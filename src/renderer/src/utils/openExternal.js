/**
 * 在系统默认浏览器中打开外链（经主进程 shell.openExternal），避免 Electron 内嵌窗口的 UA/安全策略导致站点拦截。
 */
export function openExternalUrl(url) {
  if (!url || typeof url !== 'string') return
  let trimmed = url.trim()
  if (!trimmed) return
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
  } catch {
    return
  }
  if (typeof window !== 'undefined' && window.api?.openExternal) {
    void window.api.openExternal(trimmed)
    return
  }
  window.open(trimmed, '_blank', 'noopener,noreferrer')
}
