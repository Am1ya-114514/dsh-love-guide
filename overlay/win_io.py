"""
win_io —— 悬浮窗要用的 Windows 原生动作，集中在这里。

三条来之不易的规矩，改这个文件前先读一遍：

1. **DPI 感知必须在 import 任何东西之前设**。本机缩放 125%，不设的话
   GetWindowRect 返回逻辑坐标（1319x867）而真实物理是（1649x1084），
   SetCursorPos 用逻辑、ImageGrab/mouse_event 用物理，差 1.25 倍；
   PrintWindow 出来的位图也会被打七五折，OCR 白丢分辨率。

2. **发按键之前必须确认目标窗口真的持有焦点**。SetForegroundWindow 在
   "调用方不是当前前台进程"时会被 Windows 静默拒绝（返回 0），
   而按键会打到当时真正的焦点窗口上——这不是"粘不进去"，是"粘到别人家去了"。

3. **绝不发送 Enter**。产品形态是"填进输入框，用户自己按发送"。
"""

from __future__ import annotations

import ctypes
import time

# ── 规矩 1：先设 DPI 感知，再碰任何窗口 API
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_DPI_AWARE
except Exception:  # 老系统没有 shcore
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

import win32api  # noqa: E402
import win32clipboard  # noqa: E402
import win32con  # noqa: E402
import win32gui  # noqa: E402
import win32process  # noqa: E402
import win32ui  # noqa: E402
from PIL import Image  # noqa: E402

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

PW_RENDERFULLCONTENT = 0x00000002
KEYEVENTF_KEYUP = 0x0002
VK_CONTROL, VK_A, VK_V, VK_DELETE, VK_RETURN = 0x11, 0x41, 0x56, 0x2E, 0x0D


# ── 窗口枚举 ────────────────────────────────────────────────────────────

def _normal_rect(hwnd: int) -> tuple[int, int, int, int]:
    """窗口的「还原后」位置。

    最小化的窗口 GetWindowRect 给的是 (-25600,-25600,-25441,-25573) 这种占位值，
    尺寸也退化成一个 159x27 的空壳；要判断它"本来是多大"得问 WINDOWPLACEMENT。
    """
    try:
        # GetWindowPlacement 返回的是
        # (flags, showCmd, minPosition, maxPosition, normalPosition)
        # —— 还原后的位置是**第五个**，不是第四个。
        placement = win32gui.GetWindowPlacement(hwnd)
        return tuple(placement[4])  # type: ignore[return-value]
    except Exception:
        return win32gui.GetWindowRect(hwnd)


def list_windows(min_size: int = 120, include_minimized: bool = True
                 ) -> list[tuple[int, str, str, tuple[int, int, int, int]]]:
    """列出"像聊天窗口"的顶层窗口：可见、有标题、尺寸够大、没有 owner。

    最小化的窗口默认也列出来（用还原后的尺寸判断大小），但它们的 rect 是占位值，
    调用方**必须先 restore 再截图和点击**。
    """
    out: list[tuple[int, str, str, tuple[int, int, int, int]]] = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if not title.strip():
            return
        iconic = bool(win32gui.IsIconic(hwnd))
        if iconic and not include_minimized:
            return
        if win32gui.GetWindow(hwnd, win32con.GW_OWNER):
            return
        rect = _normal_rect(hwnd) if iconic else win32gui.GetWindowRect(hwnd)
        if rect[2] - rect[0] < min_size or rect[3] - rect[1] < min_size:
            return
        cls = win32gui.GetClassName(hwnd)
        out.append((hwnd, title, cls, rect))

    win32gui.EnumWindows(cb, None)
    return out



def find_windows(keyword: str) -> list[tuple[int, str, str, tuple[int, int, int, int]]]:
    kw = keyword.lower()
    return [w for w in list_windows() if kw in w[1].lower()]


def is_iconic(hwnd: int) -> bool:
    return bool(win32gui.IsIconic(hwnd))


def restore(hwnd: int) -> None:
    if is_iconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)


# ── 截图 ────────────────────────────────────────────────────────────────

def capture(hwnd: int, client_only: bool = False) -> Image.Image:
    """PrintWindow + PW_RENDERFULLCONTENT：目标被完全遮住也能截到真内容。

    实测 QQ（Chromium 壳）一帧 24.2 ms。
    限制：窗口最小化时截不到（只会拿到一个 159x27 的空壳），调用方要自己先 restore。
    """
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width, height = right - left, bottom - top
    if width <= 0 or height <= 0:
        raise RuntimeError(f"窗口尺寸不合法: {width}x{height}（是不是最小化了？先 restore）")

    hwnd_dc = win32gui.GetWindowDC(hwnd)
    if not hwnd_dc:
        raise RuntimeError("GetWindowDC 失败")
    src_dc = win32ui.CreateDCFromHandle(hwnd_dc)
    mem_dc = src_dc.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    bitmap.CreateCompatibleBitmap(src_dc, width, height)
    mem_dc.SelectObject(bitmap)
    try:
        if not user32.PrintWindow(hwnd, mem_dc.GetSafeHdc(), PW_RENDERFULLCONTENT):
            # 退回不带标志的老写法：个别老控件窗口只认这个
            user32.PrintWindow(hwnd, mem_dc.GetSafeHdc(), 0)
        info = bitmap.GetInfo()
        bits = bitmap.GetBitmapBits(True)
        img = Image.frombuffer(
            "RGB", (info["bmWidth"], info["bmHeight"]), bits, "raw", "BGRX", 0, 1
        )
        if client_only:
            cl = win32gui.GetClientRect(hwnd)
            origin = win32gui.ClientToScreen(hwnd, (0, 0))
            dx, dy = origin[0] - left, origin[1] - top
            img = img.crop((dx, dy, dx + cl[2], dy + cl[3]))
        return img.copy()
    finally:
        win32gui.DeleteObject(bitmap.GetHandle())
        mem_dc.DeleteDC()
        src_dc.DeleteDC()
        win32gui.ReleaseDC(hwnd, hwnd_dc)


