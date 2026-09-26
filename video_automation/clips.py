"""Decide where to cut the finished video into short clips."""

from __future__ import annotations

from typing import List, Sequence

from .captions import SENTENCE_END


def _sentences(words: Sequence[dict]) -> List[List[dict]]:
    out, cur = [], []
    for w in words:
        cur.append(w)
        if w["word"].rstrip("\"'”’)").endswith(SENTENCE_END):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def plan_clips(words: Sequence[dict], total: float, cfg: dict) -> List[dict]:
    """Return ``[{"name", "start", "end"}]`` in seconds of the finished video.

    ``words`` must already be in finished-video time.
    """
    if cfg.get("mode") == "manual":
        clips = []
        for i, seg in enumerate(cfg.get("segments") or [], 1):
            start, end = float(seg["start"]), min(float(seg["end"]), total)
            if end > start:
                clips.append({"name": str(seg.get("name") or f"clip{i:02d}"), "start": start, "end": end})
        return clips

    max_len = float(cfg.get("max_length", 60))
    min_len = float(cfg.get("min_length", 15))

    if total <= max_len:
        spans = [(0.0, total)]
    elif not words:
        n = int(-(-total // max_len))
        step = total / n
        spans = [(i * step, (i + 1) * step) for i in range(n)]
    else:
        spans = []
        cur_start, cur_end = 0.0, None
        for sent in _sentences(words):
            sent_end = min(sent[-1]["end"] + 0.4, total)
            if cur_end is not None and sent_end - cur_start > max_len:
                # adding this sentence would make the clip too long: cut after the previous one
                spans.append((cur_start, cur_end))
                cur_start = cur_end
            cur_end = sent_end
        spans.append((cur_start, total))  # the last clip runs to the end of the video
        # a very long single sentence can still exceed max_len; hard-split it
        spans = [piece for s, e in spans for piece in _hard_split(s, e, max_len)]
        merged = []
        for s, e in spans:
            if merged and e - s < min_len and (e - merged[-1][0]) <= max_len * 1.25:
                merged[-1] = (merged[-1][0], e)
            else:
                merged.append((s, e))
        spans = merged

    limit = int(cfg.get("max_clips") or 0)
    if limit:
        spans = spans[:limit]
    return [{"name": f"clip{i:02d}", "start": round(s, 3), "end": round(e, 3)} for i, (s, e) in enumerate(spans, 1)]


def _hard_split(start: float, end: float, max_len: float):
    length = end - start
    if length <= max_len * 1.25:
        return [(start, end)]
    n = int(-(-length // max_len))
    step = length / n
    return [(start + i * step, start + (i + 1) * step) for i in range(n)]
