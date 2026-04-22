export function verifyToken(req) {
  const expected = (process.env.LISTEN_TOGETHER_TOKEN || '').trim()
  if (!expected) return { ok: true }
  const got =
    (req.headers['x-listen-token'] || '').toString().trim() ||
    (req.query?.token || '').toString().trim()
  if (got && got === expected) return { ok: true }
  return { ok: false, error: 'unauthorized' }
}
