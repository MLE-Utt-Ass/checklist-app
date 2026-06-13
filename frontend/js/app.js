// ── config ────────────────────────────────────────────────────────────────────
const API = window.location.origin;
const WS_BASE = (window.location.protocol === "https:" ? "wss" : "ws") + "://" + window.location.host;

// ── state ─────────────────────────────────────────────────────────────────────
let user = null;       // {id, name}
let checklists = [];
let currentCl = null;  // full checklist object with live checks
let ws = null;
let wsReconnectTimer = null;

// ── utils ─────────────────────────────────────────────────────────────────────
function $(sel, ctx = document) { return ctx.querySelector(sel); }

function avatarColor(name) {
  const colors = ["#e53e3e","#dd6b20","#d69e2e","#38a169","#3182ce","#805ad5","#d53f8c","#00b5d8"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function avatarHTML(name, size = 26) {
  const initials = name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${avatarColor(name)}">${initials}</span>`;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

let toastTimer = null;
function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
}

// ── routing ───────────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
  window.scrollTo(0, 0);
}

// ── render: login ─────────────────────────────────────────────────────────────
function renderLogin() {
  document.getElementById("app").innerHTML = `
    <div id="view-login" class="view active">
      <div class="login-wrap">
        <div class="login-logo">🧭</div>
        <div>
          <div class="login-title">Trail Checklist</div>
          <div class="login-subtitle" style="margin-top:0.4rem">Real-time shared checklists for your group</div>
        </div>
        <form class="login-form" id="login-form">
          <input type="text" id="login-name" placeholder="Enter your name" maxlength="40"
                 autocomplete="given-name" autocorrect="off" autocapitalize="words">
          <button type="submit" class="btn btn-primary">Let's go →</button>
        </form>
      </div>
    </div>`;

  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = document.getElementById("login-name").value.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({name}),
      });
      if (!res.ok) throw new Error("Login failed");
      user = await res.json();
      localStorage.setItem("checklist_user", JSON.stringify(user));
      renderHome();
    } catch {
      showToast("Could not connect — try again");
    }
  });

  // auto-focus on desktop
  setTimeout(() => document.getElementById("login-name")?.focus(), 100);
}

// ── render: home ──────────────────────────────────────────────────────────────
async function renderHome() {
  document.getElementById("app").innerHTML = `
    <div id="view-home" class="view active">
      <div class="home-header">
        <h1>🧭 Trail Checklist</h1>
        <p>Real-time shared checklists</p>
        <div class="home-user-bar">
          ${avatarHTML(user.name, 22)}
          <span>${escHtml(user.name)}</span>
          <span style="opacity:0.6">·</span>
          <button onclick="logout()" style="background:none;border:none;color:rgba(255,255,255,0.75);font-size:0.8rem;cursor:pointer;padding:0">Sign out</button>
        </div>
      </div>
      <div class="main" id="home-list">
        <div class="loading-wrap"><div class="spinner"></div><span>Loading…</span></div>
      </div>
    </div>`;

  try {
    const res = await fetch(`${API}/api/checklists`);
    checklists = await res.json();
    renderHomeList();
  } catch {
    document.getElementById("home-list").innerHTML =
      `<div class="loading-wrap">Failed to load. <button class="btn btn-outline btn-sm" onclick="renderHome()">Retry</button></div>`;
  }
}

function renderHomeList() {
  const list = document.getElementById("home-list");
  if (!list) return;
  list.innerHTML = checklists.map(cl => `
    <div class="checklist-card" onclick="openChecklist('${escHtml(cl.id)}')">
      <div class="checklist-card-inner">
        <div class="checklist-card-icon">📋</div>
        <div class="checklist-card-body">
          <div class="checklist-card-title">${escHtml(cl.title)}</div>
          <div class="checklist-card-desc">${escHtml(cl.description)}</div>
          <div class="checklist-card-meta">${cl.section_count} sections · ${cl.item_count} items</div>
        </div>
        <div class="checklist-card-arrow">›</div>
      </div>
    </div>`).join("");
}

// ── render: checklist ─────────────────────────────────────────────────────────
async function openChecklist(clId) {
  closWs();
  currentCl = null;

  document.getElementById("app").innerHTML = `
    <div id="view-checklist" class="view active">
      <div class="topbar">
        <div class="topbar-inner">
          <button class="topbar-back" onclick="goHome()">‹</button>
          <span class="topbar-title" id="cl-title">Loading…</span>
          <div class="topbar-user">
            ${avatarHTML(user.name)}
            <span>${escHtml(user.name)}</span>
            <span class="ws-dot connecting" id="ws-dot"></span>
          </div>
        </div>
      </div>
      <div class="conn-banner" id="conn-banner">Reconnecting…</div>
      <div id="cl-body">
        <div class="loading-wrap"><div class="spinner"></div><span>Loading checklist…</span></div>
      </div>
    </div>`;

  connectWs(clId);
}

