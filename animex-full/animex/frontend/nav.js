// ─── ANIMEX NAV + SHARED UTILS ───

function injectNav(active = '') {
  const html = `
  <div class="orb-field">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
  </div>
  <nav class="nav-float" id="navFloat">
    <a href="home.html" class="nav-logo">ANIME<span>X</span></a>
    <div class="nav-links">

      <div class="nav-item">
        <button class="nav-link">Genres <i class="fa-solid fa-chevron-down" style="font-size:9px"></i></button>
        <div class="nav-dropdown mega">
          ${['Action','Adventure','Avant Garde','Boys Love','Comedy','Demons','Drama','Ecchi','Fantasy','Girls Love','Gourmet','Harem','Horror','Isekai','Iyashikei','Josei','Kids','Magic','Mahou Shoujo','Martial Arts','Mecha','Military','Music','Mystery','Parody','Psychological','Reverse Harem','Romance','School','Sci-Fi','Seinen','Shoujo','Shounen','Slice of Life','Space','Sports','Super Power','Supernatural','Suspense','Thriller','Vampire']
            .map(g=>`<a class="dropdown-link" href="browse.html?genre=${encodeURIComponent(g)}">${g}</a>`).join('')}
        </div>
      </div>

      <div class="nav-item">
        <button class="nav-link">Types <i class="fa-solid fa-chevron-down" style="font-size:9px"></i></button>
        <div class="nav-dropdown" style="min-width:150px">
          <a class="dropdown-link type-link" href="browse.html?type=movie">Movies</a>
          <a class="dropdown-link type-link" href="browse.html?type=tv">TV Series</a>
          <a class="dropdown-link type-link" href="browse.html?type=ova">OVAs</a>
          <a class="dropdown-link type-link" href="browse.html?type=ona">ONAs</a>
          <a class="dropdown-link type-link" href="browse.html?type=special">Specials</a>
        </div>
      </div>

      <div class="nav-item">
        <a class="nav-link${active==='new'?' active':''}" href="browse.html?filter=new">New Releases</a>
      </div>
      <div class="nav-item">
        <a class="nav-link${active==='ongoing'?' active':''}" href="browse.html?filter=ongoing">Ongoing</a>
      </div>
      <div class="nav-item">
        <a class="nav-link${active==='schedule'?' active':''}" href="browse.html?filter=schedule">Schedule</a>
      </div>
    </div>

    <div class="nav-right">
      <div class="nav-search" id="navSearch">
        <i class="fa-solid fa-magnifying-glass nav-search-static-icon"></i>
        <input type="text" class="nav-search-input" id="navSearchInput"
          placeholder="Search anime..." autocomplete="off">
        <div class="search-suggestions" id="searchSuggestions"></div>
      </div>
      <div class="lang-toggle">
        <button class="lang-btn active" id="langEn">EN</button>
        <button class="lang-btn" id="langJp">JP</button>
      </div>
      <div class="nav-item" id="navUserMenu">
        <!-- injected by initAuthNav() -->
      </div>
      <a class="nav-icon" href="#" id="shuffleBtn" title="Random"><i class="fa-solid fa-shuffle"></i></a>
    </div>
  </nav>`;

  document.body.insertAdjacentHTML('afterbegin', html);
  initNav();
  initScrollHide();
  initAuthNav();
}

