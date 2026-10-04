// website/assets/developer.js
// NEXPLAY Developer Dashboard. Единый файл, всё внутри объекта Dev.

const CFG = window.NEXPLAY_CONFIG;
const supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const fmtSize = (b) => {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; b = Number(b);
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(b < 10 ? 2 : 1) + " " + u[i];
};
const timeAgo = (d) => {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "только что";
  if (s < 3600) return Math.floor(s / 60) + " мин назад";
  if (s < 86400) return Math.floor(s / 3600) + " ч назад";
  if (s < 604800) return Math.floor(s / 86400) + " дн назад";
  return new Date(d).toLocaleDateString("ru-RU");
};
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  const host = $("#toasts");
  if (host) host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2600);
  setTimeout(() => el.remove(), 3000);
}
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------- Dev ----------
const Dev = {
  state: {
    user: null,
    profile: null,
    myGames: [],
    tagsCache: [],
    currentGameForVersion: null,
    cropper: null,
    selectedScreenshots: [],
  },

  async init() {
    const { data } = await supa.auth.getSession();
    this.state.user = data.session?.user ?? null;

    if (this.state.user) {
      const { data: p } = await supa.from("profiles").select("*").eq("id", this.state.user.id).single();
      this.state.profile = p;
    }
    this.renderAuthArea();

    try {
      const { data: tags } = await supa.from("tags").select("*").order("name");
      this.state.tagsCache = tags ?? [];
    } catch { this.state.tagsCache = []; }
    this.renderTagSuggest();

    if (!this.state.user) {
      $("#notAuth").classList.remove("hidden");
      return;
    }
    if (!["developer", "admin"].includes(this.state.profile?.role)) {
      $("#becomeDev").classList.remove("hidden");
      return;
    }
    await this.loadDashboard();
  },

  renderAuthArea() {
    const el = $("#authArea");
    if (!el) return;
    if (!this.state.user) {
      el.innerHTML = `<a class="btn btn-sm" href="index.html">Войти</a>`;
      return;
    }
    const name = this.state.profile?.username ?? "user";
    const initial = (name[0] || "?").toUpperCase();
    const av = this.state.profile?.avatar_url
      ? `<img src="${esc(this.state.profile.avatar_url)}" alt="">` : initial;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <a class="btn btn-sm btn-ghost" href="index.html">На сайт</a>
        <div class="avatar" title="${esc(name)}">${av}</div>
      </div>`;
  },

  async becomeDeveloper() {
    const { error } = await supa.rpc("become_developer");
    if (error) { toast(error.message, "error"); return; }
    toast("Готово! Ты теперь разработчик.", "success");
    setTimeout(() => location.reload(), 700);
  },

  // ---------- dashboard ----------
  async loadDashboard() {
    $("#notAuth").classList.add("hidden");
    $("#becomeDev").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");

    const { data: games, error } = await supa.from("games").select("*")
      .eq("developer_id", this.state.user.id)
      .order("created_at", { ascending: false });
    if (error) { toast(error.message, "error"); return; }
    this.state.myGames = games ?? [];

    const ids = this.state.myGames.map(g => g.id);
    const tagMap = {};
    if (ids.length) {
      const { data: gt } = await supa.from("game_tags")
        .select("game_id, tags!inner(name, slug)").in("game_id", ids);
      (gt ?? []).forEach(r => { (tagMap[r.game_id] ??= []).push(r.tags); });
    }

    const el = $("#myGames");
    if (!this.state.myGames.length) {
      el.innerHTML = `<div class="empty" style="grid-column:1/-1">Пока нет игр. Создай первую!</div>`;
    } else {
      el.innerHTML = this.state.myGames.map(g => {
        const cover = g.cover_url
          ? `<img src="${esc(g.cover_url)}" alt="">`
          : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#241a4d,#0f1b3b)"></div>`;
        const statusPill = g.status === "published"
          ? `<span class="pill" style="background:rgba(76,217,123,.15);color:var(--success);border-color:transparent">published</span>`
          : `<span class="pill">${esc(g.status)}</span>`;
        const tags = (tagMap[g.id] ?? []).map(t => `<span class="tag">${esc(t.name)}</span>`).join("");
        return `
          <div class="card" style="cursor:default">
            <div class="card-cover">${cover}</div>
            <div class="card-body">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <div class="card-title">${esc(g.title)}</div>
                ${statusPill}
              </div>
              <div class="card-dev">${esc(g.developer_name)} · ⬇ ${g.downloads ?? 0}</div>
              <div class="game-tags" style="margin:8px 0">${tags}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
                <button class="btn btn-sm btn-primary" onclick="Dev.openVersion('${g.id}')">+ Версия</button>
                <button class="btn btn-sm" onclick="Dev.togglePublish('${g.id}')">${g.status === "published" ? "Скрыть" : "Опубликовать"}</button>
                <a class="btn btn-sm" href="index.html#/game/${esc(g.slug)}" target="_blank">Открыть</a>
              </div>
            </div>
          </div>`;
      }).join("");
    }

    await this.refreshNotifBadge();
  },

  // ---------- notifications ----------
  async refreshNotifBadge() {
    const { count } = await supa.from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", this.state.user.id).eq("is_read", false);
    const b = $("#notifBadge");
    if (!b) return;
    if (count > 0) { b.textContent = count; b.style.display = "inline-block"; }
    else { b.style.display = "none"; }
  },

  async openNotifications() {
    $("#notifModal").classList.add("open");
    const { data } = await supa.from("notifications")
      .select("*, games(title, slug)")
      .eq("user_id", this.state.user.id)
      .order("created_at", { ascending: false }).limit(60);
    const list = data ?? [];
    const el = $("#notifList");
    if (!list.length) { el.innerHTML = `<div class="empty">Уведомлений пока нет</div>`; return; }

    const labels = {
      comment: "💬 Новый комментарий",
      download: "⬇ Скачивание",
      version_published: "🚀 Версия опубликована",
      report: "⚠ Жалоба",
      system: "ℹ Системное",
    };
    el.innerHTML = list.map(n => `
      <div style="padding:12px;border-bottom:1px solid var(--border);${n.is_read ? "opacity:.6" : ""}">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <b>${labels[n.kind] ?? n.kind}</b>
          <span style="color:var(--muted);font-size:12px">${timeAgo(n.created_at)}</span>
        </div>
        ${n.games ? `<div style="color:var(--muted);font-size:13px;margin-top:4px">Игра: <a href="index.html#/game/${esc(n.games.slug)}">${esc(n.games.title)}</a></div>` : ""}
      </div>`).join("");

    await supa.from("notifications").update({ is_read: true })
      .eq("user_id", this.state.user.id).eq("is_read", false);
    this.refreshNotifBadge();
  },
  closeNotifications() { $("#notifModal").classList.remove("open"); },

  // ---------- create game ----------
  openCreate() {
    $("#createModal").classList.add("open");
    $("#createError").classList.add("hidden");
    // reset scroll
    const sc = $("#createModal .modal-scroll");
    if (sc) sc.scrollTop = 0;

    const t = $("#fTitle"), s = $("#fSlug");
    t.oninput = () => { if (!s.dataset.touched) s.value = slugify(t.value); };
    s.oninput = () => { s.dataset.touched = "1"; };

    if (!$("#fDevName").value) $("#fDevName").value = this.state.profile?.username ?? "";

    $("#fShots").onchange = (e) => this.previewShots(e.target.files);
    $("#fCover").onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) this.openCropper(f);
    };
  },
  closeCreate() { $("#createModal").classList.remove("open"); },

  onEngineChange() {
    const v = $("#fEngine").value;
    $("#unityBackendWrap").style.display = v === "unity" ? "" : "none";
    $("#unrealVersionWrap").style.display = v === "unreal" ? "" : "none";
  },

  renderTagSuggest() {
    const el = $("#tagSuggest");
    if (!el) return;
    el.innerHTML = this.state.tagsCache.slice(0, 30).map(t =>
      `<span class="tag" onclick="Dev.addTag('${esc(t.name)}')">+ ${esc(t.name)}</span>`
    ).join("");
  },
  addTag(name) {
    const inp = $("#fTags");
    const cur = inp.value.split(",").map(s => s.trim()).filter(Boolean);
    if (!cur.includes(name)) { cur.push(name); inp.value = cur.join(", "); }
  },

  previewShots(files) {
    this.state.selectedScreenshots = [];
    const el = $("#shotsPreview");
    el.innerHTML = "";
    if (!files) return;
    for (const file of files) {
      const url = URL.createObjectURL(file);
      this.state.selectedScreenshots.push({ file, url });
      const div = document.createElement("div");
      div.className = "shot";
      div.innerHTML = `<img src="${url}">`;
      el.appendChild(div);
    }
  },

  parseSysreq(text) {
    const out = {};
    (text || "").split("\n").forEach(line => {
      const i = line.indexOf(":");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return out;
  },

  async attachTag(gameId, name) {
    const { data: tagId, error } = await supa.rpc("upsert_tag", { p_name: name });
    if (error) { console.warn("tag", name, error); return; }
    await supa.from("game_tags").insert({ game_id: gameId, tag_id: tagId });
  },

  async uploadImage(blobOrFile, bucket, path) {
    const { error } = await supa.storage.from(bucket).upload(path, blobOrFile, {
      cacheControl: "31536000",
      upsert: false,
      contentType: "image/jpeg",
    });
    if (error) throw error;
    const { data } = supa.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },

  // ---------- cropper ----------
  openCropper(file) {
    const url = URL.createObjectURL(file);
    const img = $("#cropperImg");
    const overlay = $("#cropperOverlay");
    const handle = $("#cropperHandle");

    $("#cropperModal").classList.add("open");
    img.src = url;
    this.state.cropper = { file, url, rect: null };

    const RATIO = 16 / 9;
    const applyRect = () => {
      const r = this.state.cropper.rect;
      overlay.style.left = r.x + "px";
      overlay.style.top = r.y + "px";
      overlay.style.width = r.w + "px";
      overlay.style.height = r.h + "px";
    };

    img.onload = () => {
      const iw = img.clientWidth, ih = img.clientHeight;
      let w = iw * 0.8, h = w / RATIO;
      if (h > ih * 0.9) { h = ih * 0.9; w = h * RATIO; }
      this.state.cropper.rect = { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
      applyRect();
    };

    let dragging = false, dragStart = null;
    const onMouseDown = (e) => {
      if (e.target === handle) return;
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY, r: { ...this.state.cropper.rect } };
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!dragging) return;
      const iw = img.clientWidth, ih = img.clientHeight;
      const r = this.state.cropper.rect;
      const nx = dragStart.r.x + (e.clientX - dragStart.x);
      const ny = dragStart.r.y + (e.clientY - dragStart.y);
      r.x = Math.max(0, Math.min(iw - r.w, nx));
      r.y = Math.max(0, Math.min(ih - r.h, ny));
      applyRect();
    };
    const onMouseUp = () => { dragging = false; };
    overlay.onmousedown = onMouseDown;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    this.state.cropper._cleanupDrag = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      overlay.onmousedown = null;
    };

    let resizing = false, resizeStart = null;
    handle.onmousedown = (e) => {
      resizing = true;
      resizeStart = { x: e.clientX, y: e.clientY, r: { ...this.state.cropper.rect } };
      e.stopPropagation(); e.preventDefault();
    };
    const onResizeMove = (e) => {
      if (!resizing) return;
      const iw = img.clientWidth, ih = img.clientHeight;
      const r = this.state.cropper.rect;
      const dx = e.clientX - resizeStart.x;
      let w = Math.max(60, resizeStart.r.w + dx);
      let h = w / RATIO;
      if (resizeStart.r.x + w > iw) { w = iw - resizeStart.r.x; h = w / RATIO; }
      if (resizeStart.r.y + h > ih) { h = ih - resizeStart.r.y; w = h * RATIO; }
      r.w = w; r.h = h;
      applyRect();
    };
    const onResizeUp = () => { resizing = false; };
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeUp);
    this.state.cropper._cleanupResize = () => {
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeUp);
      handle.onmousedown = null;
    };
  },

  closeCropper() {
    const c = this.state.cropper;
    if (c?._cleanupDrag) c._cleanupDrag();
    if (c?._cleanupResize) c._cleanupResize();
    $("#cropperModal").classList.remove("open");
    this.state.cropper = null;
  },

  async confirmCrop() {
    const c = this.state.cropper;
    if (!c?.rect) return this.closeCropper();
    const img = $("#cropperImg");

    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sx = c.rect.x * scaleX;
    const sy = c.rect.y * scaleY;
    const sw = c.rect.w * scaleX;
    const sh = c.rect.h * scaleY;

    const canvas = document.createElement("canvas");
    const OUT_W = 1280, OUT_H = 720;
    canvas.width = OUT_W; canvas.height = OUT_H;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);

    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));
    c.resultBlob = blob;

    const preview = URL.createObjectURL(blob);
    const old = $("#fCover")?.parentElement?.querySelector(".cover-preview");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.className = "cover-preview";
    wrap.style.marginTop = "10px";
    wrap.innerHTML = `<img src="${preview}" style="max-width:220px;border-radius:10px;border:1px solid var(--border)">`;
    $("#fCover").parentElement.appendChild(wrap);

    toast("Обложка обрезана", "success");
    this.closeCropper();
  },

  // ---------- submit game ----------
  async submitCreate() {
    const errEl = $("#createError");
    errEl.classList.add("hidden");
    const err = (m) => {
      errEl.textContent = m; errEl.classList.remove("hidden");
      const sc = $("#createModal .modal-scroll");
      if (sc) sc.scrollTop = sc.scrollHeight;
      toast(m, "error");
    };

    const title = $("#fTitle").value.trim();
    const slug = ($("#fSlug").value.trim() || slugify(title));
    const devName = $("#fDevName").value.trim() || this.state.profile?.username;
    const short = $("#fShort").value.trim();
    const desc = $("#fDesc").value.trim();
    const engine = $("#fEngine").value || null;
    const unityBackend = engine === "unity" ? $("#fUnityBackend").value : null;
    const unrealVersion = engine === "unreal" ? $("#fUnrealVersion").value.trim() : null;
    const age = $("#fAge").value.trim() || null;
    const releaseDate = $("#fRelease").value || null;
    const tagsRaw = $("#fTags").value.trim();
    const isDrop = $("#fDrop").checked;
    const sysMin = this.parseSysreq($("#fSysMin").value);
    const sysRec = this.parseSysreq($("#fSysRec").value);

    if (!title) return err("Введи название игры");
    if (!/^[a-z0-9\-]+$/.test(slug)) return err("Slug: только a-z, 0-9 и дефис");
    if (!devName) return err("Введи имя разработчика");
    if (!engine) return err("Выбери движок");

    $("#btnCreateSubmit").disabled = true;
    $("#btnCreateSubmit").innerHTML = `<span class="loader"></span>`;

    try {
      const { data: existsSlug } = await supa
        .from("games").select("id").eq("slug", slug).maybeSingle();
      if (existsSlug) throw new Error("Этот slug уже занят");

      let coverUrl = null;
      if (this.state.cropper?.resultBlob) {
        coverUrl = await this.uploadImage(
          this.state.cropper.resultBlob, "covers",
          `${this.state.user.id}/${slug}-${Date.now()}.jpg`
        );
      }

      const { data: game, error: gErr } = await supa.from("games").insert({
        developer_id: this.state.user.id,
        developer_name: devName,
        title, slug,
        short_description: short || null,
        description: desc || null,
        cover_url: coverUrl,
        status: "published",
        engine,
        unity_backend: unityBackend,
        unreal_version: unrealVersion,
        age_rating: age,
        release_date: releaseDate,
        sysreq_min: sysMin,
        sysreq_rec: sysRec,
        is_drop: isDrop,
      }).select().single();
      if (gErr) throw gErr;

      const tagNames = tagsRaw.split(",").map(s => s.trim()).filter(Boolean);
      for (const name of tagNames) await this.attachTag(game.id, name);

      for (const shot of this.state.selectedScreenshots) {
        const url = await this.uploadImage(shot.file, "screenshots",
          `${this.state.user.id}/${game.id}/${Date.now()}-${shot.file.name}`);
        await supa.from("game_screenshots").insert({
          game_id: game.id, url, position: 0,
        });
      }

      toast("Игра создана! Загрузи первый билд.", "success");
      this.closeCreate();
      this.resetCreateForm();
      await this.loadDashboard();
      this.openVersion(game.id);
    } catch (e) {
      err(e.message || String(e));
    } finally {
      $("#btnCreateSubmit").disabled = false;
      $("#btnCreateSubmit").textContent = "Создать игру";
    }
  },

  resetCreateForm() {
    ["fTitle","fSlug","fShort","fDesc","fAge","fTags","fSysMin","fSysRec","fUnrealVersion"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    $("#fRelease").value = "";
    $("#fEngine").value = "";
    $("#fDrop").checked = false;
    $("#fCover").value = "";
    $("#fShots").value = "";
    $("#shotsPreview").innerHTML = "";
    $("#fSlug").dataset.touched = "";
    const old = $("#fCover")?.parentElement?.querySelector(".cover-preview");
    if (old) old.remove();
    this.state.selectedScreenshots = [];
    this.state.cropper = null;
    this.onEngineChange();
  },

  // ---------- version ----------
  openVersion(gameId) {
    this.state.currentGameForVersion = gameId;
    $("#versionModal").classList.add("open");
    $("#versionError").classList.add("hidden");
    $("#versionProgress").classList.add("hidden");
    $("#vVersion").value = "";
    $("#vExe").value = "";
    $("#vChangelog").value = "";
    $("#vFile").value = "";
    $("#vExternalUrl").value = "";
    $("#vPrimary").checked = true;
    $("#btnVersionSubmit").disabled = false;
    $("#btnVersionSubmit").textContent = "Опубликовать версию";
    const sc = $("#versionModal .modal-scroll");
    if (sc) sc.scrollTop = 0;
  },
  closeVersion() { $("#versionModal").classList.remove("open"); },

  async submitVersion() {
    const errEl = $("#versionError");
    errEl.classList.add("hidden");
    const err = (m) => {
      errEl.textContent = m; errEl.classList.remove("hidden");
      const sc = $("#versionModal .modal-scroll");
      if (sc) sc.scrollTop = sc.scrollHeight;
      toast(m, "error");
    };

    const gameId = this.state.currentGameForVersion;
    const version = $("#vVersion").value.trim();
    const exe = $("#vExe").value.trim() || null;
    const changelog = $("#vChangelog").value.trim() || null;
    const fileInput = $("#vFile");
    const external = $("#vExternalUrl").value.trim();
    const isPrimary = $("#vPrimary").checked;

    if (!version) return err("Укажи версию");
    if (!fileInput.files.length && !external)
      return err("Загрузи ZIP или укажи внешнюю ссылку");

    const file = fileInput.files[0];
    if (file && file.size > CFG.MAX_BUILD_FILE_SIZE)
      return err(`Файл больше ${(CFG.MAX_BUILD_FILE_SIZE / 1024 / 1024).toFixed(0)} МБ. Используй внешнюю ссылку.`);

    $("#btnVersionSubmit").disabled = true;
    $("#btnVersionSubmit").innerHTML = `<span class="loader"></span>`;

    const prog = $("#versionProgress");
    const bar = $("#versionProgressBar");
    const txt = $("#versionProgressText");
    prog.classList.remove("hidden");

    try {
      // --- ИСПРАВЛЕНИЕ DUPLICATE KEY ---
      // Если такая версия уже есть — удаляем её (CASCADE удалит version_files).
      const { data: existing } = await supa
        .from("game_versions")
        .select("id")
        .eq("game_id", gameId)
        .eq("version", version)
        .maybeSingle();

      if (existing) {
        const { error: delErr } = await supa
          .from("game_versions")
          .delete()
          .eq("id", existing.id);
        if (delErr) throw new Error("Не удалось перезаписать версию: " + delErr.message);
      }

      const { data: vRow, error: vErr } = await supa.from("game_versions").insert({
        game_id: gameId,
        version,
        executable: exe,
        changelog,
        status: "ready",
      }).select().single();
      if (vErr) throw vErr;

      let downloadUrl = external || null;
      let fileName = null;
      let fileSize = 0;

      if (file) {
        bar.style.width = "0%";
        txt.textContent = "Загрузка в хранилище...";
        fileName = file.name;
        fileSize = file.size;
        const path = `${this.state.user.id}/${gameId}/${version}/${Date.now()}-${file.name}`;

        const { error: upErr } = await supa.storage.from("builds").upload(path, file, {
          upsert: false,
          cacheControl: "3600",
          contentType: "application/zip",
        });
        if (upErr) throw upErr;

        bar.style.width = "100%";
        txt.textContent = "Готово";
        const { data: pub } = supa.storage.from("builds").getPublicUrl(path);
        downloadUrl = pub.publicUrl;
      } else {
        fileName = external.split("/").pop() || "build.zip";
      }

      const { error: fErr } = await supa.from("version_files").insert({
        version_id: vRow.id,
        download_url: downloadUrl,
        file_name: fileName,
        file_size: fileSize,
        is_primary: isPrimary,
      });
      if (fErr) throw fErr;

      toast("Версия опубликована 🚀", "success");
      this.closeVersion();
      await this.loadDashboard();
    } catch (e) {
      err(e.message || String(e));
    } finally {
      $("#btnVersionSubmit").disabled = false;
      $("#btnVersionSubmit").textContent = "Опубликовать версию";
    }
  },

  // ---------- publish toggle ----------
  async togglePublish(gameId) {
    const g = this.state.myGames.find(x => x.id === gameId);
    if (!g) return;
    const next = g.status === "published" ? "hidden" : "published";
    const { error } = await supa.from("games").update({ status: next }).eq("id", gameId);
    if (error) { toast(error.message, "error"); return; }
    toast(next === "published" ? "Опубликовано" : "Скрыто", "success");
    await this.loadDashboard();
  },
};

window.Dev = Dev;
window.addEventListener("DOMContentLoaded", () => Dev.init());
