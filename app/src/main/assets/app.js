// app.js — X News Feed (FINAL — Android WebView + Browser compatible)

// Visible runtime-error banner (so a blank screen never happens silently again)
window.addEventListener('error', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#d93025;color:#fff;font-size:11px;padding:6px;z-index:999;word-break:break-all;';
  d.textContent = 'JS ERROR: ' + e.message;
  if (document.body) document.body.appendChild(d);
});

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

/* ========== FETCH LAYER ========== */
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

function nativeFetchPage(url) {
  return new Promise((resolve, reject) => {
    const id = 'p' + (++_cbId);
    _cbs[id] = { resolve, reject };
    window.Android.fetchPage(url, id);
    setTimeout(() => { if (_cbs[id]) { delete _cbs[id]; reject(new Error('timeout')); } }, 30000);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function smartFetch(url) {
  if (window.Android) {
    try {
      const res = await withTimeout(fetch('https://proxy.xnewsfeed.local/' + encodeURIComponent(url)), 12000);
      if (res.ok) return await res.text();
    } catch (e) {}
    return withTimeout(nativeFetch(url), 12000);
  }
  const res = await withTimeout(fetch(url), 12000);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
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

  let NITTER_INSTANCE = 'https://xcancel.com';
  const INSTANCE_LIST = [
    'https://xcancel.com',
    'https://nitter.poast.org',
    'https://nitter.unixfox.eu',
    'https://nitter.tedomum.net',
    'https://nitter.net'
  ];

  const CAT_EMOJI = { news: '📰', ai: '🤖', stocks: '💰', war: '🌍', tech: '💻', crypto: '🪙', business: '💼', science: '🔬', world: '🌐' };
  const CAT_LABEL = {
    news: '📰 News', ai: '🤖 AI', stocks: '💰 India Stocks',
    war: '🌍 War News', tech: '💻 Tech News', crypto: '🪙 Crypto',
    business: '💼 Business', science: '🔬 Science', world: '🌐 World News'
  };

  let currentView = 'feed';
  let lastTab = 'feed';
  let trendsLoaded = false;
  let feedLoaded = false;
  let currentChannelUser = '';
  let channelMode = 'user';
  let currentSearchQuery = '';

  /* ---------- Instance failover ---------- */
  async function probeInstance() {
    for (const inst of INSTANCE_LIST) {
      try {
        const text = window.Android
          ? await withTimeout(nativeFetch(inst + '/MiddleEastEye/rss'), 8000)
          : await (await withTimeout(fetch(inst + '/MiddleEastEye/rss'), 8000)).text();
        if (text && text.includes('<rss')) { NITTER_INSTANCE = inst; return; }
      } catch (e) {}
    }
  }

  /* ---------- Global click handling ---------- */
  document.body.addEventListener('click', (e) => {
    const searchLink = e.target.closest('.in-app-search');
    if (searchLink) { e.preventDefault(); openSearch(searchLink.getAttribute('data-query')); return; }
    const userLink = e.target.closest('.in-app-user');
    if (userLink) { e.preventDefault(); openChannel(userLink.getAttribute('data-user')); return; }

    if (e.target.classList.contains('remove-btn')) {
      const userToRemove = e.target.getAttribute('data-user');
      store.get(['usernames'], (r) => {
        const list = (r.usernames || []).filter(u => u !== userToRemove);
        store.set({ usernames: list }, () => {
          document.querySelectorAll(`.tweet-card[data-user="${userToRemove}"]`).forEach(el => el.remove());
        });
      });
      return;
    }

    if (e.target.classList.contains('translate-btn')) {
      const btn = e.target;
      const card = btn.closest('.tweet-card');
      const contentEl = card.querySelector('.tweet-content');
      if (!contentEl) return;
      if (contentEl.dataset.translated === '1') {
        contentEl.innerHTML = contentEl.dataset.original;
        delete contentEl.dataset.translated;
        btn.textContent = '🌐';
        return;
      }
      if (!contentEl.dataset.original) contentEl.dataset.original = contentEl.innerHTML;
      btn.disabled = true;
      btn.textContent = '⏳';
      translateContent(contentEl)
        .then(() => { contentEl.dataset.translated = '1'; btn.textContent = '🔄'; })
        .catch(() => { btn.textContent = '❗'; setTimeout(() => { btn.textContent = '🌐'; }, 2000); })
        .finally(() => { btn.disabled = false; });
    }
  });

  /* ---------- Theme ---------- */
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

  /* ---------- Views ---------- */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      switchView(view);
      if (view === 'trends' && !trendsLoaded) { trendsLoaded = true; loadTrends(); }
      if (view === 'feed' && !feedLoaded) { feedLoaded = true; reloadFeeds(); }
    });
  });

  trendSelect.addEventListener('change', () => { trendsLoaded = true; loadTrends(); });
  channelBackBtn.addEventListener('click', () => switchView(lastTab));
  channelFollowBtn.addEventListener('click', () => {
    if (!currentChannelUser) return;
    addAndFetchUser(currentChannelUser);
    channelFollowBtn.textContent = '✓ Following';
    setTimeout(() => { channelFollowBtn.textContent = '➕ Follow'; }, 1500);
  });

  function switchView(view) {
    currentView = view;
    if (view === 'feed' || view === 'trends') lastTab = view;
    viewFeed.hidden = view !== 'feed';
    viewTrends.hidden = view !== 'trends';
    viewChannel.hidden = view !== 'channel';
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === lastTab));
  }

  refreshBtn.addEventListener('click', async () => {
    await withTimeout(probeInstance(), 20000).catch(() => {});
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

  /* ---------- Feeds ---------- */
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

  /* ---------- Channel view ---------- */
  async function openChannel(username) {
    const handle = (username || '').replace('@', '').trim();
    if (!handle) return;
    currentChannelUser = handle;
    channelMode = 'user';
    channelFollowBtn.style.display = '';
    switchView('channel');
    channelChip.textContent = '@' + handle;
    channelContainer.innerHTML = '<div class="loader">Loading @' + escapeHtml(handle) + '…</div>';
    try {
      const text = await smartFetch(`${NITTER_INSTANCE}/${handle}/rss`);
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      const avatar = xml.querySelector('channel > image > url')?.textContent.trim() || '';
      const items = xml.querySelectorAll('item');
      channelContainer.innerHTML = '';
      if (!items.length) { channelContainer.innerHTML = '<p class="empty-state">No posts found.</p>'; return; }
      items.forEach(item => channelContainer.appendChild(buildTweetCard(item, { username: handle, avatarUrl: avatar })));
    } catch (e) {
      channelContainer.innerHTML = '<div class="error">Couldn\'t load @' + escapeHtml(handle) + '. Nitter might be down.</div>';
    }
  }

  /* ---------- Search (multi-strategy) ---------- */
  async function openSearch(query) {
    if (!query) return;
    currentSearchQuery = query;
    channelMode = 'search';
    channelFollowBtn.style.display = 'none';
    switchView('channel');
    channelChip.textContent = '🔍 ' + query;
    channelContainer.innerHTML = '<div class="loader">Searching ' + escapeHtml(query) + '…</div>';

    const INSTANCES = [NITTER_INSTANCE, ...INSTANCE_LIST.filter(i => i !== NITTER_INSTANCE)];
    const q = encodeURIComponent(query);
    let fragments = [];
    let rssItems = [];
    let lastRaw = '';

    if (window.Android) {
      try {
        const raw = await nativeFetchPage(`${NITTER_INSTANCE}/search?f=tweets&q=${q}`);
        lastRaw = raw || '';
        fragments = lastRaw.split('\u0001').filter(Boolean);
      } catch (e) {}
    }

    if (!fragments.length) {
      for (const inst of INSTANCES) {
        try {
          const xmlText = await smartFetch(`${inst}/search/rss?f=tweets&q=${q}`);
          lastRaw = xmlText;
          const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
          const items = xml.querySelectorAll('item');
          if (items.length) { rssItems = Array.from(items); break; }
        } catch (e) { lastRaw = 'ERR: ' + e.message; }
      }
    }

    if (!fragments.length && !rssItems.length) {
      for (const inst of INSTANCES) {
        try {
          const html = await smartFetch(`${inst}/search?f=tweets&q=${q}`);
          lastRaw = html;
          const doc = new DOMParser().parseFromString(html, 'text/html');
          let nodes = doc.querySelectorAll('.timeline-item');
          if (!nodes.length) nodes = doc.querySelectorAll('.tweet-body');
          if (nodes.length) { fragments = Array.from(nodes).map(n => n.outerHTML); break; }
        } catch (e) {}
      }
    }

    channelContainer.innerHTML = '';
    if (rssItems.length) {
      rssItems.forEach(item => {
        const creatorNode = item.getElementsByTagName('dc:creator')[0] || item.getElementsByTagName('creator')[0];
        const handle = (creatorNode ? creatorNode.textContent : '').replace('@', '').trim() || 'unknown';
        channelContainer.appendChild(buildTweetCard(item, { username: handle }));
      });
    } else if (fragments.length) {
      fragments.forEach(frag => {
        const doc = new DOMParser().parseFromString(frag, 'text/html');
        const node = doc.body ? doc.body.firstElementChild : null;
        if (node) {
          const card = buildSearchCard(node);
          if (card) channelContainer.appendChild(card);
        }
      });
    }

    if (!channelContainer.children.length) {
      const snippet = (lastRaw || 'no response').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      channelContainer.innerHTML =
        '<p class="empty-state">No posts found for ' + escapeHtml(query) + '.</p>' +
        '<div class="error" style="text-align:left; font-size:11px; word-break:break-all;">DEBUG → ' + escapeHtml(snippet) + '</div>';
    }
  }

  function buildSearchCard(node) {
    const statusHref = (node.querySelector('a.tweet-link') || node.querySelector('a[href*="/status/"]'))?.getAttribute('href') || '';
    const mId = statusHref.match(/status\/(\d+)/);
    const tweetId = mId ? mId[1] : '';
    let username = (node.querySelector('.username')?.textContent || '').replace('@', '').trim();
    if (!username && statusHref) username = statusHref.split('/')[1] || 'unknown';
    if (!username) return null;
    const creator = '@' + username;

    const contentEl = node.querySelector('.tweet-content');
    const text = contentEl ? contentEl.textContent.trim() : '';
    if (!text && !tweetId) return null;

    const dateEl = node.querySelector('.tweet-date');
    const dateTitle = dateEl?.getAttribute('title') || dateEl?.textContent || '';

    let isVideo = !!node.querySelector('video, .gallery-video, .video-container');
    let imgSrc = '';
    const imgs = node.querySelectorAll('.attachments img');
    if (imgs.length) imgSrc = imgs[0].getAttribute('src') || '';
    if (imgSrc && imgSrc.startsWith('/')) imgSrc = NITTER_INSTANCE + imgSrc;

    let avatarUrl = node.querySelector('.tweet-avatar')?.getAttribute('src') || '';
    if (avatarUrl && avatarUrl.startsWith('/')) avatarUrl = NITTER_INSTANCE + avatarUrl;

    const card = document.createElement('div');
    card.className = 'tweet-card';
    card.setAttribute('data-user', username);

    const avatarHtml = avatarUrl ? `<img class="avatar" src="${escapeAttr(avatarUrl)}" alt="">` : fallbackAvatarHtml(creator);

    let mediaHtml = '';
    if (imgSrc) {
      mediaHtml = isVideo
        ? `<div class="media-container" data-tweet-id="${tweetId}" data-username="${username}">
             <img src="${imgSrc}" class="tweet-image" alt="Video thumbnail">
             <div class="play-btn-overlay">▶ Play Video</div>
           </div>`
        : `<img src="${imgSrc}" class="tweet-image" alt="Tweet image">`;
    }

    const xUrl = tweetId ? `https://x.com/${username}/status/${tweetId}` : '#';

    card.innerHTML = `
      <div class="tweet-header">
        <div class="tweet-user">${avatarHtml}<strong>${escapeHtml(creator)}</strong></div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="translate-btn" title="Translate to English">🌐</button>
          <span class="tweet-date" title="${escapeAttr(dateTitle)}">${escapeHtml(dateTitle)}</span>
        </div>
      </div>
      <div class="tweet-content"><p class="tweet-paragraph">${linkify(escapeHtml(text))}</p></div>
      ${mediaHtml}
      <a href="${xUrl}" target="_blank" class="tweet-link">View on X (Twitter) ↗</a>`;

    const av = card.querySelector('img.avatar');
    if (av) av.addEventListener('error', () => { av.outerHTML = fallbackAvatarHtml(creator); });
    card.querySelector('.tweet-user').addEventListener('click', () => openChannel(username));
    if (isVideo) {
      card.querySelector('.media-container')?.addEventListener('click', function () { handleVideoPlayback(this); });
    }
    return card;
  }

  /* ---------- Categories & Trending ---------- */
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
    const channels = [];
    popularSelect.querySelectorAll('optgroup').forEach(group => {
      const cat = categoryFromLabel(group.label);
      if (category && cat !== category) return;
      group.querySelectorAll('option').forEach(opt => {
        if (opt.value) channels.push({ handle: opt.value, cat });
      });
    });
    return channels;
  }

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
    loader.textContent = `Fetching ${CAT_LABEL[category]}… 0/${channels.length}`;
    trendContainer.appendChild(loader);

    const collected = [];
    let done = 0;

    await Promise.all(channels.map(async ch => {
      try {
        const text = await smartFetch(`${NITTER_INSTANCE}/${ch.handle}/rss`);
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        if (!xml.querySelector('parsererror')) {
          const avatar = xml.querySelector('channel > image > url')?.textContent.trim() || '';
          [...xml.querySelectorAll('item')].slice(0, 3).forEach(item => {
            collected.push({ item, username: ch.handle, avatarUrl: avatar, cat: ch.cat });
          });
        }
      } catch (e) {}
      done++;
      loader.textContent = `Fetching ${CAT_LABEL[category]}… ${done}/${channels.length}`;
    }));

    loader.remove();

    collected.sort((a, b) =>
      new Date(b.item.querySelector('pubDate')?.textContent || 0) -
      new Date(a.item.querySelector('pubDate')?.textContent || 0));

    if (!collected.length) {
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = 'Couldn\'t fetch any channel in this category. Nitter might be down.';
      trendContainer.appendChild(err);
      return;
    }

    collected.forEach(c => trendContainer.appendChild(buildTweetCard(c.item, c)));
    header.innerHTML = `🔥 ${CAT_LABEL[category]} — latest from ${channels.length} channels <span class="trend-updated">· updated ${new Date().toLocaleTimeString()}</span>`;
  }

  /* ---------- Card builder ---------- */
  function buildTweetCard(item, { username, avatarUrl = '', cat = '' }) {
    const title = item.querySelector('title')?.textContent || '';
    const creatorNode = item.getElementsByTagName('dc:creator')[0] || item.getElementsByTagName('creator')[0];
    const creator = creatorNode ? creatorNode.textContent : `@${username}`;
    const description = item.querySelector('description')?.textContent || '';
    const pubDate = item.querySelector('pubDate')?.textContent || '';
    const link = item.querySelector('link')?.textContent || '#';
    const tweetId = item.querySelector('guid')?.textContent || '';

    let xUrl = link;
    try {
      const u = new URL(link);
      xUrl = 'https://x.com' + u.pathname;
    } catch (e) {}

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
      : `<p class="tweet-paragraph">${linkify(escapeHtml(title))}</p>`;

    const avatarHtml = avatarUrl
      ? `<img class="avatar" src="${escapeAttr(avatarUrl)}" alt="">`
      : fallbackAvatarHtml(creator);

    const chip = cat ? `<span class="cat-chip" title="${CAT_LABEL[cat] || ''}">${CAT_EMOJI[cat] || '📰'}</span>` : '';
    const removeBtn = `<button class="remove-btn" data-user="${username}" title="Remove ${username}">❌</button>`;
    const translateBtn = `<button class="translate-btn" title="Translate to English">🌐</button>`;

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
        <div style="display:flex; align-items:center; gap:6px;">
          ${translateBtn}
          ${removeBtn}
          <span class="tweet-date" title="${new Date(pubDate).toLocaleString()}">${getRelativeTime(pubDate)}</span>
        </div>
      </div>
      <div class="tweet-content">${contentHtml}</div>
      ${mediaHtml}
      <a href="${xUrl}" target="_blank" class="tweet-link">View on X (Twitter) ↗</a>`;

    card.querySelector('.tweet-user').addEventListener('click', () => openChannel(username));

    const av = card.querySelector('img.avatar');
    if (av) av.addEventListener('error', () => { av.outerHTML = fallbackAvatarHtml(creator); });

    if (isVideo) {
      card.querySelector('.media-container').addEventListener('click', function () { handleVideoPlayback(this); });
    }
    return card;
  }

  /* ---------- Text helpers ---------- */
  function linkify(escapedText) {
    return escapedText.replace(/[#@][A-Za-z0-9_]+/g, (m) => {
      if (m.startsWith('#')) {
        return `<a href="#" class="tweet-inline-link in-app-search" data-query="${escapeAttr(m)}">${m}</a>`;
      }
      return `<a href="#" class="tweet-inline-link in-app-user" data-user="${escapeAttr(m.slice(1))}">${m}</a>`;
    });
  }

  function richTextHtml(node) {
    let out = '';
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) out += linkify(escapeHtml(child.textContent));
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') out += '<br>';
        else if (tag === 'a') {
          const rawHref = child.getAttribute('href') || '#';
          const inner = richTextHtml(child);
          let path = null;
          if (rawHref.startsWith('/')) {
            path = rawHref;
          } else {
            try {
              const u = new URL(rawHref);
              const niHost = new URL(NITTER_INSTANCE).host;
              if (u.host === niHost || u.host.endsWith('.' + niHost)) path = u.pathname + u.search;
            } catch (e) {}
          }
          if (path && path.includes('/search?q=')) {
            let q = '';
            try { q = decodeURIComponent(path.split('/search?q=')[1].split('&')[0]); } catch (e) {}
            out += `<a href="#" class="tweet-inline-link in-app-search" data-query="${escapeAttr(q)}">${inner}</a>`;
          } else if (path && path.startsWith('/hashtag/')) {
            const q = '#' + decodeURIComponent(path.replace('/hashtag/', '').split('?')[0]);
            out += `<a href="#" class="tweet-inline-link in-app-search" data-query="${escapeAttr(q)}">${inner}</a>`;
          } else if (path && /^\/[A-Za-z0-9_]+\/?$/.test(path)) {
            out += `<a href="#" class="tweet-inline-link in-app-user" data-user="${escapeAttr(path.replace(/\//g, ''))}">${inner}</a>`;
          } else if (path) {
            out += `<a href="https://x.com${path.split('?')[0]}" target="_blank" class="tweet-inline-link">${inner}</a>`;
          } else {
            out += `<a href="${escapeAttr(rawHref)}" target="_blank" class="tweet-inline-link">${inner}</a>`;
          }
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

  /* ---------- Translation (Google free + Lingva fallback) ---------- */
  async function translateContent(contentEl) {
    const paragraphs = contentEl.querySelectorAll('.tweet-paragraph');
    if (!paragraphs.length) return;
    const results = await Promise.all(
      Array.from(paragraphs).map(async p => {
        const originalHtml = p.innerHTML;
        const plainText = p.textContent.trim();
        if (!plainText) return originalHtml;
        try {
          return `<span class="translated-tag">EN</span> ${escapeHtml(await translateText(plainText))}`;
        } catch (e) {
          return originalHtml;
        }
      })
    );
    contentEl.innerHTML = results.map(h => `<p class="tweet-paragraph">${h}</p>`).join('');
  }

  async function translateText(text) {
    const MAX = 500;
    if (text.length <= MAX) return await translateChunk(text);
    const chunks = [];
    let remaining = text;
    while (remaining.length > MAX) {
      let cut = remaining.lastIndexOf('.', MAX);
      if (cut < MAX * 0.5) cut = remaining.lastIndexOf('!', MAX);
      if (cut < MAX * 0.5) cut = remaining.lastIndexOf('?', MAX);
      if (cut < MAX * 0.5) cut = MAX;
      chunks.push(remaining.slice(0, cut + 1));
      remaining = remaining.slice(cut + 1).trimStart();
    }
    if (remaining) chunks.push(remaining);
    const out = [];
    for (const c of chunks) out.push(await translateChunk(c));
    return out.join(' ');
  }

  async function translateChunk(text) {
    try {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dj=1&q=' + encodeURIComponent(text);
      const data = JSON.parse(await smartFetch(url));
      if (data && Array.isArray(data.sentences)) {
        const out = data.sentences.map(s => s.trans || '').join('');
        if (out.trim()) return out;
      }
    } catch (e) {}
    try {
      const data = JSON.parse(await smartFetch('https://lingva.ml/api/v1/auto/en/' + encodeURIComponent(text)));
      if (data && data.translation) return data.translation;
    } catch (e) {}
    throw new Error('translation failed');
  }

  /* ---------- Video ---------- */
  async function handleVideoPlayback(container) {
    const tid = container.getAttribute('data-tweet-id');
    const uname = container.getAttribute('data-username');
    const overlay = container.querySelector('.play-btn-overlay');
    const poster = container.querySelector('img')?.src || '';
    const fallbackUrl = `${NITTER_INSTANCE}/${uname}/status/${tid}`;

    if (overlay) { overlay.textContent = 'Loading video...'; overlay.style.fontSize = '12px'; }

    try {
      let candidates = [];
      try {
        const rawHtml = await smartFetch(fallbackUrl);
        const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
        candidates = await collectVideoCandidates(doc, rawHtml);
      } catch (e) {}

      if (!candidates.length) {
        try {
          const fx = JSON.parse(await smartFetch(`https://api.fxtwitter.com/${uname}/status/${tid}`));
          collectMp4s(fx).forEach(u => pushUnique(candidates, u));
        } catch (e) {}
      }

      if (!candidates.length) {
        try {
          const vx = JSON.parse(await smartFetch(`https://api.vxtwitter.com/${uname}/status/${tid}`));
          if (vx.videoURL) pushUnique(candidates, vx.videoURL);
          collectMp4s(vx).forEach(u => pushUnique(candidates, u));
        } catch (e) {}
      }

      for (const m3u8 of candidates.filter(c => c.includes('.m3u8'))) {
        const mp4 = await extractMp4FromPlaylist(m3u8);
        if (mp4) pushUnique(candidates, mp4);
      }

      candidates.sort((a, b) => (a.includes('.mp4') ? -1 : 1) - (b.includes('.mp4') ? -1 : 1));

      if (candidates.length) injectVideoPlayer(container, candidates, poster, fallbackUrl);
      else showFallback(container, fallbackUrl, '🎬 Video not found. Click to open on Nitter.');
    } catch (err) {
      showFallback(container, fallbackUrl, '🎬 Error loading video. Click to open on Nitter.');
    }
  }

  function pushUnique(arr, u) {
    if (u && u.startsWith('http') && !arr.includes(u)) arr.push(u);
  }

  function collectMp4s(obj, out = []) {
    if (typeof obj === 'string') {
      if (obj.startsWith('http') && obj.includes('.mp4')) out.push(obj);
      return out;
    }
    if (Array.isArray(obj)) { obj.forEach(v => collectMp4s(v, out)); return out; }
    if (obj && typeof obj === 'object') Object.values(obj).forEach(v => collectMp4s(v, out));
    return out;
  }

  async function collectVideoCandidates(doc, rawHtml) {
    const candidates = [];
    const pushRaw = raw => {
      if (!raw) return;
      const dec = decodeNitterProxyUrl(raw);
      if (dec && (dec.includes('.mp4') || dec.includes('.m3u8'))) pushUnique(candidates, dec);
      if (raw.startsWith('http') && (raw.includes('.mp4') || raw.includes('.m3u8') || raw.includes('video.twimg'))) pushUnique(candidates, raw);
      if (raw.startsWith('/') && (raw.includes('.mp4') || raw.includes('.m3u8') || raw.includes('/video/') || raw.includes('/vid/'))) pushUnique(candidates, NITTER_INSTANCE + raw);
    };
    doc.querySelectorAll('video source[src], video[src], video[data-url], a.video-download[href], a[href*="ext_tw_video"]').forEach(el => {
      pushRaw(el.getAttribute('src') || el.getAttribute('data-url') || el.getAttribute('href'));
    });
    const urlRegex = /https?:\/\/[^"'\s<>]+?(?:video\.twimg\.com|ext_tw_video)[^"'\s<>]*/g;
    (rawHtml.match(urlRegex) || []).forEach(m => pushRaw(m.replace(/[.,;:]+$/, '')));
    return candidates;
  }

  function decodeNitterProxyUrl(raw) {
    if (!raw) return null;
    let m = raw.match(/\/(?:video|vid)\/enc\/[^\/]+\/([^?#]+)/);
    if (m) {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      try { return atob(b64); } catch (e) {}
    }
    m = raw.match(/\/(?:video|vid)\/[^\/]+\/([^?#]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    m = raw.match(/\/vid\/([^?#]+)/);
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
    video.style.cssText = 'max-width:100%; border-radius:12px; display:block; background:black;';
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

  /* ---------- STARTUP ---------- */
  switchView('trends');
  trendsLoaded = true;
  trendContainer.innerHTML = '<div class="loader">Finding a live Nitter instance…</div>';
  withTimeout(probeInstance(), 20000).catch(() => {}).finally(() => {
    loadTrends();
  });
});
