from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorGridFSBucket,
)
from .config import get_settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(settings.mongodb_uri)
    return _client


def reset_client() -> None:
    """Force reconnection — call after settings change."""
    global _client
    if _client is not None:
        _client.close()
        _client = None


async def get_videos_collection() -> AsyncIOMotorCollection:
    settings = get_settings()
    return get_client()[settings.mongodb_db][settings.mongodb_collection_videos]


async def get_segments_collection() -> AsyncIOMotorCollection:
    settings = get_settings()
    return get_client()[settings.mongodb_db][settings.mongodb_collection_segments]


async def get_ads_collection() -> AsyncIOMotorCollection:
    settings = get_settings()
    return get_client()[settings.mongodb_db]["ads"]


async def get_placements_collection() -> AsyncIOMotorCollection:
    settings = get_settings()
    return get_client()[settings.mongodb_db]["ad_placements"]


def get_video_bucket() -> AsyncIOMotorGridFSBucket:
    """GridFS bucket for full video files."""
    s = get_settings()
    return AsyncIOMotorGridFSBucket(get_client()[s.mongodb_db], bucket_name="video_files")


def get_segment_bucket() -> AsyncIOMotorGridFSBucket:
    """GridFS bucket for segment clips and thumbnails."""
    s = get_settings()
    return AsyncIOMotorGridFSBucket(get_client()[s.mongodb_db], bucket_name="segment_files")


async def gridfs_upload(
    bucket: AsyncIOMotorGridFSBucket,
    filename: str,
    file_path: str,
    metadata: dict | None = None,
) -> str:
    """Upload a local file to GridFS. Returns the GridFS file ObjectId as a string."""
    grid_in = await bucket.open_upload_stream(filename, metadata=metadata)
    try:
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                await grid_in.write(chunk)
        await grid_in.close()
        return str(grid_in._id)
    except Exception:
        await grid_in.abort()
        raise


async def gridfs_download(
    bucket: AsyncIOMotorGridFSBucket,
    gridfs_id: str,
    dest_path: str,
) -> None:
    """Download a GridFS file to a local path."""
    from bson import ObjectId
    grid_out = await bucket.open_download_stream(ObjectId(gridfs_id))
    with open(dest_path, "wb") as f:
        while True:
            chunk = await grid_out.read(65536)
            if not chunk:
                break
            f.write(chunk)
