"""Command line: `vidauto run ...` for one video, `vidauto inbox` for a drop folder."""

from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

from .config import load_config, load_override_file
from .pipeline import process

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}


def _parse_sets(pairs: List[str]) -> Dict:
    """--set clips.max_length=45 --set profanity.audio=beep -> nested dict."""
    result: Dict = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise SystemExit(f"--set expects key=value, got {pair!r}")
        key, value = pair.split("=", 1)
        node = result
        parts = key.strip().split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = yaml.safe_load(value)
    return result


def _config_path(arg: Optional[str]) -> Optional[Path]:
    if arg:
        return Path(arg)
    default = Path("config.yaml")
    return default if default.exists() else None


def _output_root(cfg: dict, cfg_path: Optional[Path], override: Optional[str]) -> Path:
    root = Path(override or cfg.get("output_dir", "./output")).expanduser()
    if not root.is_absolute() and cfg_path is not None:
        root = cfg_path.resolve().parent / root
    return root


def cmd_run(args) -> int:
    cfg_path = _config_path(args.config)
    overrides = _parse_sets(args.set)
    if args.no_clips:
        overrides.setdefault("clips", {})["enabled"] = False
    cfg = load_config(cfg_path, overrides)
    script = Path(args.script).read_text(encoding="utf-8") if args.script else None
    process(Path(args.video), Path(args.voiceover), cfg, _output_root(cfg, cfg_path, args.out),
            name=args.name, transcript=Path(args.transcript) if args.transcript else None, script_text=script)
    return 0


# --------------------------------------------------------------------------- inbox

def find_jobs(inbox: Path, settle_seconds: float = 5.0) -> List[Tuple[Path, Path]]:
    """Pairs of (video, voiceover) sharing a file name, e.g. dog.mp4 + dog.mp3."""
    now = time.time()
    files = [p for p in inbox.iterdir() if p.is_file() and not p.name.startswith(".")]
    videos = {p.stem: p for p in files if p.suffix.lower() in VIDEO_EXTS}
    audios = {p.stem: p for p in files if p.suffix.lower() in AUDIO_EXTS}
    jobs = []
    for stem in sorted(videos.keys() & audios.keys()):
        v, a = videos[stem], audios[stem]
        # skip files that are still being copied in
        if all(now - p.stat().st_mtime >= settle_seconds for p in (v, a)):
            jobs.append((v, a))
    return jobs


def _move(paths, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for p in paths:
        if p.exists():
            p.rename(dest / p.name)


def process_inbox(inbox: Path, cfg_path: Optional[Path], overrides: Dict) -> int:
    failures = 0
    for video, audio in find_jobs(inbox):
        stem = video.stem
        extras = [inbox / f"{stem}.yaml", inbox / f"{stem}.yml", inbox / f"{stem}.txt"]
        per_job = load_override_file(extras[0]) or load_override_file(extras[1])
        cfg = load_config(cfg_path, per_job, overrides)
        script = extras[2].read_text(encoding="utf-8") if extras[2].exists() else None
        try:
            process(video, audio, cfg, _output_root(cfg, cfg_path, None), name=stem, script_text=script)
            _move([video, audio, *extras], inbox / "done" / stem)
        except Exception:  # keep the watcher alive; park the job for a look
            failures += 1
            err = traceback.format_exc()
            print(err, file=sys.stderr)
            _move([video, audio, *extras], inbox / "failed" / stem)
            (inbox / "failed" / stem / "error.txt").write_text(err, encoding="utf-8")
    return failures


def cmd_inbox(args) -> int:
    cfg_path = _config_path(args.config)
    overrides = _parse_sets(args.set)
    inbox = Path(args.folder).expanduser()
    inbox.mkdir(parents=True, exist_ok=True)
    if not args.watch:
        if not find_jobs(inbox, settle_seconds=0):
            print(f"Nothing to do. Put matching pairs like my-video.mp4 + my-video.mp3 in {inbox.resolve()}")
        return 1 if process_inbox(inbox, cfg_path, overrides) else 0
    print(f"Watching {inbox.resolve()} (Ctrl+C to stop)...")
    try:
        while True:
            process_inbox(inbox, cfg_path, overrides)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vidauto", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("-c", "--config", help="settings file (default: ./config.yaml)")
    common.add_argument("--set", action="append", metavar="KEY=VALUE",
                        help="override one setting, e.g. --set clips.max_length=45 (repeatable)")

    r = sub.add_parser("run", parents=[common], help="process one video + voiceover")
    r.add_argument("video")
    r.add_argument("voiceover")
    r.add_argument("-n", "--name", help="output name (default: the video's file name)")
    r.add_argument("-o", "--out", help="output folder (default: output_dir from config)")
    r.add_argument("--script", help="text file with the voiceover script (improves caption spelling)")
    r.add_argument("--transcript", help="use this transcript.json instead of running Whisper")
    r.add_argument("--no-clips", action="store_true", help="skip making short clips")
    r.set_defaults(func=cmd_run)

    i = sub.add_parser("inbox", parents=[common], help="process every video+voiceover pair in a folder")
    i.add_argument("folder", nargs="?", default="inbox")
    i.add_argument("-w", "--watch", action="store_true", help="keep running and pick up new files as they arrive")
    i.add_argument("--interval", type=float, default=10.0, help="seconds between checks in --watch mode")
    i.set_defaults(func=cmd_inbox)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