# ── 剪贴板 ──────────────────────────────────────────────────────────────

def get_clipboard_text() -> str:
    for _ in range(6):
        try:
            win32clipboard.OpenClipboard()
            try:
                if win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
                    return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
                return ""
            finally:
                win32clipboard.CloseClipboard()
        except Exception:
            time.sleep(0.12)
    return ""


def set_clipboard_text(text: str) -> bool:
    for _ in range(6):
        try:
            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
                win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
            finally:
                win32clipboard.CloseClipboard()
            return True
        except Exception:
            time.sleep(0.12)
    return False


# ── 焦点 ────────────────────────────────────────────────────────────────

def foreground() -> int:
    return user32.GetForegroundWindow()


def force_foreground(hwnd: int) -> bool:
    """把窗口弄到前台，返回是否成功。

    SetForegroundWindow 有个"前台锁定"：调用方不是当前前台进程时会被拒。
    绕法是把自己和前台窗口的输入队列挂到同一个线程上（AttachThreadInput），
    这时候系统就认我们"有资格"设置前台窗口了。用完必须解开，否则两个窗口的
    键盘状态会串在一起。
    """
    if foreground() == hwnd:
        return True

    cur = kernel32.GetCurrentThreadId()
    fg = foreground()
    fg_thread = user32.GetWindowThreadProcessId(fg, None) if fg else 0
    target_thread = user32.GetWindowThreadProcessId(hwnd, None)

    attached: list[int] = []
    for thread in {fg_thread, target_thread}:
        if thread and thread != cur and user32.AttachThreadInput(cur, thread, True):
            attached.append(thread)

    try:
        if is_iconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
    finally:
        for thread in attached:
            user32.AttachThreadInput(cur, thread, False)

    time.sleep(0.35)
    return foreground() == hwnd


# ── 按键 ────────────────────────────────────────────────────────────────

def _key(vk: int, with_ctrl: bool = False) -> None:
    if with_ctrl:
        user32.keybd_event(VK_CONTROL, 0, 0, 0)
    user32.keybd_event(vk, 0, 0, 0)
    time.sleep(0.04)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    if with_ctrl:
        user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)


def click(x: int, y: int) -> None:
    user32.SetCursorPos(x, y)
    time.sleep(0.18)
    user32.mouse_event(0x0002, 0, 0, 0, 0)  # LEFTDOWN
    time.sleep(0.05)
    user32.mouse_event(0x0004, 0, 0, 0, 0)  # LEFTUP


class InjectionError(RuntimeError):
    """注入没有按预期发生——调用方必须把它当失败处理，不要静默重试。"""


def fill_input(hwnd: int, text: str, *, click_at: tuple[int, int] | None = None,
               settle: float = 0.55, restore_clipboard: bool = True) -> str:
    """把 text 填进 hwnd 的输入框并返回操作后的剪贴板内容（原本的内容）。

    「填进去」= 点一下输入框（可选）→ Ctrl+V。**不发 Enter。**

    任何一步不满足就抛 InjectionError 并保证剪贴板已还原——
    这个函数宁可不做事，也不能把字打到别的窗口上。
    """
    backup = get_clipboard_text()

    def bail(reason: str) -> None:
        if restore_clipboard:
            set_clipboard_text(backup)
        raise InjectionError(reason)

    if not text:
        bail("要填的文字是空的")

    if not set_clipboard_text(text):
        raise InjectionError("写剪贴板失败")

    if not force_foreground(hwnd):
        bail(f"目标窗口没能拿到焦点（前台仍是 hwnd={foreground()}），已放弃，什么都没有输入")

    # 双保险：force_foreground 返回后焦点仍可能被别的窗口抢走
    if foreground() != hwnd:
        bail(f"焦点在发按键前又被抢走了（现在是 hwnd={foreground()}），已放弃")

    if click_at is not None:
        click(*click_at)
        time.sleep(0.25)
        if foreground() != hwnd:
            bail("点击之后焦点不在目标窗口上，已放弃")

    _key(VK_V, with_ctrl=True)
    time.sleep(settle)

    if not restore_clipboard:
        return backup
    set_clipboard_text(backup)
    return backup


def clear_input(hwnd: int, click_at: tuple[int, int] | None = None) -> None:
    """清空输入框：点进去 → Ctrl+A → Delete。**不发 Enter。**"""
    if not force_foreground(hwnd):
        raise InjectionError(f"目标窗口没能拿到焦点（前台 hwnd={foreground()}）")
    if click_at is not None:
        click(*click_at)
        time.sleep(0.25)
    if foreground() != hwnd:
        raise InjectionError("点击之后焦点不在目标窗口上，已放弃清空")
    _key(VK_A, with_ctrl=True)
    time.sleep(0.2)
    _key(VK_DELETE)
    time.sleep(0.4)
