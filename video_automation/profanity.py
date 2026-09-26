"""Find and censor curse words in word-level transcripts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

WORDLIST_PATH = Path(__file__).with_name("profanity_words.txt")

_LETTERS = re.compile(r"[a-z]+")
_CORE = re.compile(r"^([^\w*]*)(.*?)([^\w*]*)$", re.UNICODE)


def _load_wordlist(path: Path = WORDLIST_PATH) -> List[str]:
    words = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip().lower()
        if line and not line.startswith("#"):
            words.append(line)
    return words


@dataclass
class ProfanityFilter:
    exact: frozenset
    prefixes: Tuple[str, ...]
    allowed: frozenset
    mode: str = "asterisk"
    replacement: str = "[bleep]"

    @classmethod
    def from_config(cls, cfg: dict) -> "ProfanityFilter":
        entries = _load_wordlist() + [str(w).strip().lower() for w in cfg.get("extra_words") or []]
        exact = {e for e in entries if not e.endswith("*")}
        prefixes = tuple(sorted({e[:-1] for e in entries if e.endswith("*") and len(e) > 1}))
        allowed = frozenset(_key(str(w)) for w in cfg.get("allowed_words") or [])
        return cls(
            exact=frozenset(_key(e) for e in exact),
            prefixes=prefixes,
            allowed=allowed,
            mode=cfg.get("mode", "asterisk"),
            replacement=cfg.get("replacement", "[bleep]"),
        )

    def is_profane(self, word: str) -> bool:
        # Whisper sometimes self-censors ("f***"); treat a star inside a word as a curse.
        core = _CORE.match(word.strip()).group(2)
        if "*" in core and core[:1].isalpha():
            return True
        key = _key(word)
        if not key or key in self.allowed:
            return False
        if key in self.exact:
            return True
        return any(key.startswith(p) for p in self.prefixes)

    def mask(self, word: str) -> str:
        """Return the caption text for a profane ``word``, keeping surrounding punctuation."""
        lead, core, trail = _CORE.match(word.strip()).groups()
        if self.mode == "remove":
            return ""
        if self.mode == "replace":
            return f"{lead}{self.replacement}{trail}"
        if self.mode == "full":
            return lead + "*" * len(core) + trail
        # asterisk: keep the first letter
        return lead + core[:1] + "*" * max(len(core) - 1, 1) + trail

    def apply(self, words: Sequence[dict]) -> Tuple[List[dict], List[dict]]:
        """Return (censored words, list of words that were censored).

        Each word is a dict with ``word``, ``start``, ``end``. Removed words are dropped.
        """
        cleaned, hits = [], []
        for w in words:
            if self.is_profane(w["word"]):
                hits.append(dict(w))
                masked = self.mask(w["word"])
                if masked:
                    cleaned.append({**w, "word": masked, "censored": True})
            else:
                cleaned.append(dict(w))
        return cleaned, hits


def _key(word: str) -> str:
    return "".join(_LETTERS.findall(word.lower()))


def merge_intervals(intervals: Iterable[Tuple[float, float]], pad: float = 0.05) -> List[Tuple[float, float]]:
    """Pad and merge overlapping time ranges (used for muting/beeping audio)."""
    spans = sorted((max(0.0, s - pad), e + pad) for s, e in intervals)
    merged: List[Tuple[float, float]] = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged
