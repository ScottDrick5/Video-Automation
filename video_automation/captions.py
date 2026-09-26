"""Group words into caption chunks and write .srt / .ass (styled, burn-in) files."""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Sequence

SENTENCE_END = (".", "?", "!")
_EDGE_PUNCT = re.compile(r"^[\"'“”‘’(\[]+|[\"'“”‘’)\],.;:]+$")


def chunk_words(words: Sequence[dict], max_words: int = 4, max_chars: int = 22, max_gap: float = 0.6) -> List[dict]:
    """Split words into on-screen caption chunks.

    A new chunk starts when the current one is full, after a sentence ends, or
    after a pause in speech.
    """
    chunks: List[dict] = []
    current: List[dict] = []

    def flush():
        if current:
            chunks.append({"start": current[0]["start"], "end": current[-1]["end"], "words": list(current)})
            current.clear()

    for w in words:
        if current:
            prev = current[-1]
            text_len = len(" ".join(x["word"] for x in current + [w]))
            if (
                len(current) >= max_words
                or text_len > max_chars
                or w["start"] - prev["end"] > max_gap
                or prev["word"].endswith(SENTENCE_END)
            ):
                flush()
        current.append(w)
    flush()

    # Hold each caption until the next one appears when the gap is short, to avoid flicker.
    for a, b in zip(chunks, chunks[1:]):
        if 0 <= b["start"] - a["end"] < 0.35:
            a["end"] = b["start"]
    for c in chunks:
        c["end"] = max(c["end"], c["start"] + 0.2)
    return chunks


def shift_words(words: Sequence[dict], offset: float, start: float = None, end: float = None) -> List[dict]:
    """Move words by ``offset`` seconds, keeping only those inside [start, end) (in original time)."""
    out = []
    for w in words:
        if start is not None and w["end"] <= start:
            continue
        if end is not None and w["start"] >= end:
            continue
        out.append({**w, "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)})
    if out:
        out[0]["start"] = max(out[0]["start"], 0.0)
    return out


# --------------------------------------------------------------------------- SRT

def _srt_time(t: float) -> str:
    ms = int(round(max(t, 0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(path: Path, chunks: Sequence[dict]) -> None:
    lines = []
    for i, c in enumerate(chunks, 1):
        text = " ".join(w["word"] for w in c["words"])
        lines += [str(i), f"{_srt_time(c['start'])} --> {_srt_time(c['end'])}", text, ""]
    Path(path).write_text("\n".join(lines), encoding="utf-8")


# --------------------------------------------------------------------------- ASS

def _ass_time(t: float) -> str:
    cs = int(round(max(t, 0) * 100))
    h, cs = divmod(cs, 360_000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def ass_color(hex_color: str, alpha: int = 0) -> str:
    """'#RRGGBB' -> ASS '&HAABBGGRR'."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"Colour must look like #RRGGBB, got {hex_color!r}")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _display(word: str, cfg: dict) -> str:
    if cfg.get("strip_punctuation", True):
        word = _EDGE_PUNCT.sub("", word) or word
    if cfg.get("uppercase", True):
        word = word.upper()
    return word.replace("\\", "").replace("{", "(").replace("}", ")")


def build_ass(chunks: Sequence[dict], width: int, height: int, cfg: dict) -> str:
    # ~5% of the height on landscape/square; on vertical video size to the width instead.
    base = width * 0.09 if height > width else height * 0.05
    font_size = max(12, round(base * float(cfg.get("font_scale", 1.0))))
    scale = font_size / 54.0  # outline/shadow values are tuned for a 54px font
    outline = round(float(cfg.get("outline", 4)) * scale, 1)
    shadow = round(float(cfg.get("shadow", 0)) * scale, 1)
    alignment = {"bottom": 2, "middle": 5, "top": 8}.get(cfg.get("position", "bottom"), 2)
    margin_v = round(height * float(cfg.get("margin_percent", 18)) / 100)
    margin_h = round(width * 0.06)
    primary = ass_color(cfg.get("primary_color", "#FFFFFF"))
    highlight = ass_color(cfg.get("highlight_color", "#FFD700"))
    outline_c = ass_color(cfg.get("outline_color", "#000000"))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{cfg.get('font', 'Arial Black')},{font_size},{primary},{highlight},{outline_c},&H80000000,-1,0,0,0,100,100,0,0,1,{outline},{shadow},{alignment},{margin_h},{margin_h},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for c in chunks:
        words = [_display(w["word"], cfg) for w in c["words"]]
        if not cfg.get("highlight_words", True):
            events.append((c["start"], c["end"], " ".join(words)))
            continue
        for i, w in enumerate(c["words"]):
            start = c["start"] if i == 0 else w["start"]
            end = c["words"][i + 1]["start"] if i + 1 < len(c["words"]) else c["end"]
            if end <= start:
                continue
            text = " ".join(
                f"{{\\c{highlight}}}{t}{{\\c{primary}}}" if j == i else t for j, t in enumerate(words)
            )
            events.append((start, end, text))

    body = "".join(f"Dialogue: 0,{_ass_time(s)},{_ass_time(e)},Default,,0,0,0,,{t}\n" for s, e, t in events)
    return header + body


def write_ass(path: Path, chunks: Sequence[dict], width: int, height: int, cfg: dict) -> None:
    Path(path).write_text(build_ass(chunks, width, height, cfg), encoding="utf-8")
