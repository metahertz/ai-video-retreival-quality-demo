"""Ads CRUD, semantic matching, and placement management."""
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query

from ..database import (
    get_ads_collection,
    get_placements_collection,
    get_segments_collection,
    get_videos_collection,
)
from ..models import (
    AdCreate,
    AdMatchSegment,
    AdResponse,
    AdUpdate,
    EmotionScoreResult,
    PlacementCreate,
    PlacementResponse,
    serialize_doc,
)
from ..services.emotions import average_embedding, embed_anchors, score_against_anchors
from ..services.voyage import embed_query

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _doc_to_ad_response(doc: dict) -> AdResponse:
    return AdResponse(
        id=doc["_id"],
        title=doc["title"],
        description=doc["description"],
        duration_seconds=doc["duration_seconds"],
        emotion_tags=doc.get("emotion_tags", []),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


def _doc_to_placement_response(doc: dict) -> PlacementResponse:
    return PlacementResponse(
        id=doc["_id"],
        ad_id=doc["ad_id"],
        ad_title=doc["ad_title"],
        ad_description=doc["ad_description"],
        duration_seconds=doc["duration_seconds"],
        segment_id=doc["segment_id"],
        video_id=doc["video_id"],
        video_title=doc["video_title"],
        segment_index=doc["segment_index"],
        start_time=doc["start_time"],
        match_score=doc["match_score"],
        created_at=doc["created_at"],
    )


# ── Create & list ads ─────────────────────────────────────────────────────────

@router.post("", response_model=AdResponse)
async def create_ad(body: AdCreate):
    """Embed the ad description and store the ad with 1024/512/256D vectors."""
    try:
        embedding = await embed_query(body.description, dims=1024)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

    now = datetime.now(timezone.utc)
    doc = {
        "title": body.title,
        "description": body.description,
        "duration_seconds": body.duration_seconds,
        "emotion_tags": list(body.emotion_tags),
        "embedding": embedding,
        "embedding_512": embedding[:512],
        "embedding_256": embedding[:256],
        "created_at": now,
        "updated_at": now,
    }
    ads_col = await get_ads_collection()
    result = await ads_col.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return _doc_to_ad_response(doc)


@router.get("", response_model=list[AdResponse])
async def list_ads():
    ads_col = await get_ads_collection()
    docs = await ads_col.find(
        {}, {"embedding": 0, "embedding_512": 0, "embedding_256": 0}
    ).sort("created_at", -1).to_list(200)
    return [_doc_to_ad_response(serialize_doc(d)) for d in docs]


# ── Score emotions (MUST be before /{ad_id} routes) ──────────────────────────

@router.post("/score-emotions", response_model=EmotionScoreResult)
async def score_emotions():
    """
    Score the emotional tone of all completed, un-scored videos.

    Computes the average of each video's segment embeddings and compares it
    against four anchor phrase embeddings (positive/neutral/intense/negative)
    using cosine similarity. Idempotent — already-scored videos are skipped.
    """
    try:
        anchor_embs = await embed_anchors()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to embed anchors: {e}")

    videos_col = await get_videos_collection()
    segments_col = await get_segments_collection()

    scored = 0
    skipped = 0

    async for video in videos_col.find(
        {"emotion_dominant": {"$exists": False}, "status": "completed"},
        {"_id": 1},
    ):
        video_id = str(video["_id"])

        raw_embs: list[list[float]] = []
        async for seg in segments_col.find({"video_id": video_id}, {"embedding": 1}):
            emb = seg.get("embedding")
            if emb and len(emb) == 1024:
                raw_embs.append(emb)

        if not raw_embs:
            skipped += 1
            continue

        avg = average_embedding(raw_embs)
        scores, dominant = score_against_anchors(avg, anchor_embs)

        await videos_col.update_one(
            {"_id": video["_id"]},
            {"$set": {"emotion_scores": scores, "emotion_dominant": dominant}},
        )
        scored += 1

    return EmotionScoreResult(
        scored=scored,
        skipped=skipped,
        message=f"Scored {scored} video(s). Skipped {skipped} (no segments or already scored).",
    )


# ── Placements (MUST be before /{ad_id} routes) ───────────────────────────────

@router.get("/placements", response_model=list[PlacementResponse])
async def list_placements():
    placements_col = await get_placements_collection()
    docs = await placements_col.find({}).sort("created_at", -1).to_list(500)
    return [_doc_to_placement_response(serialize_doc(d)) for d in docs]


@router.post("/placements", response_model=PlacementResponse)
async def create_placement(body: PlacementCreate):
    """Save a placement, denormalising ad and video titles at write time."""
    ads_col = await get_ads_collection()
    videos_col = await get_videos_collection()
    placements_col = await get_placements_collection()

    try:
        ad = await ads_col.find_one(
            {"_id": ObjectId(body.ad_id)},
            {"title": 1, "description": 1, "duration_seconds": 1},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ad ID")
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")

    try:
        video = await videos_col.find_one(
            {"_id": ObjectId(body.video_id)}, {"title": 1}
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid video ID")
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    doc = {
        "ad_id": body.ad_id,
        "ad_title": ad["title"],
        "ad_description": ad["description"],
        "duration_seconds": ad["duration_seconds"],
        "segment_id": body.segment_id,
        "video_id": body.video_id,
        "video_title": video.get("title", ""),
        "segment_index": body.segment_index,
        "start_time": body.start_time,
        "match_score": body.match_score,
        "created_at": datetime.now(timezone.utc),
    }
    result = await placements_col.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return _doc_to_placement_response(doc)


@router.delete("/placements/{placement_id}")
async def delete_placement(placement_id: str):
    placements_col = await get_placements_collection()
    try:
        res = await placements_col.delete_one({"_id": ObjectId(placement_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid placement ID")
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Placement not found")
    return {"ok": True}


# ── Single ad CRUD ────────────────────────────────────────────────────────────

@router.get("/{ad_id}", response_model=AdResponse)
async def get_ad(ad_id: str):
    ads_col = await get_ads_collection()
    try:
        doc = await ads_col.find_one(
            {"_id": ObjectId(ad_id)},
            {"embedding": 0, "embedding_512": 0, "embedding_256": 0},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ad ID")
    if not doc:
        raise HTTPException(status_code=404, detail="Ad not found")
    return _doc_to_ad_response(serialize_doc(doc))


@router.put("/{ad_id}", response_model=AdResponse)
async def update_ad(ad_id: str, body: AdUpdate):
    """Update ad fields. Re-embeds description if it changed."""
    ads_col = await get_ads_collection()
    try:
        existing = await ads_col.find_one({"_id": ObjectId(ad_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ad ID")
    if not existing:
        raise HTTPException(status_code=404, detail="Ad not found")

    updates: dict = {"updated_at": datetime.now(timezone.utc)}

    if body.title is not None:
        updates["title"] = body.title
    if body.description is not None and body.description != existing.get("description"):
        try:
            embedding = await embed_query(body.description, dims=1024)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")
        updates["description"] = body.description
        updates["embedding"] = embedding
        updates["embedding_512"] = embedding[:512]
        updates["embedding_256"] = embedding[:256]
    elif body.description is not None:
        updates["description"] = body.description
    if body.duration_seconds is not None:
        updates["duration_seconds"] = body.duration_seconds
    if body.emotion_tags is not None:
        updates["emotion_tags"] = list(body.emotion_tags)

    await ads_col.update_one({"_id": ObjectId(ad_id)}, {"$set": updates})
    updated = await ads_col.find_one(
        {"_id": ObjectId(ad_id)},
        {"embedding": 0, "embedding_512": 0, "embedding_256": 0},
    )
    return _doc_to_ad_response(serialize_doc(updated))


@router.delete("/{ad_id}")
async def delete_ad(ad_id: str):
    """Delete an ad and cascade-delete its placements."""
    ads_col = await get_ads_collection()
    placements_col = await get_placements_collection()
    try:
        res = await ads_col.delete_one({"_id": ObjectId(ad_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ad ID")
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ad not found")
    await placements_col.delete_many({"ad_id": ad_id})
    return {"ok": True}


# ── Semantic matching ─────────────────────────────────────────────────────────

@router.post("/{ad_id}/match", response_model=list[AdMatchSegment])
async def match_ad(
    ad_id: str,
    limit: int = Query(default=10, ge=1, le=50),
):
    """
    Find video segments that best match this ad using Atlas vector search.

    Uses the pre-stored 1024D embedding of the ad description against the
    vs_1024_float index. Each result is annotated with the parent video's
    emotion_dominant and whether it is compatible with the ad's emotion_tags.
    emotion_compatible is None when the video has not yet been scored.
    """
    ads_col = await get_ads_collection()
    try:
        ad = await ads_col.find_one({"_id": ObjectId(ad_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ad ID")
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    if "embedding" not in ad:
        raise HTTPException(
            status_code=400,
            detail="Ad has no embedding — please re-save the ad to generate one.",
        )

    pipeline = [
        {
            "$vectorSearch": {
                "index": "vs_1024_float",
                "path": "embedding",
                "queryVector": ad["embedding"],
                "numCandidates": limit * 15,
                "limit": limit,
            }
        },
        {
            "$project": {
                "embedding": 0,
                "embedding_512": 0,
                "embedding_256": 0,
                "score": {"$meta": "vectorSearchScore"},
            }
        },
    ]

    segments_col = await get_segments_collection()
    videos_col = await get_videos_collection()

    try:
        segments = await segments_col.aggregate(pipeline).to_list(limit)
    except Exception as e:
        err = str(e)
        if "index" in err.lower() and (
            "not found" in err.lower() or "does not exist" in err.lower()
        ):
            raise HTTPException(
                status_code=400,
                detail="Vector search index not ready. Please create indexes in Settings first.",
            )
        raise HTTPException(status_code=500, detail=err)

    ad_tags: set[str] = set(ad.get("emotion_tags", []))
    results: list[AdMatchSegment] = []

    for seg in segments:
        seg = serialize_doc(seg)
        video_id = seg.get("video_id", "")
        try:
            video = await videos_col.find_one({"_id": ObjectId(video_id)})
        except Exception:
            video = None
        if not video:
            continue

        video = serialize_doc(video)
        emotion_dominant: Optional[str] = video.get("emotion_dominant")
        emotion_compatible: Optional[bool] = (
            None if emotion_dominant is None else (emotion_dominant in ad_tags)
        )
        seg_index = seg.get("segment_index", 0)

        results.append(
            AdMatchSegment(
                segment_id=seg["_id"],
                video_id=video["_id"],
                video_title=video.get("title", ""),
                youtube_id=video.get("youtube_id", ""),
                segment_index=seg_index,
                start_time=seg.get("start_time", 0.0),
                end_time=seg.get("end_time", 0.0),
                caption_text=seg.get("caption_text"),
                match_score=float(seg.get("score", 0.0)),
                emotion_dominant=emotion_dominant,
                emotion_compatible=emotion_compatible,
                thumbnail_url=f"/api/videos/{video_id}/segments/{seg_index}/thumbnail",
            )
        )

    return results
