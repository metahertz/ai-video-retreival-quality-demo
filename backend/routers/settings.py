import os

from bson import ObjectId
from fastapi import APIRouter, HTTPException, UploadFile, File as FastAPIFile
from motor.motor_asyncio import AsyncIOMotorClient

from ..config import get_settings, save_settings, mask_api_key, mask_uri, COOKIES_PATH
from ..database import get_client, reset_client, get_segments_collection, get_videos_collection
from ..models import (
    SettingsRequest,
    SettingsResponse,
    ConnectionTestResult,
    IndexStatusResponse,
    AllIndexStatusResponse,
    ProfileIndexStatus,
    IndexCapacityInfo,
    CreateIndexesResult,
)
from ..services.voyage import test_api_key
from ..services.video_processing import generate_thumbnail
from ..services.atlas import (
    PROFILES,
    TEXT_INDEX_NAME,
    ATLAS_FREE_TIER_LIMIT,
    TOTAL_INDEXES_NEEDED,
    IndexLimitError,
    check_index_capacity,
    create_all_indexes,
    create_all_profile_indexes,
    create_text_search_index,
    get_index_status,
    get_all_profile_index_statuses,
    # legacy — kept for backward compat
    create_vector_search_index,
    VECTOR_INDEX_NAME,
)

router = APIRouter()


def _settings_response(s) -> SettingsResponse:
    return SettingsResponse(
        voyage_api_key_masked=mask_api_key(s.voyage_api_key),
        mongodb_uri_masked=mask_uri(s.mongodb_uri),
        mongodb_db=s.mongodb_db,
        mongodb_collection_videos=s.mongodb_collection_videos,
        mongodb_collection_segments=s.mongodb_collection_segments,
        settings_configured=bool(s.voyage_api_key and s.mongodb_uri),
        yt_dlp_cookies_browser=s.yt_dlp_cookies_browser,
        yt_dlp_cookies_file=s.yt_dlp_cookies_file,
    )


@router.get("", response_model=SettingsResponse)
async def get_settings_endpoint():
    return _settings_response(get_settings())


@router.post("", response_model=SettingsResponse)
async def save_settings_endpoint(body: SettingsRequest):
    save_settings(
        voyage_api_key=body.voyage_api_key,
        mongodb_uri=body.mongodb_uri,
        mongodb_db=body.mongodb_db,
        mongodb_collection_videos=body.mongodb_collection_videos,
        mongodb_collection_segments=body.mongodb_collection_segments,
        yt_dlp_cookies_browser=body.yt_dlp_cookies_browser,
        yt_dlp_cookies_file=body.yt_dlp_cookies_file,
    )
    reset_client()
    return _settings_response(get_settings())


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


@router.post("/upload-cookies")
async def upload_cookies(file: UploadFile = FastAPIFile(...)):
    """Upload a Netscape-format cookies.txt file to the server and configure it for yt-dlp."""
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
    COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
    COOKIES_PATH.write_bytes(contents)
    s = get_settings()
    save_settings(
        voyage_api_key=s.voyage_api_key,
        mongodb_uri=s.mongodb_uri,
        mongodb_db=s.mongodb_db,
        mongodb_collection_videos=s.mongodb_collection_videos,
        mongodb_collection_segments=s.mongodb_collection_segments,
        yt_dlp_cookies_browser=s.yt_dlp_cookies_browser,
        yt_dlp_cookies_file=str(COOKIES_PATH),
    )
    reset_client()
    return {"path": str(COOKIES_PATH), "bytes": len(contents)}


@router.delete("/cookies")
async def delete_cookies():
    """Delete the uploaded cookies file and clear the yt-dlp cookies file setting."""
    if COOKIES_PATH.exists():
        COOKIES_PATH.unlink()
    s = get_settings()
    save_settings(
        voyage_api_key=s.voyage_api_key,
        mongodb_uri=s.mongodb_uri,
        mongodb_db=s.mongodb_db,
        mongodb_collection_videos=s.mongodb_collection_videos,
        mongodb_collection_segments=s.mongodb_collection_segments,
        yt_dlp_cookies_browser=s.yt_dlp_cookies_browser,
        yt_dlp_cookies_file="",
    )
    reset_client()
    return {"ok": True}


