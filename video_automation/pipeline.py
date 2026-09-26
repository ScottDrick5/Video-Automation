"""The whole job: voiceover -> transcript -> profanity filter -> captions -> exports -> clips."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable, List, Optional

from . import ffmpeg
from .captions import chunk_words, shift_words, write_ass, write_srt
from .clips import plan_clips
from .profanity import ProfanityFilter, merge_intervals
from .transcribe import load_words, save_words, transcribe


def process(
    video: Path,
    voiceover: Path,
    cfg: dict,
    out_root: Path,
    name: Optional[str] = None,
    transcript: Optional[Path] = None,
    script_text: Optional[str] = None,
    log: Callable[[str], None] = print,
) -> Path:
    """Run the full pipeline for one video. Returns the output folder."""
    ffmpeg.require_ffmpeg()
    video, voiceover = Path(video).resolve(), Path(voiceover).resolve()
    name = name or video.stem
    out = Path(out_root).resolve() / name
    work = out / ".work"
    work.mkdir(parents=True, exist_ok=True)

    vinfo, ainfo = ffmpeg.probe(video), ffmpeg.probe(voiceover)
    if not vinfo["width"]:
        raise ValueError(f"{video} has no video stream")
    vc, enc, cap = cfg["video"], cfg["encoding"], cfg["captions"]
    vo_start = float(vc.get("voiceover_start", 0.0))
    if vc.get("length", "voiceover") == "video":
        total = vinfo["duration"]
    else:
        total = vo_start + ainfo["duration"] + float(vc.get("tail_padding", 0.5))
    log(f"[{name}] video {vinfo['duration']:.1f}s, voiceover {ainfo['duration']:.1f}s -> finished length {total:.1f}s")

    # 1. Transcript (cached so a re-run is fast, and so you can fix a mis-heard word and re-run)
    cached = out / "transcript.json"
    if transcript:
        words = load_words(transcript)
        log(f"[{name}] using transcript {transcript}")
    elif cached.exists():
        words = load_words(cached)
        log(f"[{name}] reusing {cached.name} (delete it to transcribe again)")
    else:
        log(f"[{name}] transcribing voiceover with Whisper ({cfg['transcription']['model']})...")
        words = transcribe(voiceover, cfg["transcription"], script_text)
    save_words(cached, words)
    words = shift_words(words, vo_start, end=total - vo_start)  # voiceover time -> video time

    # 2. Profanity
    hits: List[dict] = []
    if cfg["profanity"].get("enabled", True):
        words, hits = ProfanityFilter.from_config(cfg["profanity"]).apply(words)
        log(f"[{name}] censored {len(hits)} word(s)" + (": " + ", ".join(h["word"] for h in hits) if hits else ""))
    audio_mode = cfg["profanity"].get("audio", "off") if hits else "off"
    bleeps = merge_intervals((h["start"], h["end"]) for h in hits) if audio_mode != "off" else []

    # 3. Clean master: new audio, reshaped picture, no captions
    final_cfg, cam_cfg = cfg["exports"]["final"], cfg["exports"]["camtasia"]
    fmt = final_cfg.get("format", "original")
    width, height = ffmpeg.format_size(fmt, vinfo["width"], vinfo["height"], enc)
    clean = out / f"{name}_camtasia.mp4" if cam_cfg.get("enabled", True) else work / "clean.mp4"
    log(f"[{name}] rendering {width}x{height} base video...")
    _render_base(video, voiceover, vinfo, total, vo_start, bleeps, audio_mode,
                 ffmpeg.format_filter(fmt, final_cfg.get("fill", "blur"), width, height), cfg, clean)

    chunks = chunk_words(words, int(cap.get("max_words", 4)), int(cap.get("max_chars", 22)))
    outputs = []
    if cam_cfg.get("enabled", True):
        srt = out / f"{name}.srt"
        write_srt(srt, chunk_words(words, max_words=8, max_chars=42))
        outputs += [clean, srt]

    # 4. Captioned final video
    if final_cfg.get("enabled", True):
        final = out / f"{name}_final.mp4"
        write_ass(work / "final.ass", chunks, width, height, cap)
        log(f"[{name}] burning captions...")
        ffmpeg.run(["-i", str(clean), "-vf", "ass=final.ass", *ffmpeg.encode_args(enc), str(final)], cwd=work)
        outputs.append(final)

    # 5. Short clips
    clip_list = []
    if cfg["clips"].get("enabled", True):
        cc = cfg["clips"]
        clip_list = plan_clips(words, total, cc)
        cw, ch = ffmpeg.format_size(cc.get("format", "vertical"), width, height, enc)
        reshape = ffmpeg.format_filter(cc.get("format", "vertical"), cc.get("fill", "blur"), cw, ch)
        clips_dir = out / "clips"
        clips_dir.mkdir(exist_ok=True)
        for clip in clip_list:
            dur = clip["end"] - clip["start"]
            clip_words = shift_words(words, -clip["start"], clip["start"], clip["end"])
            ass = f"{clip['name']}.ass"
            write_ass(work / ass, chunk_words(clip_words, int(cap.get("max_words", 4)), int(cap.get("max_chars", 22))), cw, ch, cap)
            target = clips_dir / f"{name}_{clip['name']}.mp4"
            log(f"[{name}] clip {clip['name']}: {clip['start']:.1f}s-{clip['end']:.1f}s ({dur:.0f}s)")
            ffmpeg.run([
                "-ss", f"{clip['start']:.3f}", "-i", str(clean), "-t", f"{dur:.3f}",
                "-filter_complex", f"[0:v]{reshape},ass={ass}[v]", "-map", "[v]", "-map", "0:a?",
                *ffmpeg.encode_args(enc), str(target),
            ], cwd=work)
            outputs.append(target)

    _write_report(out / "report.txt", name, total, outputs, hits, clip_list, audio_mode)
    shutil.rmtree(work, ignore_errors=True)
    log(f"[{name}] done -> {out}")
    return out


def _render_base(video, voiceover, vinfo, total, vo_start, bleeps, audio_mode, vfilter, cfg, target):
    vc, enc = cfg["video"], cfg["encoding"]
    inputs = []
    if vinfo["duration"] < total:
        inputs += ["-stream_loop", "-1"]  # source clip is shorter than the voiceover: loop it
    inputs += ["-i", str(video), "-i", str(voiceover)]

    delay_ms = int(round(vo_start * 1000))
    graph = [
        f"[0:v]{vfilter}[vout]",
        f"[1:a]aresample=48000,adelay={delay_ms}:all=1,volume={float(vc.get('voiceover_volume', 1.0))}[vo]",
    ]
    orig_vol = float(vc.get("original_audio_volume", 0.0))
    if orig_vol > 0 and vinfo["has_audio"]:
        graph.append(f"[0:a]aresample=48000,volume={orig_vol}[orig]")
        graph.append("[vo][orig]amix=inputs=2:duration=longest:normalize=0[mix]")
    else:
        graph.append("[vo]anull[mix]")
    graph.append("[mix]apad[padded]")

    last = "padded"
    if bleeps:
        expr = ffmpeg.between_expr(bleeps)
        graph.append(f"[padded]volume=0:enable='{expr}'[muted]")
        last = "muted"
        if audio_mode == "beep":
            graph.append(f"sine=frequency=1000:sample_rate=48000,volume=0.3,volume=0:enable='eq({expr},0)'[beep]")
            graph.append("[muted][beep]amix=inputs=2:duration=first:normalize=0[beeped]")
            last = "beeped"

    ffmpeg.run([
        *inputs, "-filter_complex", ";".join(graph), "-map", "[vout]", "-map", f"[{last}]",
        "-t", f"{total:.3f}", *ffmpeg.encode_args({**enc, "crf": min(int(enc.get("crf", 20)), 18)}), str(target),
    ])


def _fmt_time(t: float) -> str:
    m, s = divmod(t, 60)
    return f"{int(m)}:{s:05.2f}"


def _write_report(path, name, total, outputs, hits, clips, audio_mode):
    lines = [f"{name}", f"Length: {_fmt_time(total)}", "", "Files:"]
    lines += [f"  {Path(p).relative_to(path.parent)}" for p in outputs]
    lines += ["", f"Censored words ({len(hits)}; audio: {audio_mode}):"]
    lines += [f"  {_fmt_time(h['start'])}  {h['word']}" for h in hits] or ["  none"]
    if clips:
        lines += ["", "Clips:"]
        lines += [f"  {c['name']}: {_fmt_time(c['start'])} - {_fmt_time(c['end'])}" for c in clips]
    lines += ["", "Tip: fix a mis-heard word in transcript.json and run again -- it won't re-transcribe."]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
