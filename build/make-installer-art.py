"""生成安装界面用的品牌图（BMP）。

NSIS 对控件字体、颜色、圆角的支持都很有限，硬用 nsDialogs 拼排版会很难看。
这里的做法是：把「圆角图标 + 软件名 + 副标题」用 PIL 合成成一张整图，
安装页上只放一个 BITMAP 控件。设计全部在 Python 里控制，NSIS 只负责显示。

BMP 必须是 24 位——MUI 的头部图和侧边图不接受带 alpha 的图，所以圆角是先画好
圆角蒙版再贴到实色背景上的，不是靠透明度。

跑法：python build/make-installer-art.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "icon-source.webp"

APP_NAME = "dsh-Love Guide"
TAGLINE = "Evidence  →  Decision  →  Observation"

# 页面底色。MUI 的页面区域默认就是这个灰，图贴在灰色页面上才不会看出一块方块。
PAGE_BG = (240, 240, 240)
INK = (24, 24, 27)
MUTED = (113, 113, 122)
ACCENT = (240, 184, 101)  # 和 favicon / 主界面强调色一致


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """优先用微软雅黑：它是 Windows 上少数既好看又能显示箭头的字体。"""
    for name in (("msyhbd.ttc", "msyh.ttc") if bold else ("msyh.ttc", "msyhbd.ttc")):
        p = Path("C:/Windows/Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def load_square(size: int) -> Image.Image:
    img = Image.open(SOURCE).convert("RGBA")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    return img.resize((size, size), Image.LANCZOS)


def rounded(img: Image.Image, radius: int) -> Image.Image:
    """给图加圆角，返回带 alpha 的图。"""
    size = img.size[0]
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=radius * 4, fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    # 描一圈浅边，深色图标压在灰底上会有边界
    edge = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, outline=(0, 0, 0, 46), width=1
    )
    return Image.alpha_composite(out, edge)


def centered(draw: ImageDraw.ImageDraw, text: str, font, y: int, width: int, fill) -> None:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (right - left)) / 2 - left, y - top), text, font=font, fill=fill)


def canvas(w: int, h: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (w, h), PAGE_BG)
    return img, ImageDraw.Draw(img)


def brand_strip(w: int = 300, h: int = 54) -> Image.Image:
    """圆角图标 + 软件名，安装页上直接贴这张。

    尺寸是量出来的，不是随手定的，而且第一版**量错了两次**，结论记在这里：

    1. nsDialogs 的控件坐标是「对话单位」（DLU），MUI 的页面内区约 300x140 DLU。
    2. BITMAP 控件**不会**把图片缩放到控件框里，也**不会**把它裁到控件框里：图片
       按自己的像素尺寸画出来，再乘上系统的 DPI 缩放。本机是 150% 缩放，实测
       倍率约 1.44——所以 88 px 高的图在屏幕上占 127 px，控件框写 66 DLU（约 95 px）
       根本挡不住，图会压到下面的文字上。
    3. 因此真正要控的是**图片的像素高度**，而且必须按 1.44 倍去估它在屏幕上的高度；
       控件高度只用来占位和横向居中。

    300x54 px 在 150% 缩放下约 432x78 px，给下面留够了空间；副标题与分隔线故意不
    放在这里（它们在头部图和侧边图里），否则高度压不下去。
    """
    img, draw = canvas(w, h)
    icon = rounded(load_square(34), 8)
    img.paste(icon, ((w - 34) // 2, 2), icon)

    centered(draw, APP_NAME, load_font(13, bold=True), 38, w, INK)
    return img


def sidebar(w: int = 164, h: int = 314) -> Image.Image:
    """MUI 侧边图（欢迎页/结束页）。纵向：图标在上、软件名在下。"""
    img, draw = canvas(w, h)
    icon = rounded(load_square(64), 15)
    img.paste(icon, ((w - 64) // 2, 34), icon)

    centered(draw, "dsh-Love", load_font(15, bold=True), 116, w, INK)
    centered(draw, "Guide", load_font(15, bold=True), 136, w, INK)
    centered(draw, "关系决策实验室", load_font(10), 162, w, MUTED)

    draw.line([(42, 194), (w - 42, 194)], fill=(212, 212, 216), width=1)
    draw.line([(42, 194), (74, 194)], fill=ACCENT, width=2)

    centered(draw, "本地运行", load_font(10), 210, w, MUTED)
    centered(draw, "不联网也能用", load_font(10), 228, w, MUTED)
    centered(draw, "数据在你电脑里", load_font(10), 246, w, MUTED)
    return img


def header(w: int = 150, h: int = 57) -> Image.Image:
    """MUI 头部图（安装路径页等）。窄，所以图标在左、名字在右。"""
    img, draw = canvas(w, h)
    icon = rounded(load_square(34), 8)
    img.paste(icon, (9, (h - 34) // 2), icon)

    font = load_font(12, bold=True)
    left, top, right, bottom = draw.textbbox((0, 0), APP_NAME, font=font)
    draw.text((50 - left, (h - (bottom - top)) / 2 - top), APP_NAME, font=font, fill=INK)
    return img


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"找不到源图：{SOURCE}")
    outputs = {
        "installer-brand.bmp": brand_strip(),
        "installer-sidebar.bmp": sidebar(),
        "installer-header.bmp": header(),
    }
    for name, image in outputs.items():
        path = ROOT / name
        image.convert("RGB").save(path, "BMP")
        print(f"[art] {name}  {image.size[0]}x{image.size[1]}  {path.stat().st_size} 字节")


if __name__ == "__main__":
    main()
