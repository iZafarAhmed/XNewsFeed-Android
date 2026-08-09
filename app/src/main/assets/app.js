// app.js — X News Feed (works in Android WebView AND as Chrome extension / browser)

/* ========== STORAGE ABSTRACTION ========== */
/* localStorage on Android, chrome.storage in the extension */
const store = {
  _has: typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local),
  get(keys, cb) {
    if (this._has) return chrome.storage.local.get(keys, cb);
    const out = {};
    (Array.isArray(keys) ? keys : [keys]).forEach(k => {
      const v = localStorage.getItem('xnf_' + k);
      if (v !== null) { try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; } }
    });
    cb(out);
  },
  set(obj, cb) {
    if (this._has) return chrome.storage.local.set(obj, cb);
    Object.entries(obj).forEach(([k, v]) => localStorage.setItem('xnf_' + k, JSON.stringify(v)));
    cb && cb();
  }
};

/* ========== FETCH ABSTRACTION + ANDROID BRIDGE ========== */
/* On Android: native HTTP via Java bridge (no CORS). Elsewhere: normal fetch. */
let _cbId = 0;
const _cbs = {};

window.__onFetch = function (id, jsonStr) {
  const cb = _cbs[id];
  if (!cb) return;
  delete _cbs[id];
  try {
    const data = JSON.parse(jsonStr);
    data.ok ? cb.resolve(data.body) : cb.reject(new Error(data.error || 'fetch failed'));
  } catch (e) { cb.reject(e); }
};

function nativeFetch(url) {
  return new Promise((resolve, reject) => {
    const id = 'f' + (++_cbId);
    _cbs[id] = { resolve, reject };
    window.Android.fetch(url, id);
  });
}

