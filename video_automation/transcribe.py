"""Speech-to-text with word timestamps (runs locally, no API key needed)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional


def transcribe(audio_path: Path, cfg: dict, script_text: Optional[str] = None) -> List[dict]:
    """Return a list of ``{"word", "start", "end"}`` dicts for ``audio_path``."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on install
        raise SystemExit(
            "faster-whisper is not installed. Run ./mac/setup_mac.sh (or `pip install faster-whisper`)."
        ) from exc

    model = WhisperModel(cfg["model"], device=cfg.get("device", "auto"), compute_type=cfg.get("compute_type", "int8"))
    # If the voiceover script is available, feed its tail to Whisper as a hint so
    # names and unusual words come out spelled the way the script spells them.
    prompt = script_text[-800:] if script_text else None
    segments, _info = model.transcribe(
        str(audio_path),
        language=cfg.get("language") or None,
        word_timestamps=True,
        initial_prompt=prompt,
        condition_on_previous_text=False,
    )
    words = []
    for segment in segments:
        for w in segment.words or []:
            text = w.word.strip()
            if text:
                words.append({"word": text, "start": round(float(w.start), 3), "end": round(float(w.end), 3)})
    return words


def load_words(path: Path) -> List[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    words = data["words"] if isinstance(data, dict) else data
    return [{"word": str(w["word"]).strip(), "start": float(w["start"]), "end": float(w["end"])} for w in words]


def save_words(path: Path, words: List[dict]) -> None:
    Path(path).write_text(json.dumps({"words": words}, indent=1), encoding="utf-8")
