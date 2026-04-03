import html2canvas from 'html2canvas'

function ensureElement(target) {
  if (!target || !(target instanceof HTMLElement)) {
    throw new Error('capture_target_missing')
  }
}

function normalizeFileName(name) {
  const raw = typeof name === 'string' && name.trim() ? name.trim() : 'song-card'
  return raw.replace(/[\\/:*?"<>|]+/g, '_')
}

export async function captureSongCardImage(target, options = {}) {
  ensureElement(target)
  const canvas = await html2canvas(target, {
    backgroundColor: options.backgroundColor || '#12161f',
    useCORS: true,
    scale: Math.max(2, Math.min(window.devicePixelRatio || 2.5, 4)),
    logging: false
  })
  return canvas.toDataURL('image/png')
}

export async function copySongCardImage(target, windowApi, options = {}) {
  const dataUrl = await captureSongCardImage(target, options)
  if (!windowApi?.writeClipboardImage) throw new Error('clipboard_unavailable')
  const res = await windowApi.writeClipboardImage(dataUrl)
  if (res && res.ok === false) throw new Error(res.error || 'clipboard_write_failed')
  return dataUrl
}

export async function saveSongCardImage(target, windowApi, defaultName, options = {}) {
  const dataUrl = await captureSongCardImage(target, options)
  const fileName = `${normalizeFileName(defaultName)}.png`
  if (!windowApi?.saveImageHandler) throw new Error('save_image_unavailable')
  const res = await windowApi.saveImageHandler(dataUrl, fileName)
  if (res && res.success === false && res.error) throw new Error(res.error)
  return res
}
