  // ---------- CREATE GAME ----------
  async submitCreate() {
    const errEl = $("#createError");
    errEl.classList.add("hidden");
    const err = (m) => {
      errEl.textContent = m;
      errEl.classList.remove("hidden");
      toast(m, "error");
    };

    const title = $("#fTitle").value.trim();
    const slug = $("#fSlug").value.trim() || slugify(title);
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
      // 1) Проверка занятости slug
      const { data: existsSlug } = await supa
        .from("games").select("id").eq("slug", slug).maybeSingle();
      if (existsSlug) throw new Error("Этот slug уже занят");

      // 2) Обложка: если пользователь её обрезал — уже есть в state как Blob
      let coverUrl = null;
      if (this.state.cropper?.resultBlob) {
        coverUrl = await this.uploadImage(
          this.state.cropper.resultBlob,
          "covers",
          `${this.state.user.id}/${slug}-${Date.now()}.jpg`
        );
      }

      // 3) Создаём игру
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

      // 4) Теги
      const tagNames = tagsRaw.split(",").map(s => s.trim()).filter(Boolean);
      for (const name of tagNames) {
        await this.attachTag(game.id, name);
      }

      // 5) Скриншоты
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
      // Открываем модалку версии сразу
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
    this.state.selectedScreenshots = [];
    this.state.cropper = null;
    this.onEngineChange();
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
    // upsert_tag — RPC из SQL
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

  // ---------- CROPPER ----------
  openCropper(file) {
    const url = URL.createObjectURL(file);
    const stage = $("#cropperStage");
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
      // Центрируем рамку 16:9 по 80% ширины
      let w = iw * 0.8;
      let h = w / RATIO;
      if (h > ih * 0.9) { h = ih * 0.9; w = h * RATIO; }
      this.state.cropper.rect = {
        x: (iw - w) / 2, y: (ih - h) / 2, w, h,
      };
      applyRect();
    };

    // Перетаскивание рамки
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

    // Ресайз через угол
    let resizing = false, resizeStart = null;
    handle.onmousedown = (e) => {
      resizing = true;
      resizeStart = { x: e.clientX, y: e.clientY, r: { ...this.state.cropper.rect } };
      e.stopPropagation();
      e.preventDefault();
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
    if (this.state.cropper?._cleanupDrag) this.state.cropper._cleanupDrag();
    if (this.state.cropper?._cleanupResize) this.state.cropper._cleanupResize();
    $("#cropperModal").classList.remove("open");
    this.state.cropper = null;
  },

  async confirmCrop() {
    const c = this.state.cropper;
    if (!c?.rect) return this.closeCropper();
    const img = $("#cropperImg");

    // Реальные координаты в исходном изображении
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sx = c.rect.x * scaleX;
    const sy = c.rect.y * scaleY;
    const sw = c.rect.w * scaleX;
    const sh = c.rect.h * scaleY;

    const canvas = document.createElement("canvas");
    const OUT_W = 1280, OUT_H = 720;
    canvas.width = OUT_W; canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);

    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));
    c.resultBlob = blob;

    // Превью в форме
    const preview = URL.createObjectURL(blob);
    const wrap = document.createElement("div");
    wrap.style.marginTop = "10px";
    wrap.innerHTML = `<img src="${preview}" style="max-width:220px;border-radius:10px;border:1px solid var(--border)">`;
    const existing = $("#fCover")?.parentElement?.querySelector(".cover-preview");
    if (existing) existing.remove();
    wrap.className = "cover-preview";
    $("#fCover").parentElement.appendChild(wrap);

    toast("Обложка обрезана", "success");
    this.closeCropper();
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

  // ---------- VERSION ----------
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
  },
  closeVersion() { $("#versionModal").classList.remove("open"); },

  async submitVersion() {
    const errEl = $("#versionError");
    errEl.classList.add("hidden");
    const err = (m) => {
      errEl.textContent = m;
      errEl.classList.remove("hidden");
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
      // 1) Создаём game_versions
      const { data: vRow, error: vErr } = await supa.from("game_versions").insert({
        game_id: gameId,
        version,
        executable: exe,
        changelog,
        status: "ready",
      }).select().single();
      if (vErr) throw vErr;

      // 2) Ссылка
      let downloadUrl = external || null;
      let fileName = null;
      let fileSize = 0;

      if (file) {
        bar.style.width = "0%";
        txt.textContent = "Загрузка в хранилище...";
        fileName = file.name;
        fileSize = file.size;
        const path = `${this.state.user.id}/${gameId}/${version}/${file.name}`;

        // supabase-js v2 не даёт onProgress для upload, поэтому простая загрузка
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
        fileSize = 0;
      }

      // 3) Запись в version_files
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

  // ---------- PUBLISH TOGGLE ----------
  async togglePublish(gameId) {
    const g = this.state.myGames.find(x => x.id === gameId);
    if (!g) return;
    const next = g.status === "published" ? "hidden" : "published";
    const { error } = await supa.from("games").update({ status: next }).eq("id", gameId);
    if (error) { toast(error.message, "error"); return; }
    toast(next === "published" ? "Опубликовано" : "Скрыто", "success");
    await this.loadDashboard();
  },
