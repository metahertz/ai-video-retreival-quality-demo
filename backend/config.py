from pathlib import Path
from pydantic_settings import BaseSettings
from dotenv import set_key, dotenv_values

ENV_PATH = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    voyage_api_key: str = ""
    mongodb_uri: str = ""
    mongodb_db: str = "voyage_video_demo"
    mongodb_collection_videos: str = "videos"
    mongodb_collection_segments: str = "video_segments"

    model_config = {"env_file": str(ENV_PATH), "env_file_encoding": "utf-8"}


def get_settings() -> Settings:
    """Always reload from disk so runtime saves take effect immediately."""
    return Settings()


def save_settings(
    voyage_api_key: str,
    mongodb_uri: str,
    mongodb_db: str,
    mongodb_collection_videos: str,
    mongodb_collection_segments: str,
) -> None:
    """Write settings to .env file."""
    env_path = str(ENV_PATH)
    set_key(env_path, "VOYAGE_API_KEY", voyage_api_key)
    set_key(env_path, "MONGODB_URI", mongodb_uri)
    set_key(env_path, "MONGODB_DB", mongodb_db)
    set_key(env_path, "MONGODB_COLLECTION_VIDEOS", mongodb_collection_videos)
    set_key(env_path, "MONGODB_COLLECTION_SEGMENTS", mongodb_collection_segments)


def mask_api_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return key[:4] + "****" + key[-4:]


def mask_uri(uri: str) -> str:
    """Mask credentials in mongodb+srv URI."""
    if not uri:
        return ""
    if "@" in uri:
        prefix = uri[: uri.index("//") + 2]
        rest = uri[uri.index("//") + 2 :]
        at_idx = rest.rfind("@")
        host_part = rest[at_idx:]
        return prefix + "****" + host_part
    return uri
