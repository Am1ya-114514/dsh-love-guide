"""
悬浮窗的后端进程：一行一个 JSON 地收发，给 Electron 主进程调用。

为什么是独立进程而不是塞进 Node：
- 截图、OCR、模拟按键这三件事在 Windows 上只有 Python 生态成熟（pywin32 +
  RapidOCR + ctypes 的 SendInput/剪贴板）。Node 侧要么写原生插件，要么再拉
  一个 runtime。
- 它同时是「崩溃隔离」：OCR 模型或 pywin32 出问题只会死这个进程，主窗口还活着。

协议（stdin 一行一个请求，stdout 一行一个响应或事件）：
    请求  {"id": 1, "cmd": "list_windows"}
    响应  {"id": 1, "ok": true, "windows": [...]}
    事件  {"event": "changed", "hwnd": 123, "messages": [...]}

命令：ping / list_windows / read / inject / watch_start / watch_stop / quit

**轮询策略**：截图只要 25ms，OCR 却要 2.7 秒（11 行中文），所以监听循环
只截图 + 缩略图哈希比对，哈希变了才跑一次 OCR。这样既接近实时，又不会
一直烧 CPU —— 空闲时每 2 秒只花 30ms。

**绝不发 Enter**：注入只做「聚焦 → 点输入框 → Ctrl+V」，发送键永远由人按。
这个进程里不存在任何"提交"的代码路径，是故意的。
"""

from __future__ import annotations

import hashlib
import json
import sys
import threading
import time
from io import BytesIO

import win_io
import chat_reader

# 只认「最近几条消息」那一块：越靠下越新，上半屏的旧消息对判断当下没用，
# 少认几行就少等一两秒。
CROP_RECENT = (0.27, 0.42, 1.0, 0.88)
# 哈希用的缩略图尺寸，够灵敏又不至于被一个像素的抖动触发
HASH_SIZE = (64, 64)

_watch: dict = {"hwnd": None, "interval": 2.0, "stop": None, "last": None}


def out(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def digest(img) -> str:
    small = img.resize(HASH_SIZE)
    return hashlib.sha1(small.tobytes()).hexdigest()


def cmd_ping(_req: dict) -> dict:
    return {"pong": True, "pid": __import__("os").getpid()}


def cmd_list_windows(_req: dict) -> dict:
    wins = []
    for hwnd, title, cls, rect in win_io.list_windows():
        wins.append(
            {
                "hwnd": hwnd,
                "title": title,
                "class": cls,
                "rect": list(rect),
                "iconic": win_io.is_iconic(hwnd),
                "width": rect[2] - rect[0],
                "height": rect[3] - rect[1],
            }
        )
    return {"windows": wins}


def cmd_read(req: dict) -> dict:
    hwnd = req.get("hwnd")
    if not hwnd:
        hits = win_io.find_windows(req.get("keyword", "QQ"))
        if not hits:
            return {"ok": False, "error": "找不到窗口"}
        hwnd = hits[0][0]
    crop = tuple(req.get("crop") or CROP_RECENT)
    return chat_reader.read_window(
        hwnd,
        max_messages=int(req.get("max", 12)),
        crop=crop,
        scale=float(req.get("scale", 0.7)),
    )


def cmd_inject(req: dict) -> dict:
    hwnd = req.get("hwnd")
    text = req.get("text") or ""
    if not hwnd or not text:
        return {"ok": False, "error": "缺少 hwnd 或 text"}
    try:
        win_io.fill_input(hwnd, text, click_at=req.get("click_at"))
    except win_io.InjectionError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "filled": len(text), "sent": False}


def watch_loop(hwnd: int, interval: float, stop: threading.Event) -> None:
    crop = CROP_RECENT
    while not stop.is_set():
        try:
            if win_io.is_iconic(hwnd):
                # 最小化的窗口截不到内容（窗口矩形只剩 159x27），
                # 但也没必要每 2 秒去还原它一次——那会抢用户的焦点。
                out({"event": "minimized", "hwnd": hwnd})
                stop.wait(interval)
                continue
            full = win_io.capture(hwnd)
            img = full.crop(chat_reader.crop_box(full.size, crop))
            d = digest(img)
            if d != _watch["last"]:
                _watch["last"] = d
                data = chat_reader.read_window(hwnd, max_messages=12, crop=crop, scale=0.7)
                out({"event": "changed", "hwnd": hwnd, **data})
        except Exception as exc:  # 单次失败不能让监听过期
            out({"event": "error", "hwnd": hwnd, "message": f"{type(exc).__name__}: {exc}"})
        stop.wait(interval)


def cmd_watch_start(req: dict) -> dict:
    cmd_watch_stop({})
    hwnd = req.get("hwnd")
    if not hwnd:
        return {"ok": False, "error": "缺少 hwnd"}
    stop = threading.Event()
    _watch.update(hwnd=hwnd, interval=float(req.get("interval", 2.0)), stop=stop, last=None)
    t = threading.Thread(target=watch_loop, args=(hwnd, _watch["interval"], stop), daemon=True)
    t.start()
    return {"ok": True, "watching": hwnd, "interval": _watch["interval"]}


def cmd_watch_stop(_req: dict) -> dict:
    if _watch["stop"] is not None:
        _watch["stop"].set()
        _watch.update(stop=None, last=None)
    return {"ok": True}


HANDLERS = {
    "ping": cmd_ping,
    "list_windows": cmd_list_windows,
    "read": cmd_read,
    "inject": cmd_inject,
    "watch_start": cmd_watch_start,
    "watch_stop": cmd_watch_stop,
}


def main() -> int:
    out({"event": "ready", "pid": __import__("os").getpid()})
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except json.JSONDecodeError as exc:
            out({"id": None, "ok": False, "error": f"JSON 解析失败: {exc}"})
            continue

        cmd = req.get("cmd")
        if cmd == "quit":
            cmd_watch_stop({})
            out({"id": req.get("id"), "ok": True})
            return 0
        fn = HANDLERS.get(cmd)
        if fn is None:
            out({"id": req.get("id"), "ok": False, "error": f"未知命令 {cmd!r}"})
            continue
        try:
            t0 = time.perf_counter()
            payload = fn(req)
            payload.setdefault("ok", True)
            payload["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        except Exception as exc:
            payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        payload["id"] = req.get("id")
        out(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
