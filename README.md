# Video Automation

> **Looking for the Premiere Pro plugin test?** See [`premiere-plugin/README.md`](premiere-plugin/README.md). The standalone tool described below is an earlier version, kept for reference.

Drop a video and your voiceover into a folder. Your Mac hands back:

| File | What it's for |
|---|---|
| `name_final.mp4` | Video with your voiceover and burned-in captions, curse words masked. Ready to post. |
| `clips/name_clip01.mp4`, … | Vertical 9:16 clips (≤ 60 s by default, cut at sentence breaks) with captions, for TikTok, Reels and Shorts. |
| `name_camtasia.mp4` + `name.srt` | The same video **without** burned-in captions, plus a caption file, if you still want to edit in Camtasia. |
| `report.txt` | Every word that was censored, with timestamps, and where each clip starts and ends. |

This replaces the Premiere Pro step completely (voiceover, captions, curse-word check and export).
Uploading is still up to you.

## How it works

1. **Voiceover**: your ChatGPT voiceover replaces (or plays over) the video's audio. The video is trimmed
   to the voiceover's length, or looped if it's shorter.
2. **Captions**: [Whisper](https://github.com/SYSTRAN/faster-whisper) runs on your Mac and writes down
   every word with its exact timing. It's free and needs no API key.
3. **Curse words**: each word is checked against `video_automation/profanity_words.txt` and masked
   (`F***`). You can also mute or beep the audio under them.
4. **Captions are burned in** TikTok-style: a few words at a time, with the word being spoken highlighted.
5. **Clips**: the finished video is cut into short vertical clips at sentence breaks.

## One-time setup

1. Install [Homebrew](https://brew.sh) if you don't have it.
2. Download this project, open **Terminal**, and run:
   ```bash
   cd path/to/Video-Automation
   ./mac/setup_mac.sh
   ```
   This installs ffmpeg and the Python packages, and creates `config.yaml` and the `inbox/` folder.

The first run downloads the Whisper speech model (about 500 MB for `small.en`), so it takes a little longer.

## Daily use

1. Put the video and the voiceover in `inbox/` **with the same file name**:
   ```
   inbox/crazy-dog.mp4
   inbox/crazy-dog.mp3
   ```
   Optional extras with the same name:
   - `crazy-dog.txt`: the voiceover script. Helps names and slang come out spelled right.
   - `crazy-dog.yaml`: settings for this one video only, for example:
     ```yaml
     clips:
       max_length: 30
     profanity:
       audio: beep
     ```
2. Double-click **`mac/Process Inbox.command`**. When it finishes, the `output/` folder opens.
   Processed files move to `inbox/done/`. If something goes wrong they move to `inbox/failed/` with an `error.txt`.

### Hands-off mode

```bash
./mac/install_watcher.sh
```
Now it runs in the background, starting automatically when you log in. Drop files into `inbox/` and
finished videos appear in `output/`. To stop it: `./mac/install_watcher.sh --uninstall`.

### From Terminal

```bash
source .venv/bin/activate
vidauto run ~/Downloads/clip.mp4 ~/Downloads/voiceover.mp3
vidauto run clip.mp4 vo.mp3 --name monday-post --set clips.max_length=45 --set profanity.audio=mute
vidauto inbox inbox --watch
```

## Settings (`config.yaml`)

The most useful ones are below. The full list, with explanations, is in `video_automation/default_config.yaml`.

| Setting | Default | Meaning |
|---|---|---|
| `video.original_audio_volume` | `0` | Keep the source video's sound under the voiceover (for example `0.15`). |
| `video.voiceover_start` | `0` | Start the voiceover this many seconds into the video. |
| `profanity.mode` | `asterisk` | How curse words look in captions: `asterisk` (F***), `full` (\*\*\*\*), `remove` or `replace`. |
| `profanity.audio` | `"off"` | Set to `"mute"` or `"beep"` to also silence curse words in the voiceover audio. |
| `profanity.extra_words` / `allowed_words` | `[]` | Add words to the list, or allow ones it blocks. |
| `captions.font`, `highlight_color`, `max_words`, `position` | | How the captions look. |
| `exports.final.format` | `original` | Make the main video `vertical` or `square` instead. |
| `exports.camtasia.enabled` | `true` | Set to `false` if you stop using Camtasia. |
| `clips.max_length` | `60` | Longest a clip can be, in seconds. |
| `clips.mode` | `auto` | Set to `manual` and list `segments` to choose exactly where to cut. |
| `clips.fill` | `blur` | How landscape video fills a vertical frame: `blur` (blurred background) or `crop` (zoom in). |

## Fixing a caption

Whisper occasionally mishears a word. Open `output/<name>/transcript.json`, fix the word, and run the same
video again (put the files back in `inbox/` or use `vidauto run`). It reuses your corrected transcript
instead of transcribing again.

## Using the Camtasia files

Import `name_camtasia.mp4` into Camtasia and do your edits. To get captions, use
**File → Import → Captions** and pick `name.srt`. The curse words in it are already masked.

## Development

```bash
pip install -e '.[dev]'
pytest
```