@router.get("/index-capacity", response_model=IndexCapacityInfo)
async def index_capacity():
    """
    Return the current Atlas Search index count for the segments collection
    and whether the cluster may be at the M0/M2/M5 tier quota.
    """
    try:
        col = await get_segments_collection()
        info = await check_index_capacity(col)
        if "error" in info:
            raise HTTPException(status_code=500, detail=info["error"])

        if info["all_present"]:
            msg = "All required indexes are present."
        elif info["potentially_at_limit"]:
            msg = (
                f"{len(info['missing_names'])} index(es) still needed, but the cluster already "
                f"has {info['total_existing']} search index(es) — at or above the "
                f"{ATLAS_FREE_TIER_LIMIT}-index limit for M0/M2/M5 tiers. "
                f"Upgrade to M10+ to create all {TOTAL_INDEXES_NEEDED} required indexes."
            )
        else:
            msg = f"{len(info['missing_names'])} index(es) not yet created."

        return IndexCapacityInfo(
            total_existing=info["total_existing"],
            our_indexes_count=len(info["our_names"]),
            missing_indexes=info["missing_names"],
            total_needed=TOTAL_INDEXES_NEEDED,
            all_present=info["all_present"],
            potentially_at_limit=info["potentially_at_limit"],
            tier_limit=ATLAS_FREE_TIER_LIMIT,
            message=msg,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-indexes", response_model=CreateIndexesResult)
async def create_indexes():
    """
    Create all indexes in tier-aware priority order: primary vector → text → remaining profiles.
    On free/shared clusters (3-index limit) this ensures both search types work before
    the quota is exhausted on secondary vector profiles.
    """
    try:
        col = await get_segments_collection()
        result = await create_all_indexes(col)

        if result["limit_reached"]:
            n_created = len(result["created"])
            return CreateIndexesResult(
                status="limit_reached",
                message=(
                    f"Atlas Search index quota reached after creating "
                    f"{n_created} index(es). "
                    f"Your cluster tier (M0/M2/M5) allows only {ATLAS_FREE_TIER_LIMIT} "
                    f"search indexes, but this demo needs {TOTAL_INDEXES_NEEDED}. "
                    f"The search page will automatically adapt to the available indexes. "
                    f"Upgrade to M10 or higher to unlock all profiles and comparison."
                ),
                limit_reached=True,
                created_count=n_created,
                failed_count=len(result["failed"]),
                upgrade_required=True,
            )

        if result["failed"]:
            return CreateIndexesResult(
                status="partial",
                message=(
                    f"Created {len(result['created'])} index(es); "
                    f"{len(result['failed'])} failed with unexpected errors."
                ),
                limit_reached=False,
                created_count=len(result["created"]),
                failed_count=len(result["failed"]),
                upgrade_required=False,
            )

        return CreateIndexesResult(
            status="creating",
            message="Index creation initiated. Indexes will be READY within 1–2 minutes.",
            limit_reached=False,
            created_count=len(result["created"]),
            failed_count=0,
            upgrade_required=False,
        )
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


@router.post("/backfill-thumbnails")
async def backfill_thumbnails():
    """
    Generate thumbnails for segments that don't have one yet.
    Reads each segment's start/end time and the parent video's file path,
    then extracts a JPEG frame at the midpoint using ffmpeg.
    No VoyageAI API calls required.
    """
    try:
        col = await get_segments_collection()
        videos_col = await get_videos_collection()
        updated = 0
        skipped = 0
        async for seg in col.find(
            {"thumbnail_path": {"$exists": False}},
            {"_id": 1, "video_id": 1, "segment_index": 1, "start_time": 1, "end_time": 1},
        ):
            video = await videos_col.find_one(
                {"_id": ObjectId(seg["video_id"])},
                {"file_path": 1},
            )
            if not video or not video.get("file_path"):
                skipped += 1
                continue
            video_path = video["file_path"]
            if not os.path.exists(video_path):
                skipped += 1
                continue
            midpoint = (seg.get("start_time", 0) + seg.get("end_time", 0)) / 2
            thumb_dir = os.path.join(os.path.dirname(video_path), "thumbnails")
            thumb_path = os.path.join(thumb_dir, f"thumb_{seg.get('segment_index', 0):04d}.jpg")
            try:
                await generate_thumbnail(video_path, midpoint, thumb_path)
                await col.update_one(
                    {"_id": seg["_id"]},
                    {"$set": {"thumbnail_path": thumb_path}},
                )
                updated += 1
            except Exception:
                skipped += 1
        msg = f"Generated {updated} thumbnails"
        if skipped:
            msg += f", {skipped} skipped"
        return {"updated": updated, "skipped": skipped, "message": msg + "."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
