"""从 build/icon-source.webp 生成 Android 需要的图标与启动图。

和 make-icon.py 分开写是因为两者要的东西不一样：桌面只要一张 .ico，
Android 要的是「自适应图标」的三件套——前景、背景、以及旧版系统用的合成图——
外加一张启动屏。全部由同一张源图生成，不引入任何第三方素材。

跑法：python build/make-android-art.py
产物落在仓库根的 assets/（@capacitor/assets 认这个目录）。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(__file__).resolve().parent / "icon-source.webp"
OUT = ROOT / "assets"

# 和桌面版保持一致的底色，取自 src/index.css 的 --background 深色值。
BG = (12, 10, 9)

# 自适应图标：前景画在 108dp 的画布上，系统只会露出中间约 72dp（66%）。
# 这里**刻意不把前景缩进安全区**：源图是一张满幅插画，缩进去就会在深色背景层上
# 露出一块浅色方框（插画自己的底色），比被遮罩裁掉四角难看得多。人物在画面正中，
# 外层 17% 本来就只有头发和背景，裁掉不可惜。
ADAPTIVE = 1024
SAFE_RATIO = 1.0

# 启动屏用 Android 12 之前的 splash 尺寸，@capacitor/assets 会自己缩。
SPLASH = 2732
SPLASH_ICON_RATIO = 0.28


def load_square(size: int) -> Image.Image:
    """把源图居中裁成正方形再缩放，避免拉伸变形。"""
    img = Image.open(SOURCE).convert("RGBA")
    side = min(img.size)
    left = (img.width - side) // 2
    top = (img.height - side) // 2
    return img.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.LANCZOS
    )


def rounded(img: Image.Image, radius_ratio: float) -> Image.Image:
    """圆角遮罩。4 倍超采样再降采样，边缘才不会有锯齿。"""
    size = img.width
    radius = int(size * radius_ratio)
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1), radius=radius * scale, fill=255
    )
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def flattened(img: Image.Image, size: int) -> Image.Image:
    """把透明图压到实色底上——旧版 Android 的图标不支持透明。"""
    canvas = Image.new("RGB", (size, size), BG)
    canvas.paste(img, (0, 0), img)
    return canvas


def write_android_res(legacy: Image.Image, foreground: Image.Image) -> None:
    """直接写进 Capacitor 生成的 android 资源目录。

    没有用 @capacitor/assets：它依赖 sharp，而 sharp 的安装脚本在 pnpm 下默认被拦，
    为了生成一批固定尺寸的 PNG 引入一个原生依赖不划算。这里把尺寸表写死，
    跑一次就把 mipmap 与 splash 全部覆盖掉。

    对应关系（Android 的密度倍率）：mdpi 1x / hdpi 1.5x / xhdpi 2x / xxhdpi 3x / xxxhdpi 4x
      ic_launcher            48dp
      ic_launcher_round      48dp
      ic_launcher_foreground 108dp（自适应图标的前景画布）
    """
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    if not res.exists():
        print("  （还没有 android/ 目录，先跑 npx cap add android 再生成资源）")
        return

    densities = {
        "mdpi": 1.0,
        "hdpi": 1.5,
        "xhdpi": 2.0,
        "xxhdpi": 3.0,
        "xxxhdpi": 4.0,
    }
    count = 0
    for name, factor in densities.items():
        folder = res / f"mipmap-{name}"
        if not folder.exists():
            continue
        side = int(48 * factor)
        # 旧版图标必须不透明，自适应前景则可以带透明。
        legacy.resize((side, side), Image.LANCZOS).convert("RGB").save(
            folder / "ic_launcher.png"
        )
        circular = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        mask = Image.new("L", (side * 4, side * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, side * 4 - 1, side * 4 - 1), fill=255)
        circular.paste(
            legacy.resize((side, side), Image.LANCZOS),
            (0, 0),
            mask.resize((side, side), Image.LANCZOS),
        )
        circular.convert("RGB").save(folder / "ic_launcher_round.png")

        fg_side = int(108 * factor)
        foreground.resize((fg_side, fg_side), Image.LANCZOS).save(
            folder / "ic_launcher_foreground.png"
        )
        count += 3

    # 自适应图标的背景色（模板默认是 #FFFFFF）。
    (res / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">#{BG[0]:02X}{BG[1]:02X}{BG[2]:02X}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )

    # 启动图：底色 + 居中的圆角图标。styles.xml 把它当窗口背景拉伸，
    # 所以只放纯色底与一个小图标，拉伸也看不出来。
    def splash(width: int, height: int) -> Image.Image:
        canvas = Image.new("RGB", (width, height), BG)
        side = int(min(width, height) * SPLASH_ICON_RATIO)
        icon = legacy.resize((side, side), Image.LANCZOS)
        canvas.paste(icon, ((width - side) // 2, (height - side) // 2))
        return canvas

    targets: list[tuple[Path, int, int]] = [(res / "drawable" / "splash.png", 1024, 1024)]
    for name, factor in densities.items():
        targets.append(
            (res / f"drawable-port-{name}" / "splash.png", int(320 * factor), int(480 * factor))
        )
        targets.append(
            (res / f"drawable-land-{name}" / "splash.png", int(480 * factor), int(320 * factor))
        )
    for path, width, height in targets:
        if path.parent.exists():
            splash(width, height).save(path)
            count += 1

    print(f"  写入 Android 资源 {count} 个文件")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"找不到源图：{SOURCE}")

    OUT.mkdir(exist_ok=True)

    # 旧版图标：整张源图压深色底 + 圆角，和桌面 exe 的观感一致。
    legacy = flattened(rounded(load_square(ADAPTIVE), 0.22), ADAPTIVE)

    # 自适应图标：背景纯色，前景缩进安全区。
    inner = int(ADAPTIVE * SAFE_RATIO)
    mark = load_square(inner)
    foreground = Image.new("RGBA", (ADAPTIVE, ADAPTIVE), (0, 0, 0, 0))
    offset = (ADAPTIVE - inner) // 2
    foreground.paste(mark, (offset, offset), mark)
    background = Image.new("RGB", (ADAPTIVE, ADAPTIVE), BG)

    # 启动屏：深底居中放图标。
    splash_icon = int(SPLASH * SPLASH_ICON_RATIO)
    splash = Image.new("RGB", (SPLASH, SPLASH), BG)
    splash.paste(flattened(rounded(load_square(splash_icon), 0.22), splash_icon),
                 ((SPLASH - splash_icon) // 2, (SPLASH - splash_icon) // 2))

    outputs = {
        "icon.png": legacy,
        "icon-foreground.png": foreground,
        "icon-background.png": background,
        "splash.png": splash,
        "splash-dark.png": splash,
    }
    for name, image in outputs.items():
        path = OUT / name
        image.save(path)
        print(f"  {name:24s} {image.width}x{image.height}  {path.stat().st_size:,} 字节")

    write_android_res(legacy, foreground)


if __name__ == "__main__":
    main()
