"""Atlas Search and Vector Search index management."""
import asyncio
from typing import Optional

from pymongo.operations import SearchIndexModel
from motor.motor_asyncio import AsyncIOMotorCollection

VECTOR_INDEX_NAME = "video_segment_vector_index"
TEXT_INDEX_NAME = "video_segment_text_index"

# ── Retrieval profiles ────────────────────────────────────────────────────────
# Each profile maps to a named Atlas Vector Search index.
# 512D / 256D fields are Matryoshka slices stored at processing time.
# int8 / binary share the same 1024D field — only the index definition differs.

PROFILES: dict[str, dict] = {
    "1024_float": {
        "field": "embedding",
        "dims": 1024,
        "quantization": None,
        "label": "1024D float32",
        "index": "vs_1024_float",
        "cost_note": "1× baseline",
    },
    "512_float": {
        "field": "embedding_512",
        "dims": 512,
        "quantization": None,
        "label": "512D float32",
        "index": "vs_512_float",
        "cost_note": "~0.5× storage",
    },
    "256_float": {
        "field": "embedding_256",
        "dims": 256,
        "quantization": None,
        "label": "256D float32",
        "index": "vs_256_float",
        "cost_note": "~0.25× storage",
    },
    "1024_int8": {
        "field": "embedding",
        "dims": 1024,
        "quantization": "scalar",
        "label": "1024D int8",
        "index": "vs_1024_int8",
        "cost_note": "~0.25× memory",
    },
    "1024_binary": {
        "field": "embedding",
        "dims": 1024,
        "quantization": "binary",
        "label": "1024D binary",
        "index": "vs_1024_binary",
        "cost_note": "~0.03× memory",
    },
}


async def create_profile_index(collection: AsyncIOMotorCollection, profile_key: str) -> str:
    """Create a named Atlas Vector Search index for a retrieval profile."""
    profile = PROFILES[profile_key]
    field_def: dict = {
        "type": "vector",
        "path": profile["field"],
        "numDimensions": profile["dims"],
        "similarity": "cosine",
    }
    if profile["quantization"]:
        field_def["quantization"] = profile["quantization"]

    index_def = SearchIndexModel(
        definition={"fields": [field_def]},
        name=profile["index"],
        type="vectorSearch",
    )
    try:
        result = await collection.create_search_index(index_def)
        return result
    except Exception as e:
        if "already exists" in str(e).lower() or "IndexAlreadyExists" in str(e):
            return profile["index"]
        raise


async def create_all_profile_indexes(collection: AsyncIOMotorCollection) -> list[str]:
    """Create all 5 profile vector search indexes."""
    results = []
    for key in PROFILES:
        name = await create_profile_index(collection, key)
        results.append(name)
    return results


async def get_all_profile_index_statuses(
    collection: AsyncIOMotorCollection,
) -> dict[str, str]:
    """Return status string for every profile index. Values: READY | BUILDING | PENDING | NOT_FOUND."""
    statuses = await asyncio.gather(
        *[get_index_status(collection, PROFILES[key]["index"]) for key in PROFILES]
    )
    return dict(zip(PROFILES.keys(), statuses))


async def create_vector_search_index(collection: AsyncIOMotorCollection) -> str:
    index_def = SearchIndexModel(
        definition={
            "fields": [
                {
                    "type": "vector",
                    "path": "embedding",
                    "numDimensions": 1024,
                    "similarity": "cosine",
                }
            ]
        },
        name=VECTOR_INDEX_NAME,
        type="vectorSearch",
    )
    try:
        result = await collection.create_search_index(index_def)
        return result
    except Exception as e:
        if "already exists" in str(e).lower() or "IndexAlreadyExists" in str(e):
            return VECTOR_INDEX_NAME
        raise


async def create_text_search_index(collection: AsyncIOMotorCollection) -> str:
    index_def = SearchIndexModel(
        definition={
            "mappings": {
                "dynamic": False,
                "fields": {
                    "caption_text": {"type": "string"},
                    "video_id": {"type": "string"},
                },
            }
        },
        name=TEXT_INDEX_NAME,
        type="search",
    )
    try:
        result = await collection.create_search_index(index_def)
        return result
    except Exception as e:
        if "already exists" in str(e).lower() or "IndexAlreadyExists" in str(e):
            return TEXT_INDEX_NAME
        raise


async def get_index_status(
    collection: AsyncIOMotorCollection, index_name: str
) -> str:
    """Return index status string: READY | BUILDING | PENDING | NOT_FOUND."""
    try:
        async for index in collection.list_search_indexes(index_name):
            return index.get("status", "UNKNOWN")
        return "NOT_FOUND"
    except Exception:
        return "NOT_FOUND"


async def wait_for_index_ready(
    collection: AsyncIOMotorCollection,
    index_name: str,
    timeout_seconds: int = 180,
) -> bool:
    """Poll until index status is READY or timeout."""
    start = asyncio.get_event_loop().time()
    while True:
        status = await get_index_status(collection, index_name)
        if status == "READY":
            return True
        if asyncio.get_event_loop().time() - start > timeout_seconds:
            return False
        await asyncio.sleep(5)
