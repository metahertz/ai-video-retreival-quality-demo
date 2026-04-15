"""Atlas Search and Vector Search index management."""
import asyncio
from typing import Optional

from pymongo.operations import SearchIndexModel
from motor.motor_asyncio import AsyncIOMotorCollection

VECTOR_INDEX_NAME = "video_segment_vector_index"
TEXT_INDEX_NAME = "video_segment_text_index"

# Atlas Search index limits by tier
ATLAS_FREE_TIER_LIMIT = 3   # M0 / M2 / M5 shared tiers
TOTAL_INDEXES_NEEDED = 6    # 5 vector profiles + 1 text


class IndexLimitError(Exception):
    """Raised when Atlas rejects index creation due to tier search-index quota."""
    pass


def is_index_limit_error(e: Exception) -> bool:
    """Return True if the exception message indicates an Atlas Search index quota error."""
    msg = str(e).lower()
    limit_words = {"limit", "maximum", "exceeded", "quota", "too many", "allowed", "num search"}
    index_words = {"index", "search"}
    return any(w in msg for w in limit_words) and any(w in msg for w in index_words)

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


async def check_index_capacity(collection: AsyncIOMotorCollection) -> dict:
    """
    List all Atlas Search indexes on the collection and return capacity info.

    Returns a dict with:
        existing_names       – names of all search indexes currently on this collection
        our_names            – subset that belong to this app
        missing_names        – our required indexes not yet created
        total_existing       – total count of existing search indexes
        total_needed         – how many this app requires (TOTAL_INDEXES_NEEDED)
        all_present          – True if every required index exists
        potentially_at_limit – True if existing >= FREE_TIER_LIMIT and some are still missing
        error                – error string if listing failed
    """
    our_expected = {PROFILES[k]["index"] for k in PROFILES} | {TEXT_INDEX_NAME}
    existing_names: list[str] = []
    try:
        async for idx in collection.list_search_indexes():
            name = idx.get("name", "")
            if name:
                existing_names.append(name)
    except Exception as e:
        return {
            "error": str(e),
            "existing_names": [],
            "our_names": [],
            "missing_names": sorted(our_expected),
            "total_existing": 0,
            "total_needed": TOTAL_INDEXES_NEEDED,
            "all_present": False,
            "potentially_at_limit": False,
        }

    our_present = [n for n in existing_names if n in our_expected]
    missing = sorted(n for n in our_expected if n not in existing_names)
    total = len(existing_names)
    all_present = len(missing) == 0

    # Heuristic: if we already have >= FREE_TIER_LIMIT indexes and still need more,
    # the cluster is likely at the M0/M2/M5 quota.
    potentially_at_limit = (total >= ATLAS_FREE_TIER_LIMIT) and not all_present

    return {
        "existing_names": existing_names,
        "our_names": our_present,
        "missing_names": missing,
        "total_existing": total,
        "total_needed": TOTAL_INDEXES_NEEDED,
        "all_present": all_present,
        "potentially_at_limit": potentially_at_limit,
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
        if is_index_limit_error(e):
            raise IndexLimitError(str(e)) from e
        raise


async def create_all_profile_indexes(collection: AsyncIOMotorCollection) -> dict:
    """
    Attempt to create all 5 profile vector search indexes.

    Returns a dict:
        created       – list of index names successfully created / already existing
        failed        – list of index names that failed (non-limit errors)
        limit_reached – True if an Atlas tier quota error was encountered
    """
    created: list[str] = []
    failed: list[str] = []
    limit_reached = False

    for key in PROFILES:
        try:
            name = await create_profile_index(collection, key)
            created.append(name)
        except IndexLimitError:
            limit_reached = True
            failed.append(PROFILES[key]["index"])
        except Exception:
            failed.append(PROFILES[key]["index"])

    return {"created": created, "failed": failed, "limit_reached": limit_reached}


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
        if is_index_limit_error(e):
            raise IndexLimitError(str(e)) from e
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
