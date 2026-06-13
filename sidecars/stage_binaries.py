"""Stage PyInstaller outputs for Tauri externalBin bundling.

Run from the sidecars/ directory after building capture.exe and chat.exe:
    python stage_binaries.py
"""

import shutil
import subprocess
import sys
from pathlib import Path

SIDECARS = ("capture", "chat")


def main() -> int:
    sidecars_dir = Path(__file__).resolve().parent
    dist_dir = sidecars_dir / "dist"
    binaries_dir = sidecars_dir.parent / "src-tauri" / "binaries"

    try:
        target = subprocess.check_output(
            ["rustc", "--print", "host-tuple"],
            text=True,
            stderr=subprocess.PIPE,
        ).strip()
    except FileNotFoundError:
        print("error: rustc not found on PATH", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"error: rustc failed: {exc.stderr}", file=sys.stderr)
        return 1

    ext = ".exe" if sys.platform == "win32" else ""
    binaries_dir.mkdir(parents=True, exist_ok=True)

    for name in SIDECARS:
        src = dist_dir / f"{name}{ext}"
        dst = binaries_dir / f"{name}-{target}{ext}"
        if not src.is_file():
            print(f"error: missing {src} — run PyInstaller first", file=sys.stderr)
            return 1
        shutil.move(str(src), str(dst))
        print(f"staged {dst.relative_to(sidecars_dir.parent)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
