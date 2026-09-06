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
  crash: { status: "waiting", multiplier: 1, history: [], bets: [] },
  inventory: [],
  invFilter: "all",
  ratingOffset: 0,
  crashRoundLocal: null,
  crashHasBet: false,
  crashChartPoints: [],
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

const NAV_SCREENS = ["home", "pvp", "crash", "history", "inventory", "rating", "rewards", "invite"];
const BOTTOM_NAV_SCREENS = ["home", "inventory", "invite", "rating", "rewards"];

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
    inventory: "Инвентарь", rating: "Рейтинг", rewards: "Награды", invite: "Пригласить",
  };
  titleText.textContent = titles[name] || "Epic Battle";

  Tg.haptic("selection");

  if (name === "pvp") { Pvp.refresh(); Pvp.startPolling(); } else { Pvp.stopPolling(); }
  if (name === "crash") { Crash.refresh(); Crash.startPolling(); } else { Crash.stopPolling(); }
  if (name === "inventory") Inventory.load();
  if (name === "rating") Rating.load(true);
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

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.refresh(), 1500);
  },
  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  async refresh() {
    const res = await Api.get("/api/game");
    if (!res.ok) return;
    this.render(res.game);
    this.renderHome(res.game);
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

    document.getElementById("pvpBankValue").innerHTML = `${fmt(game.bank)} <span class="ton-icon">◆</span>`;

    const statusEl = document.getElementById("wheelStatus");
    const timerEl = document.getElementById("wheelTimer");
    const joinBtn = document.getElementById("btnJoinBattle");

    if (game.status === "waiting") {
      statusEl.textContent = "WAITING";
      statusEl.classList.remove("live");
      timerEl.textContent = game.players.length + "/" + game.min_players;
      joinBtn.textContent = "Присоединиться к битве";
      joinBtn.classList.remove("disabled");
    } else if (game.status === "countdown") {
      statusEl.textContent = "СТАРТ ЧЕРЕЗ";
      statusEl.classList.remove("live");
      const left = Math.max(0, Math.ceil(game.countdown_at - game.server_time));
      timerEl.textContent = left + "s";
      joinBtn.textContent = "Присоединиться к битве";
      joinBtn.classList.remove("disabled");
    } else if (game.status === "spinning") {
      statusEl.textContent = "LIVE";
      statusEl.classList.add("live");
      timerEl.textContent = "";
      joinBtn.textContent = "Раунд идёт...";
      joinBtn.classList.add("disabled");
      this.spinTo(game);
    } else if (game.status === "finished") {
      statusEl.textContent = "WAITING";
      statusEl.classList.remove("live");
      timerEl.textContent = "";
      joinBtn.textContent = "Присоединиться к битве";
      joinBtn.classList.remove("disabled");
    }

    this.renderWheelSegments(game.players);
    this.renderPlayerCards(game.players);
  },

  lastSpinRoundId: null,
  spinTo(game) {
    if (this.lastSpinRoundId === game.round_id) return;
    this.lastSpinRoundId = game.round_id;
    const svg = document.getElementById("wheelSvg");
    const spins = 4 + Math.random() * 2;
    const finalDeg = spins * 360 + Math.random() * 360;
    svg.style.transition = "transform 6s cubic-bezier(.12,.84,.2,1)";
    svg.style.transform = `rotate(${finalDeg}deg)`;
    Tg.haptic("impact", "medium");

    setTimeout(() => {
      const isMe = State.user && game.winner_user_id === State.user.id;
      if (isMe) {
        Tg.haptic("notification", "success");
        User.refreshBalance();
        showWinModal(`Вы выиграли!`, `+${fmt(game.winner_amount)} ◆`);
      } else {
        toast(`Победил ${game.winner_name} — ${fmt(game.winner_amount)} ◆ (${game.winner_chance}%)`, "info");
      }
      svg.style.transition = "none";
      svg.style.transform = "rotate(0deg)";
    }, 6100);
  },

  renderWheelSegments(players) {
    const svg = document.getElementById("wheelSvg");
    svg.innerHTML = "";
    const cx = 160, cy = 160, r = 130;
    if (!players.length) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", cx); circle.setAttribute("cy", cy); circle.setAttribute("r", r);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "rgba(255,255,255,0.08)");
      circle.setAttribute("stroke-width", "20");
      svg.appendChild(circle);
      return;
    }
    const total = players.reduce((a, p) => a + p.amount, 0) || 1;
    let startAngle = -90;
    players.forEach((p) => {
      const sweep = (p.amount / total) * 360;
      const path = describeArc(cx, cy, r, startAngle, startAngle + sweep);
      const arcEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arcEl.setAttribute("d", path);
      arcEl.setAttribute("stroke", p.color);
      arcEl.setAttribute("stroke-width", "22");
      arcEl.setAttribute("fill", "none");
      arcEl.setAttribute("stroke-linecap", "round");
      svg.appendChild(arcEl);
      startAngle += sweep;
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

function describeArc(cx, cy, r, startDeg, endDeg) {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
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
  canvas: null,
  ctx: null,

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.refresh(), 400);
  },
  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  initCanvas() {
    if (this.canvas) return;
    this.canvas = document.getElementById("crashCanvas");
    this.ctx = this.canvas.getContext("2d");
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width * devicePixelRatio;
      this.canvas.height = rect.height * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);
  },

  async refresh() {
    const res = await Api.get("/api/crash/current");
    if (!res.ok) return;
    this.render(res.crash);
  },

  lastStatus: null,
  lastRoundId: null,
  render(crash) {
    this.initCanvas();

    if (crash.round_id !== this.lastRoundId) {
      State.crashChartPoints = [];
      State.crashHasBet = false;
      this.lastRoundId = crash.round_id;
      document.getElementById("crashPlayers").innerHTML = "";
    }

    const statusText = document.getElementById("crashStatusText");
    const timerText = document.getElementById("crashTimerText");
    const multEl = document.getElementById("crashMultiplier");
    const actionBtn = document.getElementById("btnCrashAction");

    if (crash.status === "waiting") {
      statusText.textContent = "Ожидание ставок";
      statusText.className = "";
      timerText.textContent = formatCountdown(crash.wait_seconds - (crash.server_time - (crash.server_time)));
      multEl.textContent = "1.00x";
      multEl.classList.remove("crashed");
      actionBtn.textContent = "Сделать ставку";
      actionBtn.classList.remove("cashout", "disabled");
    } else if (crash.status === "running") {
      statusText.textContent = "LIVE";
      statusText.className = "live";
      timerText.textContent = "";
      multEl.textContent = fmt(crash.multiplier) + "x";
      multEl.classList.remove("crashed");
      State.crashChartPoints.push(crash.multiplier);
      this.drawGraph(crash.multiplier, false);

      const myBet = crash.bets.find((b) => State.user && b.user_id === State.user.id);
      if (myBet && !myBet.cashed_out) {
        actionBtn.textContent = `Забрать ${fmt(myBet.current_win)} ◆`;
        actionBtn.classList.add("cashout");
        actionBtn.classList.remove("disabled");
      } else {
        actionBtn.textContent = "Раунд идёт...";
        actionBtn.classList.add("disabled");
        actionBtn.classList.remove("cashout");
      }
    } else if (crash.status === "crashed") {
      statusText.textContent = "Раунд завершён";
      statusText.className = "crashed";
      timerText.textContent = "";
      multEl.textContent = fmt(crash.multiplier) + "x";
      multEl.classList.add("crashed");
      this.drawGraph(crash.multiplier, true);
      actionBtn.textContent = "Раунд завершён";
      actionBtn.classList.add("disabled");
      actionBtn.classList.remove("cashout");
    }

    this.renderHistory(crash.history);
    this.renderPlayers(crash.bets);
    this.renderHomeMult(crash);
  },

  renderHomeMult(crash) {
    const el = document.getElementById("homeCrashMult");
    if (el) el.textContent = fmt(crash.multiplier) + "x";
  },

  drawGraph(multiplier, crashed) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pts = State.crashChartPoints;
    if (pts.length < 2) return;

    const maxMult = Math.max(...pts, 2);
    const stepX = w / Math.max(pts.length - 1, 1);

    ctx.beginPath();
    pts.forEach((m, i) => {
      const x = i * stepX;
      const y = h - (Math.min(m, maxMult) / maxMult) * (h * 0.85) - h * 0.05;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = crashed ? "#ff5c5c" : "#20d6d0";
    ctx.lineWidth = 3 * devicePixelRatio;
    ctx.lineJoin = "round";
    ctx.shadowColor = crashed ? "rgba(255,92,92,0.5)" : "rgba(32,214,208,0.5)";
    ctx.shadowBlur = 12;
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, crashed ? "rgba(255,92,92,0.25)" : "rgba(32,214,208,0.22)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.shadowBlur = 0;
    ctx.fill();
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
    this.render(res.crash);
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

    // also fill "recent games" on home screen with top 5
    const recent = document.getElementById("recentList");
    if (recent) {
      recent.innerHTML = "";
      res.history.slice(0, 5).forEach((g) => {
        const item = document.createElement("div");
        item.className = "recent-item";
        item.innerHTML = `<span class="rname">${escapeHtml(g.winner_name || "—")}</span><span class="ramount">+${fmt(g.winner_amount)} ◆</span>`;
        recent.appendChild(item);
      });
    }
  },
};