async function smartFetch(url) {
  if (window.Android) return nativeFetch(url);      // Android: native, CORS-free
  const res = await fetch(url);                     // Browser fallback
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/* ========== APP ========== */
document.addEventListener('DOMContentLoaded', () => {
  const feedContainer = document.getElementById('feed-container');
  const trendContainer = document.getElementById('trend-container');
  const usernameInput = document.getElementById('username-input');
  const loadBtn = document.getElementById('load-btn');
  const clearBtn = document.getElementById('clear-btn');
  const popularSelect = document.getElementById('popular-select');
  const refreshBtn = document.getElementById('refresh-btn');
  const themeBtn = document.getElementById('theme-btn');
  const viewFeed = document.getElementById('view-feed');
  const viewTrends = document.getElementById('view-trends');

  const NITTER_INSTANCE = 'https://nitter.net'; // change if instance is down

  let currentView = 'feed';
  let trendsLoaded = false;

  /* ---------- THEME ---------- */
  store.get(['darkMode'], (r) => applyTheme(!!r.darkMode));
  themeBtn.addEventListener('click', () => {
    const dark = !document.body.classList.contains('dark');
    store.set({ darkMode: dark });
    applyTheme(dark);
  });
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    themeBtn.textContent = dark ? '☀️' : '🌙';
  }

  /* ---------- VIEWS / TABS ---------- */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      switchView(view);
      if (view === 'trends' && !trendsLoaded) { trendsLoaded = true; loadTrends(); }
    });
  });

  function switchView(view) {
    currentView = view;
    viewFeed.hidden = view !== 'feed';
    viewTrends.hidden = view !== 'trends';
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  }

  refreshBtn.addEventListener('click', () => {
    currentView === 'feed' ? reloadFeeds() : loadTrends();
  });

  /* ---------- CONTROLS ---------- */
  loadBtn.addEventListener('click', () => {
    const u = usernameInput.value.trim().replace('@', '');
    if (u) { addAndFetchUser(u); usernameInput.value = ''; }
  });
  usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loadBtn.click(); });
  clearBtn.addEventListener('click', () => {
    store.set({ usernames: [] });
    feedContainer.innerHTML = '<p class="empty-state">Add a username to get started!</p>';
  });
  popularSelect.addEventListener('change', () => {
    const v = popularSelect.value.trim();
    if (v) addAndFetchUser(v);
    popularSelect.value = '';
  });

  /* ---------- FEEDS ---------- */
  function reloadFeeds() {
    feedContainer.innerHTML = '<div class="loader">Loading feeds…</div>';
    store.get(['usernames'], (r) => {
      const usernames = r.usernames || ['MiddleEastEye'];
      feedContainer.innerHTML = '';
      if (!usernames.length) { feedContainer.innerHTML = '<p class="empty-state">Add a username to get started!</p>'; return; }
      usernames.forEach(u => fetchFeed(u, feedContainer));
    });
  }

  function addAndFetchUser(username) {
    fetchFeed(username, feedContainer);
    store.get(['usernames'], (r) => {
      let list = r.usernames || [];
      if (!list.includes(username)) { list.push(username); store.set({ usernames: list }); }
    });
  }

  async function fetchFeed(username, container) {
    container.querySelectorAll(`.tweet-card[data-user="${username}"]`).forEach(el => el.remove());
    try {
      const text = await smartFetch(`${NITTER_INSTANCE}/${username}/rss`);
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      const avatar = xml.querySelector('channel > image > url')?.textContent.trim() || '';
      xml.querySelectorAll('item').forEach(item => {
        container.appendChild(buildTweetCard(item, { username, avatarUrl: avatar }));
      });
    } catch (e) {
      const d = document.createElement('div');
      d.className = 'error';
      d.textContent = `Failed to load @${username}. Nitter might be down.`;
      container.prepend(d);
    }
  }

  /* ---------- TRENDING (newest posts from all curated channels) ---------- */
  function getCuratedChannels() {
    const channels = [];
    popularSelect.querySelectorAll('optgroup').forEach(group => {
      const cat = group.label.includes('AI') ? 'ai' : 'news';
      group.querySelectorAll('option').forEach(opt => {
        if (opt.value) channels.push({ handle: opt.value, cat });
      });
    });
    return channels;
  }

  async function loadTrends() {
    const channels = getCuratedChannels();
    trendContainer.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'trend-header';
    header.textContent = `🔥 Latest from ${channels.length} top channels`;
    trendContainer.appendChild(header);

    const loader = document.createElement('div');
    loader.className = 'loader';
    loader.textContent = `Fetching latest news… 0/${channels.length}`;
    trendContainer.appendChild(loader);

    const collected = [];
    let done = 0;

    await Promise.all(channels.map(async ch => {
      try {
        const text = await smartFetch(`${NITTER_INSTANCE}/${ch.handle}/rss`);
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        if (!xml.querySelector('parsererror')) {
          const avatar = xml.querySelector('channel > image > url')?.textContent.trim() || '';
          [...xml.querySelectorAll('item')].slice(0, 2).forEach(item => {
            collected.push({ item, username: ch.handle, avatarUrl: avatar, cat: ch.cat });
          });
        }
      } catch (e) { /* skip failed channel */ }
      done++;
      loader.textContent = `Fetching latest news… ${done}/${channels.length}`;
    }));

    loader.remove();

    collected.sort((a, b) =>
      new Date(b.item.querySelector('pubDate')?.textContent || 0) -
      new Date(a.item.querySelector('pubDate')?.textContent || 0));

    if (!collected.length) {
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = 'Couldn\'t fetch any channel. Nitter might be down.';
      trendContainer.appendChild(err);
      return;
    }

    collected.slice(0, 30).forEach(c => trendContainer.appendChild(buildTweetCard(c.item, c)));

    header.innerHTML = `🔥 Latest from ${channels.length} top channels <span class="trend-updated">· updated ${new Date().toLocaleTimeString()}</span>`;
  }

  /* ---------- SHARED CARD BUILDER ---------- */
  function buildTweetCard(item, { username, avatarUrl = '', cat = '' }) {
    const title = item.querySelector('title')?.textContent || '';
    const creatorNode = item.getElementsByTagName('dc:creator')[0] || item.getElementsByTagName('creator')[0];
    const creator = creatorNode ? creatorNode.textContent : `@${username}`;
    const description = item.querySelector('description')?.textContent || '';
    const pubDate = item.querySelector('pubDate')?.textContent || '';
    const link = item.querySelector('link')?.textContent || '#';
    const tweetId = item.querySelector('guid')?.textContent || '';

    const card = document.createElement('div');
    card.className = 'tweet-card';
    card.setAttribute('data-user', username);

    const descDiv = document.createElement('div');
    descDiv.innerHTML = description;
    const img = descDiv.querySelector('img');
    const isVideo = description.includes('Video') || (img && img.src.includes('ext_tw_video_thumb'));

    const pTags = descDiv.querySelectorAll('p');
    const contentHtml = pTags.length
      ? Array.from(pTags).map(p => `<p class="tweet-paragraph">${richTextHtml(p)}</p>`).join('')
      : `<p class="tweet-paragraph">${escapeHtml(title)}</p>`;

    const avatarHtml = avatarUrl
      ? `<img class="avatar" src="${escapeAttr(avatarUrl)}" alt="">`
      : fallbackAvatarHtml(creator);

    const chip = cat ? `<span class="cat-chip" title="${cat === 'ai' ? 'AI channel' : 'News channel'}">${cat === 'ai' ? '🤖' : '📰'}</span>` : '';

    let mediaHtml = '';
    if (img) {
      mediaHtml = isVideo
        ? `<div class="media-container" data-tweet-id="${tweetId}" data-username="${username}">
             <img src="${img.src}" class="tweet-image" alt="Video thumbnail">
             <div class="play-btn-overlay">▶ Play Video</div>
           </div>`
        : `<img src="${img.src}" class="tweet-image" alt="Tweet image">`;
    }

    card.innerHTML = `
      <div class="tweet-header">
        <div class="tweet-user">${avatarHtml}<strong>${escapeHtml(creator)}</strong>${chip}</div>
        <span class="tweet-date" title="${new Date(pubDate).toLocaleString()}">${getRelativeTime(pubDate)}</span>
      </div>
      <div class="tweet-content">${contentHtml}</div>
      ${mediaHtml}
      <a href="${link}" target="_blank" class="tweet-link">View on X (Twitter) ↗</a>`;

    const av = card.querySelector('img.avatar');
    if (av) av.addEventListener('error', () => { av.outerHTML = fallbackAvatarHtml(creator); });

    if (isVideo) {
      card.querySelector('.media-container').addEventListener('click', function () { handleVideoPlayback(this); });
    }
    return card;
  }

  /* ---------- HELPERS ---------- */
  function richTextHtml(node) {
    let out = '';
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) out += escapeHtml(child.textContent);
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') out += '<br>';
        else if (tag === 'a') {
          let href = child.getAttribute('href') || '#';
          if (href.startsWith('/')) href = NITTER_INSTANCE + href;
          out += `<a href="${escapeAttr(href)}" target="_blank" class="tweet-inline-link">${richTextHtml(child)}</a>`;
        } else out += richTextHtml(child);
      }
    });
    return out;
  }

  function fallbackAvatarHtml(name) {
    const letter = ((name || '?').replace('@', '').charAt(0) || '?').toUpperCase();
    return `<div class="avatar avatar-fallback">${escapeHtml(letter)}</div>`;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getRelativeTime(dateString) {
    if (!dateString) return '';
    const s = Math.floor((new Date() - new Date(dateString)) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
    return new Date(dateString).toLocaleDateString();
  }

  function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  /* ---------- VIDEO ---------- */
  async function handleVideoPlayback(container) {
    const tid = container.getAttribute('data-tweet-id');
    const uname = container.getAttribute('data-username');
    const overlay = container.querySelector('.play-btn-overlay');
    const poster = container.querySelector('img')?.src || '';
    const fallbackUrl = `${NITTER_INSTANCE}/${uname}/status/${tid}`;

    if (overlay) { overlay.textContent = 'Loading video...'; overlay.style.fontSize = '12px'; }

    try {
      const text = await smartFetch(fallbackUrl);
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const candidates = await collectVideoCandidates(doc);
      if (candidates.length) injectVideoPlayer(container, candidates, poster, fallbackUrl);
      else showFallback(container, fallbackUrl, '🎬 Video not found. Click to open on Nitter.');
    } catch (err) {
      showFallback(container, fallbackUrl, '🎬 Error loading video. Click to open on Nitter.');
    }
  }

  async function collectVideoCandidates(doc) {
    const candidates = [];
    const push = u => { if (u && !candidates.includes(u)) candidates.push(u); };
    const els = [
      ...doc.querySelectorAll('video source[src]'),
      ...doc.querySelectorAll('video[src]'),
      ...doc.querySelectorAll('a.video-download[href]')
    ];
    for (const el of els) {
      const raw = el.getAttribute('src') || el.getAttribute('href');
      if (!raw) continue;
      const dec = decodeNitterProxyUrl(raw);
      if (dec && dec.includes('.mp4')) push(dec);
      if (raw.startsWith('http') && raw.includes('.mp4')) push(raw);
      if (raw.startsWith('/') && raw.includes('.mp4')) push(NITTER_INSTANCE + raw);
    }
    const hlsEl = doc.querySelector('video[data-url]');
    if (hlsEl) {
      const raw = hlsEl.getAttribute('data-url');
      const url = decodeNitterProxyUrl(raw) || (raw.startsWith('http') ? raw : NITTER_INSTANCE + raw);
      push(await extractMp4FromPlaylist(url));
    }
    return candidates;
  }

  function decodeNitterProxyUrl(raw) {
    if (!raw) return null;
    let m = raw.match(/\/video\/enc\/[^\/]+\/([^?#]+)/);
    if (m) {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      try { return atob(b64); } catch (e) {}
    }
    m = raw.match(/\/video\/[^\/]+\/([^?#]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    return null;
  }

  async function extractMp4FromPlaylist(url) {
    if (!url || !url.includes('.m3u8')) return null;
    try {
      const text = await smartFetch(url);
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      let mp4 = lines.find(l => l.endsWith('.mp4'));
      if (mp4) return mp4.startsWith('http') ? mp4 : new URL(mp4, url).href;
      const child = lines.find(l => l.endsWith('.m3u8'));
      if (child) {
        const childUrl = child.startsWith('http') ? child : new URL(child, url).href;
        const t2 = await smartFetch(childUrl);
        const m2 = t2.split('\n').map(l => l.trim()).filter(Boolean).find(l => l.endsWith('.mp4'));
        if (m2) return m2.startsWith('http') ? m2 : new URL(m2, childUrl).href;
      }
    } catch (e) {}
    return null;
  }

  function injectVideoPlayer(container, candidates, poster, fallbackUrl) {
    container.innerHTML = '';
    const video = document.createElement('video');
    video.controls = true; video.playsInline = true;
    if (poster) video.poster = poster;
    video.style.cssText = 'max-width:100%; border-radius:12px; display:block;';
    let i = 0;
    video.addEventListener('error', () => {
      i++;
      if (i < candidates.length) { video.src = candidates[i]; video.load(); video.play().catch(() => {}); }
      else showFallback(container, fallbackUrl, '🎬 Playback failed. Click to open on Nitter.');
    });
    video.src = candidates[0];
    container.appendChild(video);
    video.play().catch(() => {});
  }

  function showFallback(container, url, msg) {
    container.innerHTML = `<div class="video-fallback">${msg}</div>`;
    container.onclick = () => window.open(url, '_blank');
  }

  /* ---------- INIT ---------- */
  reloadFeeds();
});
