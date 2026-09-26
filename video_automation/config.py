"""Load settings: built-in defaults <- config.yaml <- per-video overrides."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

DEFAULTS_PATH = Path(__file__).with_name("default_config.yaml")


def deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy of ``base`` with ``override`` merged in (nested dicts merge, everything else replaces)."""
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _read_yaml(path: Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping at the top level")
    return data


def _normalise(cfg: Dict[str, Any]) -> Dict[str, Any]:
    # YAML 1.1 turns a bare `off` into False; accept that spelling.
    audio = cfg["profanity"].get("audio")
    if audio is False or audio is None:
        cfg["profanity"]["audio"] = "off"
    elif audio is True:
        cfg["profanity"]["audio"] = "mute"
    return cfg


def load_config(path: Optional[Path] = None, *overrides: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    cfg = _read_yaml(DEFAULTS_PATH)
    if path is not None:
        cfg = deep_merge(cfg, _read_yaml(Path(path)))
    for extra in overrides:
        if extra:
            cfg = deep_merge(cfg, extra)
    return _normalise(cfg)


def load_override_file(path: Path) -> Dict[str, Any]:
    return _read_yaml(path) if path.exists() else {}
