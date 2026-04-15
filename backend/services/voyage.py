"""VoyageAI multimodal embedding service."""
import asyncio
from typing import Optional

import voyageai
from voyageai.video_utils import Video

from ..config import get_settings

MODEL = "voyage-multimodal-3.5"


def _get_client() -> voyageai.AsyncClient:
    settings = get_settings()
    return voyageai.AsyncClient(api_key=settings.voyage_api_key)


def _load_video_sync(path: str) -> Video:
    """Load and optimise a video. Runs ffmpeg synchronously — wrap in executor."""
    return Video.from_path(path, model=MODEL, optimize=True)


async def embed_segment(
    segment_path: str,
    caption_text: Optional[str] = None,
) -> tuple[dict[str, list[float]], dict]:
    """
    Embed a single video segment.
    Returns (embeddings_dict, metadata_dict).

    embeddings_dict keys:
      "embedding"     — full 1024D vector
      "embedding_512" — first 512 dimensions (Matryoshka slice)
      "embedding_256" — first 256 dimensions (Matryoshka slice)
    """
    client = _get_client()
    loop = asyncio.get_event_loop()

    # Video.from_path runs ffmpeg — must be in executor
    video = await loop.run_in_executor(None, _load_video_sync, segment_path)

    inputs = [[video, caption_text]] if caption_text else [[video]]

    result = await client.multimodal_embed(
        inputs=inputs,
        model=MODEL,
        input_type="document",
    )

    emb_1024 = result.embeddings[0]
    embeddings = {
        "embedding": emb_1024,
        "embedding_512": emb_1024[:512],
        "embedding_256": emb_1024[:256],
    }
    metadata = {
        "num_pixels": getattr(video, "num_pixels", None),
        "num_frames": getattr(video, "num_frames", None),
        "estimated_tokens": getattr(video, "estimated_num_tokens", None),
        "video_pixels_used": getattr(result, "video_pixels", None),
        "total_tokens": getattr(result, "total_tokens", None),
    }
    return embeddings, metadata


async def embed_query(query_text: str, dims: int = 1024) -> list[float]:
    """Embed a text query for vector search. Truncates to `dims` if < 1024."""
    client = _get_client()
    result = await client.multimodal_embed(
        inputs=[[query_text]],
        model=MODEL,
        input_type="query",
    )
    emb = result.embeddings[0]
    return emb[:dims] if dims < len(emb) else emb


async def test_api_key() -> None:
    """Raise an exception if the API key is invalid."""
    client = _get_client()
    await client.multimodal_embed(
        inputs=[["test"]],
        model=MODEL,
        input_type="query",
    )
