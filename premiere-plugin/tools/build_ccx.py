"""Package premiere-plugin/plugin into .ccx installer files.

Adobe's installer is picky about the zip layout, so this builds two variants:
  dist/VidAutoTest.ccx         files at the top of the archive (the usual layout)
  dist/VidAutoTest-folder.ccx  files inside one folder named after the plugin id
Both use normal file permissions (644 files, 755 folders).

Run: python3 premiere-plugin/tools/build_ccx.py
"""

import json
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugin"
DIST = ROOT / "dist"


def png(size, rgb=(40, 120, 220)):
    """A plain square PNG, used for the plugin icons."""
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def ensure_icons():
    icons = PLUGIN / "icons"
    icons.mkdir(exist_ok=True)
    for name, size in [("plugin-icon", 48), ("panel-dark", 23), ("panel-light", 23)]:
        (icons / f"{name}.png").write_bytes(png(size))
        (icons / f"{name}@2x.png").write_bytes(png(size * 2))


def add(zf, arcname, data=None, is_dir=False):
    info = zipfile.ZipInfo(arcname + ("/" if is_dir else ""), date_time=(2026, 1, 1, 0, 0, 0))
    info.create_system = 3  # unix, so the permission bits below are honoured
    info.external_attr = ((0o40755 if is_dir else 0o100644) << 16) | (0x10 if is_dir else 0)
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, b"" if is_dir else data)


def build(target, prefix):
    files = sorted(p for p in PLUGIN.rglob("*") if p.is_file() and not p.name.startswith("."))
    with zipfile.ZipFile(target, "w") as zf:
        if prefix:
            add(zf, prefix, is_dir=True)
        dirs = sorted({p.parent.relative_to(PLUGIN) for p in files} - {Path(".")})
        for d in dirs:
            add(zf, f"{prefix}/{d.as_posix()}" if prefix else d.as_posix(), is_dir=True)
        for f in files:
            rel = f.relative_to(PLUGIN).as_posix()
            add(zf, f"{prefix}/{rel}" if prefix else rel, f.read_bytes())
    print(f"built {target.relative_to(ROOT.parent)} ({len(files)} files)")


def main():
    ensure_icons()
    plugin_id = json.loads((PLUGIN / "manifest.json").read_text())["id"]
    DIST.mkdir(exist_ok=True)
    build(DIST / "VidAutoTest.ccx", "")
    build(DIST / "VidAutoTest-folder.ccx", plugin_id)


if __name__ == "__main__":
    main()
