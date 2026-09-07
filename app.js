// ============================================================
// EPIC BATTLE — client logic
// ============================================================

// ---------- CONFIG ----------
const API_URL = "https://lagger077.pythonanywhere.com";

// ============================================================
// TELEGRAM INIT
// ============================================================

const Tg = (function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  let isTelegram = false;
  let user = null;
  let initData = "";
  let startParam = "";

  if (tg && tg.initDataUnsafe && Object.keys(tg.initDataUnsafe).length > 0) {
    isTelegram = true;
    try { tg.ready(); } catch (e) {}
    try { tg.expand(); } catch (e) {}
    try { tg.setHeaderColor && tg.setHeaderColor("#0a0b0f"); } catch (e) {}
    try { tg.setBackgroundColor && tg.setBackgroundColor("#0a0b0f"); } catch (e) {}
    user = tg.initDataUnsafe.user || null;
    initData = tg.initData || "";
    startParam = tg.initDataUnsafe.start_param || "";
  }

  function haptic(type, style) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (type === "impact") tg.HapticFeedback.impactOccurred(style || "light");
      if (type === "notification") tg.HapticFeedback.notificationOccurred(style || "success");
      if (type === "selection") tg.HapticFeedback.selectionChanged();
    } catch (e) {}
  }

  return { tg, isTelegram, user, initData, startParam, haptic };
})();

// ============================================================
// API CLIENT
// ============================================================