function skeletonRows(n) {
  let html = "";
  for (let i = 0; i < n; i++) html += `<div class="skeleton" style="height:64px;margin-bottom:10px;"></div>`;
  return html;
}

// ============================================================
// INVENTORY
// ============================================================

const RARITY_ICONS = { Common: "🔹", Rare: "🔷", Epic: "💠", Legendary: "👑" };

const Inventory = {
  async load() {
    const grid = document.getElementById("inventoryGrid");
    grid.innerHTML = skeletonRows(4);
    const res = await Api.get("/api/inventory");
    if (!res.ok) { grid.innerHTML = "<div class='stat-label'>Не удалось загрузить инвентарь</div>"; return; }
    State.inventory = res.inventory;
    this.render();
  },
  render() {
    const grid = document.getElementById("inventoryGrid");
    const items = State.invFilter === "all" ? State.inventory : State.inventory.filter((i) => i.rarity === State.invFilter);
    grid.innerHTML = "";
    if (!items.length) { grid.innerHTML = "<div class='stat-label' style='grid-column:1/-1;text-align:center;'>Пусто</div>"; return; }
    items.forEach((it) => {
      const card = document.createElement("div");
      card.className = `item-card rare-glow-${it.rarity}`;
      card.innerHTML = `
        <div class="item-rarity ${it.rarity}">${it.rarity}</div>
        <div class="item-icon">${RARITY_ICONS[it.rarity] || "🎁"}</div>
        <div class="item-name">${escapeHtml(it.name)}</div>
        <div class="item-value">${fmt(it.value)} ◆</div>
      `;
      grid.appendChild(card);
    });
  },
};

