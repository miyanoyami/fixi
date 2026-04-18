'use strict';

// ============================================================
// CONFIG
// ============================================================

let config = {};
let baseDate = null;
let decryptKey = null; // AES-GCM key — null if not built (plaintext mode)

async function loadConfig() {
  const res = await fetch('config.json');
  config = await res.json();

  // Apply theme
  document.documentElement.dataset.theme = config.theme || 'dark';

  // Apply site name
  document.title = config.siteName || 'SNS';
  document.getElementById('site-name').textContent = config.siteName || 'SNS';

  // Derive decryption key if buildDate is present (built mode)
  if (config.buildDate) {
    decryptKey = await deriveKey(config.siteName || '');
  }

  // Resolve baseDate
  const bd = config.baseDate || 'relative';
  if (bd.startsWith('fixed:')) {
    baseDate = new Date(bd.slice(6));
  } else {
    baseDate = new Date();
  }
}

// ============================================================
// DATA
// ============================================================

// ============================================================
// CRYPTO (AES-GCM — used only in built/dist mode)
// ============================================================

async function deriveKey(siteName) {
  const enc  = new TextEncoder();
  const ikm  = enc.encode(siteName);
  const salt = enc.encode('fixi-salt-v1');
  const info = enc.encode('fixi-aes-gcm');
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function decryptText(key, b64) {
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv  = buf.slice(0, 12);
  const ct  = buf.slice(12);
  const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function decryptUser(user) {
  if (!decryptKey) return user;
  if (user.bio) user.bio = await decryptText(decryptKey, user.bio);
  for (const post of (user.posts || [])) {
    if (post.body) post.body = await decryptText(decryptKey, post.body);
  }
  return user;
}

// ============================================================
// DATA
// ============================================================

const userCache = {}; // key -> user object

async function loadAllUsers() {
  const res = await fetch('data/index.json');
  const index = await res.json();
  await Promise.all(index.users.map(key => loadUser(key)));
}

async function loadUser(key) {
  if (userCache[key]) return userCache[key];
  try {
    const res = await fetch(`data/${key}/user.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const user = await decryptUser(await res.json());
    userCache[key] = user;
    return user;
  } catch (e) {
    // Ghost user: referenced but missing
    userCache[key] = { key, name: '削除済みユーザー', bio: '', avatar: null, following: [], followers: [], posts: [] };
    return userCache[key];
  }
}

function getAllPosts() {
  return Object.values(userCache).flatMap(u => u.posts.map(p => ({ ...p, _user: u })));
}

// ============================================================
// DATE UTILS
// ============================================================

function resolveDate(offset) {
  return new Date(baseDate.getTime() + offset * 1000);
}

function formatRelative(date) {
  // baseDateを「今」として相対表示する（ARG世界観の時間軸）
  const diff = Math.floor((baseDate - date) / 1000);
  if (diff < 0) return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

function formatAbsolute(date) {
  return date.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// RENDER HELPERS
// ============================================================

const AVATAR_COLORS = ['#4a90d9','#e06c75','#56b6c2','#98c379','#e5c07b','#c678dd','#d19a66','#61afef'];

function avatarFallbackSvg(key) {
  const color = AVATAR_COLORS[
    key.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <rect width="40" height="40" rx="20" fill="${color}"/>
    <circle cx="20" cy="15" r="7" fill="rgba(255,255,255,0.85)"/>
    <ellipse cx="20" cy="35" rx="12" ry="9" fill="rgba(255,255,255,0.85)"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function applyAvatarFallback(img, user) {
  img.onerror = () => { img.src = avatarFallbackSvg(user.key); img.onerror = null; };
}

function avatarEl(user) {
  const el = document.createElement('div');
  el.className = 'avatar';
  const img = document.createElement('img');
  img.src = `data/${user.key}/icon.png`;
  img.alt = user.name;
  img.loading = 'lazy';
  applyAvatarFallback(img, user);
  el.appendChild(img);
  return el;
}

function renderPostCard(post, users) {
  const user = post._user || userCache[post.id?.split('_')[0]] || { key: '?', name: '不明', key: '?', avatar: null };
  const date = resolveDate(post.offset);

  const card = document.createElement('div');
  card.className = 'post-card';
  card.dataset.postId = post.id;

  // Avatar
  const av = avatarEl(user);
  av.addEventListener('click', (e) => {
    e.stopPropagation();
    navigate(`#user/${user.key}`);
  });
  card.appendChild(av);

  // Body column
  const body = document.createElement('div');
  body.className = 'post-body';

  // Meta row
  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const dn = document.createElement('span');
  dn.className = 'display-name';
  dn.textContent = user.name;
  const sn = document.createElement('span');
  sn.className = 'screen-name';
  sn.textContent = `@${user.key}`;
  const time = document.createElement('span');
  time.className = 'post-time';
  time.title = formatAbsolute(date);
  time.textContent = formatRelative(date);
  meta.append(dn, sn, time);
  body.appendChild(meta);

  // Reply label
  if (post.replyTo) {
    const replyUser = findPostUser(post.replyTo);
    const replyPost = getAllPosts().find(p => p.id === post.replyTo);
    const replyLabel = document.createElement('div');
    replyLabel.className = 'post-reply-label';
    const snippet = replyPost ? `「${replyPost.body.slice(0, 20)}${replyPost.body.length > 20 ? '…' : ''}」` : '';
    replyLabel.innerHTML = `<a href="#post/${post.replyTo}">@${replyUser?.key || '不明'} ${snippet}</a> への返信`;
    body.appendChild(replyLabel);
  }

  // Text
  const text = document.createElement('p');
  text.className = 'post-text';
  text.textContent = post.body;
  body.appendChild(text);

  // Media
  if (post.media) {
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'post-media';
    const isVideo = /\.(mp4|mov|webm|ogg)$/i.test(post.media);
    if (isVideo) {
      const video = document.createElement('video');
      video.src = `data/${user.key}/${post.media}`;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      mediaWrap.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = `data/${user.key}/${post.media}`;
      img.alt = '';
      img.loading = 'lazy';
      mediaWrap.appendChild(img);
    }
    body.appendChild(mediaWrap);
  }

  card.appendChild(body);

  // Click to thread
  card.addEventListener('click', () => navigate(`#post/${post.id}`));

  return card;
}

function findPostUser(postId) {
  const key = postId.split('_').slice(0, -1).join('_');
  return userCache[key] || null;
}

function renderProfileHeader(user) {
  const wrap = document.getElementById('profile-header');
  wrap.innerHTML = '';

  const banner = document.createElement('div');
  banner.className = 'profile-banner';

  const info = document.createElement('div');
  info.className = 'profile-info';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'profile-avatar-wrap';

  const av = document.createElement('div');
  av.className = 'profile-avatar';
  const avImg = document.createElement('img');
  avImg.src = `data/${user.key}/icon.png`;
  avImg.alt = user.name;
  applyAvatarFallback(avImg, user);
  av.appendChild(avImg);
  avatarWrap.appendChild(av);

  const dn = document.createElement('div');
  dn.className = 'profile-display-name';
  dn.textContent = user.name;

  const sn = document.createElement('div');
  sn.className = 'profile-screen-name';
  sn.textContent = `@${user.key}`;

  const bio = document.createElement('div');
  bio.className = 'profile-bio';
  bio.textContent = user.bio || '';

  const stats = document.createElement('div');
  stats.className = 'profile-stats';

  const followingCount = user.following?.length || 0;
  const followersCount = user.followers?.length || 0;

  stats.innerHTML = `
    <span class="stat"><span class="stat-num">${followingCount}</span><span class="stat-label">フォロー中</span></span>
    <span class="stat"><span class="stat-num">${followersCount}</span><span class="stat-label">フォロワー</span></span>
  `;

  info.append(avatarWrap, dn, sn, bio, stats);
  wrap.append(banner, info);
}

function renderUserCard(user) {
  const card = document.createElement('div');
  card.className = 'user-card';
  card.appendChild(avatarEl(user));

  const info = document.createElement('div');
  info.className = 'user-card-info';
  info.innerHTML = `
    <div class="display-name">${escapeHtml(user.name)}</div>
    <div class="screen-name">@${escapeHtml(user.key)}</div>
    ${user.bio ? `<div class="bio-snippet">${escapeHtml(user.bio)}</div>` : ''}
  `;
  card.appendChild(info);
  card.addEventListener('click', () => navigate(`#user/${user.key}`));
  return card;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// VIEWS
// ============================================================

const VIEWS = ['timeline', 'profile', 'thread', 'search', 'loading', 'error'];

function showView(name) {
  for (const v of VIEWS) {
    const el = document.getElementById(`view-${v}`);
    if (el) el.hidden = (v !== name);
  }
}

const TIMELINE_PAGE_SIZE = 20;
let timelinePosts = [];
let timelineOffset = 0;
let timelineObserver = null;

let timelineLoading = false;

function loadMoreTimeline() {
  if (timelineLoading) return;
  const list = document.getElementById('timeline-list');
  const page = timelinePosts.slice(timelineOffset, timelineOffset + TIMELINE_PAGE_SIZE);
  if (page.length === 0) return;

  timelineLoading = true;

  // 既存センチネルを一旦除去
  const oldSentinel = document.getElementById('timeline-sentinel');
  if (oldSentinel) oldSentinel.remove();

  // ローディングインジケーターを表示
  const loader = document.createElement('div');
  loader.className = 'timeline-loader';
  loader.innerHTML = '<div class="spinner"></div>';
  list.appendChild(loader);

  setTimeout(() => {
    loader.remove();

    const frag = document.createDocumentFragment();
    for (const post of page) frag.appendChild(renderPostCard(post));
    list.appendChild(frag);
    timelineOffset += page.length;
    timelineLoading = false;

    if (timelineOffset < timelinePosts.length) {
      // 次のページがあればセンチネルを追加して監視
      const sentinel = document.createElement('div');
      sentinel.id = 'timeline-sentinel';
      list.appendChild(sentinel);
      if (timelineObserver) timelineObserver.observe(sentinel);
    }
  }, 500);
}

async function showTimeline() {
  showView('timeline');
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';
  timelinePosts = getAllPosts()
    .filter(p => !p.replyTo)
    .sort((a, b) => b.offset - a.offset)
    .slice(0, 100);
  timelineOffset = 0;
  timelineLoading = false;

  if (timelineObserver) { timelineObserver.disconnect(); }

  // Observerを先に作成しておく（センチネルはloadMoreTimeline内で追加・observe）
  timelineObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMoreTimeline();
  }, { rootMargin: '200px' });

  loadMoreTimeline();
}

async function showProfile(key) {
  await loadUser(key);
  const user = userCache[key];
  if (!user) { showError('ユーザーが見つかりません'); return; }

  showView('profile');
  renderProfileHeader(user);

  const list = document.getElementById('profile-posts');
  list.innerHTML = '';
  const posts = [...user.posts].sort((a, b) => b.offset - a.offset).map(p => ({ ...p, _user: user }));
  const frag = document.createDocumentFragment();
  for (const post of posts) frag.appendChild(renderPostCard(post));
  list.appendChild(frag);
}

async function showThread(postId) {
  const allPosts = getAllPosts();
  const root = allPosts.find(p => p.id === postId);
  if (!root) { showError('投稿が見つかりません'); return; }

  showView('thread');

  const rootList = document.getElementById('thread-root');
  rootList.innerHTML = '';
  rootList.appendChild(renderPostCard(root));

  const repliesList = document.getElementById('thread-replies');
  repliesList.innerHTML = '';
  const replies = allPosts
    .filter(p => p.replyTo === postId)
    .sort((a, b) => b.offset - a.offset);
  const frag = document.createDocumentFragment();
  for (const p of replies) frag.appendChild(renderPostCard(p));
  repliesList.appendChild(frag);
}

const SEARCH_PAGE_SIZE = 20;
let searchUserItems = [];
let searchPostItems = [];
let searchUserOffset = 0;
let searchPostOffset = 0;
let searchUserObserver = null;
let searchPostObserver = null;

function loadMoreSearchUsers() {
  const list = document.getElementById('search-user-results');
  const page = searchUserItems.slice(searchUserOffset, searchUserOffset + SEARCH_PAGE_SIZE);
  if (page.length === 0) return;
  const oldSentinel = document.getElementById('search-user-sentinel');
  if (oldSentinel) oldSentinel.remove();
  const frag = document.createDocumentFragment();
  for (const u of page) frag.appendChild(renderUserCard(u));
  list.appendChild(frag);
  searchUserOffset += page.length;
  if (searchUserOffset < searchUserItems.length) {
    const sentinel = document.createElement('div');
    sentinel.id = 'search-user-sentinel';
    list.appendChild(sentinel);
    if (searchUserObserver) searchUserObserver.observe(sentinel);
  }
}

function loadMoreSearchPosts() {
  const list = document.getElementById('search-post-results');
  const page = searchPostItems.slice(searchPostOffset, searchPostOffset + SEARCH_PAGE_SIZE);
  if (page.length === 0) return;
  const oldSentinel = document.getElementById('search-post-sentinel');
  if (oldSentinel) oldSentinel.remove();
  const frag = document.createDocumentFragment();
  for (const p of page) frag.appendChild(renderPostCard(p));
  list.appendChild(frag);
  searchPostOffset += page.length;
  if (searchPostOffset < searchPostItems.length) {
    const sentinel = document.createElement('div');
    sentinel.id = 'search-post-sentinel';
    list.appendChild(sentinel);
    if (searchPostObserver) searchPostObserver.observe(sentinel);
  }
}

function showSearch(query) {
  showView('search');
  document.getElementById('search-results-title').textContent = `「${query}」の検索結果`;

  const q = query.toLowerCase();

  // User search
  searchUserItems = Object.values(userCache).filter(u =>
    u.name.toLowerCase().includes(q) ||
    u.key.toLowerCase().includes(q) ||
    (u.bio || '').toLowerCase().includes(q)
  );
  searchUserOffset = 0;
  const userList = document.getElementById('search-user-results');
  userList.innerHTML = '';
  document.getElementById('search-user-empty').hidden = searchUserItems.length > 0;
  if (searchUserObserver) searchUserObserver.disconnect();
  searchUserObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadMoreSearchUsers();
  }, { rootMargin: '200px' });
  loadMoreSearchUsers();

  // Post search
  searchPostItems = getAllPosts()
    .filter(p => p.body.toLowerCase().includes(q))
    .sort((a, b) => b.offset - a.offset);
  searchPostOffset = 0;
  const postList = document.getElementById('search-post-results');
  postList.innerHTML = '';
  document.getElementById('search-post-empty').hidden = searchPostItems.length > 0;
  if (searchPostObserver) searchPostObserver.disconnect();
  searchPostObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadMoreSearchPosts();
  }, { rootMargin: '200px' });
  loadMoreSearchPosts();

  // Tab switching
  const tabs = document.querySelectorAll('.search-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isUsers = tab.dataset.tab === 'users';
      document.getElementById('search-tab-users').hidden = !isUsers;
      document.getElementById('search-tab-posts').hidden = isUsers;
    };
  });
  // Reset to users tab
  tabs[0].classList.add('active');
  tabs[1].classList.remove('active');
  document.getElementById('search-tab-users').hidden = false;
  document.getElementById('search-tab-posts').hidden = true;
}

