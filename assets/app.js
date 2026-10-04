// website/assets/app.js
// Клиент Supabase + каталог + страница игры + auth + комментарии.

const CFG = window.NEXPLAY_CONFIG;
const supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const fmtSize = (b) => {
  if (!b) return "—";
  const u = ["B","KB","MB","GB"]; let i = 0; b = Number(b);
  while (b >= 1024 && i < u.length-1) { b /= 1024; i++; }
  return b.toFixed(b < 10 ? 2 : 1) + " " + u[i];
};
const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
};
const timeAgo = (d) => {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "только что";
  if (s < 3600) return Math.floor(s/60) + " мин назад";
  if (s < 86400) return Math.floor(s/3600) + " ч назад";
  if (s < 604800) return Math.floor(s/86400) + " дн назад";
  return fmtDate(d);
};

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

// ---------- state ----------
const state = {
  user: null,
  profile: null,
  tags: [],
  authMode: "login", // or "signup"
};

// ---------- App ----------
const App = {

  async init() {
    await this.loadSession();
    this.renderAuthArea();
    await this.loadTags();
    await this.loadHome();
    this.bindSearch();
    this.bindHashRouter();
    if (location.hash) this.handleHash();
  },

  async loadSession() {
    const { data } = await supa.auth.getSession();
    state.user = data.session?.user ?? null;
    if (state.user) {
      const { data: p } = await supa.from("profiles").select("*").eq("id", state.user.id).single();
      state.profile = p;
    }
    supa.auth.onAuthStateChange(async (_e, session) => {
      state.user = session?.user ?? null;
      if (state.user) {
        const { data: p } = await supa.from("profiles").select("*").eq("id", state.user.id).single();
        state.profile = p;
      } else {
        state.profile = null;
      }
      this.renderAuthArea();
    });
  },

  renderAuthArea() {
    const el = $("#authArea");
    if (!state.user) {
      el.innerHTML = `<button class="btn btn-primary btn-sm" onclick="App.openAuth('login')">Войти</button>`;
      return;
    }
    const name = state.profile?.username ?? state.user.email;
    const initial = (name[0] || "?").toUpperCase();
    const av = state.profile?.avatar_url
      ? `<img src="${esc(state.profile.avatar_url)}" alt="">`
      : initial;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <div class="avatar" onclick="App.showProfile()" title="${esc(name)}">${av}</div>
      </div>`;
  },

  // ---------- AUTH ----------
  openAuth(mode = "login") {
    state.authMode = mode;
    this.syncAuthMode();
    $("#authModal").classList.add("open");
    $("#authError").classList.add("hidden");
  },
  closeAuth() { $("#authModal").classList.remove("open"); },
  toggleAuthMode() {
    state.authMode = state.authMode === "login" ? "signup" : "login";
    this.syncAuthMode();
  },
  syncAuthMode() {
    const isSignup = state.authMode === "signup";
    $("#authTitle").textContent = isSignup ? "Регистрация" : "Вход в NEXPLAY";
    $("#authSub").textContent   = isSignup ? "Создай аккаунт за 10 секунд" : "Рад видеть снова";
    $("#usernameField").style.display = isSignup ? "" : "none";
    $("#btnToggleAuth").textContent = isSignup ? "У меня есть аккаунт" : "Регистрация";
    $("#btnAuthSubmit").textContent = isSignup ? "Создать аккаунт" : "Войти";
  },
  async submitAuth() {
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    const username = $("#authUsername").value.trim();
    const errEl = $("#authError");
    errEl.classList.add("hidden");

    if (!email || !password) return this._authErr("Заполни email и пароль");
    if (state.authMode === "signup" && (!username || username.length < 3))
      return this._authErr("Username минимум 3 символа");

    $("#btnAuthSubmit").disabled = true;
    $("#btnAuthSubmit").innerHTML = `<span class="loader"></span>`;

    try {
      if (state.authMode === "signup") {
        const { error } = await supa.auth.signUp({
          email, password,
          options: { data: { username } }
        });
        if (error) throw error;
        toast("Аккаунт создан! Проверь почту, если нужна верификация.", "success");
      } else {
        const { error } = await supa.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast("Добро пожаловать!", "success");
      }
      this.closeAuth();
    } catch (e) {
      this._authErr(e.message || String(e));
    } finally {
      $("#btnAuthSubmit").disabled = false;
      this.syncAuthMode();
    }
  },
  _authErr(msg) {
    const el = $("#authError");
    el.textContent = msg;
    el.classList.remove("hidden");
  },
  async logout() {
    await supa.auth.signOut();
    location.hash = "";
    location.reload();
  },

  // ---------- NAVIGATION ----------
  goHome() {
    location.hash = "";
    $("#pageHome").classList.remove("hidden");
    $("#pageGame").classList.add("hidden");
    $("#pageProfile").classList.add("hidden");
    $("#navLinks a").forEach(a => a.classList.remove("active"));
    $("#navLinks a[data-nav=home]").classList.add("active");
  },
  scrollCatalog() {
    document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
  },
  bindHashRouter() {
    window.addEventListener("hashchange", () => this.handleHash());
  },
  async handleHash() {
    const h = location.hash;
    if (h.startsWith("#/game/")) {
      const slug = h.slice("#/game/".length);
      await this.openGame(slug);
    } else if (h.startsWith("#/profile/")) {
      const id = h.slice("#/profile/".length);
      await this.openProfile(id);
    } else {
      this.goHome();
    }
  },

  // ---------- DATA: TAGS ----------
  async loadTags() {
    const { data } = await supa.from("tags").select("*").order("name");
    state.tags = data ?? [];
    const cloud = $("#tagsCloud");
    if (cloud) {
      cloud.innerHTML = state.tags.map(t =>
        `<span class="tag" onclick="App.filterByTag('${esc(t.slug)}')">${esc(t.name)}</span>`
      ).join("");
    }
  },

  // ---------- DATA: HOME ----------
  async loadHome() {
    const since = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

    const [drops, popular, fresh, all] = await Promise.all([
      supa.from("games").select("*")
          .eq("status","published").eq("is_drop", true)
          .gte("created_at", since(48)).order("created_at", { ascending: false }).limit(8),
      supa.from("games").select("*")
          .eq("status","published").order("downloads", { ascending: false }).limit(8),
      supa.from("games").select("*")
          .eq("status","published").gte("updated_at", since(24))
          .order("updated_at", { ascending: false }).limit(8),
      supa.from("games").select("*")
          .eq("status","published").order("created_at", { ascending: false }).limit(40),
    ]);

    this.fillGrid("#gridDrops",   drops.data ?? []);
    this.fillGrid("#gridPopular", popular.data ?? []);
    this.fillGrid("#gridFresh",   fresh.data ?? []);
    this.fillGrid("#gridAll",     all.data ?? []);
  },

  fillGrid(sel, games) {
    const el = $(sel);
    if (!el) return;
    if (!games.length) {
      el.innerHTML = `<div class="empty" style="grid-column:1/-1">Пока пусто</div>`;
      return;
    }
    el.innerHTML = games.map(g => this.gameCard(g)).join("");
  },

  gameCard(g) {
    const drop = g.is_drop && (Date.now() - new Date(g.created_at).getTime() < 48*3600*1000);
    const fresh = (Date.now() - new Date(g.updated_at).getTime() < 24*3600*1000);
    const cover = g.cover_url
      ? `<img src="${esc(g.cover_url)}" alt="" loading="lazy">`
      : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#241a4d,#0f1b3b)"></div>`;
    const engineLabel = g.engine === "unity"
      ? `Unity ${g.unity_backend ? "· " + g.unity_backend.toUpperCase() : ""}`
      : (g.engine === "unreal" ? "Unreal" : "");
    return `
      <div class="card" onclick="location.hash='#/game/${esc(g.slug)}'">
        <div class="card-cover">
          ${cover}
          ${drop ? `<div class="badge badge-drop">NEW DROP</div>` :
            (fresh ? `<div class="badge badge-new">FRESH BUILD</div>` : "")}
          ${engineLabel ? `<div class="badge badge-engine">${esc(engineLabel)}</div>` : ""}
        </div>
        <div class="card-body">
          <div class="card-title">${esc(g.title)}</div>
          <div class="card-dev">${esc(g.developer_name)}</div>
          <div class="card-meta">
            <span>⬇ ${g.downloads ?? 0}</span>
            <span class="pill">${timeAgo(g.updated_at)}</span>
          </div>
        </div>
      </div>`;
  },

  // ---------- SEARCH ----------
  bindSearch() {
    const inp = $("#searchInput");
    let t = null;
    inp.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => this.doSearch(inp.value.trim()), 260);
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.doSearch(inp.value.trim());
    });
  },
  async doSearch(q, tag = null) {
    if (!q && !tag) { this.goHome(); await this.loadHome(); return; }
    const { data, error } = await supa.rpc("search_games", {
      p_query: q || null,
      p_tag: tag || null,
      p_limit: 40, p_offset: 0,
    });
    if (error) { toast(error.message, "error"); return; }
    $("#pageHome").classList.remove("hidden");
    $("#pageGame").classList.add("hidden");
    $("#pageProfile").classList.add("hidden");

    // Показываем результат внутри секции каталога
    ["secDrops","secPopular","secFresh"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
    $("#catalog").scrollIntoView();
    document.querySelector("#catalog h2").textContent =
      tag ? `Результаты по тегу: ${tag}` : `Результаты поиска: "${q}"`;
    this.fillGrid("#gridAll", data ?? []);
  },
  filterByTag(slug) {
    $("#searchInput").value = "";
    this.doSearch("", slug);
  },

  // ---------- GAME PAGE ----------
  async openGame(slug) {
    $("#pageHome").classList.add("hidden");
    $("#pageProfile").classList.add("hidden");
    const el = $("#pageGame");
    el.classList.remove("hidden");
    el.innerHTML = `<div class="empty"><span class="loader"></span></div>`;
    window.scrollTo({ top: 0 });

    const { data: g, error } = await supa.from("games").select("*").eq("slug", slug).single();
    if (error || !g) {
      el.innerHTML = `<div class="empty">Игра не найдена</div>`;
      return;
    }
    // increment views (best-effort)
    supa.rpc("increment_views", { p_game_id: g.id }).catch(() => {});

    const [shotsR, tagsR, versionsR, commentsR] = await Promise.all([
      supa.from("game_screenshots").select("*").eq("game_id", g.id).order("position"),
      supa.from("game_tags").select("tag_id, tags!inner(id,name,slug)").eq("game_id", g.id),
      supa.from("game_versions").select("*").eq("game_id", g.id).order("created_at", { ascending: false }),
      supa.from("comments").select("*, profiles!inner(username, avatar_url)")
          .eq("game_id", g.id).order("created_at", { ascending: false }).limit(50),
    ]);

    const shots = shotsR.data ?? [];
    const tags = (tagsR.data ?? []).map(r => r.tags);
    const versions = versionsR.data ?? [];
    const comments = commentsR.data ?? [];
    const latest = versions[0] ?? null;

    let files = [];
    if (latest) {
      const { data: fs } = await supa.from("version_files").select("*").eq("version_id", latest.id);
      files = fs ?? [];
    }
    const primary = files.find(f => f.is_primary) ?? files[0] ?? null;
    const totalSize = files.reduce((a, f) => a + Number(f.file_size || 0), 0);

    const engineLabel = g.engine === "unity"
      ? `Unity${g.unity_backend ? " · " + g.unity_backend.toUpperCase() : ""}`
      : (g.engine === "unreal" ? `Unreal${g.unreal_version ? " " + g.unreal_version : ""}` : "—");

    const sysreqHtml = (j) => {
      if (!j || typeof j !== "object" || !Object.keys(j).length) return "<em>не указано</em>";
      return Object.entries(j).map(([k,v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join("");
    };

    el.innerHTML = `
      <div class="game-hero">
        <div class="game-cover">
          ${g.cover_url ? `<img src="${esc(g.cover_url)}" alt="">` : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#241a4d,#0f1b3b)"></div>`}
        </div>
        <div class="game-info">
          <h1>${esc(g.title)}</h1>
          <p class="game-dev-line">by <b>${esc(g.developer_name)}</b>
            ${g.release_date ? `· вышла ${fmtDate(g.release_date)}` : ""}
          </p>
          <div class="game-tags">
            ${tags.map(t => `<span class="tag" onclick="App.filterByTag('${esc(t.slug)}')">${esc(t.name)}</span>`).join("")}
          </div>
          <div class="game-stats">
            <div class="stat"><div class="stat-value">${g.downloads ?? 0}</div><div class="stat-label">Скачиваний</div></div>
            <div class="stat"><div class="stat-value">${g.views ?? 0}</div><div class="stat-label">Просмотров</div></div>
            <div class="stat"><div class="stat-value">${fmtSize(totalSize)}</div><div class="stat-label">Размер</div></div>
          </div>
          <div class="game-actions">
            ${primary
              ? `<a class="btn btn-primary btn-lg" href="${esc(primary.download_url)}" target="_blank" rel="noopener" onclick="App.trackDownload('${g.id}','${latest.id}')">⬇ Скачать ${esc(latest.version)}</a>`
              : `<button class="btn btn-lg" disabled>Нет билда</button>`}
            <button class="btn btn-lg" onclick="App.showGameInfo('${esc(g.id)}')">Подробнее</button>
          </div>
          <p style="color:var(--muted);font-size:13px;margin-top:14px">
            Движок: ${esc(engineLabel)} · Обновлено ${timeAgo(g.updated_at)}
          </p>
        </div>
      </div>

      ${shots.length ? `
      <div class="section">
        <h2>Скриншоты</h2>
        <div class="shots">
          ${shots.map(s => `<div class="shot" onclick="App.openImage('${esc(s.url)}')"><img src="${esc(s.url)}" loading="lazy"></div>`).join("")}
        </div>
      </div>` : ""}

      ${g.description ? `
      <div class="section">
        <h2>Об игре</h2>
        <div class="description">${esc(g.description)}</div>
      </div>` : ""}

      <div class="section">
        <h2>Системные требования</h2>
        <div class="row">
          <div>
            <h3 style="font-size:15px;color:var(--muted);margin-bottom:6px">Минимальные</h3>
            ${sysreqHtml(g.sysreq_min)}
          </div>
          <div>
            <h3 style="font-size:15px;color:var(--muted);margin-bottom:6px">Рекомендуемые</h3>
            ${sysreqHtml(g.sysreq_rec)}
          </div>
        </div>
      </div>

      ${versions.length ? `
      <div class="section">
        <h2>История обновлений</h2>
        <div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
          ${versions.map(v => `
            <div style="padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <b>v${esc(v.version)}</b>
                <span style="color:var(--muted);font-size:12px">${fmtDate(v.created_at)}</span>
              </div>
              ${v.changelog ? `<div style="margin-top:8px;color:#cfcfe0;font-size:14px;white-space:pre-wrap">${esc(v.changelog)}</div>` : ""}
            </div>`).join("")}
        </div>
      </div>` : ""}

      <div class="section">
        <h2>Комментарии (${comments.length})</h2>
        ${state.user ? `
          <div class="form" style="max-width:100%;margin-top:12px">
            <textarea id="newComment" placeholder="Напиши что-нибудь..."></textarea>
            <div><button class="btn btn-primary" onclick="App.postComment('${g.id}')">Отправить</button></div>
          </div>` : `<p class="sub">Войди, чтобы оставлять комментарии.</p>`}
        <div id="commentsList" style="margin-top:18px">
          ${comments.length ? comments.map(c => this.commentHtml(c)).join("") : `<div class="empty">Комментариев пока нет</div>`}
        </div>
      </div>
    `;
  },

  commentHtml(c) {
    const name = c.profiles?.username ?? "anon";
    const initial = name[0]?.toUpperCase() ?? "?";
    const av = c.profiles?.avatar_url
      ? `<img src="${esc(c.profiles.avatar_url)}">`
      : initial;
    return `
      <div class="comment">
        <div class="comment-avatar">${av}</div>
        <div class="comment-body">
          <div class="comment-head">
            <span class="comment-author">${esc(name)}</span>
            <span class="comment-time">${timeAgo(c.created_at)}</span>
          </div>
          <div class="comment-text">${esc(c.body)}</div>
        </div>
      </div>`;
  },

  async postComment(gameId) {
    const ta = $("#newComment");
    const body = ta.value.trim();
    if (!body) return;
    ta.disabled = true;
    const { error } = await supa.from("comments").insert({
      game_id: gameId, user_id: state.user.id, body,
    });
    ta.disabled = false;
    if (error) { toast(error.message, "error"); return; }
    ta.value = "";
    toast("Комментарий добавлен", "success");
    // перезагружаем страницу игры
    const slug = location.hash.slice("#/game/".length);
    this.openGame(slug);
  },

  async trackDownload(gameId, versionId) {
    if (!state.user) return; // гости не пишутся
    await supa.from("game_downloads").insert({
      user_id: state.user.id, game_id: gameId, version_id: versionId,
    });
  },

  showGameInfo(gameId) {
    // простая ссылка на тот же URL — можно расширить
    toast("Информация об игре обновлена");
  },

  // ---------- PROFILE ----------
  async showProfile() {
    if (!state.user) return;
    location.hash = "#/profile/" + state.user.id;
  },
  async openProfile(id) {
    $("#pageHome").classList.add("hidden");
    $("#pageGame").classList.add("hidden");
    const el = $("#pageProfile");
    el.classList.remove("hidden");
    el.innerHTML = `<div class="empty"><span class="loader"></span></div>`;
    window.scrollTo({ top: 0 });

    const { data: p } = await supa.from("profiles").select("*").eq("id", id).single();
    if (!p) { el.innerHTML = `<div class="empty">Профиль не найден</div>`; return; }

    const { data: games } = await supa.from("games").select("*")
      .eq("developer_id", id).order("created_at", { ascending: false });

    const initial = (p.username[0] || "?").toUpperCase();
    const av = p.avatar_url ? `<img src="${esc(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover">` : initial;
    const isMe = state.user && state.user.id === p.id;

    el.innerHTML = `
      <div class="section">
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
          <div style="width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#fff;overflow:hidden">
            ${av}
          </div>
          <div>
            <h1 style="margin:0 0 4px">${esc(p.display_name || p.username)}</h1>
            <p style="color:var(--muted);margin:0">@${esc(p.username)} · ${esc(p.role)} · с ${fmtDate(p.created_at)}</p>
            ${p.bio ? `<p style="color:#cfcfe0;margin:8px 0 0">${esc(p.bio)}</p>` : ""}
          </div>
          <div class="spacer" style="flex:1"></div>
          ${isMe ? `<button class="btn btn-danger btn-sm" onclick="App.logout()">Выйти</button>` : ""}
        </div>
      </div>
      <div class="section">
        <h2>Игры (${(games ?? []).length})</h2>
        <div class="grid" id="gridUserGames"></div>
      </div>
    `;
    this.fillGrid("#gridUserGames", games ?? []);
  },

  // ---------- IMAGE VIEWER ----------
  openImage(url) {
    $("#imgModalSrc").src = url;
    $("#imgModal").classList.add("open");
  },
  closeImage() {
    $("#imgModal").classList.remove("open");
  },
};

// Public export
window.App = App;
window.addEventListener("DOMContentLoaded", () => App.init());