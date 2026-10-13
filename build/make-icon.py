"""把 public/favicon.svg 的狗头标记画成 Windows 图标（.ico + .png）。

为什么要单独画一遍：PIL 不能渲染 SVG，而 Electron 在 Windows 上要的是
多尺寸 .ico。这里按 SVG 里的原始坐标（64×64 视图框）重画，再降采样，
保证每个尺寸都干净——直接让系统缩放 256px 会糊。
"""
from PIL import Image, ImageDraw

DARK = (12, 10, 9, 255)
GOLD = (240, 184, 101, 255)
SS = 8  # 超采样倍数：先画 8 倍大再缩，边缘才不会有锯齿
BASE = 64


def draw_mark(size: int) -> Image.Image:
    px = size * SS
    k = px / BASE
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def p(x, y):
        return (x * k, y * k)

    # 圆角底板
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=15 * k, fill=DARK)

    # 两只耳朵（三角形）
    d.polygon([p(18.6, 13.1), p(11.9, 31.6), p(26.5, 25.5)], fill=GOLD)
    d.polygon([p(45.4, 13.1), p(52.1, 31.6), p(37.5, 25.5)], fill=GOLD)

    # 头（圆），圆心 (32, 33.3) 半径 15.4
    cx, cy = p(32, 33.3)
    d.ellipse([cx - 15.4 * k, cy - 15.4 * k, cx + 15.4 * k, cy + 15.4 * k], fill=GOLD)

    # 眼睛
    for ex, ey in ((25.7, 31.4), (38.3, 31.4)):
        x, y = p(ex, ey)
        d.ellipse([x - 2.7 * k, y - 2.7 * k, x + 2.7 * k, y + 2.7 * k], fill=DARK)

    # 鼻子：以 (32, 39.1) 为圆心、半径 3 的下半圆
    nx, ny = p(32, 39.1)
    d.pieslice([nx - 3 * k, ny - 3 * k, nx + 3 * k, ny + 3 * k], start=0, end=180, fill=DARK)

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    out_png = os.path.join(here, "icon.png")
    out_ico = os.path.join(here, "icon.ico")

    master = draw_mark(512)
    master.save(out_png, format="PNG")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [draw_mark(s) for s in sizes]
    frames[-1].save(out_ico, format="ICO", sizes=[(s, s) for s in sizes])

    print(f"[icon] {out_png} 512x512")
    print(f"[icon] {out_ico} sizes={sizes}")
    for s in sizes:
        print(f"[icon]   {s}x{s} ok")


if __name__ == "__main__":
    main()
