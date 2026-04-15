import os
import shutil
from datetime import datetime, timezone
from typing import Optional

import aiofiles
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..config import get_settings
from ..database import get_videos_collection, get_segments_collection
from ..models import (
    VideoDownloadRequest,
    VideoResponse,
    YouTubeSearchRequest,
    YouTubeSearchResult,
    serialize_doc,
)
from ..services.youtube import search_youtube, download_video, find_downloaded_file

router = APIRouter()

VIDEOS_DIR: Optional[str] = None  # set at startup via main.py


def set_videos_dir(path: str) -> None:
    global VIDEOS_DIR
    VIDEOS_DIR = path


def _doc_to_response(doc: dict) -> VideoResponse:
    doc = serialize_doc(doc)
    return VideoResponse(
        id=doc["_id"],
        title=doc["title"],
        youtube_id=doc["youtube_id"],
        youtube_url=doc["youtube_url"],
        file_path=doc.get("file_path", ""),
        duration=doc.get("duration", 0.0),
        thumbnail_url=doc.get("thumbnail_url", ""),
        status=doc.get("status", "downloaded"),
        created_at=doc.get("created_at", datetime.now(timezone.utc)),
        segment_count=doc.get("segment_count", 0),
        chunking_strategy=doc.get("chunking_strategy"),
        error_message=doc.get("error_message"),
    )


# ── YouTube search ────────────────────────────────────────────────────────────

@router.post("/search", response_model=list[YouTubeSearchResult])
async def search_videos(body: YouTubeSearchRequest):
    try:
        results = await search_youtube(body.query, body.max_results)
        return [YouTubeSearchResult(**r) for r in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Download ──────────────────────────────────────────────────────────────────

@router.post("/download", response_model=VideoResponse)
async def download_video_endpoint(body: VideoDownloadRequest):
    if not VIDEOS_DIR:
        raise HTTPException(status_code=500, detail="Videos directory not configured")

    col = await get_videos_collection()

    # Check if already downloaded
    existing = await col.find_one({"youtube_id": body.youtube_id})
    if existing:
        return _doc_to_response(existing)

    video_dir = os.path.join(VIDEOS_DIR, body.youtube_id)
    try:
        info = await download_video(body.youtube_id, video_dir)
        file_path = find_downloaded_file(video_dir) or ""
        duration = float(info.get("duration") or 0)
        # Best thumbnail
        thumbnails = info.get("thumbnails") or []
        thumb = thumbnails[-1]["url"] if thumbnails else info.get("thumbnail", "")

        doc = {
            "title": info.get("title", "Untitled"),
            "youtube_id": body.youtube_id,
            "youtube_url": f"https://www.youtube.com/watch?v={body.youtube_id}",
            "file_path": file_path,
            "duration": duration,
            "thumbnail_url": thumb,
            "status": "downloaded",
            "created_at": datetime.now(timezone.utc),
            "segment_count": 0,
            "chunking_strategy": None,
            "error_message": None,
        }
        result = await col.insert_one(doc)
        doc["_id"] = result.inserted_id
        return _doc_to_response(doc)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {e}")


# ── List / Get ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[VideoResponse])
async def list_videos():
    col = await get_videos_collection()
    docs = await col.find({}).sort("created_at", -1).to_list(100)
    return [_doc_to_response(d) for d in docs]


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(video_id: str):
    col = await get_videos_collection()
    doc = await col.find_one({"_id": ObjectId(video_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Video not found")
    return _doc_to_response(doc)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{video_id}")
async def delete_video(video_id: str):
    videos_col = await get_videos_collection()
    segments_col = await get_segments_collection()

    doc = await videos_col.find_one({"_id": ObjectId(video_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Video not found")

    # Delete segment files on disk
    segments = await segments_col.find({"video_id": video_id}).to_list(10000)
    for seg in segments:
        if seg.get("file_path") and os.path.exists(seg["file_path"]):
            try:
                os.remove(seg["file_path"])
            except OSError:
                pass

    # Delete video directory
    if VIDEOS_DIR:
        youtube_id = doc.get("youtube_id", "")
        video_dir = os.path.join(VIDEOS_DIR, youtube_id)
        if os.path.exists(video_dir):
            shutil.rmtree(video_dir, ignore_errors=True)

    await segments_col.delete_many({"video_id": video_id})
    await videos_col.delete_one({"_id": ObjectId(video_id)})
    return {"ok": True}


# ── Streaming ─────────────────────────────────────────────────────────────────

async def _stream_file(file_path: str, request: Request) -> StreamingResponse:
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    if range_header:
        range_val = range_header.replace("bytes=", "")
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        async def generate_partial():
            async with aiofiles.open(file_path, "rb") as f:
                await f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    read_size = min(65536, remaining)
                    data = await f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            generate_partial(),
            status_code=206,
            media_type="video/mp4",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )
    else:
        async def generate_full():
            async with aiofiles.open(file_path, "rb") as f:
                while chunk := await f.read(65536):
                    yield chunk

        return StreamingResponse(
            generate_full(),
            status_code=200,
            media_type="video/mp4",
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
            },
        )


@router.get("/{video_id}/stream")
async def stream_video(video_id: str, request: Request):
    col = await get_videos_collection()
    doc = await col.find_one({"_id": ObjectId(video_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Video not found")
    return await _stream_file(doc["file_path"], request)


@router.get("/{video_id}/segments/{seg_index}/stream")
async def stream_segment(video_id: str, seg_index: int, request: Request):
    col = await get_segments_collection()
    doc = await col.find_one({"video_id": video_id, "segment_index": seg_index})
    if not doc:
        raise HTTPException(status_code=404, detail="Segment not found")
    return await _stream_file(doc["file_path"], request)