const Api = (function () {
  let token = localStorage.getItem("eb_token") || null;

  function setToken(t) {
    token = t;
    localStorage.setItem("eb_token", t);
  }

  async function request(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (token) headers["Authorization"] = "Bearer " + token;

    let res;
    try {
      res = await fetch(API_URL + path, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      return { ok: false, offline: true, error: { message: "Нет соединения с сервером" } };
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      return { ok: false, error: { message: "Некорректный ответ сервера" } };
    }
    return data;
  }

  return {
    get token() { return token; },
    setToken,
    get: (path) => request(path, { method: "GET" }),
    post: (path, body) => request(path, { method: "POST", body }),
  };
})();

// ============================================================
// STATE
// ============================================================

const State = {
  user: null,
  currentScreen: "home",
  history: ["home"],
  pvp: { players: [], status: "waiting", bank: 0, roundId: null },
  offline: false,
};

// ============================================================
// UTILITIES
// ============================================================

function fmt(n, digits = 2) {
  const v = Number(n || 0);
  return v.toFixed(digits);
}

function colorForString(str) {
  const colors = ["#3ea6ff", "#a76bff", "#28d17c", "#ffb23e", "#ff5c5c", "#20d6d0"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name) {
  if (!name) return "?";
  return name.slice(0, 2).toUpperCase();
}

function timeAgoOrDate(ts) {
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} • ${hh}:${min}`;
}

function formatCountdown(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// ============================================================
// TOASTS
// ============================================================

function toast(message, type = "info") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2900);
}

// ============================================================
// NAVIGATION
// ============================================================

const NAV_SCREENS = ["home", "pvp", "crash", "history", "rewards", "invite"];
const BOTTOM_NAV_SCREENS = ["home", "invite", "rewards"];

function showScreen(name, opts = {}) {
  if (!NAV_SCREENS.includes(name)) name = "home";
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById("screen-" + name);
  if (el) el.classList.add("active");

  State.currentScreen = name;
  if (!opts.skipHistory) State.history.push(name);

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.target === name && BOTTOM_NAV_SCREENS.includes(name));
  });

  const back = document.getElementById("btnBack");
  back.classList.toggle("hidden-el", name === "home");

  const titleText = document.getElementById("topbarTitleText");
  const titles = {
    home: "Epic Battle", pvp: "PVP Битва", crash: "Crash", history: "История",
    rewards: "Награды", invite: "Пригласить",
  };
  titleText.textContent = titles[name] || "Epic Battle";

  Tg.haptic("selection");

  if (name === "pvp") { Pvp.refresh(); Pvp.startPolling(); } else { Pvp.stopPolling(); }
  if (name === "crash") { Crash.startPolling(); } else { Crash.stopPolling(); }
  if (name === "rewards") Rewards.load();
  if (name === "invite") Invite.load();
  if (name === "history") History.load();
}

function goBack() {
  State.history.pop();
  const prev = State.history.length ? State.history[State.history.length - 1] : "home";
  showScreen(prev, { skipHistory: true });
}

// ============================================================
// USER / BALANCE
// ============================================================

const User = {
  async authenticate() {
    let demoId = localStorage.getItem("eb_demo_id");
    if (!demoId) {
      demoId = "demo_" + Math.random().toString(36).slice(2, 12);
      localStorage.setItem("eb_demo_id", demoId);
    }
    const body = {};
    if (Tg.isTelegram && Tg.initData) {
      body.init_data = Tg.initData;
    } else {
      body.demo_id = demoId;
    }
    const refCode = getStartParamRef();
    if (refCode) body.ref = refCode;

    const res = await Api.post("/api/auth", body);
    if (!res.ok) {
      State.offline = true;
      renderOfflineFallback();
      return;
    }
    Api.setToken(res.token);
    State.user = res.user;
    renderUserUI();

    if (refCode) {
      Api.post("/api/referral", { code: refCode });
    }
  },

  async refreshBalance() {
    const res = await Api.get("/api/balance");
    if (!res.ok) return;
    if (res.balance !== State.user.balance) {
      State.user.balance = res.balance;
      renderUserUI(true);
    }
  },
};

function getStartParamRef() {
  if (Tg.startParam && Tg.startParam.startsWith("ref_")) return Tg.startParam;
  const params = new URLSearchParams(window.location.search);
  const sp = params.get("startapp") || params.get("ref");
  if (sp && sp.startsWith("ref_")) return sp;
  return null;
}

function renderUserUI(pulse = false) {
  if (!State.user) return;
  document.getElementById("balanceValue").textContent = fmt(State.user.balance);
  document.getElementById("statBalance").innerHTML = fmt(State.user.balance) + ' <span class="ton-icon">◆</span>';
  document.getElementById("userName").textContent = State.user.username || "Гость";
  document.getElementById("userSub").textContent = State.user.is_demo ? "demo режим" : "Telegram аккаунт";
  const avatar = document.getElementById("userAvatar");
  avatar.src = State.user.avatar_url || svgAvatarDataUri(State.user.username || "U");
  avatar.onerror = () => { avatar.src = svgAvatarDataUri(State.user.username || "U"); };

  if (pulse) {
    const pill = document.getElementById("balancePill");
    pill.classList.remove("pulse");
    void pill.offsetWidth;
    pill.classList.add("pulse");
  }
}

function svgAvatarDataUri(name) {
  const color = colorForString(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="${color}"/><text x="50%" y="56%" font-family="sans-serif" font-size="24" fill="white" text-anchor="middle">${initials(name)}</text></svg>`;
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

function renderOfflineFallback() {
  toast("Нет связи с сервером. Работаем в оффлайн demo-режиме.", "error");
  State.user = { id: 0, username: "Guest", balance: 0, is_demo: true, avatar_url: "" };
  renderUserUI();
}

// ============================================================
// PVP WHEEL
// ============================================================

const Pvp = {
  pollTimer: null,
  countdownTimer: null,
  serverOffset: 0,
  lastGame: null,
  lastAreaSig: null,

  startPolling() {
    this.stopPolling();
    this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), 1500);
    this.countdownTimer = setInterval(() => this.tickCountdown(), 250);
  },
  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.pollTimer = null;
    this.countdownTimer = null;
  },

  nowServer() {
    return Date.now() / 1000 + this.serverOffset;
  },

  async refresh() {
    const res = await Api.get("/api/game");
    if (!res.ok) return;
    this.serverOffset = res.game.server_time - Date.now() / 1000;
    this.render(res.game);
    this.renderHome(res.game);
  },

  // Between polls (every 1.5s) the countdown text would otherwise jump
  // in uneven chunks — tick it locally every 250ms instead, so it counts
  // down smoothly like a real clock.
  tickCountdown() {
    if (!this.lastGame || this.lastGame.status !== "countdown") return;
    const timerEl = document.getElementById("wheelTimer");
    const left = Math.max(0, Math.ceil(this.lastGame.countdown_at - this.nowServer()));
    timerEl.textContent = left + "s";
  },

  renderHome(game) {
    document.getElementById("homePvpBank").textContent = `Банк: ${fmt(game.bank)} ◆`;
    const wrap = document.getElementById("homePvpPlayers");
    wrap.innerHTML = "";
    game.players.slice(0, 5).forEach((p) => {
      const d = document.createElement("div");
      d.className = "mini-avatar";
      d.style.background = p.color;
      d.textContent = initials(p.name);
      wrap.appendChild(d);
    });
  },

  render(game) {
    State.pvp = game;
    this.lastGame = game;

    document.getElementById("pvpBankValue").innerHTML = `${fmt(game.bank)} <span class="ton-icon">◆</span>`;

    const statusEl = document.getElementById("wheelStatus");
    const timerEl = document.getElementById("wheelTimer");
    const overlayEl = document.getElementById("squareStatusOverlay");
    const joinBtn = document.getElementById("btnJoinBattle");

    if (game.status === "waiting") {
      overlayEl.style.opacity = "1";
      statusEl.textContent = "WAITING";
      statusEl.classList.remove("live");
      timerEl.textContent = game.players.length + "/" + game.min_players;
      joinBtn.textContent = "Присоединиться к битве";
      joinBtn.classList.remove("disabled");
    } else if (game.status === "countdown") {
      overlayEl.style.opacity = "1";
      statusEl.textContent = "СТАРТ ЧЕРЕЗ";
      statusEl.classList.remove("live");
      this.tickCountdown();
      joinBtn.textContent = "Присоединиться к битве";
      joinBtn.classList.remove("disabled");
    } else if (game.status === "spinning") {
      overlayEl.style.opacity = "0";
      statusEl.textContent = "LIVE";
      statusEl.classList.add("live");
      timerEl.textContent = "";
      joinBtn.textContent = "Раунд идёт...";
      joinBtn.classList.add("disabled");
      this.revealWinner(game);
    } else if (game.status === "finished") {
      overlayEl.style.opacity = "1";
      statusEl.textContent = "WAITING";
      statusEl.classList.remove("live");
      timerEl.textContent = "";
      joinBtn.textContent = "Присоединиться к битве";
      joinBtn.classList.remove("disabled");
    }

    // Bets are locked once the round goes live, so the areas can't change
    // mid-reveal — skip rebuilding the layout then to avoid a jarring
    // reshuffle, and only redraw the rest of the time when something changed.
    const sig = game.players.map((p) => `${p.user_id}:${p.amount}`).join("|");
    const shouldRedraw = game.status === "spinning" ? this.lastAreaSig === null : sig !== this.lastAreaSig;
    if (shouldRedraw) {
      this.lastAreaSig = sig;
      this.renderSquareAreas(game.players);
    }
    this.renderPlayerCards(game.players);
  },

  lastSpinRoundId: null,
  // Returns the {x%, y%} center point of a player cell within the square,
  // used as waypoints for the reveal marker.
  cellCenter(cell) {
    if (cell.classList.contains("square-main")) return { x: 50, y: 50 };
    const w = parseFloat(cell.style.width) || 20;
    const h = parseFloat(cell.style.height) || 20;
    if (cell.classList.contains("corner-tl")) return { x: w * 0.32, y: h * 0.32 };
    if (cell.classList.contains("corner-tr")) return { x: 100 - w * 0.32, y: h * 0.32 };
    if (cell.classList.contains("corner-bl")) return { x: w * 0.32, y: 100 - h * 0.32 };
    if (cell.classList.contains("corner-br")) return { x: 100 - w * 0.32, y: 100 - h * 0.32 };
    return { x: 50, y: 50 };
  },

  revealWinner(game) {
    if (this.lastSpinRoundId === game.round_id) return;
    this.lastSpinRoundId = game.round_id;
    const wrap = document.getElementById("squareWrap");
    const cells = Array.from(wrap.querySelectorAll("[data-uid]"));
    if (!cells.length) return;
    Tg.haptic("impact", "medium");

    let marker = document.getElementById("revealMarker");
    if (!marker) {
      marker = document.createElement("div");
      marker.id = "revealMarker";
      marker.className = "reveal-marker";
      wrap.appendChild(marker);
    }
    marker.classList.remove("landed");
    marker.style.opacity = "1";

    // The marker hops between players and slows down step by step, landing
    // on the real winner last — a ball settling into its pocket, not just
    // the cells themselves fading in and out.
    const winnerCell = cells.find((c) => String(game.winner_user_id) === c.dataset.uid) || cells[0];
    const steps = 12;
    const sequence = [];
    for (let i = 0; i < steps - 1; i++) {
      sequence.push(cells[Math.floor(Math.random() * cells.length)]);
    }
    sequence.push(winnerCell);

    let delay = 90;
    let i = 0;
    const tick = () => {
      const cell = sequence[i];
      const pos = this.cellCenter(cell);
      marker.style.left = pos.x + "%";
      marker.style.top = pos.y + "%";
      Tg.haptic("selection");
      i++;
      delay *= 1.26; // ease-out — each hop a little slower than the last
      if (i < sequence.length) {
        setTimeout(tick, delay);
      } else {
        setTimeout(() => {
          marker.classList.add("landed");
          cells.forEach((c) => {
            if (c === winnerCell) c.classList.add("winner-cell");
            else c.classList.add("dim-cell");
          });

          setTimeout(() => {
            const isMe = State.user && game.winner_user_id === State.user.id;
            if (isMe) {
              Tg.haptic("notification", "success");
              User.refreshBalance();
              showWinModal(`Вы выиграли!`, `+${fmt(game.winner_amount)} ◆`);
            } else {
              toast(`Победил ${game.winner_name} — ${fmt(game.winner_amount)} ◆ (${game.winner_chance}%)`, "info");
            }
            cells.forEach((c) => c.classList.remove("winner-cell", "dim-cell"));
            marker.style.opacity = "0";
            marker.classList.remove("landed");
          }, 1400);
        }, 150);
      }
    };
    tick();
  },

  // Biggest bettor fills the whole square with their avatar centered on it;
  // everyone else gets a small triangular "corner flag" sized roughly by
  // their bet — bigger bet, bigger corner. Tap any area for the exact numbers.
  renderSquareAreas(players) {
    const wrap = document.getElementById("squareWrap");
    wrap.innerHTML = "";
    if (!players.length) {
      const empty = document.createElement("div");
      empty.className = "square-empty";
      empty.textContent = "Ждём игроков...";
      wrap.appendChild(empty);
      return;
    }

    const sorted = players.slice().sort((a, b) => b.amount - a.amount);
    const main = sorted[0];
    const minors = sorted.slice(1, 5); // up to 4 corners

    const mainCell = document.createElement("div");
    mainCell.className = "square-main";
    mainCell.dataset.uid = main.user_id;
    mainCell.style.background = `linear-gradient(135deg, ${shadeColor(main.color, 22)}, ${shadeColor(main.color, -20)})`;
    mainCell.innerHTML = `
      <div class="square-main-avatar" style="background:${shadeColor(main.color, -6)}">${initials(main.name)}</div>
      <div class="square-main-name">${escapeHtml(main.name)}</div>
      <div class="square-main-amount">${fmt(main.amount)} ◆ · ${main.chance}%</div>
    `;
    mainCell.addEventListener("click", () => toast(`${main.name} — ${fmt(main.amount)} ◆ (${main.chance}%)`, "info"));
    wrap.appendChild(mainCell);

    const cornerClasses = ["corner-tl", "corner-br", "corner-tr", "corner-bl"];
    const minorTotal = minors.reduce((s, p) => s + p.amount, 0) || 1;
    minors.forEach((p, i) => {
      const shareOfMinor = p.amount / minorTotal;
      const sidePct = Math.min(42, Math.max(16, Math.sqrt(shareOfMinor) * 46));
      const corner = document.createElement("div");
      corner.className = `square-corner ${cornerClasses[i]}`;
      corner.dataset.uid = p.user_id;
      corner.style.width = sidePct + "%";
      corner.style.height = sidePct + "%";
      corner.style.background = p.color;
      corner.innerHTML = `<div class="corner-badge" style="background:${shadeColor(p.color, 14)}">${initials(p.name)}</div>`;
      corner.addEventListener("click", () => toast(`${p.name} — ${fmt(p.amount)} ◆ (${p.chance}%)`, "info"));
      wrap.appendChild(corner);
    });
  },

  renderPlayerCards(players) {
    const row = document.getElementById("playersRow");
    const existingIds = Array.from(row.children).map((c) => c.dataset.uid);
    const newIds = players.map((p) => String(p.user_id));
    if (JSON.stringify(existingIds) === JSON.stringify(newIds)) {
      // update values only
      players.forEach((p, i) => {
        const card = row.children[i];
        if (!card) return;
        card.querySelector(".pc-chance").textContent = p.chance + "%";
        card.querySelector(".pc-amount").textContent = fmt(p.amount) + " ◆";
      });
      return;
    }
    row.innerHTML = "";
    players.forEach((p) => {
      const card = document.createElement("div");
      card.className = "player-card";
      card.dataset.uid = p.user_id;
      card.innerHTML = `
        <div class="pc-avatar" style="background:${p.color}">${initials(p.name)}</div>
        <div class="pc-name">${escapeHtml(p.name)}</div>
        <div class="pc-chance" style="color:${p.color}">${p.chance}%</div>
        <div class="pc-amount">${fmt(p.amount)} ◆</div>
      `;
      row.appendChild(card);
    });
  },

  async placeBet(amount) {
    const res = await Api.post("/api/bet", { amount });
    if (!res.ok) {
      toast(res.error ? res.error.message : "Ошибка ставки", "error");
      Tg.haptic("notification", "error");
      return false;
    }
    State.user.balance = res.balance;
    renderUserUI(true);
    toast("Ставка принята", "success");
    Tg.haptic("impact", "light");
    this.render(res.game);
    return true;
  },
};

