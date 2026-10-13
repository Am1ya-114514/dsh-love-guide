# 悬浮窗后端（Windows 专用）

读取**屏幕上已经显示的**聊天窗口内容、把建议回复填进目标输入框的工具。
它不注入进程、不解密数据库、不绕过任何平台权限——用的都是 Windows 公开的
窗口 API（`PrintWindow` + `SendInput`），和你自己用眼睛看、用手打字是一回事。

## 它做什么

- `win_io.py`    窗口枚举、DPI 感知截图、点击与按键注入（**绝不发 Enter**）
- `chat_reader.py` OCR 读数、按位置判断说话人、把多行合并成消息
- `service.py`   一行一个 JSON 的 stdio 服务，供 Electron 主进程调用

## 为什么用截图而不是读控件树

微信和 QQ 的聊天区都是自绘的（Chromium / GPU 画布），无障碍树里几乎是空的，
常规的 UI Automation 看不到消息文字。截图 + OCR 是唯一稳定可行的路子。

## 为什么不用 WGC

实测 `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` 对 NTQQ 能拿到真实内容
（1319x867，24ms，纯黑占比 0%），并且**窗口被完全遮住时依然能截到**，
所以不需要引入 Windows Graphics Capture。唯一的硬限制是窗口最小化时截不到，
这时悬浮窗会提示先还原窗口。

## 安装

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt --ignore-requires-python
```

`--ignore-requires-python` 是必须的：上游把 `rapidocr-onnxruntime` 的
`Requires-Python` 写成了 `<3.13`，而它实际在 3.13 上跑得很好。不想用这个参数，
就用 Python 3.12 建虚拟环境。

主程序会自动找这里的 `.venv`（见 `electron/sidecar.cjs` 的 `resolvePython`），
找不到才退回系统 `python`——那时会因为缺 rapidocr 报 ModuleNotFoundError。
