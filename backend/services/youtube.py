"""YouTube search, download, and caption extraction via yt-dlp."""
import asyncio
import glob
import json
import os
from typing import Optional

import yt_dlp

from ..config import get_settings


def _cookie_opts() -> dict:
    """Return yt-dlp cookie options based on current settings.
    Cookies file takes priority over browser if both are configured."""
    s = get_settings()
    if s.yt_dlp_cookies_file:
        return {"cookiefile": s.yt_dlp_cookies_file}
    if s.yt_dlp_cookies_browser:
        return {"cookiesfrombrowser": (s.yt_dlp_cookies_browser,)}
    return {}


def _build_search_opts() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        **_cookie_opts(),
    }


def _do_search(query: str, max_results: int) -> list[dict]:
    with yt_dlp.YoutubeDL(_build_search_opts()) as ydl:
        result = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)
    entries = result.get("entries", []) if result else []
    out = []
    for e in entries:
        if not e or not e.get("id"):
            continue
        # Prefer the first available thumbnail
        thumb = ""
        thumbnails = e.get("thumbnails") or []
        if thumbnails:
            thumb = thumbnails[-1].get("url", "")
        if not thumb:
            thumb = e.get("thumbnail", "")
        out.append(
            {
                "youtube_id": e["id"],
                "title": e.get("title", "Untitled"),
                "duration": e.get("duration"),
                "thumbnail_url": thumb,
                "youtube_url": f"https://www.youtube.com/watch?v={e['id']}",
                "uploader": e.get("uploader") or e.get("channel"),
                "view_count": e.get("view_count"),
            }
        )
    return out


async def search_youtube(query: str, max_results: int = 10) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _do_search, query, max_results)


# ── Download ──────────────────────────────────────────────────────────────────

def _do_download(youtube_id: str, output_dir: str) -> dict:
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    ydl_opts = {
        "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "outtmpl": f"{output_dir}/%(title)s.%(ext)s",
        "quiet": True,
        "no_warnings": True,
        "merge_output_format": "mp4",
        "writeinfojson": True,
        "noplaylist": True,
        **_cookie_opts(),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
    return info


async def download_video(youtube_id: str, output_dir: str) -> dict:
    """Download video to output_dir. Returns yt-dlp info dict."""
    os.makedirs(output_dir, exist_ok=True)
    loop = asyncio.get_event_loop()
    info = await loop.run_in_executor(None, _do_download, youtube_id, output_dir)
    return info


def find_downloaded_file(output_dir: str) -> Optional[str]:
    """Find the downloaded mp4 file in the directory."""
    patterns = [
        os.path.join(output_dir, "*.mp4"),
        os.path.join(output_dir, "*.webm"),
        os.path.join(output_dir, "*.mkv"),
    ]
    for pattern in patterns:
        files = [f for f in glob.glob(pattern) if not f.endswith(".info.json")]
        if files:
            return sorted(files, key=os.path.getsize, reverse=True)[0]
    return None


# ── Captions ──────────────────────────────────────────────────────────────────

def _do_caption_download(youtube_id: str, output_dir: str) -> None:
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    ydl_opts = {
        "writeautomaticsub": True,
        "writesubtitles": True,
        "subtitlesformat": "json3",
        "subtitleslangs": ["en", "en-US", "en-GB"],
        "skip_download": True,
        "outtmpl": os.path.join(output_dir, "captions"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        **_cookie_opts(),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.extract_info(url, download=True)


def _parse_json3_captions(output_dir: str) -> Optional[list[dict]]:
    """Parse .en.json3 caption file into list of {start, end, text}."""
    candidates = glob.glob(os.path.join(output_dir, "*.json3"))
    if not candidates:
        return None
    # Prefer English
    candidates.sort(key=lambda f: (0 if ".en." in f else 1))
    with open(candidates[0], encoding="utf-8") as f:
        data = json.load(f)
    events = data.get("events", [])
    segments = []
    for event in events:
        if "segs" not in event:
            continue
        start_ms = event.get("tStartMs", 0)
        dur_ms = event.get("dDurationMs", 0)
        text = "".join(s.get("utf8", "") for s in event["segs"]).strip()
        if text and text != "\n":
            segments.append(
                {
                    "start": start_ms / 1000.0,
                    "end": (start_ms + dur_ms) / 1000.0,
                    "text": text.replace("\n", " "),
                }
            )
    return segments if segments else None


async def download_captions(youtube_id: str, output_dir: str) -> Optional[list[dict]]:
    """Download and parse YouTube captions. Returns None if unavailable."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _do_caption_download, youtube_id, output_dir)
    return _parse_json3_captions(output_dir)
