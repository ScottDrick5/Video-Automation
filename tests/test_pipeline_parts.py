import shutil
import subprocess

import pytest

from video_automation.captions import ass_color, build_ass, chunk_words, shift_words
from video_automation.clips import plan_clips
from video_automation.config import load_config
from video_automation.profanity import ProfanityFilter, merge_intervals


def words_from(text, gap=0.35):
    out, t = [], 0.0
    for w in text.split():
        out.append({"word": w, "start": round(t, 3), "end": round(t + 0.3, 3)})
        t += gap
    return out


@pytest.fixture
def cfg():
    return load_config()


# ---------------------------------------------------------------- profanity

def test_masks_curse_words_and_keeps_punctuation(cfg):
    pf = ProfanityFilter.from_config(cfg["profanity"])
    cleaned, hits = pf.apply(words_from("What the fuck, that's bullshit!"))
    assert [w["word"] for w in cleaned] == ["What", "the", "f***,", "that's", "b*******!"]
    assert [h["word"] for h in hits] == ["fuck,", "bullshit!"]


def test_does_not_flag_innocent_words(cfg):
    pf = ProfanityFilter.from_config(cfg["profanity"])
    for word in ["class", "assume", "Dickens", "cockpit", "Scunthorpe", "shiitake", "hello", "assassin"]:
        assert not pf.is_profane(word), word


def test_prefix_matches_variants_and_whisper_self_censoring(cfg):
    pf = ProfanityFilter.from_config(cfg["profanity"])
    for word in ["FUCKING", "Motherfucker", "shitty", "f***", "sh*t"]:
        assert pf.is_profane(word), word


def test_modes_extra_and_allowed_words(cfg):
    p = dict(cfg["profanity"], mode="replace", replacement="[beep]", extra_words=["heck"], allowed_words=["crap"])
    pf = ProfanityFilter.from_config(p)
    cleaned, hits = pf.apply(words_from("oh heck. crap"))
    assert [w["word"] for w in cleaned] == ["oh", "[beep].", "crap"]
    pf.mode = "remove"
    assert [w["word"] for w in pf.apply(words_from("oh heck now"))[0]] == ["oh", "now"]


def test_merge_intervals():
    assert merge_intervals([(1.0, 1.2), (1.2, 1.5), (3, 3.1)], pad=0.05) == [(0.95, 1.55), (2.95, 3.15)]


# ---------------------------------------------------------------- captions

def test_chunks_respect_limits_and_sentences():
    chunks = chunk_words(words_from("one two three four five. six seven"), max_words=3, max_chars=40)
    assert [" ".join(w["word"] for w in c["words"]) for c in chunks] == ["one two three", "four five.", "six seven"]


def test_chunks_split_on_pauses():
    words = [{"word": "a", "start": 0, "end": 0.2}, {"word": "b", "start": 2.0, "end": 2.2}]
    assert len(chunk_words(words)) == 2


def test_ass_has_highlight_and_style(cfg):
    chunks = chunk_words(words_from("hello there, friend"))
    ass = build_ass(chunks, 1080, 1920, cfg["captions"])
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
    dialogues = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert len(dialogues) == 3  # one per highlighted word
    text = dialogues[0].split(",,", 1)[1].split(",,")[-1]
    assert "THERE" in text and "," not in text
    assert ass_color("#FFD700") == "&H0000D7FF"


def test_shift_words_filters_to_window():
    shifted = shift_words(words_from("a b c d"), -0.7, start=0.7, end=1.1)
    assert [w["word"] for w in shifted] == ["c", "d"]
    assert shifted[0]["start"] == 0.0


# ---------------------------------------------------------------- clips

def test_auto_clips_cut_at_sentences_within_limits(cfg):
    sentence = "this is a sentence of ten words right here ok."
    words = words_from(" ".join([sentence] * 30), gap=0.5)  # ~150s of speech
    total = words[-1]["end"] + 1
    clips = plan_clips(words, total, dict(cfg["clips"], max_length=60, min_length=15))
    assert clips[0]["start"] == 0 and clips[-1]["end"] == pytest.approx(total)
    for a, b in zip(clips, clips[1:]):
        assert a["end"] == b["start"]
    assert all(c["end"] - c["start"] <= 60 * 1.25 for c in clips)
    assert len(clips) >= 3


def test_short_video_is_one_clip(cfg):
    assert plan_clips(words_from("hi there."), 20.0, cfg["clips"]) == [{"name": "clip01", "start": 0.0, "end": 20.0}]


def test_manual_clips(cfg):
    c = dict(cfg["clips"], mode="manual", segments=[{"start": 5, "end": 20, "name": "hook"}, {"start": 30, "end": 99}])
    assert plan_clips([], 40.0, c) == [
        {"name": "hook", "start": 5.0, "end": 20.0},
        {"name": "clip02", "start": 30.0, "end": 40.0},
    ]


# ---------------------------------------------------------------- end to end (needs ffmpeg)

@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_end_to_end(tmp_path, cfg):
    import json

    from video_automation.pipeline import process

    video, vo = tmp_path / "src.mp4", tmp_path / "vo.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
                    "-f", "lavfi", "-i", "sine=frequency=300", "-t", "3", "-pix_fmt", "yuv420p", str(video)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=500", "-t", "5", str(vo)], check=True)
    transcript = tmp_path / "t.json"
    transcript.write_text(json.dumps({"words": words_from("well what the hell is shit going on here.")}))

    cfg["profanity"]["audio"] = "beep"
    cfg["encoding"]["preset"] = "ultrafast"
    cfg["encoding"]["vertical_size"] = [360, 640]
    out = process(video, vo, cfg, tmp_path / "out", transcript=transcript, log=lambda *_: None)

    assert (out / "src_final.mp4").exists() and (out / "src_camtasia.mp4").exists()
    assert (out / "clips" / "src_clip01.mp4").exists()
    assert "s***" in (out / "src.srt").read_text()
    assert "shit" in (out / "report.txt").read_text()
