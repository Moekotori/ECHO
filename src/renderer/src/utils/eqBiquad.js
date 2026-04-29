/** 与 UI / Web Audio 双二阶搁架与峰值 Q 范围对齐 */
export function clampBiquadQ(type, q) {
  const t = type || 'peaking'
  const n = typeof q === 'number' && !Number.isNaN(q) ? q : 1
  if (t === 'lowshelf' || t === 'highshelf') {
    return Math.max(0.1, Math.min(2, n))
  }
  return Math.max(0.1, Math.min(10, n))
}
