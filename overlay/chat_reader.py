"""
从窗口截图里读出聊天内容。

链路：`win_io.capture` 拿窗口画面 → 裁掉会话列表和输入区 → RapidOCR 认字
→ 按位置判左右、按纵向间距并成一条条消息。全程只看像素，不碰 QQ/微信的
任何内部数据（微信 8.0.52 起对普通无障碍服务隐藏消息文字，截图是唯一还行
的路，这也是 jev-chat 在 v1.4 放弃微信的原因）。

**这不是高保真的聊天记录解析器**。它只需要给出「最近几轮谁说了什么」这个
级别的信息——够模型判断意图、够生成建议回复就行。所以：认错字可以接受，
判错左右不行（那会把「对方说的」当成「我说的」，建议就全反了），因此左右
判定用了保守阈值，两边都不像时标 `unknown` 让模型自己去问。

**速度**：一次全窗口识别约 7 秒，瓶颈是逐行文本识别（61 行 × ~100ms）。
裁掉左侧会话列表和底部输入区后行数降到十几行，约 2 秒，够做「按一下刷新」
和「每几秒扫一次」。裁剪比例按窗口尺寸算，窗口缩放不用改配置。

用法：
    python chat_reader.py QQ            # 人类可读
    python chat_reader.py QQ --json     # 给程序用
    python chat_reader.py QQ --debug    # 把每一行 OCR 结果和裁剪框打出来
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, asdict

import numpy as np
from PIL import Image

import win_io

# (left, top, right, bottom) 占窗口宽高的比例。默认值是按 NTQQ 量的：
# 左侧会话列表约占 27%，标题栏 8%，底部输入区 12%。
CROP_DEFAULTS = (0.27, 0.08, 1.0, 0.88)

_ENGINE = None


def engine():
    global _ENGINE
    if _ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR

        # use_cls=False 关掉方向分类器：聊天截图不会有倒着的字，
        # 每行省一次前向，几十行省下来很可观。
        _ENGINE = RapidOCR(use_cls=False)
    return _ENGINE


@dataclass
class Line:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    score: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class Message:
    speaker: str  # 'self' | 'other' | 'unknown'
    text: str
    y0: float
    y1: float
    x0: float
    score: float


NOISE = re.compile(
    r"^(?:\d{1,2}:\d{2}|昨天|星期[一二三四五六日天]|"
    r"\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?|"
    r"\d+(?:\.\d+)?\s*(?:KB|MB|GB|B)|"
    r"\+?\d+条新消息|已读|未读|99\+|@全体成员|发送)$",
    re.IGNORECASE,
)

# 图片/文件气泡下面那行小字，例如「IMG_20261013_151039.png 354.06KB已下载」。
# 它长得像聊天内容，但其实是文件状态。不滤掉的话模型会把它当成"对方发来的话"
# 去解读，而且会挤占本来就有限的上下文。OCR 常把「354」认成「854」、把空格吃掉，
# 所以这里不逐字匹配，只要求同时出现「像文件名」和「像文件状态」两个特征。
FILE_CAPTION = re.compile(
    # 行首得像一个文件名（含「.扩展名」），后面任意位置出现文件状态词。
    # 扩展名用白名单 + 允许末位被吃掉：OCR 经常把 .png 认成 .pn、.jpeg 认成 .jpe，
    # 死抠完整扩展名会漏掉一整类噪声。白名单同时挡住「正常句子里有个句点」的误伤。
    r"^[^\s]{1,80}\.(?:png?|jpe?g?|gif|webp|bmp|mp4|mov|avi|zip|rar|7z|pdf|"
    r"docx?|xlsx?|pptx?|txt|csv|mp3|wav|apk|exe)\b"
    r".*(?:KB|MB|GB|已下载|下载完成|已过期|已失效|已取消)",
    re.IGNORECASE | re.DOTALL,
)


def is_noise(text: str) -> bool:
    return bool(NOISE.match(text)) or bool(FILE_CAPTION.match(text))


def crop_box(size: tuple[int, int], crop: tuple[float, ...]) -> tuple[int, int, int, int]:
    w, h = size
    l, t, r, b = crop
    return (int(w * l), int(h * t), int(w * r), int(h * b))


def read_lines(img) -> list[Line]:
    """OCR 一张图，坐标是相对这张图的。"""
    result, _ = engine()(np.array(img))
    out: list[Line] = []
    for box, text, score in result or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        text = (text or "").strip()
        if not text:
            continue
        out.append(Line(text, min(xs), min(ys), max(xs), max(ys), float(score)))
    out.sort(key=lambda l: (l.cy, l.x0))
    return out


def build_messages(lines: list[Line], width: int) -> list[Message]:
    body = [l for l in lines if l.score >= 0.5 and not is_noise(l.text)]
    if not body:
        return []

    avg_h = sum(l.y1 - l.y0 for l in body) / len(body)
    merge_gap = avg_h * 1.35

    groups: list[list[Line]] = [[body[0]]]
    for prev, cur in zip(body, body[1:]):
        same_side = abs(cur.x0 - prev.x0) < width * 0.04
        near = (cur.y0 - prev.y1) < merge_gap
        if same_side and near:
            groups[-1].append(cur)
        else:
            groups.append([cur])

    msgs: list[Message] = []
    for g in groups:
        x0 = min(l.x0 for l in g)
        x1 = max(l.x1 for l in g)
        right_gap = width - x1
        text = " ".join(l.text for l in g)
        # 合并之后要再审一次。OCR 会把「文件名」和「体积+已下载」切成两行，
        # 单看每一行都不像文件状态，合起来才是——只按行过滤漏得掉这一整类。
        if is_noise(text):
            continue
        # 自己的消息在 QQ 里整块靠右；对方靠左。两个条件都不满足就标 unknown。
        if right_gap < width * 0.12 and x0 > width * 0.35:
            speaker = "self"
        elif x0 < width * 0.55 and x1 < width * 0.92:
            speaker = "other"
        else:
            speaker = "unknown"
        msgs.append(
            Message(
                speaker,
                text,
                min(l.y0 for l in g),
                max(l.y1 for l in g),
                x0,
                min(l.score for l in g),
            )
        )
    return msgs


def read_window(
    hwnd: int,
    max_messages: int = 12,
    crop: tuple[float, ...] = CROP_DEFAULTS,
    debug: bool = False,
    scale: float = 1.0,
) -> dict:
    if win_io.is_iconic(hwnd):
        win_io.restore(hwnd)
        time.sleep(1.0)

    engine()  # 先把模型加载/Session 建好，别算进识别耗时里
    t0 = time.perf_counter()
    full = win_io.capture(hwnd)
    box = crop_box(full.size, crop)
    img = full.crop(box)
    if scale != 1.0:
        # 识别耗时几乎全在文本框检测那一遍前向，跟图面积成正比；
        # 缩一半面积就少四分之三。缩过头会把汉字糊掉，0.6 是实测的平衡点。
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.LANCZOS,
        )
    t1 = time.perf_counter()
    lines = read_lines(img)
    t2 = time.perf_counter()
    msgs = build_messages(lines, img.width)
    tail = msgs[-max_messages:] if max_messages > 0 else msgs

    data = {
        "ok": True,
        "window": {"hwnd": hwnd, "width": full.width, "height": full.height},
        "crop_box": box,
        "scale": scale,
        "timing": {
            "capture_ms": round((t1 - t0) * 1000, 1),
            "ocr_ms": round((t2 - t1) * 1000, 1),
        },
        "line_count": len(lines),
        "messages": [asdict(m) for m in tail],
    }
    if debug:
        data["lines"] = [asdict(l) for l in lines]
    return data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("keyword", nargs="?", default="QQ")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--max", type=int, default=12)
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--scale", type=float, default=1.0, help="识别前缩放；0.6 提速明显")
    ap.add_argument(
        "--crop",
        default=",".join(str(v) for v in CROP_DEFAULTS),
        help="left,top,right,bottom 占比",
    )
    args = ap.parse_args()

    crop = tuple(float(v) for v in args.crop.split(","))
    hits = win_io.find_windows(args.keyword)
    if not hits:
        print(f"找不到标题含「{args.keyword}」的窗口")
        return 1
    hwnd = hits[0][0]
    data = read_window(hwnd, args.max, crop, args.debug, args.scale)

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    t = data["timing"]
    print(
        f"窗口 {data['window']['width']}x{data['window']['height']}  "
        f"裁剪 {data['crop_box']} 缩放 {data['scale']}  截图 {t['capture_ms']} ms  "
        f"识别 {t['ocr_ms']} ms  共 {data['line_count']} 行 "
        f"→ {len(data['messages'])} 条消息\n"
    )
    if args.debug:
        for l in data.get("lines", []):
            print(f"  {l['y0']:6.0f} {l['x0']:6.0f} {l['x1']:6.0f} {l['score']:.2f}  {l['text']}")
        print()

    label = {"self": "我  ", "other": "对方", "unknown": "??? "}
    for m in data["messages"]:
        print(f"[{label[m['speaker']]}] {m['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
