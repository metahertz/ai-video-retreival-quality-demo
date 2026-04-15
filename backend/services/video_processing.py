"""Video chunking strategies using ffmpeg."""
import asyncio
import os
import subprocess
from typing import Optional

import ffmpeg

MAX_VIDEO_BYTES = 20 * 1024 * 1024  # 20 MB — VoyageAI API limit


def check_file_size(path: str) -> bool:
    return os.path.getsize(path) <= MAX_VIDEO_BYTES


def _probe_duration(video_path: str) -> float:
    probe = ffmpeg.probe(video_path)
    return float(probe["format"]["duration"])


def _cut_segment_sync(input_path: str, start: float, duration: float, output_path: str) -> str:
    """ffmpeg stream-copy cut (fast, no re-encode). Cuts at nearest keyframe."""
    (
        ffmpeg.input(input_path, ss=start, t=duration)
        .output(output_path, codec="copy", avoid_negative_ts="1")
        .overwrite_output()
        .run(quiet=True)
    )
    return output_path


async def _cut_segment(input_path: str, start: float, duration: float, output_path: str) -> str:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _cut_segment_sync, input_path, start, duration, output_path)


# ── Thumbnail extraction ──────────────────────────────────────────────────────

def _extract_thumbnail_sync(video_path: str, time_offset: float, output_path: str) -> str:
    """Extract a single JPEG frame at time_offset seconds."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    (
        ffmpeg.input(video_path, ss=time_offset)
        .output(output_path, vframes=1)
        .overwrite_output()
        .run(quiet=True)
    )
    return output_path


async def generate_thumbnail(video_path: str, time_offset: float, output_path: str) -> str:
    """Async wrapper — runs ffmpeg in a thread pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _extract_thumbnail_sync, video_path, time_offset, output_path)


# ── Strategy: whole video ─────────────────────────────────────────────────────

async def chunk_whole_video(video_path: str) -> list[dict]:
    """Single segment covering the full video (no splitting)."""
    loop = asyncio.get_event_loop()
    duration = await loop.run_in_executor(None, _probe_duration, video_path)
    return [{"start": 0.0, "end": duration, "path": video_path, "caption_text": None}]


# ── Strategy: caption-based ───────────────────────────────────────────────────

def _merge_short_captions(captions: list[dict], min_duration: float = 3.0) -> list[dict]:
    """Merge consecutive captions until each segment is at least min_duration seconds."""
    if not captions:
        return []
    merged = []
    current = dict(captions[0])
    for cap in captions[1:]:
        if (current["end"] - current["start"]) < min_duration:
            current["end"] = cap["end"]
            current["text"] = current["text"].rstrip() + " " + cap["text"].lstrip()
        else:
            merged.append(current)
            current = dict(cap)
    merged.append(current)
    return merged


async def chunk_by_captions(
    video_path: str,
    captions: list[dict],
    output_dir: str,
    min_duration: float = 3.0,
) -> list[dict]:
    merged = _merge_short_captions(captions, min_duration)
    os.makedirs(output_dir, exist_ok=True)
    tasks = []
    for i, cap in enumerate(merged):
        out_path = os.path.join(output_dir, f"seg_{i:04d}.mp4")
        dur = max(cap["end"] - cap["start"], 0.1)
        tasks.append(_cut_segment(video_path, cap["start"], dur, out_path))
    paths = await asyncio.gather(*tasks)
    return [
        {
            "start": cap["start"],
            "end": cap["end"],
            "path": path,
            "caption_text": cap["text"],
        }
        for cap, path in zip(merged, paths)
    ]


# ── Strategy: scene detection ─────────────────────────────────────────────────

def _detect_scene_timestamps_sync(video_path: str, threshold: float) -> list[float]:
    """Use ffmpeg select filter to detect scene changes, return timestamps in seconds."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-i", video_path,
            "-vf", f"select='gt(scene,{threshold})',showinfo",
            "-vsync", "vfr",
            "-f", "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    timestamps = []
    for line in result.stderr.splitlines():
        if "pts_time:" in line:
            try:
                ts = float(line.split("pts_time:")[1].split()[0])
                timestamps.append(ts)
            except (IndexError, ValueError):
                pass
    return sorted(set(timestamps))


def _build_boundaries(
    timestamps: list[float], duration: float, min_duration: float
) -> list[tuple[float, float]]:
    """Convert scene timestamps into (start, end) pairs, filtering short segments."""
    all_times = [0.0] + timestamps + [duration]
    boundaries = []
    prev = 0.0
    for t in all_times[1:]:
        if t - prev >= min_duration:
            boundaries.append((prev, t))
            prev = t
    if boundaries and boundaries[-1][1] < duration:
        # Merge remainder into last segment
        last = boundaries[-1]
        boundaries[-1] = (last[0], duration)
    return boundaries or [(0.0, duration)]


async def chunk_by_scenes(
    video_path: str,
    output_dir: str,
    threshold: float = 0.3,
    min_duration: float = 3.0,
) -> list[dict]:
    loop = asyncio.get_event_loop()
    duration = await loop.run_in_executor(None, _probe_duration, video_path)
    timestamps = await loop.run_in_executor(
        None, _detect_scene_timestamps_sync, video_path, threshold
    )
    boundaries = _build_boundaries(timestamps, duration, min_duration)
    os.makedirs(output_dir, exist_ok=True)
    tasks = []
    for i, (start, end) in enumerate(boundaries):
        out_path = os.path.join(output_dir, f"seg_{i:04d}.mp4")
        tasks.append(_cut_segment(video_path, start, end - start, out_path))
    paths = await asyncio.gather(*tasks)
    return [
        {"start": start, "end": end, "path": path, "caption_text": None}
        for (start, end), path in zip(boundaries, paths)
    ]


# ── Strategy: fixed interval ──────────────────────────────────────────────────

async def chunk_fixed_interval(
    video_path: str,
    output_dir: str,
    interval_seconds: float = 30.0,
) -> list[dict]:
    loop = asyncio.get_event_loop()
    duration = await loop.run_in_executor(None, _probe_duration, video_path)
    os.makedirs(output_dir, exist_ok=True)
    boundaries = []
    start = 0.0
    while start < duration:
        end = min(start + interval_seconds, duration)
        boundaries.append((start, end))
        start = end
    tasks = []
    for i, (start, end) in enumerate(boundaries):
        out_path = os.path.join(output_dir, f"seg_{i:04d}.mp4")
        tasks.append(_cut_segment(video_path, start, end - start, out_path))
    paths = await asyncio.gather(*tasks)
    return [
        {"start": start, "end": end, "path": path, "caption_text": None}
        for (start, end), path in zip(boundaries, paths)
    ]