function renderChecklistBody(cl) {
  currentCl = cl;
  document.getElementById("cl-title").textContent = cl.title;

  const totalItems = cl.sections.reduce((s, sec) => s + sec.items.length, 0);
  const checkedItems = cl.sections.reduce((s, sec) =>
    s + sec.items.filter(it => it.checked_by.length > 0).length, 0);

  const myCheckedItems = cl.sections.reduce((s, sec) =>
    s + sec.items.filter(it => it.checked_by.some(c => c.user_id === user.id)).length, 0);

  const pct = totalItems ? Math.round(checkedItems / totalItems * 100) : 0;

  const badgeHtml = cl.badge
    ? `<div class="badge-strip">${escHtml(cl.badge)}</div>` : "";

  const onlineHtml = renderOnlineBar(cl.online_users);

  const sectionsHtml = cl.sections.map(sec => renderSection(sec)).join("");

  document.getElementById("cl-body").innerHTML = `
    ${badgeHtml}
    <div class="progress-wrap">
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="progress-label" id="progress-label">
        ${checkedItems} of ${totalItems} items checked (${pct}%) &nbsp;·&nbsp; you: ${myCheckedItems}
      </div>
      <div class="progress-actions">
        <button class="btn btn-green btn-sm" onclick="checkAllMine()">✓ Check all (me)</button>
        <button class="btn btn-outline btn-sm" onclick="uncheckAllMine()">✗ Uncheck mine</button>
        <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Print</button>
      </div>
    </div>
    ${onlineHtml}
    <div class="main" id="cl-sections">${sectionsHtml}</div>`;

  attachItemListeners();
}

function renderOnlineBar(users) {
  if (!users || users.length === 0) return "";
  return `<div class="online-bar">
    <span class="online-bar-label">Online:</span>
    <div class="online-avatars">
      ${users.map(u => `<span title="${escHtml(u.name)}">${avatarHTML(u.name, 28)}</span>`).join("")}
    </div>
    <span style="font-size:0.75rem;color:var(--text3);margin-left:0.25rem">${users.map(u => escHtml(u.name)).join(", ")}</span>
  </div>`;
}

function renderSection(sec) {
  const total = sec.items.length;
  const checked = sec.items.filter(it => it.checked_by.length > 0).length;
  const optTag = sec.optional ? `<span class="section-optional-tag">Optional</span>` : "";

  return `
    <div class="section" id="sec-${escHtml(sec.id)}">
      <div class="section-header" onclick="toggleSection('${escHtml(sec.id)}')">
        <span class="section-icon">${sec.icon}</span>
        <span class="section-title">${escHtml(sec.title)}${optTag}</span>
        <span class="section-count" id="sec-count-${escHtml(sec.id)}">${checked}/${total}</span>
        <span class="section-chevron">▼</span>
      </div>
      <div class="section-body">
        ${sec.items.map(it => renderItem(it)).join("")}
      </div>
    </div>`;
}

