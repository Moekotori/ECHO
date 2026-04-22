import { existsSync } from 'fs'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Packaged Electron apps store deps in app.asar; Windows cannot execute .exe from inside asar.
 * List `ffmpeg-static` in build.asarUnpack and use this to point at app.asar.unpacked.
 */
export function getResolvedFfmpegStaticPath() {
  const imported = ffmpegStatic
  if (typeof imported !== 'string' || !imported) return imported
  if (imported.includes('app.asar') && !imported.includes('app.asar.unpacked')) {
    const unpacked = imported.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1')
    if (existsSync(unpacked)) return unpacked
  }
  return imported
}
