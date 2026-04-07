/**
 * Build IPC payload for the transparent desktop lyrics window.
 */
export function buildDesktopLyricsPayload(cfg, d, noneText) {
  const lines = Array.isArray(d.lyrics) ? d.lyrics : []
  const idx = typeof d.activeLyricIndex === 'number' ? d.activeLyricIndex : -1
  const romajiLines = Array.isArray(d.romajiDisplayLines) ? d.romajiDisplayLines : []
  const kList = Array.isArray(d.lyricKaraokeProgressList) ? d.lyricKaraokeProgressList : []
  const timelineOk = !!d.lyricTimelineValid

  let prev = ''
  let current = ''
  let next = ''
  let prevRomaji = ''
  let currentRomaji = ''
  let nextRomaji = ''

  if (idx >= 0 && idx < lines.length) {
    const line = lines[idx]
    current = (line?.text || '').trim()
    currentRomaji = `${line?.romaji || romajiLines[idx] || ''}`.trim()
    if (idx > 0) {
      prev = (lines[idx - 1]?.text || '').trim()
      prevRomaji = `${lines[idx - 1]?.romaji || romajiLines[idx - 1] || ''}`.trim()
    }
    if (idx < lines.length - 1) {
      next = (lines[idx + 1]?.text || '').trim()
      nextRomaji = `${lines[idx + 1]?.romaji || romajiLines[idx + 1] || ''}`.trim()
    }
  } else if (lines.length > 0) {
    current = (lines[0]?.text || '').trim() || noneText
  }

  const showPrev = cfg.desktopLyricsShowPrev !== false
  const showNext = cfg.desktopLyricsShowNext !== false
  const showRomaji = cfg.desktopLyricsShowRomaji === true

  const wordHl =
    cfg.desktopLyricsWordHighlight !== false && timelineOk

  const karaokeProgress =
    idx >= 0 && idx < kList.length && Number.isFinite(kList[idx]) ? kList[idx] : 0

  const colors = {
    text: cfg.desktopLyricsColorText || '#fff8f5',
    secondary: cfg.desktopLyricsColorSecondary || '#ffc8b8',
    karaoke: cfg.desktopLyricsColorKaraoke || '#ffffff',
    glow: cfg.desktopLyricsColorGlow || '#ff8866',
    romaji: cfg.desktopLyricsColorRomaji || '#e8d0c8'
  }

  return {
    prev: showPrev ? prev : '',
    next: showNext ? next : '',
    current: current || noneText,
    prevRomaji: showPrev && showRomaji ? prevRomaji : '',
    nextRomaji: showNext && showRomaji ? nextRomaji : '',
    currentRomaji: showRomaji ? currentRomaji : '',
    showPrev,
    showNext,
    showRomaji,
    wordHighlight: wordHl,
    lyricTimelineValid: timelineOk,
    karaokeProgress,
    title: d.displayMainTitle || '',
    fontPx: typeof cfg.desktopLyricsFontPx === 'number' ? cfg.desktopLyricsFontPx : 26,
    colors
  }
}
