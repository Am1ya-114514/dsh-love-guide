#!/usr/bin/env python3
"""从 build/icon-source.webp 生成各平台要用的图标。

为什么用脚本而不是直接提交一堆二进制：图标要同时喂给 Electron（.ico，多档尺寸）、
网页（favicon）、以及界面里的品牌标记。留着源图 + 这个脚本，以后换图只要换源图。

用法：
    python build/make-icon.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print("需要 Pillow：python -m pip install pillow", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SOURCE = BUILD / "icon-source.webp"

# .ico 里要有的尺寸。Windows 在标题栏、任务栏、Alt+Tab、桌面大图标时各取所需。
ICO_SIZES = [256, 128, 64, 48, 32, 24, 16]


def load_square() -> Image.Image:
    """读源图并裁成 1:1。

    源图基本是正方形，这里只做居中裁切以保证严格 1:1，不做拉伸变形。
    """
    img = Image.open(SOURCE).convert("RGBA")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def main() -> int:
    if not SOURCE.exists():
        print(f"找不到源图：{SOURCE}", file=sys.stderr)
        return 1

    src = load_square()
    print(f"源图 {Image.open(SOURCE).size} -> 裁成 {src.size}")

    # 主图（512）：Electron 在打包时会拿它做部分平台的图标。
    icon_png = BUILD / "icon.png"
    src.resize((512, 512), Image.LANCZOS).save(icon_png, "PNG", optimize=True)
    print(f"写出 {icon_png.relative_to(ROOT)}  512x512")

    # .ico：把每一档都按目标尺寸重新采样，比让系统缩放一张大图清楚得多。
    icon_ico = BUILD / "icon.ico"
    src.resize((256, 256), Image.LANCZOS).save(
        icon_ico,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
    )
    print(f"写出 {icon_ico.relative_to(ROOT)}  含 {', '.join(str(s) for s in ICO_SIZES)}")

    # 网页 favicon 与 iOS/macOS 加到桌面时的图标。
    public = ROOT / "public"
    public.mkdir(exist_ok=True)
    fav = public / "favicon.png"
    src.resize((64, 64), Image.LANCZOS).save(fav, "PNG", optimize=True)
    print(f"写出 {fav.relative_to(ROOT)}  64x64")

    touch = public / "apple-touch-icon.png"
    src.resize((180, 180), Image.LANCZOS).save(touch, "PNG", optimize=True)
    print(f"写出 {touch.relative_to(ROOT)}  180x180")

    # 界面左上角的品牌标记。用 2 倍图，高 DPI 屏不糊。
    assets = ROOT / "src" / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    brand = assets / "brand.png"
    src.resize((128, 128), Image.LANCZOS).save(brand, "PNG", optimize=True)
    print(f"写出 {brand.relative_to(ROOT)}  128x128")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
