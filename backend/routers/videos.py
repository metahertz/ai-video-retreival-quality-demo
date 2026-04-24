import os
import shutil
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiofiles
from bson import ObjectId
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from ..config import get_settings
from ..database import (
    get_segments_collection,
    get_videos_collection,
    get_video_bucket,
    get_segment_bucket,
    gridfs_upload,
)
from ..models import (
    VideoDownloadRequest,
    VideoResponse,
    YouTubeSearchRequest,
    YouTubeSearchResult,
    serialize_doc,
)
from ..services.youtube import search_youtube, download_video, find_downloaded_file
from .process import cancel_video_jobs

router = APIRouter()

VIDEOS_DIR: Optional[str] = None  # set at startup via main.py


def set_videos_dir(path: str) -> None:
    global VIDEOS_DIR
    VIDEOS_DIR = path


def _doc_to_response(doc: dict) -> VideoResponse:
    doc = serialize_doc(doc)
    file_path = doc.get("file_path", "")
    gridfs_file_id = doc.get("gridfs_file_id")
    # File is only "missing" if there's no local copy AND no GridFS backup
    file_missing = bool(
        file_path and not os.path.exists(file_path) and not gridfs_file_id
    )
    return VideoResponse(
        id=doc["_id"],
        title=doc["title"],
        youtube_id=doc["youtube_id"],
        youtube_url=doc.get("youtube_url", ""),
        file_path=file_path,
        duration=doc.get("duration", 0.0),
        thumbnail_url=doc.get("thumbnail_url", ""),
        status=doc.get("status", "downloaded"),
        created_at=doc.get("created_at", datetime.now(timezone.utc)),
        segment_count=doc.get("segment_count", 0),
        chunking_strategy=doc.get("chunking_strategy"),
        error_message=doc.get("error_message"),
        file_missing=file_missing,
    )


# ── GridFS streaming helper ───────────────────────────────────────────────────