// ============================================================
// RATING
// ============================================================

const Rating = {
  async load(reset) {
    if (reset) State.ratingOffset = 0;
    const list = document.getElementById("ratingList");
    if (reset) list.innerHTML = skeletonRows(6);
    const res = await Api.get(`/api/rating?limit=50&offset=${State.ratingOffset}`);
    if (!res.ok) { list.innerHTML = "<div class='stat-label'>Не удалось загрузить рейтинг</div>"; return; }
    if (reset) list.innerHTML = "";
    res.rating.forEach((r) => {
      const row = document.createElement("div");
      row.className = "rating-row";
      row.innerHTML = `
        <div class="rating-rank">#${r.rank}</div>
        <div class="rating-avatar" style="background:${colorForString(r.username)}">${initials(r.username)}</div>
        <div class="rating-name">${escapeHtml(r.username)}</div>
        <div class="rating-amount">${fmt(r.balance, r.balance > 1000 ? 0 : 2)} ◆</div>
      `;
      list.appendChild(row);
    });
    State.ratingOffset += res.rating.length;

    if (res.me) {
      document.getElementById("ratingMyBalance").textContent = fmt(res.me.balance, 3);
      document.getElementById("ratingMyRank").textContent = `Место #${res.me.rank} из ${res.total}`;
    }
  },
};

// ============================================================
// REWARDS
// ============================================================

const Rewards = {
  countdownInterval: null,
  async load() {
    const res = await Api.get("/api/rewards");
    if (!res.ok) return;
    this.render(res);
    this.renderGrid();
  },

  render(data) {
    const itemsWrap = document.getElementById("dailyCaseItems");
    itemsWrap.innerHTML = "";
    data.daily_items.forEach((it) => {
      const el = document.createElement("div");
      el.className = "dc-item";
      el.textContent = RARITY_ICONS[it.rarity] || "🎁";
      el.title = it.name;
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
    const items = [
      ["Nail Bracelet", "Rare", 65], ["Bonded Ring", "Rare", 48],
      ["Jelly Bunny", "Common", 12], ["Sharp Tongue", "Epic", 175],
    ];
    grid.innerHTML = "";
    items.forEach(([name, rarity, value]) => {
      const card = document.createElement("div");
      card.className = `item-card rare-glow-${rarity}`;
      card.innerHTML = `
        <div class="item-rarity ${rarity}">${rarity}</div>
        <div class="item-icon">${RARITY_ICONS[rarity]}</div>
        <div class="item-name">${name}</div>
        <div class="item-value">${value} ◆</div>
      `;
      grid.appendChild(card);
    });
  },

  async claim() {
    const res = await Api.post("/api/rewards/claim", {});
    if (!res.ok) { toast(res.error ? res.error.message : "Пока рано", "error"); return; }
    Tg.haptic("notification", "success");
    toast(`Получено: ${res.item.name}`, "success");
    this.load();
    Inventory.load();
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

  document.getElementById("btnTopup").addEventListener("click", () => topupCrypto());
document.getElementById("btnAddFunds").addEventListener("click", () => topupCrypto());

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

  // Inventory filters
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      State.invFilter = chip.dataset.filter;
      Inventory.render();
    });
  });

  document.getElementById("btnRatingMore").addEventListener("click", () => Rating.load(false));

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
  setInterval(() => Pvp.refresh(), State.currentScreen === "home" ? 4000 : 999999);
  setInterval(() => { if (State.currentScreen === "home") Pvp.refresh(); }, 4000);
  setInterval(() => { if (State.user) User.refreshBalance(); }, 6000);
}

document.addEventListener("DOMContentLoaded", bootstrap);
async function topupCrypto() {
  const amount = prompt("Введите сумму в TON:");
  if (!amount || amount <= 0) return;
  
  const res = await Api.post("/api/crypto/create-invoice", { amount: parseFloat(amount), asset: "TON" });
  if (res.ok) {
    if (Tg.tg && Tg.tg.openTelegramLink) {
      Tg.tg.openTelegramLink(res.invoice_url);
    } else {
      window.open(res.invoice_url, "_blank");
    }
  } else {
    toast("Ошибка создания счёта", "error");
  }
}