function initNav() {
  const input = document.getElementById('navSearchInput');
  const suggs = document.getElementById('searchSuggestions');
  let searchTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) { suggs.classList.remove('open'); return; }
    searchTimer = setTimeout(async () => {
      const d = await gqlFetch(
        `query($s:String){Page(perPage:8){media(search:$s,type:ANIME,isAdult:false){id title{english romaji}coverImage{medium}format averageScore status startDate{year}}}}`,
        {s:q}
      );
      const list = d?.data?.Page?.media || [];
      if (!list.length) { suggs.classList.remove('open'); return; }
      suggs.innerHTML = list.map(a => {
        const t = a.title.english || a.title.romaji;
        const sc = a.averageScore ? (a.averageScore/10).toFixed(1) : '';
        return `<a href="anime.html?id=${a.id}" class="sugg-item">
          <img class="sugg-thumb" src="${a.coverImage?.medium||''}" alt="${t}" loading="lazy">
          <div>
            <div class="sugg-title">${t}</div>
            <div class="sugg-meta">${a.format||''} ${sc?'· ★'+sc:''} ${a.startDate?.year?'· '+a.startDate.year:''}</div>
          </div>
        </a>`;
      }).join('');
      suggs.classList.add('open');
    }, 220);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      suggs.classList.remove('open');
      window.location.href = `browse.html?search=${encodeURIComponent(input.value.trim())}`;
    }
    if (e.key === 'Escape') { suggs.classList.remove('open'); input.blur(); }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#navSearch')) suggs.classList.remove('open');
  });

  const shuffleIds = [21,11061,9253,20,1535,16498,22319,101922,1,5,6,74,889,97940,113415];
  document.getElementById('shuffleBtn')?.addEventListener('click', e => {
    e.preventDefault();
    window.location.href = `anime.html?id=${shuffleIds[Math.floor(Math.random()*shuffleIds.length)]}`;
  });

  document.getElementById('langEn')?.addEventListener('click', () => {
    document.getElementById('langEn').classList.add('active');
    document.getElementById('langJp').classList.remove('active');
  });
  document.getElementById('langJp')?.addEventListener('click', () => {
    document.getElementById('langJp').classList.add('active');
    document.getElementById('langEn').classList.remove('active');
  });
}

function initScrollHide() {
  let lastY = 0, ticking = false;
  const nav = document.getElementById('navFloat');
  if (!nav) return;
  nav.style.transition = 'transform .35s cubic-bezier(.4,0,.2,1), opacity .35s ease';
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > 100) {
          if (y > lastY) {
            nav.style.transform = 'translateX(-50%) translateY(calc(-100% - 24px))';
            nav.style.opacity = '0';
          } else {
            nav.style.transform = 'translateX(-50%) translateY(0)';
            nav.style.opacity = '1';
          }
        } else {
          nav.style.transform = 'translateX(-50%) translateY(0)';
          nav.style.opacity = '1';
        }
        lastY = y;
        ticking = false;
      });
      ticking = true;
    }
  });
}

function gqlFetch(query, variables = {}) {
  return fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  }).then(r => r.json()).catch(() => null);
}

function buildCard(a) {
  const t = a.title?.english || a.title?.romaji || 'Unknown';
  const sc = a.averageScore ? (a.averageScore/10).toFixed(1) : null;
  const subN = Math.floor(Math.random()*12)+1;
  const dubN = Math.random() > 0.45 ? Math.floor(Math.random()*10)+1 : null;
  return `<a href="anime.html?id=${a.id}" class="anime-card">
    <div class="card-poster">
      <img src="${a.coverImage?.large||a.coverImage?.medium||''}" alt="${t}" loading="lazy">
      ${sc?`<div class="card-score">★ ${sc}</div>`:''}
      <div class="card-type">${a.format||'TV'}</div>
    </div>
    <div class="card-body">
      <div class="card-title">${t}</div>
      <div class="card-meta">
        <span class="card-sub">CC ${subN}</span>
        ${dubN?`<span class="card-dub">DUB ${dubN}</span>`:''}
        <span>${a.startDate?.year||''}</span>
      </div>
    </div>
  </a>`;
}

function skelCards(n) {
  return Array(n).fill(0).map(()=>`
    <div class="anime-card" style="pointer-events:none">
      <div class="card-poster shimmer" style="aspect-ratio:2/3"></div>
      <div class="card-body">
        <div class="shimmer" style="height:13px;border-radius:4px;margin-bottom:6px"></div>
        <div class="shimmer" style="height:11px;width:55%;border-radius:4px"></div>
      </div>
    </div>`).join('');
}

