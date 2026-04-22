export async function initMediaUpload(serverBaseUrl, token, payload) {
  const res = await fetch(`${serverBaseUrl}/media/upload/init`, {
    method: 'POST',
    headers: buildHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {})
  })
  return res.json()
}

export async function uploadMediaChunk(serverBaseUrl, token, mediaId, chunkBuffer) {
  const res = await fetch(
    `${serverBaseUrl}/media/upload/chunk?mediaId=${encodeURIComponent(mediaId)}`,
    {
      method: 'POST',
      headers: buildHeaders(token, {
        'Content-Type': 'application/octet-stream'
      }),
      body: chunkBuffer
    }
  )
  return res.json()
}

export async function finishMediaUpload(serverBaseUrl, token, mediaId) {
  const res = await fetch(`${serverBaseUrl}/media/upload/finish`, {
    method: 'POST',
    headers: buildHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mediaId })
  })
  return res.json()
}

export function appendTokenToStreamUrl(url, token) {
  if (!token) return url
  const u = new URL(url)
  u.searchParams.set('token', token)
  return u.toString()
}

function buildHeaders(token, extra = {}) {
  const out = { ...extra }
  if (token) out['x-listen-token'] = token
  return out
}
