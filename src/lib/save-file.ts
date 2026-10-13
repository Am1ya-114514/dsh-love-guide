/**
 * 把一份文本交给用户「保存下来」，桌面网页与 Android 走的是两条完全不同的路。
 *
 * 桌面网页：Blob + `<a download>`，浏览器自己的下载条。
 * Android：**这条路走不通**。WebView 不实现 `<a download>`，点了没有任何反应，
 *   而且 Blob URL 也只活在当前进程里，用户拿不到文件。所以原生端改成
 *   「写进缓存目录 → 唤起系统分享面板」，由用户自己选保存到「文件」还是发到微信。
 *
 * 两个 Capacitor 插件用动态 `import()` 引入，是为了让网页版与桌面版**根本不下载**
 * 这两个包的代码——它们只在 `Capacitor.isNativePlatform()` 为真时才会被请求。
 */

export type SaveOutcome = 'downloaded' | 'shared'

/** 东八区的当天日期。不用 `toISOString()`——那是 UTC，晚上八点后导出的日期会差一天。 */
export function todayStamp(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

/** 文件名里不能出现的字符。Windows 与 Android 都不接受它们。 */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-')
}

export async function saveTextFile(name: string, text: string): Promise<SaveOutcome> {
  const filename = safeName(name)
  const { Capacitor } = await import('@capacitor/core')

  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const written = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    await Share.share({
      title: filename,
      url: written.uri,
      dialogTitle: '保存或分享这份导出文件',
    })
    return 'shared'
  }

  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // 立刻 revoke 在部分浏览器上会打断下载，等一拍再放。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