// Lightens (positive percent) or darkens (negative) a "#rrggbb" color, used
// to give each treemap cell a subtle diagonal gradient.
function shadeColor(hex, percent) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16) || 0;
  const amt = Math.round(2.55 * percent);
  let r = (num >> 16) + amt;
  let g = ((num >> 8) & 0xff) + amt;
  let b = (num & 0xff) + amt;
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return `rgb(${r}, ${g}, ${b})`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// BET SHEET (PVP)
// ============================================================

const BetSheet = {
  open() {
    document.getElementById("betSheetOverlay").classList.remove("hidden");
    document.getElementById("sheetBalance").textContent = fmt(State.user.balance);
    document.getElementById("betAmountInput").value = "";
  },
  close() {
    document.getElementById("betSheetOverlay").classList.add("hidden");
  },
};

function showWinModal(title, amountText) {
  document.getElementById("winTitle").textContent = title;
  document.getElementById("winAmount").textContent = amountText;
  document.getElementById("winOverlay").classList.remove("hidden");
}

// ============================================================
// CRASH GAME
// ============================================================

const Crash = {
  pollTimer: null,
  rafId: null,
  canvas: null,
  ctx: null,
  rocketEl: null,
  cssW: 0,
  cssH: 0,

  // synced-from-server state
  status: "waiting",
  roundId: null,
  serverOffset: 0,
  startedAt: null,
  runAt: null,
  waitSeconds: 8,
  growthRate: 0.17,
  maxMultiplier: 120,
  serverMultiplier: 1,
  bets: [],
  points: [],
  _rocketState: null,
  _explodedRoundId: null,

  startPolling() {
    this.stopPolling();
    this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), 1000);
    this.loop();
  },
  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  },

  initCanvas() {
    if (this.canvas) return;
    this.canvas = document.getElementById("crashCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.rocketEl = document.getElementById("crashRocket");
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.cssW = rect.width;
      this.cssH = rect.height;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
  },

  nowServer() {
    return Date.now() / 1000 + this.serverOffset;
  },

  async refresh() {
    const res = await Api.get("/api/crash/current");
    if (!res.ok) return;
    this.applyServerState(res.crash);
  },

  applyServerState(crash) {
    this.initCanvas();
    this.serverOffset = crash.server_time - Date.now() / 1000;

    if (crash.round_id !== this.roundId) {
      this.roundId = crash.round_id;
      this.points = [];
      document.getElementById("crashPlayers").innerHTML = "";
      this.hideExplosion();
    }

    this.status = crash.status;
    this.startedAt = crash.started_at;
    this.runAt = crash.run_at;
    this.waitSeconds = crash.wait_seconds;
    this.growthRate = crash.growth_rate || 0.17;
    this.maxMultiplier = crash.max_multiplier || 120;
    this.serverMultiplier = crash.multiplier;
    this.bets = crash.bets;

    this.renderHistory(crash.history);
    this.renderPlayers(crash.bets);
    this.updateStatusChrome();
  },

  updateStatusChrome() {
    const statusText = document.getElementById("crashStatusText");
    const actionBtn = document.getElementById("btnCrashAction");

    if (this.status === "waiting") {
      statusText.textContent = "Ожидание ставок";
      statusText.className = "";
      actionBtn.textContent = "Сделать ставку";
      actionBtn.classList.remove("cashout", "disabled");
    } else if (this.status === "running") {
      statusText.textContent = "LIVE";
      statusText.className = "live";
    } else if (this.status === "crashed") {
      statusText.textContent = "Раунд завершён";
      statusText.className = "crashed";
      actionBtn.textContent = "Раунд завершён";
      actionBtn.classList.add("disabled");
      actionBtn.classList.remove("cashout");
      this.triggerExplosion();
    }
  },

  loop() {
    this.tick();
    this.rafId = requestAnimationFrame(() => this.loop());
  },

  tick() {
    if (!this.canvas) return;
    const timerText = document.getElementById("crashTimerText");
    const multEl = document.getElementById("crashMultiplier");
    const actionBtn = document.getElementById("btnCrashAction");

    if (this.status === "waiting") {
      const left = this.waitSeconds - (this.nowServer() - (this.startedAt || this.nowServer()));
      timerText.textContent = formatCountdown(left);
      multEl.textContent = "1.00x";
      multEl.classList.remove("crashed");
      this.points = [];
      this.setRocketPosition(26, this.cssH - 22, 0);
      this.setRocketState("idle");
      this.drawGraph();
      this.setHomeMult(1);
    } else if (this.status === "running") {
      timerText.textContent = "";
      const elapsed = Math.max(0, this.nowServer() - this.runAt);
      const mult = Math.min(Math.exp(this.growthRate * elapsed), this.maxMultiplier);
      multEl.textContent = fmt(mult) + "x";
      multEl.classList.remove("crashed");

      this.points.push({ t: elapsed, m: mult });
      if (this.points.length > 3000) this.points.shift();
      this.drawGraph();
      this.setRocketState("flying");
      this.setHomeMult(mult);

      const myBet = this.bets.find((b) => State.user && b.user_id === State.user.id);
      if (myBet && !myBet.cashed_out) {
        actionBtn.textContent = `Забрать ${fmt(myBet.amount * mult)} ◆`;
        actionBtn.classList.add("cashout");
        actionBtn.classList.remove("disabled");
      } else {
        actionBtn.textContent = "Раунд идёт...";
        actionBtn.classList.add("disabled");
        actionBtn.classList.remove("cashout");
      }
    } else if (this.status === "crashed") {
      timerText.textContent = "";
      multEl.textContent = fmt(this.serverMultiplier) + "x";
      multEl.classList.add("crashed");
      this.drawGraph();
      this.setRocketState("exploded");
      this.setHomeMult(this.serverMultiplier);
    }
  },

  setHomeMult(mult) {
    const el = document.getElementById("homeCrashMult");
    if (el) el.textContent = fmt(mult) + "x";
  },

  computeCurve() {
    const pts = this.points;
    if (pts.length < 2) return null;
    const w = this.cssW, h = this.cssH;
    const domainT = Math.max(pts[pts.length - 1].t, 0.001);
    let maxMult = 2;
    for (const p of pts) if (p.m > maxMult) maxMult = p.m;
    const padLeft = 10, padRight = 22, padTop = 34, padBottom = 14;
    const mapX = (t) => padLeft + (t / domainT) * (w - padLeft - padRight);
    const mapY = (m) => (h - padBottom) - (m / maxMult) * (h - padTop - padBottom);
    return { pts, mapX, mapY };
  },

  drawGraph() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const crashedNow = this.status === "crashed";
    const curve = this.computeCurve();
    if (!curve) return;
    const { pts, mapX, mapY } = curve;

    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = mapX(p.t), y = mapY(p.m);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = crashedNow ? "#ff5c5c" : "#20d6d0";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = crashedNow ? "rgba(255,92,92,0.55)" : "rgba(32,214,208,0.55)";
    ctx.shadowBlur = 10;
    ctx.stroke();

    const lastX = mapX(pts[pts.length - 1].t);
    const lastY = mapY(pts[pts.length - 1].m);
    ctx.lineTo(lastX, this.cssH);
    ctx.lineTo(mapX(pts[0].t), this.cssH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, this.cssH);
    grad.addColorStop(0, crashedNow ? "rgba(255,92,92,0.22)" : "rgba(32,214,208,0.2)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.shadowBlur = 0;
    ctx.fillStyle = grad;
    ctx.fill();

    // rocket heading, sampled a bit behind the tip so the tilt looks stable, not jittery
    let angle = 0;
    if (pts.length > 2) {
      const lastT = pts[pts.length - 1].t;
      let refIdx = 0;
      for (let i = pts.length - 2; i >= 0; i--) {
        refIdx = i;
        if (lastT - pts[i].t >= 0.15) break;
      }
      const p0 = pts[refIdx], p1 = pts[pts.length - 1];
      const dx = mapX(p1.t) - mapX(p0.t);
      const dy = mapY(p1.m) - mapY(p0.m);
      if (dx || dy) {
        angle = Math.atan2(dx, -dy) * 180 / Math.PI;
        angle = Math.max(-55, Math.min(70, angle));
      }
    }
    this.setRocketPosition(lastX, lastY, angle);
  },

  setRocketState(state) {
    const el = this.rocketEl;
    if (!el || state === this._rocketState) return;
    this._rocketState = state;
    el.classList.remove("idle", "flying", "crashed");
    if (state === "idle") el.classList.remove("visible");
    else el.classList.add("visible");
    el.classList.add(state === "exploded" ? "crashed" : state);
  },

  setRocketPosition(x, y, angleDeg) {
    const el = this.rocketEl;
    if (!el) return;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
  },

  triggerExplosion() {
    if (this._explodedRoundId === this.roundId) return;
    this._explodedRoundId = this.roundId;
    Tg.haptic("notification", "error");
  },

  hideExplosion() {
    this._explodedRoundId = null;
    this._rocketState = null;
    if (this.rocketEl) this.rocketEl.classList.remove("idle", "flying", "crashed", "visible");
  },

  renderHistory(history) {
    const wrap = document.getElementById("crashHistory");
    wrap.innerHTML = "";
    history.forEach((m) => {
      const chip = document.createElement("div");
      const cls = m < 1.5 ? "low" : m < 3 ? "mid" : "high";
      chip.className = "crash-history-chip " + cls;
      chip.textContent = fmt(m) + "x";
      wrap.appendChild(chip);
    });
  },

  renderPlayers(bets) {
    const wrap = document.getElementById("crashPlayers");
    wrap.innerHTML = "";
    if (!bets.length) {
      wrap.innerHTML = '<div class="stat-label" style="text-align:center;padding:10px 0;">Пока нет ставок</div>';
      return;
    }
    bets.forEach((b) => {
      const card = document.createElement("div");
      card.className = "crash-player-card " + (b.cashed_out ? "win" : "");
      card.innerHTML = `
        <div class="cp-name">${escapeHtml(b.name)}</div>
        <div class="cp-mid">${fmt(b.amount)} ${b.cashout_multiplier ? "× " + fmt(b.cashout_multiplier) : ""}</div>
        <div class="cp-win" style="color:${b.cashed_out ? "var(--green)" : "var(--muted)"}">${fmt(b.current_win)} ◆</div>
      `;
      wrap.appendChild(card);
    });
  },

  async placeBet(amount) {
    const res = await Api.post("/api/crash/bet", { amount });
    if (!res.ok) {
      toast(res.error ? res.error.message : "Ошибка ставки", "error");
      return;
    }
    State.user.balance = res.balance;
    renderUserUI(true);
    toast("Ставка принята", "success");
    Tg.haptic("impact", "light");
    this.applyServerState(res.crash);
  },

  async cashout() {
    const res = await Api.post("/api/crash/cashout", {});
    if (!res.ok) {
      toast(res.error ? res.error.message : "Не удалось забрать", "error");
      return;
    }
    State.user.balance = res.balance;
    renderUserUI(true);
    Tg.haptic("notification", "success");
    const myBet = this.bets.find((b) => State.user && b.user_id === State.user.id);
    if (myBet) {
      myBet.cashed_out = true;
      myBet.cashout_multiplier = res.result.multiplier;
      myBet.current_win = res.result.win_amount;
    }
    showWinModal("Вы забрали выигрыш!", `+${fmt(res.result.win_amount)} ◆ (${fmt(res.result.multiplier)}x)`);
  },
};