function renderItem(item) {
  const myCheck = item.checked_by.some(c => c.user_id === user.id);
  const anyCheck = item.checked_by.length > 0;
  const cls = myCheck ? "fully-checked" : (anyCheck ? "partial" : "");

  const tags = (item.tags || []).map(t =>
    `<span class="tag tag-${escHtml(t)}">${escHtml(t)}</span>`).join("");

  const checkers = item.checked_by.map(c =>
    `<span class="checker-chip">${avatarHTML(c.user_name, 16)}<span>${escHtml(c.user_name)}</span></span>`
  ).join("");

  return `
    <div class="item ${cls}" data-item-id="${escHtml(item.id)}" onclick="toggleItem(this)">
      <div class="item-check">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <path d="M1 5l3.5 3.5L11 1" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="item-body">
        <div class="item-label">${escHtml(item.label)}</div>
        ${item.note ? `<div class="item-note">${escHtml(item.note)}</div>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        ${checkers ? `<div class="item-checkers" id="checkers-${escHtml(item.id)}">${checkers}</div>` : `<div class="item-checkers" id="checkers-${escHtml(item.id)}"></div>`}
      </div>
    </div>`;
}

function attachItemListeners() {
  // items use onclick delegation via data attr — no additional listeners needed
}

function toggleSection(id) {
  document.getElementById("sec-" + id)?.classList.toggle("collapsed");
}

function toggleItem(el) {
  const itemId = el.dataset.itemId;
  if (!itemId || !ws || ws.readyState !== WebSocket.OPEN) {
    showToast("Not connected — please wait");
    return;
  }
  const isMyCheck = el.classList.contains("fully-checked");
  ws.send(JSON.stringify({ type: "check", item_id: itemId, checked: !isMyCheck }));
  // optimistic UI
  el.classList.toggle("fully-checked", !isMyCheck);
  if (!isMyCheck) el.classList.remove("partial");
}

// ── patch single item after ws update ─────────────────────────────────────────
function patchItem(itemId, checkedBy) {
  const el = document.querySelector(`[data-item-id="${itemId}"]`);
  if (!el) return;

  const myCheck = checkedBy.some(c => c.user_id === user.id);
  const anyCheck = checkedBy.length > 0;
  el.classList.toggle("fully-checked", myCheck);
  el.classList.toggle("partial", !myCheck && anyCheck);

  const checkersEl = document.getElementById("checkers-" + itemId);
  if (checkersEl) {
    checkersEl.innerHTML = checkedBy.map(c =>
      `<span class="checker-chip">${avatarHTML(c.user_name, 16)}<span>${escHtml(c.user_name)}</span></span>`
    ).join("");
  }

  // update section count
  if (currentCl) {
    for (const sec of currentCl.sections) {
      const item = sec.items.find(i => i.id === itemId);
      if (item) {
        item.checked_by = checkedBy;
        const checked = sec.items.filter(i => i.checked_by.length > 0).length;
        const countEl = document.getElementById("sec-count-" + sec.id);
        if (countEl) countEl.textContent = `${checked}/${sec.items.length}`;
        break;
      }
    }
  }

  updateProgressBar();
}

function updateProgressBar() {
  if (!currentCl) return;
  const totalItems = currentCl.sections.reduce((s, sec) => s + sec.items.length, 0);
  const checkedItems = currentCl.sections.reduce((s, sec) =>
    s + sec.items.filter(it => it.checked_by.length > 0).length, 0);
  const myCheckedItems = currentCl.sections.reduce((s, sec) =>
    s + sec.items.filter(it => it.checked_by.some(c => c.user_id === user.id)).length, 0);
  const pct = totalItems ? Math.round(checkedItems / totalItems * 100) : 0;

  const fill = document.getElementById("progress-fill");
  const label = document.getElementById("progress-label");
  if (fill) fill.style.width = pct + "%";
  if (label) label.textContent = `${checkedItems} of ${totalItems} items checked (${pct}%) · you: ${myCheckedItems}`;
}

function updateOnlineBar(users) {
  // rebuild online bar in place if it exists
  const existing = document.querySelector(".online-bar");
  const parent = existing?.parentElement;
  if (existing && parent && currentCl) {
    currentCl.online_users = users;
    const next = document.createElement("div");
    next.innerHTML = renderOnlineBar(users);
    const newBar = next.firstElementChild;
    if (newBar) parent.replaceChild(newBar, existing);
  }
}

// ── bulk actions ──────────────────────────────────────────────────────────────
function checkAllMine() {
  if (!currentCl || !ws || ws.readyState !== WebSocket.OPEN) return;
  currentCl.sections.forEach(sec => {
    sec.items.forEach(item => {
      if (!item.checked_by.some(c => c.user_id === user.id)) {
        ws.send(JSON.stringify({ type: "check", item_id: item.id, checked: true }));
      }
    });
  });
}

function uncheckAllMine() {
  if (!currentCl || !ws || ws.readyState !== WebSocket.OPEN) return;
  currentCl.sections.forEach(sec => {
    sec.items.forEach(item => {
      if (item.checked_by.some(c => c.user_id === user.id)) {
        ws.send(JSON.stringify({ type: "check", item_id: item.id, checked: false }));
      }
    });
  });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWs(clId) {
  clearTimeout(wsReconnectTimer);
  setWsDot("connecting");

  ws = new WebSocket(`${WS_BASE}/ws/${clId}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", user_name: user.name }));
  };

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === "state") {
      renderChecklistBody(msg.checklist);
      setWsDot("connected");
      hideBanner();
    }

    if (msg.type === "item_update") {
      patchItem(msg.item_id, msg.checked_by);
    }

    if (msg.type === "user_join") {
      updateOnlineBar(msg.online_users);
      showToast(`${msg.user.name} joined`);
    }

    if (msg.type === "user_leave") {
      updateOnlineBar(msg.online_users);
    }
  };

  ws.onclose = () => {
    setWsDot("disconnected");
    showBanner();
    wsReconnectTimer = setTimeout(() => connectWs(clId), 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function closWs() {
  clearTimeout(wsReconnectTimer);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

function setWsDot(state) {
  const d = document.getElementById("ws-dot");
  if (d) { d.className = `ws-dot ${state}`; }
}

function showBanner() {
  document.getElementById("conn-banner")?.classList.add("show");
}
function hideBanner() {
  document.getElementById("conn-banner")?.classList.remove("show");
}

// ── navigation ────────────────────────────────────────────────────────────────
function goHome() {
  closWs();
  currentCl = null;
  renderHome();
}

function logout() {
  closWs();
  localStorage.removeItem("checklist_user");
  user = null;
  renderLogin();
}

// ── init ──────────────────────────────────────────────────────────────────────
(function init() {
  try {
    const saved = localStorage.getItem("checklist_user");
    if (saved) {
      user = JSON.parse(saved);
      renderHome();
      return;
    }
  } catch {}
  renderLogin();
})();
