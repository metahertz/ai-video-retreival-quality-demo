import asyncio
import os
import random
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, HTTPException

import voyageai.error as voyage_errors

from ..database import get_videos_collection, get_segments_collection
from ..models import ProcessRequest, ProcessJobStatus
from ..services.video_processing import (
    check_file_size,
    chunk_whole_video,
    chunk_by_captions,
    chunk_by_scenes,
    chunk_fixed_interval,
    MAX_VIDEO_BYTES,
)
from ..services.youtube import download_captions
from ..services.voyage import embed_segment

router = APIRouter()

# In-memory job store (acceptable for demo; lost on restart)
_jobs: dict[str, ProcessJobStatus] = {}

VIDEOS_DIR: str | None = None

# Parallel embedding config
MAX_CONCURRENT_EMBEDS = 3   # simultaneous API calls
MAX_RETRIES = 5
BASE_BACKOFF_SECONDS = 2.0  # doubles each retry, plus jitter


def set_videos_dir(path: str) -> None:
    global VIDEOS_DIR
    VIDEOS_DIR = path


@router.post("", response_model=ProcessJobStatus)
async def start_processing(body: ProcessRequest, background_tasks: BackgroundTasks):
    videos_col = await get_videos_collection()
    doc = await videos_col.find_one({"_id": ObjectId(body.video_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Video not found")
    if doc.get("status") == "processing":
        raise HTTPException(status_code=409, detail="Video is already being processed")

    job_id = str(uuid.uuid4())
    job = ProcessJobStatus(
        job_id=job_id,
        video_id=body.video_id,
        status="pending",
        progress=0.0,
        message="Queued",
    )
    _jobs[job_id] = job
    background_tasks.add_task(_run_processing_job, job_id, body)
    return job


@router.get("/{job_id}", response_model=ProcessJobStatus)
async def get_job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/video/{video_id}/jobs", response_model=list[ProcessJobStatus])
async def list_video_jobs(video_id: str):
    return [j for j in _jobs.values() if j.video_id == video_id]


# ── Rate-limit-aware embedding ────────────────────────────────────────────────

def _is_retryable(exc: Exception) -> bool:
    """True for rate-limit (429) and transient server errors worth retrying."""
    if isinstance(exc, (voyage_errors.RateLimitError, voyage_errors.ServiceUnavailableError)):
        return True
    # Catch-all: look for 429 / 503 in string representation
    msg = str(exc).lower()
    return "429" in msg or "rate" in msg or "too many requests" in msg or "503" in msg


async def _embed_with_backoff(chunk: dict, semaphore: asyncio.Semaphore) -> tuple[list[float], dict]:
    """
    Embed one chunk, retrying on rate-limit / server errors with
    exponential backoff + jitter. Releases the semaphore before sleeping.
    """
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        async with semaphore:
            try:
                return await embed_segment(chunk["path"], caption_text=chunk.get("caption_text"))
            except Exception as e:
                last_exc = e
                if not _is_retryable(e) or attempt >= MAX_RETRIES - 1:
                    raise
                # Fall through — semaphore released by context-manager exit
        # Sleep outside the semaphore so other tasks can proceed
        wait = BASE_BACKOFF_SECONDS * (2 ** attempt) + random.uniform(0, 1.5)
        await asyncio.sleep(wait)

    assert last_exc is not None
    raise last_exc


# ── Background processing pipeline ───────────────────────────────────────────

async def _run_processing_job(job_id: str, request: ProcessRequest) -> None:
    job = _jobs[job_id]
    videos_col = await get_videos_collection()
    segments_col = await get_segments_collection()

    def _upd(**kwargs) -> None:
        for k, v in kwargs.items():
            setattr(job, k, v)

    try:
        _upd(status="processing", message="Loading video metadata…")
        await videos_col.update_one(
            {"_id": ObjectId(request.video_id)},
            {"$set": {"status": "processing"}},
        )

        video_doc = await videos_col.find_one({"_id": ObjectId(request.video_id)})
        video_path = video_doc["file_path"]
        youtube_id = video_doc.get("youtube_id", "")

        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # Remove old segments for this video (re-processing)
        old_segs = await segments_col.find({"video_id": request.video_id}).to_list(10000)
        for seg in old_segs:
            fp = seg.get("file_path", "")
            if fp and os.path.exists(fp) and fp != video_path:
                try:
                    os.remove(fp)
                except OSError:
                    pass
        await segments_col.delete_many({"video_id": request.video_id})

        # ── Chunking ──────────────────────────────────────────────────────────
        _upd(message="Chunking video…")
        segment_dir = os.path.join(os.path.dirname(video_path), "segments")
        os.makedirs(segment_dir, exist_ok=True)

        chunks: list[dict] = []
        if request.chunking_strategy == "whole":
            chunks = await chunk_whole_video(video_path)

        elif request.chunking_strategy == "caption":
            _upd(message="Downloading captions…")
            video_dir = os.path.dirname(video_path)
            captions = await download_captions(youtube_id, video_dir)
            if not captions:
                raise ValueError(
                    "No English captions found for this video. "
                    "Try a different chunking strategy."
                )
            _upd(message="Splitting by captions…")
            chunks = await chunk_by_captions(video_path, captions, segment_dir)

        elif request.chunking_strategy == "scene":
            _upd(message="Detecting scene changes…")
            chunks = await chunk_by_scenes(video_path, segment_dir)

        elif request.chunking_strategy == "fixed":
            interval = request.interval_seconds or 30.0
            _upd(message=f"Splitting into {interval}s segments…")
            chunks = await chunk_fixed_interval(video_path, segment_dir, interval)

        # Filter out oversized / missing files before embedding
        valid_chunks: list[tuple[int, dict]] = []
        skipped_pre = 0
        for i, chunk in enumerate(chunks):
            if not os.path.exists(chunk["path"]):
                skipped_pre += 1
                continue
            if os.path.getsize(chunk["path"]) > MAX_VIDEO_BYTES:
                skipped_pre += 1
                continue
            valid_chunks.append((i, chunk))

        total = len(valid_chunks)
        _upd(
            total_segments=total,
            message=f"Embedding {total} segments"
            + (f" ({MAX_CONCURRENT_EMBEDS} in parallel)" if total > 1 else "")
            + "…",
        )

        # ── Parallel embedding with rate-limit backoff ────────────────────────
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_EMBEDS)
        # Shared progress counter (asyncio is single-threaded — no lock needed)
        completed_count = 0
        skipped_embed = 0

        async def _embed_one(orig_index: int, chunk: dict) -> None:
            nonlocal completed_count, skipped_embed
            try:
                embeddings_dict, metadata = await _embed_with_backoff(chunk, semaphore)
                seg_doc = {
                    "video_id": request.video_id,
                    "segment_index": orig_index,
                    "start_time": chunk["start"],
                    "end_time": chunk["end"],
                    "caption_text": chunk.get("caption_text"),
                    "file_path": chunk["path"],
                    "embedding": embeddings_dict["embedding"],
                    "embedding_512": embeddings_dict["embedding_512"],
                    "embedding_256": embeddings_dict["embedding_256"],
                    "chunking_strategy": request.chunking_strategy,
                    "metadata": metadata,
                    "created_at": datetime.now(timezone.utc),
                }
                await segments_col.insert_one(seg_doc)
                job.segments_processed += 1
            except Exception as e:
                skipped_embed += 1
                _upd(message=f"Segment {orig_index + 1} failed: {e} — continuing…")
            finally:
                completed_count += 1
                if total > 0:
                    _upd(
                        progress=completed_count / total,
                        message=f"Embedded {job.segments_processed}/{total} segments"
                        + (f" ({skipped_embed} failed)" if skipped_embed else "")
                        + "…",
                    )

        await asyncio.gather(*[_embed_one(i, chunk) for i, chunk in valid_chunks])

        total_skipped = skipped_pre + skipped_embed
        await videos_col.update_one(
            {"_id": ObjectId(request.video_id)},
            {
                "$set": {
                    "status": "completed",
                    "segment_count": job.segments_processed,
                    "chunking_strategy": request.chunking_strategy,
                }
            },
        )
        _upd(
            status="completed",
            progress=1.0,
            message=f"Done — {job.segments_processed} segments embedded"
            + (f", {total_skipped} skipped" if total_skipped else ""),
        )

    except Exception as e:
        err_msg = str(e)
        _upd(status="error", message=err_msg)
        try:
            await videos_col.update_one(
                {"_id": ObjectId(request.video_id)},
                {"$set": {"status": "error", "error_message": err_msg}},
            )
        except Exception:
            pass
