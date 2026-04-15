// Mirrors Pydantic models from backend/models.py

export interface SettingsRequest {
  voyage_api_key: string;
  mongodb_uri: string;
  mongodb_db: string;
  mongodb_collection_videos: string;
  mongodb_collection_segments: string;
}

export interface SettingsResponse {
  voyage_api_key_masked: string;
  mongodb_uri_masked: string;
  mongodb_db: string;
  mongodb_collection_videos: string;
  mongodb_collection_segments: string;
  settings_configured: boolean;
}

export interface ConnectionTestResult {
  voyage_ok: boolean;
  mongodb_ok: boolean;
  voyage_error: string | null;
  mongodb_error: string | null;
}

export interface IndexStatusResponse {
  vector_index_status: string;
  text_index_status: string;
  message: string;
}

export interface ProfileIndexStatus {
  profile_key: string;
  label: string;
  dims: number;
  quantization: string | null;
  cost_note: string;
  index_name: string;
  status: string;
}

export interface AllIndexStatusResponse {
  profiles: ProfileIndexStatus[];
  text_index_status: string;
  message: string;
}

export interface IndexCapacityInfo {
  total_existing: number;
  our_indexes_count: number;
  missing_indexes: string[];
  total_needed: number;
  all_present: boolean;
  potentially_at_limit: boolean;
  tier_limit: number;
  message: string;
}

export interface CreateIndexesResult {
  status: 'creating' | 'limit_reached' | 'partial' | 'error';
  message: string;
  limit_reached: boolean;
  created_count: number;
  failed_count: number;
  upgrade_required: boolean;
}

export interface YouTubeSearchResult {
  youtube_id: string;
  title: string;
  duration: number | null;
  thumbnail_url: string;
  youtube_url: string;
  uploader: string | null;
  view_count: number | null;
}

export interface VideoResponse {
  id: string;
  title: string;
  youtube_id: string;
  youtube_url: string;
  file_path: string;
  duration: number;
  thumbnail_url: string;
  status: 'downloaded' | 'processing' | 'completed' | 'error';
  created_at: string;
  segment_count: number;
  chunking_strategy: string | null;
  error_message: string | null;
}

export interface ProcessRequest {
  video_id: string;
  chunking_strategy: 'whole' | 'caption' | 'scene' | 'fixed';
  interval_seconds?: number;
}

export interface ProcessJobStatus {
  job_id: string;
  video_id: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  message: string;
  segments_processed: number;
  total_segments: number;
}

export interface SearchRequest {
  query: string;
  search_type: 'text' | 'vector';
  limit: number;
  profile?: string;
}

export interface SearchResult {
  segment_id: string;
  video_id: string;
  video_title: string;
  youtube_id: string;
  youtube_url: string;
  segment_index: number;
  start_time: number;
  end_time: number;
  caption_text: string | null;
  score: number;
  chunking_strategy: string;
  thumbnail_url: string | null;
  created_at: string | null;
}

export interface CompareSearchRequest {
  query: string;
  profiles: string[];
  limit: number;
}

export interface ProfileSearchResult {
  profile_key: string;
  label: string;
  results: SearchResult[];
  error: string | null;
}

export interface CompareSearchResponse {
  query: string;
  profiles: ProfileSearchResult[];
}