// ============================================================
// HISTORY
// ============================================================

const History = {
  async load() {
    const list = document.getElementById("historyList");
    list.innerHTML = skeletonRows(4);
    const res = await Api.get("/api/history?limit=30");
    if (!res.ok) { list.innerHTML = "<div class='stat-label'>Не удалось загрузить историю</div>"; return; }
    list.innerHTML = "";
    if (!res.history.length) { list.innerHTML = "<div class='stat-label'>Пока нет завершённых игр</div>"; return; }
    res.history.forEach((g) => {
      const card = document.createElement("div");
      card.className = "history-card";
      card.innerHTML = `
        <div class="history-top"><span>${timeAgoOrDate(g.finished_at)}</span><span>Игра #${g.id}</span></div>
        <div class="history-mid">${g.players_count} игроков • Банк ${fmt(g.bank)} ◆</div>
        <div class="history-bottom">
          <div class="history-winner">Победитель <b>${escapeHtml(g.winner_name || "—")}</b></div>
          <div class="history-chance">${fmt(g.winner_amount)} ◆ • ${g.winner_chance}% шанс</div>
        </div>
      `;
      list.appendChild(card);
    });
  },
};

function skeletonRows(n) {
  let html = "";
  for (let i = 0; i < n; i++) html += `<div class="skeleton" style="height:64px;margin-bottom:10px;"></div>`;
  return html;
}