function buildFooter() {
  return `<footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-top">
        <div>
          <div class="footer-logo">ANIMEX</div>
          <div class="footer-desc">Your personal anime streaming destination. Thousands of titles, updated daily.</div>
        </div>
        <div class="footer-links-group">
          <h4>Browse</h4>
          <a href="browse.html?filter=new">New Releases</a>
          <a href="browse.html?filter=ongoing">Ongoing</a>
          <a href="browse.html?type=movie">Movies</a>
          <a href="browse.html">All Anime</a>
        </div>
        <div class="footer-links-group">
          <h4>Account</h4>
          <a href="profile.html">Profile</a>
          <a href="watchlist.html">Watchlist</a>
          <a href="history.html">History</a>
          <a href="settings.html">Settings</a>
        </div>
        <div class="footer-links-group">
          <h4>Info</h4>
          <a href="about.html">About</a>
          <a href="contact.html">Contact</a>
          <a href="dmca.html">DMCA</a>
          <a href="privacy.html">Privacy</a>
        </div>
      </div>
      <div class="footer-bottom">
        <div class="footer-note">© 2025 ANIMEX · Personal use only · Powered by AniList</div>
        <div class="footer-note">All anime data provided by AniList API</div>
      </div>
    </div>
  </footer>`;
}

// ─── AUTH-AWARE NAV USER MENU ────────────────────────────────────────────
function initAuthNav() {
  const wrap = document.getElementById('navUserMenu');
  if (!wrap) return;
  const token = localStorage.getItem('animex_token');
  const user  = JSON.parse(localStorage.getItem('animex_user') || 'null');

  if (!token || !user) {
    wrap.innerHTML = `<a class="btn-white" href="login.html" style="padding:7px 16px;font-size:12px">
      <i class="fa-solid fa-right-to-bracket"></i> Sign In
    </a>`;
    return;
  }

  const initial = (user.username || user.email || '?')[0].toUpperCase();
  const avatar  = user.avatarUrl
    ? `<img src="${user.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<span style="font-size:13px;font-weight:700;font-family:var(--font-display)">${initial}</span>`;

  wrap.innerHTML = `
    <button class="nav-link" style="display:flex;align-items:center;gap:8px;padding:6px 10px">
      <div style="width:30px;height:30px;border-radius:50%;background:var(--glass-hi);border:1px solid var(--border-hi);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
        ${avatar}
      </div>
      <span style="font-size:13px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user.username || 'Account'}</span>
      <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--text3)"></i>
    </button>
    <div class="nav-dropdown" style="min-width:180px;right:0;left:auto">
      <div style="padding:10px 14px 8px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <div style="font-size:12px;font-weight:700;color:var(--white)">${user.username || 'User'}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis">${user.email || ''}</div>
      </div>
      <a class="dropdown-link" href="profile.html"><i class="fa-solid fa-user" style="width:14px"></i> Profile</a>
      <a class="dropdown-link" href="watchlist.html"><i class="fa-solid fa-bookmark" style="width:14px"></i> Watchlist</a>
      <a class="dropdown-link" href="history.html"><i class="fa-solid fa-clock-rotate-left" style="width:14px"></i> History</a>
      <a class="dropdown-link" href="settings.html"><i class="fa-solid fa-gear" style="width:14px"></i> Settings</a>
      <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">
        <a class="dropdown-link" href="#" onclick="authSignOut();return false" style="color:rgba(255,100,100,0.8)">
          <i class="fa-solid fa-right-from-bracket" style="width:14px"></i> Sign Out
        </a>
      </div>
    </div>`;

  wrap.classList.add('nav-item');
}

function authSignOut() {
  const token = localStorage.getItem('animex_token');
  if (token) fetch('/api/auth/logout', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }
  }).catch(() => {});
  localStorage.removeItem('animex_token');
  localStorage.removeItem('animex_user');
  window.location.href = 'index.html';
}

function requireAuthPage(redirectBack = true) {
  if (!localStorage.getItem('animex_token')) {
    const back = redirectBack ? `?next=${encodeURIComponent(location.pathname + location.search)}` : '';
    window.location.href = `login.html${back}`;
    return false;
  }
  return true;
}

function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('animex_token');
  return fetch(`/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  }).then(async r => {
    if (r.status === 401) {
      localStorage.removeItem('animex_token');
      localStorage.removeItem('animex_user');
      window.location.href = 'login.html';
      return null;
    }
    return r.json();
  });
}
