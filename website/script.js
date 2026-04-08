// script.js — fetch GitHub releases and render changelog
// Note: GitHub API supports CORS for public repos; if you encounter CORS errors, consider using a simple proxy.

const owner = 'your-github-username'; // TODO: replace
const repo = 'ECHO'; // TODO: replace with actual repo name if different
const releasesEl = document.getElementById('releases');

async function fetchReleases(){
  try{
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`);
    if(!res.ok) throw new Error('GitHub API error '+res.status);
    const data = await res.json();
    renderReleases(data);
  }catch(err){
    console.error(err);
    releasesEl.innerHTML = `<div class="release"><h5>无法获取更新日志</h5><p class="muted">${err.message}</p></div>`;
  }
}

function renderReleases(list){
  if(!list || list.length===0){
    releasesEl.innerHTML = `<div class="release"><h5>暂无版本发布</h5></div>`;return;
  }
  releasesEl.innerHTML = '';
  list.slice(0,6).forEach(r=>{
    const div = document.createElement('div');
    div.className = 'release';
    div.innerHTML = `<h5>${r.name || r.tag_name}</h5>
      <div class="meta">${new Date(r.published_at).toLocaleString()}</div>
      <p>${(r.body || '').split('\n').slice(0,5).join('\n').replace(/\n/g,'<br>')}</p>
      <div><a class="btn outline" href="${r.html_url}" target="_blank">查看完整发布</a>
      ${r.assets && r.assets[0] ? `<a class="btn" style="margin-left:8px" href="${r.assets[0].browser_download_url}">下载 ${r.assets[0].name}</a>` : ''}
      </div>`;
    releasesEl.appendChild(div);
  })
}

// Initialize
fetchReleases();

// Footer year
const yearEl = document.getElementById('year');
if(yearEl) yearEl.textContent = new Date().getFullYear();
