"""
从窗口截图里读出聊天内容。

链路：`win_io.capture` 拿窗口画面 → 定位消息区 → RapidOCR 认字 → 按位置并成
一条条消息、按气泡底色判左右。全程只看像素，不碰 QQ/微信的任何内部数据
（微信 8.0.52 起对普通无障碍服务隐藏消息文字，截图是唯一还行的路，这也是
jev-chat 在 v1.4 放弃微信的原因）。

**这不是高保真的聊天记录解析器**。它只需要给出「最近几轮谁说了什么」这个
级别的信息——够模型判断意图、够生成建议回复就行。所以：认错字可以接受，
判错左右不行（那会把「对方说的」当成「我说的」，建议就全反了），因此左右
判定用了保守阈值，两边都不像时标 `unknown` 让模型自己去问。

**消息区不写死坐标**：`find_chat_area()` 靠像素锚点算出来（面板底色 → 面板
左右边界 → 分隔线 → 输入框顶）。这一段移植自 jev-chat-windows 的
`app/capture.py:80 chat_area()`（MIT，Copyright (c) 2026 rezoch340 and the
jev-chat contributors），因为它比按比例裁剪稳得多：窗口一改大小、换主题、
输入框被拉高，比例就对不上了。算不出来时退回 `CROP_DEFAULTS` 的比例裁剪。

**速度**：RapidOCR 的 `det_limit_type` 默认是 `'min'`，会把小图**放大**到短边
736 再检测——所以裁小反而更慢。必须显式设成 `'max'`，裁剪才真的省时间。
这一条也是从 jev 的实测里来的（它写在 `app/ocr.py:19` 的注释里）。

用法：
    python chat_reader.py QQ            # 人类可读
    python chat_reader.py QQ --json     # 给程序用
    python chat_reader.py QQ --debug    # 把每一行 OCR 结果和消息区打出来
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
from dataclasses import dataclass, asdict

import numpy as np
from PIL import Image

import win_io

# (left, top, right, bottom) 占窗口宽高的比例。只在 `find_chat_area()` 认不出
# 消息区时兜底。默认值是按 NTQQ 量的：左侧会话列表约占 27%，标题栏 8%，
# 底部输入区 12%。
CROP_DEFAULTS = (0.27, 0.08, 1.0, 0.88)

# 判定「是不是面板底色」的容差。WGC / PrintWindow 给的都是精确像素，不需要放宽。
BG_TOLERANCE = 6

_ENGINE = None


def engine():
    global _ENGINE
    if _ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR

        # use_cls=False 关掉方向分类器：聊天截图不会有倒着的字，每行省一次前向。
        # det_limit_type='max' 是关键——默认 'min' 会把小图放大到短边 736 再检测，
        # 于是"裁小一点"反而更慢；改成 'max' 并给足 4000，裁剪才真的省时间。
        _ENGINE = RapidOCR(
            intra_op_num_threads=4,
            use_cls=False,
            det_limit_type="max",
            det_limit_side_len=4000,
        )
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
    r"^[^\s]{1,80}\.(?:png?|jpe?g?|gif|webp|bmp|mp4|mov|avi|zip|rar|7z|pdf|"
    r"docx?|xlsx?|pptx?|txt|csv|mp3|wav|apk|exe)\b"
    r".*(?:KB|MB|GB|已下载|下载完成|已过期|已失效|已取消)",
    re.IGNORECASE | re.DOTALL,
)


def is_noise(text: str) -> bool:
    return bool(NOISE.match(text)) or bool(FILE_CAPTION.match(text))


def similar(a: str, b: str) -> bool:
    """同一段像素挪个位置，OCR 会抖（「不好意思」↔「不好竟思」），按相似度判同一条。

    移植自 jev-chat-windows `app/ocr.py:79 similar()`。
    """
    if a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.75:
        return True
    return len(a) == len(b) >= 3 and sum(x != y for x, y in zip(a, b)) <= 1


def find_chat_area(full: Image.Image, header_h: int = 60) -> tuple | None:
    """算出消息列表区，返回 `(x0, y_top, x1, y_in, 面板底色, y_pane)`，认不出返回 None。

    移植自 jev-chat-windows `app/capture.py:80 chat_area()`（MIT）。全靠像素锚点，
    不写死坐标、深浅主题通用：

    - 面板底色 = 右半边最常见的颜色（抽样算，全量 np.unique 在大图上要半秒）
    - 面板左右边界 = 第一/最后一根「底色占比 > 30%」的列（联系人列表是另一种底色，占比 0）
    - y_pane = 面板第一行；会话名印在 y_pane~y_top 这段头部里
    - 横向分隔线 = 整行单色且非底色；输入框顶 y_in = 面板 45% 高度以下第一根
    - 公告条下面那根（有的话）= 消息区顶 y_top，没有就用 header_h

    `header_h` 是按 100% DPI 给的，缩放要按比例调。
    """
    arr = np.asarray(full.convert("RGB"))
    H, W = arr.shape[:2]
    if H < 80 or W < 200:
        return None

    right = arr[::8, W // 2 :: 8].reshape(-1, 3)
    vals, cnt = np.unique(right, axis=0, return_counts=True)
    bg = vals[cnt.argmax()]

    isbg = np.abs(arr.astype(int) - bg).sum(-1) <= BG_TOLERANCE
    col = isbg[H // 4 : H * 3 // 4].mean(0)
    if not (col > 0.3).any():
        return None
    x0 = int(np.argmax(col > 0.3))
    x1 = W - int(np.argmax(col[::-1] > 0.3))
    if x1 - x0 < 100:
        return None

    row = isbg[:, x0:x1].mean(1)
    if not (row > 0.9).any():
        return None
    y_pane = int(np.argmax(row > 0.9))
    y_bottom = H - int(np.argmax(row[::-1] > 0.9))
    if y_bottom - y_pane < 80:
        return None

    band = arr[y_pane:y_bottom, x0:x1].astype(int)
    flat = (band.std(axis=(1, 2)) < 4) & (row[y_pane:y_bottom] < 0.1)
    seps = [int(s) for s in (y_pane + np.where(flat)[0])]
    # 相邻的分隔线只留一根（抗锯齿会让一条线占好几行）
    seps = [s for i, s in enumerate(seps) if i == 0 or s - seps[i - 1] > 3]

    below = [s for s in seps if s > y_pane + 0.45 * (y_bottom - y_pane)]
    y_in = below[0] if below else y_bottom
    above = [s for s in seps if y_pane + header_h < s < y_in - 50]
    y_top = above[-1] if above else y_pane + header_h

    if y_in - y_top < 40:
        return None
    # 只靠「最大一块浅色」会把整扇窗都框进去——左侧会话列表同样是浅色的。
    # 真正的聊天区一定在右边：左边界落在 16%~42%，右边界贴到窗口右侧。
    # 不合这两个比例就当作没认出来，交给调用方退回固定的比例裁剪。
    if not (0.16 <= x0 / W <= 0.42) or x1 / W < 0.85:
        return None
    return x0, y_top, x1, y_in, tuple(int(v) for v in bg), y_pane


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


def flat_bg(region: np.ndarray) -> tuple | None:
    """一块区域的众数颜色；不平（照片、表情包）就返回 None。

    判据来自 jev 的实测：气泡/面板里众数颜色占 0.56~0.82，头像和图片里只有
    0.1~0.3。所以 0.45 是个干净的界。
    """
    if region.size == 0:
        return None
    vals, cnt = np.unique(region.reshape(-1, 3), axis=0, return_counts=True)
    share = cnt.max() / (region.shape[0] * region.shape[1])
    if share < 0.45:
        return None
    return tuple(int(v) for v in vals[cnt.argmax()])


def build_messages(lines: list[Line], image: Image.Image) -> list[Message]:
    """把 OCR 行并成消息，并判断每条的说话人。

    说话人判定分两遍，第二遍是自校准的：
    第一遍只用几何（自己的气泡整块靠右、对方的靠左）。拿不准的标 None。
    第二遍回头看：几何高置信度判出来的那些消息，各自的气泡底色是什么；
    拿不准的那条如果底色和「自己的」那批一致，就是自己发的，反之亦然。
    这样不用硬编码 QQ 的气泡颜色——换个主题、换个版本、换成别的聊天软件
    都能自己认出来。
    """
    arr = np.asarray(image.convert("RGB"))
    width = image.width

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

    staged: list[dict] = []
    for g in groups:
        x0 = min(l.x0 for l in g)
        x1 = max(l.x1 for l in g)
        y0 = min(l.y0 for l in g)
        y1 = max(l.y1 for l in g)
        text = " ".join(l.text for l in g)
        # 合并之后要再审一次。OCR 会把「文件名」和「体积+已下载」切成两行，
        # 单看每一行都不像文件状态，合起来才是——只按行过滤漏得掉这一整类。
        if is_noise(text):
            continue

        guard = 3
        region = arr[
            max(0, int(y0) + guard) : min(arr.shape[0], int(y1) - guard),
            max(0, int(x0) - guard) : min(arr.shape[1], int(x1) + guard),
        ]
        bg = flat_bg(region)

        # 第一遍：只看几何。自己的气泡整块靠右，且左边离得很远。
        right_gap = width - x1
        if right_gap < width * 0.12 and x0 > width * 0.35:
            guess = "self"
        elif x0 < width * 0.55 and x1 < width * 0.92:
            guess = "other"
        else:
            guess = None

        staged.append(
            {
                "text": text,
                "x0": x0,
                "y0": y0,
                "y1": y1,
                "score": min(l.score for l in g),
                "bg": bg,
                "guess": guess,
            }
        )

    # 第二遍：用几何认下来的底色去补那些几何认不出的。
    tally: dict[tuple, dict[str, int]] = {}
    for m in staged:
        if m["guess"] and m["bg"]:
            tally.setdefault(m["bg"], {"self": 0, "other": 0})[m["guess"]] += 1

    msgs: list[Message] = []
    for m in staged:
        speaker = m["guess"]
        if speaker is None:
            votes = tally.get(m["bg"]) if m["bg"] else None
            if votes:
                if votes["self"] > votes["other"]:
                    speaker = "self"
                elif votes["other"] > votes["self"]:
                    speaker = "other"
        msgs.append(
            Message(
                speaker or "unknown",
                m["text"],
                m["y0"],
                m["y1"],
                m["x0"],
                m["score"],
            )
        )
    return msgs


def read_window(
    hwnd: int,
    max_messages: int = 12,
    crop: tuple[float, ...] = CROP_DEFAULTS,
    debug: bool = False,
    scale: float = 1.0,
    auto_area: bool = True,
) -> dict:
    if win_io.is_iconic(hwnd):
        win_io.restore(hwnd)
        time.sleep(1.0)

    engine()  # 先把模型加载/Session 建好，别算进识别耗时里
    t0 = time.perf_counter()
    full = win_io.capture(hwnd)
    full = full.convert("RGB")

    area = find_chat_area(full) if auto_area else None
    if area:
        x0, y_top, x1, y_in, _bg, _pane = area
        box = (x0, y_top, x1, y_in)
        source = "auto"
    else:
        box = crop_box(full.size, crop)
        source = "ratio"

    img = full.crop(box)
    if scale != 1.0:
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.LANCZOS,
        )
    t1 = time.perf_counter()
    lines = read_lines(img)
    t2 = time.perf_counter()
    msgs = build_messages(lines, img)
    tail = msgs[-max_messages:] if max_messages > 0 else msgs

    data = {
        "ok": True,
        "window": {"hwnd": hwnd, "width": full.width, "height": full.height},
        "crop_box": box,
        "crop_source": source,
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
    ap.add_argument("--scale", type=float, default=1.0, help="识别前缩放")
    ap.add_argument("--no-auto", action="store_true", help="不用像素锚点定位，按比例裁")
    ap.add_argument(
        "--crop",
        default=",".join(str(v) for v in CROP_DEFAULTS),
        help="left,top,right,bottom 占比（仅在自动定位失败时用）",
    )
    args = ap.parse_args()

    crop = tuple(float(v) for v in args.crop.split(","))
    hits = win_io.find_windows(args.keyword)
    if not hits:
        print(f"找不到标题含「{args.keyword}」的窗口")
        return 1
    hwnd = hits[0][0]
    data = read_window(hwnd, args.max, crop, args.debug, args.scale, not args.no_auto)

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    t = data["timing"]
    print(
        f"窗口 {data['window']['width']}x{data['window']['height']}  "
        f"消息区 {data['crop_box']}（{data['crop_source']}）  截图 {t['capture_ms']} ms  "
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