// ============================================================
// REWARDS
// ============================================================

const Rewards = {
  countdownInterval: null,
  lastTiers: [],

  async load() {
    const res = await Api.get("/api/rewards");
    if (!res.ok) return;
    this.lastTiers = res.reward_tiers || [];
    this.render(res);
    this.renderGrid();
  },

  render(data) {
    const itemsWrap = document.getElementById("dailyCaseItems");
    itemsWrap.innerHTML = "";
    (data.reward_tiers || []).forEach((tier) => {
      const el = document.createElement("div");
      el.className = "dc-item";
      el.textContent = "◆";
      el.title = `${fmt(tier.min)}–${fmt(tier.max)} ◆`;
      itemsWrap.appendChild(el);
    });

    const claimBtn = document.getElementById("btnClaimDaily");
    const timerEl = document.getElementById("dailyCaseTimer");
    claimBtn.disabled = !data.can_claim;

    if (this.countdownInterval) clearInterval(this.countdownInterval);
    if (data.can_claim) {
      timerEl.textContent = "Награда доступна!";
    } else {
      const updateTimer = () => {
        const left = data.next_available_at - (Date.now() / 1000);
        if (left <= 0) {
          timerEl.textContent = "Награда доступна!";
          claimBtn.disabled = false;
          clearInterval(this.countdownInterval);
          return;
        }
        timerEl.textContent = "Возвращайтесь через " + formatCountdown(left);
      };
      updateTimer();
      this.countdownInterval = setInterval(updateTimer, 1000);
    }
  },

  renderGrid() {
    const grid = document.getElementById("rewardsGrid");
    grid.innerHTML = "";
    this.lastTiers.forEach((tier) => {
      const card = document.createElement("div");
      card.className = "reward-tier-card";
      card.innerHTML = `
        <div class="reward-tier-range">${fmt(tier.min)}–${fmt(tier.max)} <span class="ton-icon">◆</span></div>
        <div class="reward-tier-chance">${Math.round(tier.chance * 100)}% шанс</div>
      `;
      grid.appendChild(card);
    });
  },

  async claim() {
    const res = await Api.post("/api/rewards/claim", {});
    if (!res.ok) { toast(res.error ? res.error.message : "Пока рано", "error"); return; }
    Tg.haptic("notification", "success");
    toast(`Получено: +${fmt(res.points)} ◆`, "success");
    if (State.user) {
      State.user.balance = res.balance;
      renderUserUI(true);
    }
    this.load();
  },
};

