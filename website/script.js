// Fetch GitHub releases and render a small changelog feed.

const owner = 'Moekotori'
const repo = 'Echoes'
const releasesEl = document.getElementById('releases')

function renderMessage(title, detail = '') {
  if (!releasesEl) return
  releasesEl.innerHTML = `<div class="release"><h5>${title}</h5>${
    detail ? `<p class="muted">${detail}</p>` : ''
  }</div>`
}

async function fetchReleases() {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`)
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`)
    const data = await res.json()
    renderReleases(data)
  } catch (err) {
    console.error('[website releases]', err)
    renderMessage('Unable to load release notes', err.message || String(err))
  }
}

function renderReleases(list) {
  if (!releasesEl) return
  if (!Array.isArray(list) || list.length === 0) {
    renderMessage('No releases published yet')
    return
  }

  releasesEl.innerHTML = ''
  list.slice(0, 6).forEach((release) => {
    const div = document.createElement('div')
    div.className = 'release'
    div.innerHTML = `<h5>${release.name || release.tag_name}</h5>
      <div class="meta">${new Date(release.published_at).toLocaleString()}</div>
      <p>${(release.body || '')
        .split('\n')
        .slice(0, 5)
        .join('\n')
        .replace(/\n/g, '<br>')}</p>
      <div>
        <a class="btn outline" href="${release.html_url}" target="_blank" rel="noreferrer">View full release</a>
        ${
          release.assets && release.assets[0]
            ? `<a class="btn" style="margin-left:8px" href="${release.assets[0].browser_download_url}">Download ${release.assets[0].name}</a>`
            : ''
        }
      </div>`
    releasesEl.appendChild(div)
  })
}

fetchReleases()

const yearEl = document.getElementById('year')
if (yearEl) yearEl.textContent = new Date().getFullYear()
