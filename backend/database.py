from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection
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
