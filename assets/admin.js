// website/assets/admin.js
const CFG = window.NEXPLAY_CONFIG;
const supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleString("ru-RU") : "—";

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind; el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

const Admin = {
  state: { user: null, profile: null, tab: "users" },

  async init() {
    const { data } = await supa.auth.getSession();
    this.state.user = data.session?.user ?? null;
    if (this.state.user) {
      const { data: p } = await supa.from("profiles").select("*").eq("id", this.state.user.id).single();
      this.state.profile = p;
    }
    const el = $("#authArea");
    if (this.state.user) {
      const n = this.state.profile?.username ?? "?";
      el.innerHTML = `<span style="color:var(--muted);font-size:13px">@${esc(n)}</span>`;
    } else {
      el.innerHTML = `<a class="btn btn-sm" href="index.html">Войти</a>`;
    }

    if (!this.state.user || this.state.profile?.role !== "admin") {
      $("#denied").classList.remove("hidden");
      return;
    }
    $("#admin").classList.remove("hidden");
    await this.loadStats();
    this.tab("users");
  },

  async loadStats() {
    const [{ count: users }, { count: games }, { count: reports }] = await Promise.all([
      supa.from("profiles").select("*", { count: "exact", head: true }),
      supa.from("games").select("*", { count: "exact", head: true }),
      supa.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
    ]);
    const { data: dl } = await supa.from("games").select("downloads");
    const total = (dl ?? []).reduce((a, g) => a + (g.downloads || 0), 0);
    $("#stUsers").textContent = users ?? 0;
    $("#stGames").textContent = games ?? 0;
    $("#stDownloads").textContent = total;
    $("#stReports").textContent = reports ?? 0;
  },

  tab(name) {
    this.state.tab = name;
    ["users", "games", "reports"].forEach(t => {
      document.getElementById("tab" + t[0].toUpperCase() + t.slice(1))
        .classList.toggle("active", t === name);
    });
    if (name === "users") this.renderUsers();
    if (name === "games") this.renderGames();
    if (name === "reports") this.renderReports();
  },

  async renderUsers() {
    const el = $("#panel");
    el.innerHTML = `<div class="empty"><span class="loader"></span></div>`;
    const { data } = await supa.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
    el.innerHTML = `
      <div style="overflow:auto;border:1px solid var(--border);border-radius:var(--radius)">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead style="background:var(--surface-2);text-align:left">
            <tr><th style="padding:12px">Username</th><th style="padding:12px">Роль</th>
                <th style="padding:12px">Статус</th><th style="padding:12px">Создан</th><th style="padding:12px">Действия</th></tr>
          </thead>
          <tbody>
          ${(data ?? []).map(u => `
            <tr style="border-top:1px solid var(--border)">
              <td style="padding:10px 12px">@${esc(u.username)}</td>
              <td style="padding:10px 12px">
                <select onchange="Admin.setRole('${u.id}', this.value)" style="background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px">
                  ${["user","developer","admin"].map(r => `<option value="${r}" ${u.role===r?"selected":""}>${r}</option>`).join("")}
                </select>
              </td>
              <td style="padding:10px 12px">${u.is_blocked ? "🚫 blocked" : "✅ active"}</td>
              <td style="padding:10px 12px;color:var(--muted)">${fmtDate(u.created_at)}</td>
              <td style="padding:10px 12px">
                <button class="btn btn-sm" onclick="Admin.toggleBlock('${u.id}', ${u.is_blocked})">
                  ${u.is_blocked ? "Разблокировать" : "Заблокировать"}
                </button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  },

  async setRole(userId, role) {
    const { error } = await supa.from("profiles").update({ role }).eq("id", userId);
    if (error) { toast(error.message, "error"); return; }
    toast("Роль обновлена", "success");
  },

  async toggleBlock(userId, blocked) {
    const { error } = await supa.from("profiles").update({ is_blocked: !blocked }).eq("id", userId);
    if (error) { toast(error.message, "error"); return; }
    toast(blocked ? "Разблокирован" : "Заблокирован", "success");
    this.renderUsers();
  },

  async renderGames() {
    const el = $("#panel");
    el.innerHTML = `<div class="empty"><span class="loader"></span></div>`;
    const { data } = await supa.from("games").select("*").order("created_at", { ascending: false }).limit(200);
    el.innerHTML = `
      <div style="display:grid;gap:12px">
        ${(data ?? []).map(g => `
          <div style="display:flex;gap:14px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);align-items:center">
            <div style="width:120px;height:68px;border-radius:8px;overflow:hidden;background:var(--surface-2);flex-shrink:0">
              ${g.cover_url ? `<img src="${esc(g.cover_url)}" style="width:100%;height:100%;object-fit:cover">` : ""}
            </div>
            <div style="flex:1">
              <div style="font-weight:700">${esc(g.title)}</div>
              <div style="color:var(--muted);font-size:13px">${esc(g.developer_name)} · ${esc(g.status)} · ⬇ ${g.downloads}</div>
            </div>
            <div style="display:flex;gap:6px">
              <a class="btn btn-sm" href="index.html#/game/${esc(g.slug)}">Открыть</a>
              <button class="btn btn-sm" onclick="Admin.hideGame('${g.id}', 'hidden')">Скрыть</button>
              <button class="btn btn-sm btn-danger" onclick="Admin.deleteGame('${g.id}')">Удалить</button>
            </div>
          </div>`).join("")}
      </div>`;
  },

  async hideGame(id, status) {
    const { error } = await supa.from("games").update({ status }).eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    toast("Обновлено", "success");
    this.renderGames();
  },

  async deleteGame(id) {
    if (!confirm("Удалить игру навсегда?")) return;
    const { error } = await supa.from("games").delete().eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    toast("Удалено", "success");
    this.renderGames();
  },

  async renderReports() {
    const el = $("#panel");
    el.innerHTML = `<div class="empty"><span class="loader"></span></div>`;
    const { data } = await supa.from("reports").select("*, games(title, slug)").order("created_at", { ascending: false }).limit(200);
    if (!data?.length) { el.innerHTML = `<div class="empty">Жалоб нет</div>`; return; }
    el.innerHTML = data.map(r => `
      <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px">
        <div style="display:flex;justify-content:space-between">
          <b>${r.games ? esc(r.games.title) : "—"}</b>
          <span style="color:var(--muted);font-size:12px">${fmtDate(r.created_at)}</span>
        </div>
        <div style="margin:8px 0;color:#cfcfe0">${esc(r.reason)}</div>
        <button class="btn btn-sm" onclick="Admin.resolveReport('${r.id}','resolved')">Решено</button>
        <button class="btn btn-sm" onclick="Admin.resolveReport('${r.id}','rejected')">Отклонить</button>
      </div>`).join("");
  },

  async resolveReport(id, status) {
    const { error } = await supa.from("reports").update({ status }).eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    toast("Статус обновлён", "success");
    this.renderReports();
  },
};

window.Admin = Admin;
window.addEventListener("DOMContentLoaded", () => Admin.init());