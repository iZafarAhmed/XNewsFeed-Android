// app.js — X News Feed (API-only, clean)

/* ========== STORAGE ========== */
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

/* ========== FETCH ========== */
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
}

/* ========== APP ========== */
document.addEventListener('DOMContentLoaded', () => {
  const feedContainer = document.getElementById('feed-container');
  const trendContainer = document.getElementById('trend-container');
  const trendSelect = document.getElementById('trend-category-select');
  const channelContainer = document.getElementById('channel-container');
  const channelChip = document.getElementById('channel-chip');
  const channelBackBtn = document.getElementById('channel-back-btn');
  const channelFollowBtn = document.getElementById('channel-follow-btn');
  const usernameInput = document.getElementById('username-input');
  const loadBtn = document.getElementById('load-btn');
  const clearBtn = document.getElementById('clear-btn');
  const popularSelect = document.getElementById('popular-select');
  const refreshBtn = document.getElementById('refresh-btn');
  const themeBtn = document.getElementById('theme-btn');
  const viewFeed = document.getElementById('view-feed');
  const viewTrends = document.getElementById('view-trends');
  const viewChannel = document.getElementById('view-channel');

  const TWITTER_API = 'https://twitter-api.izafr.workers.dev';   // ← your Cloudflare Worker proxy

  const CAT_EMOJI = { news: '📰', ai: '🤖', stocks: '💰', war: '🌍', tech: '💻', crypto: '🪙', business: '💼', science: '🔬', world: '🌐' };
  const CAT_LABEL = {
    news: '📰 News', ai: '🤖 AI', stocks: '💰 India Stocks',
    war: '🌍 War News', tech: '💻 Tech News', crypto: '🪙 Crypto',
    business: '💼 Business', science: '🔬 Science', world: '🌐 World News'
  };

  let currentView = 'feed', lastTab = 'feed', trendsLoaded = false, feedLoaded = false;
  let currentChannelUser = '', channelMode = 'user', currentSearchQuery = '';

  /* ---------- API client ---------- */
  async function apiGetPosts(handles, max) {
    const out = {};
    for (let i = 0; i < handles.length; i += 10) {
      const chunk = handles.slice(i, i + 10);
      try {
        const res = await withTimeout(
          fetch(`${TWITTER_API}/api/v1/users/posts?users=${chunk.join(',')}&max_posts_per_user=${max}`),
          35000
        );
        if (!res.ok) continue;
        const json = await res.json();
        for (const [h, r] of Object.entries(json.results || {})) {
          if (!r || !r.success) continue;
          const arr = Array.isArray(r.posts) ? r.posts : (r.posts && Array.isArray(r.posts.data) ? r.posts.data : []);
          if (arr.length) out[h] = arr;
        }
      } catch (e) {}
    }
    return out;
  }

  /* ---------- Card builder (from API posts) ---------- */
  function buildApiCard(post, cat = '') {
    const username = (post.author && post.author.screenName) || post._source_user || 'unknown';
    const creator = '@' + username;
    const tweetId = post.id || '';
    const card = document.createElement('div');
    card.className = 'tweet-card';
    card.setAttribute('data-user', username);

    const avatarUrl = (post.author && post.author.profileImageUrl) || '';
    const avatarHtml = avatarUrl ? `<img class="avatar" src="${escapeAttr(avatarUrl)}" alt="">` : fallbackAvatarHtml(creator);
    const chip = cat ? `<span class="cat-chip" title="${CAT_LABEL[cat] || ''}">${CAT_EMOJI[cat] || '📰'}</span>` : '';
    const removeBtn = `<button class="remove-btn" data-user="${username}" title="Remove ${username}">❌</button>`;
    const translateBtn = `<button class="translate-btn" title="Translate to English">🌐</button>`;
    const dateHtml = post.createdAtISO ? getRelativeTime(post.createdAtISO) : '';

    let mediaHtml = '';
    const m0 = (post.media || [])[0];
    if (m0 && m0.url) {
      if (m0.type === 'video') {
        mediaHtml = `<div class="media-container" data-video-mp4="${escapeAttr(m0.url)}" data-tweet-id="${escapeAttr(tweetId)}" data-username="${escapeAttr(username)}" style="aspect-ratio:16/9;background:#000;">
          <div class="play-btn-overlay">▶ Play Video</div>
        </div>`;
      } else {
        mediaHtml = `<img src="${escapeAttr(m0.url)}" class="tweet-image" alt="Tweet image">`;
      }
    }
    const xUrl = tweetId ? `https://x.com/${username}/status/${tweetId}` : '#';

    card.innerHTML = `
      <div class="tweet-header">
        <div class="tweet-user">${avatarHtml}<strong>${escapeHtml(creator)}</strong>${chip}</div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${translateBtn}${removeBtn}
          <span class="tweet-date" title="${escapeAttr(post.createdAtISO || '')}">${escapeHtml(dateHtml)}</span>
        </div>
      </div>
      <div class="tweet-content"><p class="tweet-paragraph">${linkify(escapeHtml(post.text || ''))}</p></div>
      ${mediaHtml}
      <a href="${xUrl}" target="_blank" class="tweet-link">View on X (Twitter) ↗</a>`;

    card.querySelector('.tweet-user').addEventListener('click', () => openChannel(username));
    const av = card.querySelector('img.avatar');
    if (av) av.addEventListener('error', () => { av.outerHTML = fallbackAvatarHtml(creator); });
    const mc = card.querySelector('.media-container');
    if (mc) mc.addEventListener('click', function () {
      const url = this.getAttribute('data-video-mp4');
      if (url) injectVideoPlayer(this, [url], '', xUrl);
    });
    return card;
  }

  /* ---------- Global click handler ---------- */
  document.body.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-btn')) {
      const u = e.target.getAttribute('data-user');
      store.get(['usernames'], (r) => {
        store.set({ usernames: (r.usernames || []).filter(x => x !== u) }, () => {
          document.querySelectorAll(`.tweet-card[data-user="${u}"]`).forEach(el => el.remove());
        });
      });
      return;
    }
    if (e.target.classList.contains('translate-btn')) {
      const btn = e.target;
      const card = btn.closest('.tweet-card');
      const el = card && card.querySelector('.tweet-content');
      if (!el) return;
      if (el.dataset.translated === '1') {
        el.innerHTML = el.dataset.original; delete el.dataset.translated;
        btn.textContent = '🌐'; btn.title = 'Translate to English'; return;
      }
      if (!el.dataset.original) el.dataset.original = el.innerHTML;
      btn.disabled = true; btn.textContent = '⏳';
      translateContent(el)
        .then(() => { el.dataset.translated = '1'; btn.textContent = '🔄'; btn.title = 'Show original'; })
        .catch(() => { btn.textContent = '❗'; setTimeout(() => btn.textContent = '🌐', 2000); })
        .finally(() => { btn.disabled = false; });
    }
  });

  /* ---------- Theme ---------- */
  store.get(['darkMode'], (r) => applyTheme(!!r.darkMode));
  themeBtn.addEventListener('click', () => {
    const d = !document.body.classList.contains('dark');
    store.set({ darkMode: d }); applyTheme(d);
  });
  function applyTheme(d) {
    document.body.classList.toggle('dark', d);
    themeBtn.textContent = d ? '☀️' : '🌙';
  }

  /* ---------- Views / tabs ---------- */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const v = tab.dataset.view;
      switchView(v);
      if (v === 'trends' && !trendsLoaded) { trendsLoaded = true; loadTrends(); }
      if (v === 'feed' && !feedLoaded) { feedLoaded = true; reloadFeeds(); }
    });
  });
  trendSelect.addEventListener('change', () => { trendsLoaded = true; loadTrends(); });
  channelBackBtn.addEventListener('click', () => switchView(lastTab));
  channelFollowBtn.addEventListener('click', () => {
    if (!currentChannelUser) return;
    addAndFetchUser(currentChannelUser);
    channelFollowBtn.textContent = '✓ Following';
    setTimeout(() => channelFollowBtn.textContent = '➕ Follow', 1500);
  });

  function switchView(v) {
    currentView = v;
    if (v === 'feed' || v === 'trends') lastTab = v;
    viewFeed.hidden = v !== 'feed';
    viewTrends.hidden = v !== 'trends';
    viewChannel.hidden = v !== 'channel';
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === lastTab));
  }

  refreshBtn.addEventListener('click', () => {
    if (currentView === 'feed') reloadFeeds();
    else if (currentView === 'trends') loadTrends();
    else if (currentView === 'channel') (channelMode === 'search' ? openSearch(currentSearchQuery) : openChannel(currentChannelUser));
  });

  /* ---------- Controls ---------- */
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

  /* ---------- Feed ---------- */
  function reloadFeeds() {
    feedContainer.innerHTML = '<div class="loader">Loading feeds…</div>';
    store.get(['usernames'], async (r) => {
      const list = r.usernames || ['MiddleEastEye'];
      feedContainer.innerHTML = '';
      if (!list.length) { feedContainer.innerHTML = '<p class="empty-state">Add a username to get started!</p>'; return; }
      const byHandle = await apiGetPosts(list, 10);
      let added = 0;
      for (const u of list) {
        (byHandle[u] || []).forEach(p => { feedContainer.appendChild(buildApiCard(p)); added++; });
      }
      if (!added) {
        const err = document.createElement('div');
        err.className = 'error';
        err.innerHTML = `Couldn't reach your Twitter API at <code>${escapeHtml(TWITTER_API)}</code>. Check the Worker proxy.`;
        feedContainer.appendChild(err);
      }
    });
  }

  function addAndFetchUser(username) {
    store.get(['usernames'], (r) => {
      let list = r.usernames || [];
      if (!list.includes(username)) { list.push(username); store.set({ usernames: list }); }
    });
    (async () => {
      const byHandle = await apiGetPosts([username], 10);
      (byHandle[username] || []).forEach(p => feedContainer.appendChild(buildApiCard(p)));
    })();
  }

  /* ---------- Channel ---------- */
  async function openChannel(username) {
    const handle = (username || '').replace('@', '').trim();
    if (!handle) return;
    currentChannelUser = handle; channelMode = 'user';
    channelFollowBtn.style.display = '';
    switchView('channel');
    channelChip.textContent = '@' + handle;
    channelContainer.innerHTML = '<div class="loader">Loading @' + escapeHtml(handle) + '…</div>';
    const byHandle = await apiGetPosts([handle], 20);
    const posts = byHandle[handle] || [];
    channelContainer.innerHTML = '';
    if (!posts.length) {
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = `Couldn't load @${handle}.`;
      channelContainer.appendChild(err);
      return;
    }
    posts.forEach(p => channelContainer.appendChild(buildApiCard(p)));
  }

  /* ---------- Search (username lookups via API) ---------- */
  function openSearch(query) {
    if (!query) return;
    currentSearchQuery = query; channelMode = 'search';
    channelFollowBtn.style.display = 'none';
    switchView('channel');
    channelChip.textContent = '🔍 ' + query;
    channelContainer.innerHTML = '<div class="loader">Searching ' + escapeHtml(query) + '…</div>';
    const handles = (query.startsWith('#') ? [] : [query.replace('@', '')]);
    if (!handles.length) {
      channelContainer.innerHTML = '<p class="empty-state">Hashtag search needs a backend. Try tapping a @username instead.</p>';
      return;
    }
    (async () => {
      const byHandle = await apiGetPosts(handles, 20);
      channelContainer.innerHTML = '';
      const posts = byHandle[handles[0]] || [];
      if (!posts.length) {
        channelContainer.innerHTML = `<p class="empty-state">No posts from @${escapeHtml(handles[0])}.</p>`;
        return;
      }
      posts.forEach(p => channelContainer.appendChild(buildApiCard(p)));
    })();
  }

  /* ---------- Categories ---------- */
  function categoryFromLabel(label) {
    if (label.includes('AI')) return 'ai';
    if (label.includes('Stocks')) return 'stocks';
    if (label.includes('War')) return 'war';
    if (label.includes('Tech')) return 'tech';
    if (label.includes('Crypto')) return 'crypto';
    if (label.includes('Business')) return 'business';
    if (label.includes('Science')) return 'science';
    if (label.includes('World')) return 'world';
    return 'news';
  }
  function getCuratedChannels(category) {
    const ch = [];
    popularSelect.querySelectorAll('optgroup').forEach(g => {
      const cat = categoryFromLabel(g.label);
      if (category && cat !== category) return;
      g.querySelectorAll('option').forEach(o => { if (o.value) ch.push({ handle: o.value, cat }); });
    });
    return ch;
  }

  /* ---------- Trending (API-only, fast) ---------- */
  async function loadTrends() {
    const category = trendSelect.value || 'world';
    const channels = getCuratedChannels(category);
    trendContainer.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'trend-header';
    header.textContent = `🔥 ${CAT_LABEL[category]} — latest from ${channels.length} channels`;
    trendContainer.appendChild(header);
    const loader = document.createElement('div');
    loader.className = 'loader';
    loader.textContent = `Fetching ${CAT_LABEL[category]}…`;
    trendContainer.appendChild(loader);

    const byHandle = await apiGetPosts(channels.map(c => c.handle), 3);
    loader.remove();

    const collected = [];
    for (const ch of channels) {
      (byHandle[ch.handle] || []).forEach(p => {
        collected.push({ ms: Date.parse(p.createdAtISO || p.createdAt || '') || 0, el: buildApiCard(p, ch.cat) });
      });
    }

    if (!collected.length) {
      const err = document.createElement('div');
      err.className = 'error';
      err.innerHTML = `Couldn't reach your Twitter API at <code>${escapeHtml(TWITTER_API)}</code>. Check the Worker proxy.`;
      trendContainer.appendChild(err);
      return;
    }
    collected.sort((a, b) => b.ms - a.ms);
    collected.forEach(c => trendContainer.appendChild(c.el));
    header.innerHTML = `🔥 ${CAT_LABEL[category]} — latest from ${channels.length} channels <span class="trend-updated">· updated ${new Date().toLocaleTimeString()}</span>`;
  }

  /* ---------- Helpers ---------- */
  function linkify(t) {
    return t.replace(/[#@][A-Za-z0-9_]+/g, m => {
      if (m.startsWith('#')) return `<a href="#" class="tweet-inline-link in-app-search" data-query="${escapeAttr(m)}">${m}</a>`;
      return `<a href="#" class="tweet-inline-link in-app-user" data-user="${escapeAttr(m.slice(1))}">${m}</a>`;
    });
  }
  function fallbackAvatarHtml(n) {
    const l = ((n || '?').replace('@', '').charAt(0) || '?').toUpperCase();
    return `<div class="avatar avatar-fallback">${escapeHtml(l)}</div>`;
  }
  function escapeAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function getRelativeTime(s) {
    if (!s) return '';
    const x = Math.floor((new Date() - new Date(s)) / 1000);
    if (x < 60) return 'just now';
    const m = Math.floor(x / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
    return new Date(s).toLocaleDateString();
  }

  /* ---------- Translation ---------- */
  async function translateContent(el) {
    const ps = el.querySelectorAll('.tweet-paragraph');
    if (!ps.length) return;
    const out = await Promise.all([...ps].map(async p => {
      const orig = p.innerHTML;
      const txt = p.textContent.trim();
      if (!txt) return orig;
      try {
        const tr = await translateText(txt);
        return `<span class="translated-tag">EN</span> ${linkify(escapeHtml(tr))}`;
      } catch (e) { return orig; }
    }));
    el.innerHTML = out.map(h => `<p class="tweet-paragraph">${h}</p>`).join('');
  }
  async function translateText(t) {
    if (t.length <= 500) return await translateChunk(t);
    const cs = []; let r = t;
    while (r.length > 500) {
      let c = r.lastIndexOf('.', 500);
      if (c < 250) c = r.lastIndexOf('!', 500);
      if (c < 250) c = r.lastIndexOf('?', 500);
      if (c < 250) c = 500;
      cs.push(r.slice(0, c + 1)); r = r.slice(c + 1).trimStart();
    }
    if (r) cs.push(r);
    return (await Promise.all(cs.map(translateChunk))).join(' ');
  }
  async function translateChunk(t) {
    try {
      const d = JSON.parse(await (await withTimeout(fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dj=1&q=' + encodeURIComponent(t)), 8000)).text());
      if (d && Array.isArray(d.sentences)) {
        const o = d.sentences.map(s => s.trans || '').join('');
        if (o.trim()) return o;
      }
    } catch (e) {}
    try {
      const d = JSON.parse(await (await withTimeout(fetch('https://lingva.ml/api/v1/auto/en/' + encodeURIComponent(t)), 8000)).text());
      if (d && d.translation) return d.translation;
    } catch (e) {}
    throw new Error('translation failed');
  }

  /* ---------- Video ---------- */
  function injectVideoPlayer(container, candidates, poster, fallbackUrl) {
    container.innerHTML = '';
    const v = document.createElement('video');
    v.controls = true; v.playsInline = true;
    if (poster) v.poster = poster;
    v.style.cssText = 'max-width:100%; border-radius:12px; display:block; background:black;';
    let i = 0;
    v.addEventListener('error', () => {
      i++;
      if (i < candidates.length) { v.src = candidates[i]; v.load(); v.play().catch(() => {}); }
      else showFallback(container, fallbackUrl, '🎬 Playback failed. Click to open on X.');
    });
    v.src = candidates[0];
    container.appendChild(v);
    v.play().catch(() => {});
  }
  function showFallback(c, url, msg) {
    c.innerHTML = `<div class="video-fallback">${msg}</div>`;
    c.onclick = () => window.open(url, '_blank');
  }

  /* ---------- Init ---------- */
  switchView('trends');
  trendsLoaded = true;
  loadTrends();
});