// ============================================================
// INVITE / REFERRAL
// ============================================================

const Invite = {
  async load() {
    const res = await Api.get("/api/referral");
    if (!res.ok) return;
    document.getElementById("inviteLinkText").textContent = res.link;
    document.getElementById("inviteCount").textContent = res.invited_count;
    document.getElementById("inviteEarnings").textContent = fmt(res.earnings) + " ◆";
    this._link = res.link;
    this._code = res.code;

    const badge = document.getElementById("badgeInvite");
    if (res.invited_count > 0) { badge.textContent = res.invited_count; badge.classList.remove("hidden"); }
  },

  copy() {
    if (!this._link) return;
    navigator.clipboard && navigator.clipboard.writeText(this._link).catch(() => {});
    toast("Ссылка скопирована", "success");
    Tg.haptic("impact", "light");
  },

  shareTelegram() {
    if (!this._link) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(this._link)}&text=${encodeURIComponent("Присоединяйся в Epic Battle!")}`;
    if (Tg.tg && Tg.tg.openTelegramLink) {
      Tg.tg.openTelegramLink(url);
    } else {
      window.open(url, "_blank");
    }
  },
};

// ============================================================
// EVENT WIRING
// ============================================================

function wireEvents() {
  document.getElementById("btnBack").addEventListener("click", goBack);

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.target));
  });

  document.getElementById("cardPVP").addEventListener("click", () => showScreen("pvp"));
  document.getElementById("cardCrash").addEventListener("click", () => showScreen("crash"));
  document.getElementById("promoBanner").addEventListener("click", () => showScreen("crash"));
  document.getElementById("miniFree24").addEventListener("click", () => showScreen("rewards"));
  document.getElementById("miniFree").addEventListener("click", () => showScreen("crash"));

  document.getElementById("btnTopup").addEventListener("click", () => TopupSheet.open());
  document.getElementById("btnAddFunds").addEventListener("click", () => TopupSheet.open());

  document.getElementById("btnConfirmTopup").addEventListener("click", () => {
    const val = parseFloat(String(document.getElementById("topupAmountInput").value).replace(",", "."));
    topupCrypto(val);
  });

  document.querySelectorAll("#topupSheet .bet-quick-row button").forEach((b) => {
    b.addEventListener("click", () => {
      document.getElementById("topupAmountInput").value = b.dataset.amt;
    });
  });

  document.getElementById("topupSheetOverlay").addEventListener("click", (e) => {
    if (e.target.id === "topupSheetOverlay") TopupSheet.close();
  });

  document.getElementById("btnMenu").addEventListener("click", () => showScreen("history"));

  document.getElementById("btnJoinBattle").addEventListener("click", () => {
    if (State.pvp.status === "spinning") return;
    Tg.haptic("impact", "light");
    BetSheet.open();
    BetSheet._target = "pvp";
  });

  document.getElementById("btnConfirmBet").addEventListener("click", async () => {
    const val = parseFloat(document.getElementById("betAmountInput").value);
    if (!val || val <= 0) { toast("Введите сумму ставки", "error"); return; }
    const ok = await Pvp.placeBet(Math.round(val * 100) / 100);
    if (ok) BetSheet.close();
  });

  document.querySelectorAll("#betSheet .bet-quick-row button").forEach((b) => {
    b.addEventListener("click", () => {
      const amt = b.dataset.amt;
      const input = document.getElementById("betAmountInput");
      input.value = amt === "max" ? fmt(State.user.balance) : amt;
    });
  });

  document.getElementById("betSheetOverlay").addEventListener("click", (e) => {
    if (e.target.id === "betSheetOverlay") BetSheet.close();
  });

  document.getElementById("btnCloseWin").addEventListener("click", () => {
    document.getElementById("winOverlay").classList.add("hidden");
  });

  // Crash quick bet buttons
  document.querySelectorAll("#crashQuickRow button").forEach((b) => {
    b.addEventListener("click", () => { document.getElementById("crashBetInput").value = b.dataset.amt; });
  });

  document.getElementById("btnCrashAction").addEventListener("click", () => {
    const btn = document.getElementById("btnCrashAction");
    if (btn.classList.contains("cashout")) {
      Crash.cashout();
    } else if (!btn.classList.contains("disabled")) {
      const val = parseFloat(document.getElementById("crashBetInput").value);
      if (!val || val <= 0) { toast("Введите сумму ставки", "error"); return; }
      Crash.placeBet(Math.round(val * 100) / 100);
    }
  });

  document.getElementById("btnClaimDaily").addEventListener("click", () => Rewards.claim());

  document.getElementById("btnCopyLink").addEventListener("click", () => Invite.copy());
  document.getElementById("btnShareTelegram").addEventListener("click", () => Invite.shareTelegram());
}

// ============================================================
// BOOTSTRAP
// ============================================================

async function bootstrap() {
  wireEvents();
  showScreen("home", { skipHistory: true });
  await User.authenticate();
  Pvp.refresh();
  History.load();
  setInterval(() => { if (State.currentScreen === "home") Pvp.refresh(); }, 4000);
  setInterval(() => { if (State.user) User.refreshBalance(); }, 6000);
}

document.addEventListener("DOMContentLoaded", bootstrap);
const TopupSheet = {
  open() {
    document.getElementById("topupSheetOverlay").classList.remove("hidden");
    document.getElementById("topupAmountInput").value = "";
  },
  close() {
    document.getElementById("topupSheetOverlay").classList.add("hidden");
  },
};

let topupInProgress = false;

async function topupCrypto(amount) {
  if (topupInProgress) return;

  if (!Number.isFinite(amount) || amount <= 0) {
    toast("Введите корректную сумму", "error");
    return;
  }

  topupInProgress = true;
  const btn = document.getElementById("btnConfirmTopup");
  if (btn) { btn.disabled = true; btn.textContent = "Создаём счёт..."; }

  try {
    const res = await Api.post("/api/crypto/create-invoice", {
      amount: amount,
      asset: "TON"
    });

    if (!res || !res.ok || !res.invoice_url) {
      toast(
        typeof res?.error === "object"
          ? (res.error?.message || JSON.stringify(res.error))
          : (res?.error || "Ошибка создания счёта"),
        "error"
      );
      return;
    }

    TopupSheet.close();

    if (Tg.tg && typeof Tg.tg.openTelegramLink === "function") {
      Tg.tg.openTelegramLink(res.invoice_url);
    } else {
      window.open(res.invoice_url, "_blank");
    }

  } catch (err) {
    console.error("Ошибка создания счёта:", err);
    toast("Не удалось создать счёт", "error");
  } finally {
    topupInProgress = false;
    if (btn) { btn.disabled = false; btn.textContent = "Создать счёт"; }
  }
}