function showError(msg) {
  showView('error');
  document.getElementById('error-msg').textContent = msg || 'エラーが発生しました';
}

// ============================================================
// ROUTER (hash-based)
// ============================================================

function navigate(hash) {
  location.hash = hash;
}

async function handleRoute() {
  const hash = location.hash || '#timeline';

  if (hash === '#timeline' || hash === '') {
    await showTimeline();
    return;
  }

  const userMatch = hash.match(/^#user\/(.+)$/);
  if (userMatch) {
    await showProfile(decodeURIComponent(userMatch[1]));
    return;
  }

  const postMatch = hash.match(/^#post\/(.+)$/);
  if (postMatch) {
    await showThread(decodeURIComponent(postMatch[1]));
    return;
  }

  const searchMatch = hash.match(/^#search\?q=(.+)$/);
  if (searchMatch) {
    showSearch(decodeURIComponent(searchMatch[1]));
    return;
  }

  await showTimeline();
}

// ============================================================
// SEARCH UI
// ============================================================

function initSearch() {
  const toggleBtn = document.getElementById('search-toggle-btn');
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');

  toggleBtn.addEventListener('click', () => {
    searchBar.hidden = !searchBar.hidden;
    if (!searchBar.hidden) searchInput.focus();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      if (q) navigate(`#search?q=${encodeURIComponent(q)}`);
    }
    if (e.key === 'Escape') {
      searchBar.hidden = true;
      searchInput.value = '';
    }
  });
}

// ============================================================
// INIT
// ============================================================

async function init() {
  showView('loading');
  try {
    await loadConfig();
    await loadAllUsers();
    initSearch();
    window.addEventListener('hashchange', handleRoute);
    await handleRoute();
  } catch (e) {
    console.error(e);
    showError('データの読み込みに失敗しました');
  }
}

init();