async def _stream_from_gridfs(bucket, gridfs_id: str, request: Request, content_type: str = "video/mp4") -> StreamingResponse:
    """Stream a file from GridFS, supporting Range requests."""
    grid_out = await bucket.open_download_stream(ObjectId(gridfs_id))
    file_size = grid_out.length
    range_header = request.headers.get("range")

    if range_header:
        range_val = range_header.replace("bytes=", "")
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        # Skip to start by reading and discarding
        if start > 0:
            skipped = 0
            while skipped < start:
                to_read = min(65536, start - skipped)
                data = await grid_out.read(to_read)
                if not data:
                    break
                skipped += len(data)

        async def generate_partial():
            remaining = chunk_size
            while remaining > 0:
                data = await grid_out.read(min(65536, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

        return StreamingResponse(
            generate_partial(),
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )
    else:
        async def generate_full():
            while True:
                data = await grid_out.read(65536)
                if not data:
                    break
                yield data

        return StreamingResponse(
            generate_full(),
            status_code=200,
            media_type=content_type,
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
            },
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
        thumbnails = info.get("thumbnails") or []
        thumb = thumbnails[-1]["url"] if thumbnails else info.get("thumbnail", "")

        # Upload to GridFS so the file is available on server-hosted instances
        gridfs_file_id = None
        if file_path and os.path.exists(file_path):
            try:
                bucket = get_video_bucket()
                gridfs_file_id = await gridfs_upload(
                    bucket,
                    f"{body.youtube_id}.mp4",
                    file_path,
                    metadata={"youtube_id": body.youtube_id, "title": info.get("title", "")},
                )
            except Exception:
                pass  # GridFS upload is best-effort; local file still works

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
            "gridfs_file_id": gridfs_file_id,
        }
        result = await col.insert_one(doc)
        doc["_id"] = result.inserted_id
        return _doc_to_response(doc)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {e}")


# ── Local file upload ─────────────────────────────────────────────────────────

@router.post("/upload", response_model=VideoResponse)
async def upload_video_file(
    file: UploadFile = File(...),
    title: str = Form(...),
):
    """Upload a local video file directly into the library."""
    if not VIDEOS_DIR:
        raise HTTPException(status_code=500, detail="Videos directory not configured")

    col = await get_videos_collection()

    # Use a stable local ID derived from the filename + uuid
    local_id = f"local_{uuid.uuid4().hex[:12]}"
    video_dir = os.path.join(VIDEOS_DIR, local_id)
    os.makedirs(video_dir, exist_ok=True)

    original_name = file.filename or "video.mp4"
    ext = os.path.splitext(original_name)[1].lower() or ".mp4"
    file_path = os.path.join(video_dir, f"video{ext}")

    # Stream the upload to disk
    try:
        async with aiofiles.open(file_path, "wb") as out:
            while True:
                chunk = await file.read(65536)
                if not chunk:
                    break
                await out.write(chunk)
    except Exception as e:
        shutil.rmtree(video_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Probe duration with ffmpeg
    duration = 0.0
    try:
        import ffmpeg as ffmpeg_lib
        probe = ffmpeg_lib.probe(file_path)
        duration = float(probe["format"].get("duration", 0))
    except Exception:
        pass

    # Upload to GridFS
    gridfs_file_id = None
    try:
        bucket = get_video_bucket()
        gridfs_file_id = await gridfs_upload(
            bucket,
            original_name,
            file_path,
            metadata={"title": title, "source": "local_upload"},
        )
    except Exception:
        pass  # Best-effort

    doc = {
        "title": title,
        "youtube_id": local_id,
        "youtube_url": "",
        "file_path": file_path,
        "duration": duration,
        "thumbnail_url": "",
        "status": "downloaded",
        "created_at": datetime.now(timezone.utc),
        "segment_count": 0,
        "chunking_strategy": None,
        "error_message": None,
        "gridfs_file_id": gridfs_file_id,
    }
    result = await col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _doc_to_response(doc)


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

    # Cancel any active processing jobs before deleting
    cancel_video_jobs(video_id)

    # Delete segment files (disk + GridFS)
    seg_bucket = get_segment_bucket()
    segments = await segments_col.find({"video_id": video_id}).to_list(10000)
    for seg in segments:
        if seg.get("file_path") and os.path.exists(seg["file_path"]):
            try:
                os.remove(seg["file_path"])
            except OSError:
                pass
        for field in ("gridfs_file_id", "gridfs_thumb_id"):
            gfs_id = seg.get(field)
            if gfs_id:
                try:
                    await seg_bucket.delete(ObjectId(gfs_id))
                except Exception:
                    pass

    # Delete video file from GridFS
    vid_gridfs_id = doc.get("gridfs_file_id")
    if vid_gridfs_id:
        try:
            await get_video_bucket().delete(ObjectId(vid_gridfs_id))
        except Exception:
            pass

    # Delete video directory from disk
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

    file_path = doc.get("file_path", "")
    if file_path and os.path.exists(file_path):
        return await _stream_file(file_path, request)

    # Fall back to GridFS
    gridfs_id = doc.get("gridfs_file_id")
    if not gridfs_id:
        raise HTTPException(status_code=404, detail="Video file not available")
    return await _stream_from_gridfs(get_video_bucket(), gridfs_id, request)


@router.get("/{video_id}/segments/{seg_index}/stream")
async def stream_segment(video_id: str, seg_index: int, request: Request):
    col = await get_segments_collection()
    doc = await col.find_one({"video_id": video_id, "segment_index": seg_index})
    if not doc:
        raise HTTPException(status_code=404, detail="Segment not found")

    file_path = doc.get("file_path", "")
    if file_path and os.path.exists(file_path):
        return await _stream_file(file_path, request)

    # Fall back to GridFS
    gridfs_id = doc.get("gridfs_file_id")
    if not gridfs_id:
        raise HTTPException(status_code=404, detail="Segment file not available")
    return await _stream_from_gridfs(get_segment_bucket(), gridfs_id, request)


@router.get("/{video_id}/segments/{seg_index}/thumbnail")
async def get_segment_thumbnail(video_id: str, seg_index: int):
    col = await get_segments_collection()
    doc = await col.find_one(
        {"video_id": video_id, "segment_index": seg_index},
        {"thumbnail_path": 1, "gridfs_thumb_id": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Segment not found")

    thumb_path = doc.get("thumbnail_path")
    if thumb_path and os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/jpeg")

    # Fall back to GridFS
    gridfs_thumb_id = doc.get("gridfs_thumb_id")
    if not gridfs_thumb_id:
        raise HTTPException(status_code=404, detail="Thumbnail not available")

    grid_out = await get_segment_bucket().open_download_stream(ObjectId(gridfs_thumb_id))
    data = await grid_out.read()
    from fastapi.responses import Response
    return Response(content=data, media_type="image/jpeg")
