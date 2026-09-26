"""Thin wrappers around the ffmpeg / ffprobe command-line tools."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional, Sequence, Tuple


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise SystemExit(f"{tool} not found. Install it with `brew install ffmpeg` (see README).")


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(out)
    info = {"duration": float(data["format"].get("duration", 0.0)), "has_audio": False, "width": None, "height": None}
    for s in data.get("streams", []):
        if s.get("codec_type") == "video" and info["width"] is None:
            w, h = int(s["width"]), int(s["height"])
            rotation = _rotation(s)
            if rotation in (90, 270):
                w, h = h, w
            info.update(width=w, height=h)
            if not info["duration"] and s.get("duration"):
                info["duration"] = float(s["duration"])
        elif s.get("codec_type") == "audio":
            info["has_audio"] = True
    return info


def _rotation(stream: dict) -> int:
    rot = stream.get("tags", {}).get("rotate")
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = sd["rotation"]
    try:
        return abs(int(float(rot))) % 360
    except (TypeError, ValueError):
        return 0


def run(args: Sequence[str], cwd: Optional[Path] = None) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-stats", "-y", *args]
    result = subprocess.run(cmd, cwd=str(cwd) if cwd else None)
    if result.returncode != 0:
        raise RuntimeError("ffmpeg failed:\n  " + " ".join(cmd))


def even(n: float) -> int:
    n = int(round(n))
    return n - (n % 2)


def format_size(fmt: str, src_w: int, src_h: int, enc: dict) -> Tuple[int, int]:
    if fmt == "vertical":
        return tuple(enc.get("vertical_size", [1080, 1920]))
    if fmt == "square":
        return tuple(enc.get("square_size", [1080, 1080]))
    return even(src_w), even(src_h)


def format_filter(fmt: str, fill: str, width: int, height: int) -> Optional[str]:
    """Video filter that reshapes the picture to ``width`` x ``height``.

    ``fill='crop'`` zooms in to fill the frame; ``fill='blur'`` fits the whole
    picture on top of a blurred, zoomed copy of itself.
    """
    if fmt == "original":
        return f"scale={width}:{height},setsar=1"
    cover = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    if fill == "crop":
        return f"{cover},setsar=1"
    return (
        f"split=2[bg][fg];[bg]{cover},boxblur=luma_radius=40:luma_power=2[bg2];"
        f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[fg2];"
        f"[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1"
    )


def encode_args(enc: dict) -> List[str]:
    return [
        "-c:v", "libx264", "-preset", str(enc.get("preset", "medium")), "-crf", str(enc.get("crf", 20)),
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", str(enc.get("audio_bitrate", "192k")),
        "-ar", "48000", "-movflags", "+faststart",
    ]


def between_expr(intervals: Sequence[Tuple[float, float]]) -> str:
    return "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in intervals)
