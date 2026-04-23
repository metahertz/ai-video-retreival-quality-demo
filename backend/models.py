from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime


# ── Settings ─────────────────────────────────────────────────────────────────

class SettingsRequest(BaseModel):
    voyage_api_key: str
    mongodb_uri: str
    mongodb_db: str = "voyage_video_demo"
    mongodb_collection_videos: str = "videos"
    mongodb_collection_segments: str = "video_segments"
    yt_dlp_cookies_browser: str = ""
    yt_dlp_cookies_file: str = ""


class SettingsResponse(BaseModel):
    voyage_api_key_masked: str
    mongodb_uri_masked: str
    mongodb_db: str
    mongodb_collection_videos: str
    mongodb_collection_segments: str
    settings_configured: bool
    yt_dlp_cookies_browser: str = ""
    yt_dlp_cookies_file: str = ""


class ConnectionTestResult(BaseModel):
    voyage_ok: bool
    mongodb_ok: bool
    voyage_error: Optional[str] = None
    mongodb_error: Optional[str] = None


class IndexStatusResponse(BaseModel):
    vector_index_status: str  # READY | BUILDING | NOT_FOUND | ERROR
    text_index_status: str
    message: str


class ProfileIndexStatus(BaseModel):
    profile_key: str
    label: str
    dims: int
    quantization: Optional[str] = None
    cost_note: str
    index_name: str
    status: str  # READY | BUILDING | PENDING | NOT_FOUND | ERROR


class AllIndexStatusResponse(BaseModel):
    profiles: List[ProfileIndexStatus]
    text_index_status: str
    message: str


class IndexCapacityInfo(BaseModel):
    total_existing: int          # search indexes currently on the segments collection
    our_indexes_count: int       # of those, how many belong to this app
    missing_indexes: List[str]   # our required index names not yet created
    total_needed: int            # total indexes this app requires
    all_present: bool
    potentially_at_limit: bool   # heuristic: at/near M0/M2/M5 quota
    tier_limit: int              # known free-tier limit (3)
    message: str


class CreateIndexesResult(BaseModel):
    status: str              # "creating" | "limit_reached" | "partial" | "error"
    message: str
    limit_reached: bool = False
    created_count: int = 0
    failed_count: int = 0
    upgrade_required: bool = False


# ── YouTube search ────────────────────────────────────────────────────────────

class YouTubeSearchRequest(BaseModel):
    query: str
    max_results: int = 10


class YouTubeSearchResult(BaseModel):
    youtube_id: str
    title: str
    duration: Optional[int] = None   # seconds
    thumbnail_url: str
    youtube_url: str
    uploader: Optional[str] = None
    view_count: Optional[int] = None


# ── Video ─────────────────────────────────────────────────────────────────────

class VideoDownloadRequest(BaseModel):
    youtube_id: str


class VideoResponse(BaseModel):
    id: str
    title: str
    youtube_id: str
    youtube_url: str
    file_path: str
    duration: float
    thumbnail_url: str
    status: str
    created_at: datetime
    segment_count: int
    chunking_strategy: Optional[str] = None
    error_message: Optional[str] = None
    file_missing: bool = False  # True when file_path is set but absent on disk


# ── Processing ────────────────────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    video_id: str
    chunking_strategy: Literal["whole", "caption", "scene", "fixed"]
    interval_seconds: Optional[float] = 30.0


class ProcessJobStatus(BaseModel):
    job_id: str
    video_id: str
    status: Literal["pending", "processing", "completed", "error", "cancelled"]
    progress: float = 0.0  # 0.0 – 1.0
    message: str = ""
    segments_processed: int = 0
    total_segments: int = 0


# ── Search ────────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    search_type: Literal["text", "vector"] = "vector"
    limit: int = Field(default=10, ge=1, le=50)
    profile: str = "1024_float"


class SearchResult(BaseModel):
    segment_id: str
    video_id: str
    video_title: str
    youtube_id: str
    youtube_url: str
    segment_index: int
    start_time: float
    end_time: float
    caption_text: Optional[str] = None
    score: float
    chunking_strategy: str
    thumbnail_url: Optional[str] = None
    created_at: Optional[datetime] = None


class CompareSearchRequest(BaseModel):
    query: str
    profiles: List[str] = ["1024_float", "512_float", "256_float"]
    limit: int = Field(default=5, ge=1, le=20)


class ProfileSearchResult(BaseModel):
    profile_key: str
    label: str
    results: List[SearchResult]
    error: Optional[str] = None


class CompareSearchResponse(BaseModel):
    query: str
    profiles: List[ProfileSearchResult]


# ── Ads ───────────────────────────────────────────────────────────────────────

class AdCreate(BaseModel):
    title: str
    description: str
    duration_seconds: int = Field(default=10, ge=1, le=30)
    emotion_tags: List[str] = ["positive", "neutral", "intense"]


class AdUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    duration_seconds: Optional[int] = Field(default=None, ge=1, le=30)
    emotion_tags: Optional[List[str]] = None


class AdResponse(BaseModel):
    id: str
    title: str
    description: str
    duration_seconds: int
    emotion_tags: List[str]
    created_at: datetime
    updated_at: datetime


class AdMatchSegment(BaseModel):
    segment_id: str
    video_id: str
    video_title: str
    youtube_id: str
    segment_index: int
    start_time: float
    end_time: float
    caption_text: Optional[str] = None
    match_score: float
    emotion_dominant: Optional[str] = None
    emotion_compatible: Optional[bool] = None  # None = video not yet scored
    thumbnail_url: Optional[str] = None


class PlacementCreate(BaseModel):
    ad_id: str
    segment_id: str
    video_id: str
    segment_index: int
    start_time: float
    match_score: float


class PlacementResponse(BaseModel):
    id: str
    ad_id: str
    ad_title: str
    ad_description: str
    duration_seconds: int
    segment_id: str
    video_id: str
    video_title: str
    segment_index: int
    start_time: float
    match_score: float
    created_at: datetime


class EmotionScoreResult(BaseModel):
    scored: int
    skipped: int
    message: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def serialize_doc(doc: dict) -> dict:
    """Convert ObjectId fields to strings for JSON serialisation."""
    from bson import ObjectId
    result = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            result[k] = str(v)
        else:
            result[k] = v
    return result
