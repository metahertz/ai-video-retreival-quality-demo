import asyncio

from bson import ObjectId
from fastapi import APIRouter, HTTPException

from ..database import get_videos_collection, get_segments_collection
from ..models import (
    SearchRequest,
    SearchResult,
    CompareSearchRequest,
    ProfileSearchResult,
    CompareSearchResponse,
    serialize_doc,
)
from ..services.voyage import embed_query
from ..services.atlas import PROFILES, TEXT_INDEX_NAME

router = APIRouter()


def _build_search_result(seg: dict, video: dict) -> SearchResult:
    video_id = seg.get("video_id", "")
    seg_index = seg.get("segment_index", 0)
    # Always emit the thumbnail URL — the endpoint returns 404 if the file
    # doesn't exist yet; the frontend handles that gracefully.
    thumbnail_url = f"/api/videos/{video_id}/segments/{seg_index}/thumbnail"
    return SearchResult(
        segment_id=seg["_id"],
        video_id=video_id,
        video_title=video.get("title", ""),
        youtube_id=video.get("youtube_id", ""),
        youtube_url=video.get("youtube_url", ""),
        segment_index=seg_index,
        start_time=seg.get("start_time", 0.0),
        end_time=seg.get("end_time", 0.0),
        caption_text=seg.get("caption_text"),
        score=float(seg.get("score", 0.0)),
        chunking_strategy=seg.get("chunking_strategy", ""),
        thumbnail_url=thumbnail_url,
        created_at=seg.get("created_at"),
    )


async def _run_vector_search(
    segments_col,
    videos_col,
    query_embedding_1024: list[float],
    profile_key: str,
    limit: int,
) -> list[SearchResult]:
    """Run a vector search for a given profile, truncating the query as needed."""
    if profile_key not in PROFILES:
        raise ValueError(f"Unknown profile: {profile_key}")

    profile = PROFILES[profile_key]
    dims = profile["dims"]
    query_vec = query_embedding_1024[:dims]

    pipeline = [
        {
            "$vectorSearch": {
                "index": profile["index"],
                "path": profile["field"],
                "queryVector": query_vec,
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
                # thumbnail_path kept so _build_search_result can use it
            }
        },
    ]

    segments = await segments_col.aggregate(pipeline).to_list(limit)

    results = []
    for seg in segments:
        seg = serialize_doc(seg)
        video_id = seg.get("video_id", "")
        try:
            video = await videos_col.find_one({"_id": ObjectId(video_id)})
        except Exception:
            video = None
        if not video:
            continue
        results.append(_build_search_result(seg, video))
    return results


@router.post("", response_model=list[SearchResult])
async def search(body: SearchRequest):
    segments_col = await get_segments_collection()
    videos_col = await get_videos_collection()

    if body.search_type == "vector":
        try:
            query_embedding = await embed_query(body.query)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

        try:
            return await _run_vector_search(
                segments_col, videos_col, query_embedding, body.profile, body.limit
            )
        except Exception as e:
            err = str(e)
            if "index" in err.lower() and ("not found" in err.lower() or "does not exist" in err.lower()):
                raise HTTPException(
                    status_code=400,
                    detail="Search index not ready. Please create indexes in Settings first.",
                )
            raise HTTPException(status_code=500, detail=err)

    else:  # text search
        pipeline = [
            {
                "$search": {
                    "index": TEXT_INDEX_NAME,
                    "text": {
                        "query": body.query,
                        "path": "caption_text",
                    },
                }
            },
            {"$limit": body.limit},
            {
                "$project": {
                    "embedding": 0,
                    "embedding_512": 0,
                    "embedding_256": 0,
                    "score": {"$meta": "searchScore"},
                    # thumbnail_path kept so _build_search_result can use it
                }
            },
        ]

        try:
            segments = await segments_col.aggregate(pipeline).to_list(body.limit)
        except Exception as e:
            err = str(e)
            if "index" in err.lower() and ("not found" in err.lower() or "does not exist" in err.lower()):
                raise HTTPException(
                    status_code=400,
                    detail="Search index not ready. Please create indexes in Settings first.",
                )
            raise HTTPException(status_code=500, detail=err)

        results = []
        for seg in segments:
            seg = serialize_doc(seg)
            video_id = seg.get("video_id", "")
            try:
                video = await videos_col.find_one({"_id": ObjectId(video_id)})
            except Exception:
                video = None
            if not video:
                continue
            results.append(_build_search_result(seg, video))
        return results


@router.post("/compare", response_model=CompareSearchResponse)
async def compare_search(body: CompareSearchRequest):
    """Run the same query against multiple retrieval profiles simultaneously."""
    segments_col = await get_segments_collection()
    videos_col = await get_videos_collection()

    # Embed once at full 1024D; each profile helper slices as needed
    try:
        query_embedding = await embed_query(body.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

    async def _search_profile(profile_key: str) -> ProfileSearchResult:
        label = PROFILES.get(profile_key, {}).get("label", profile_key)
        try:
            results = await _run_vector_search(
                segments_col, videos_col, query_embedding, profile_key, body.limit
            )
            return ProfileSearchResult(profile_key=profile_key, label=label, results=results)
        except Exception as e:
            return ProfileSearchResult(
                profile_key=profile_key, label=label, results=[], error=str(e)
            )

    profile_results = await asyncio.gather(
        *[_search_profile(pk) for pk in body.profiles]
    )

    return CompareSearchResponse(query=body.query, profiles=list(profile_results))
