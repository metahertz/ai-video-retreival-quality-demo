from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from ..config import get_settings, save_settings, mask_api_key, mask_uri
from ..database import get_client, reset_client, get_segments_collection
from ..models import (
    SettingsRequest,
    SettingsResponse,
    ConnectionTestResult,
    IndexStatusResponse,
    AllIndexStatusResponse,
    ProfileIndexStatus,
)
from ..services.voyage import test_api_key
from ..services.atlas import (
    PROFILES,
    TEXT_INDEX_NAME,
    create_all_profile_indexes,
    create_text_search_index,
    get_index_status,
    get_all_profile_index_statuses,
    # legacy — kept for backward compat
    create_vector_search_index,
    VECTOR_INDEX_NAME,
)

router = APIRouter()


@router.get("", response_model=SettingsResponse)
async def get_settings_endpoint():
    s = get_settings()
    return SettingsResponse(
        voyage_api_key_masked=mask_api_key(s.voyage_api_key),
        mongodb_uri_masked=mask_uri(s.mongodb_uri),
        mongodb_db=s.mongodb_db,
        mongodb_collection_videos=s.mongodb_collection_videos,
        mongodb_collection_segments=s.mongodb_collection_segments,
        settings_configured=bool(s.voyage_api_key and s.mongodb_uri),
    )


@router.post("", response_model=SettingsResponse)
async def save_settings_endpoint(body: SettingsRequest):
    save_settings(
        voyage_api_key=body.voyage_api_key,
        mongodb_uri=body.mongodb_uri,
        mongodb_db=body.mongodb_db,
        mongodb_collection_videos=body.mongodb_collection_videos,
        mongodb_collection_segments=body.mongodb_collection_segments,
    )
    reset_client()
    s = get_settings()
    return SettingsResponse(
        voyage_api_key_masked=mask_api_key(s.voyage_api_key),
        mongodb_uri_masked=mask_uri(s.mongodb_uri),
        mongodb_db=s.mongodb_db,
        mongodb_collection_videos=s.mongodb_collection_videos,
        mongodb_collection_segments=s.mongodb_collection_segments,
        settings_configured=bool(s.voyage_api_key and s.mongodb_uri),
    )


@router.post("/test-connection", response_model=ConnectionTestResult)
async def test_connection(body: SettingsRequest):
    voyage_ok = False
    voyage_error = None
    mongodb_ok = False
    mongodb_error = None

    # Test VoyageAI
    if body.voyage_api_key:
        try:
            import voyageai
            client = voyageai.AsyncClient(api_key=body.voyage_api_key)
            await client.multimodal_embed(
                inputs=[["test"]],
                model="voyage-multimodal-3.5",
                input_type="query",
            )
            voyage_ok = True
        except Exception as e:
            voyage_error = str(e)
    else:
        voyage_error = "API key not provided"

    # Test MongoDB
    if body.mongodb_uri:
        try:
            test_client = AsyncIOMotorClient(
                body.mongodb_uri,
                serverSelectionTimeoutMS=5000,
            )
            await test_client.admin.command("ping")
            test_client.close()
            mongodb_ok = True
        except Exception as e:
            mongodb_error = str(e)
    else:
        mongodb_error = "MongoDB URI not provided"

    return ConnectionTestResult(
        voyage_ok=voyage_ok,
        mongodb_ok=mongodb_ok,
        voyage_error=voyage_error,
        mongodb_error=mongodb_error,
    )


@router.post("/create-indexes")
async def create_indexes():
    """Create all 5 profile vector search indexes plus the text index."""
    try:
        col = await get_segments_collection()
        await create_all_profile_indexes(col)
        await create_text_search_index(col)
        return {
            "status": "creating",
            "message": "Index creation initiated. Indexes will be READY within 1–2 minutes.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/index-status", response_model=AllIndexStatusResponse)
async def index_status():
    """Return status for all 5 profile indexes plus the text index."""
    try:
        col = await get_segments_collection()
        profile_statuses = await get_all_profile_index_statuses(col)
        text_status = await get_index_status(col, TEXT_INDEX_NAME)

        profile_list = [
            ProfileIndexStatus(
                profile_key=key,
                label=PROFILES[key]["label"],
                dims=PROFILES[key]["dims"],
                quantization=PROFILES[key]["quantization"],
                cost_note=PROFILES[key]["cost_note"],
                index_name=PROFILES[key]["index"],
                status=profile_statuses[key],
            )
            for key in PROFILES
        ]

        statuses_summary = ", ".join(
            f"{p.label}: {p.status}" for p in profile_list
        )
        return AllIndexStatusResponse(
            profiles=profile_list,
            text_index_status=text_status,
            message=f"{statuses_summary} | Text: {text_status}",
        )
    except Exception as e:
        return AllIndexStatusResponse(
            profiles=[],
            text_index_status="ERROR",
            message=str(e),
        )


@router.post("/backfill-dimensions")
async def backfill_dimensions():
    """
    Slice 512D and 256D sub-embeddings from existing 1024D stored embeddings.
    No VoyageAI API calls — reads the stored `embedding` field and writes
    `embedding_512` / `embedding_256`. Streams with a cursor to avoid loading
    all embeddings into memory at once.
    """
    try:
        col = await get_segments_collection()
        updated = 0
        async for seg in col.find(
            {"embedding_512": {"$exists": False}},
            {"_id": 1, "embedding": 1},
        ):
            emb = seg.get("embedding")
            if not emb or len(emb) < 512:
                continue
            await col.update_one(
                {"_id": seg["_id"]},
                {"$set": {
                    "embedding_512": emb[:512],
                    "embedding_256": emb[:256],
                }},
            )
            updated += 1
        return {"updated": updated, "message": f"Backfilled {updated} segments."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
