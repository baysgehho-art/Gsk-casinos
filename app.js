/* ==========================================================================
   LUCKY SPIN — app.js
   The round (participants, bank, timer, winner) now lives on the server.
   Every client polls /api/round so everyone sees the same table — no bots,
   no per-browser fake state.
   ========================================================================== */
(() => {
  'use strict';

  const SERVER_URL = "https://lagger.pythonanywhere.com";

  /* ---------------------------------------------------------------------
     Telegram WebApp integration (safe no-op outside Telegram)
     --------------------------------------------------------------------- */
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor && tg.setHeaderColor('#0b0714');
      tg.setBackgroundColor && tg.setBackgroundColor('#050308');
    } catch (e) { /* ignore in non-Telegram browsers */ }
  }

  let myUserId = null;
  let myUsername = 'Player';
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    myUserId = String(tg.initDataUnsafe.user.id);
    myUsername = tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name || 'Player';
  } else {
    // Outside Telegram (e.g. testing in a normal browser) fall back to a
    // per-browser guest id so the game still works end to end.
    myUserId = localStorage.getItem('luckyspin_guest_id');
    if (!myUserId) {
      myUserId = 'guest_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('luckyspin_guest_id', myUserId);
    }
    myUsername = 'Guest';
  }

  /* ---------------------------------------------------------------------
     Config
     --------------------------------------------------------------------- */
  const CFG = {
    SPIN_MS: 5000,           // must match SPIN_SECONDS on the server
    MIN_BET: 1,
    MAX_CARDS: 420,
    CYCLES: 7,
    POLL_MS: 1000,
    SIDE_POLL_MS: 5000,      // history / leaders refresh
  };

  const AVATAR_PALETTES = [
    ['#8b5cf6', '#ec4899'],
    ['#ec4899', '#fbbf24'],
    ['#fbbf24', '#8b5cf6'],
    ['#a855f7', '#f472b6'],
    ['#f472b6', '#f59e0b'],
    ['#6d28d9', '#db2777'],
  ];

  /* ---------------------------------------------------------------------
     DOM refs
     --------------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const el = {
    bankValue: $('bankValue'),
    myBalance: $('myBalance'),
    participantsCount: $('participantsCount'),
    reelShell: document.querySelector('.reel-shell'),
    reelTrack: $('reelTrack'),
    pointer: $('pointer'),
    winnerBanner: $('winnerBanner'),
    winnerAvatar: $('winnerAvatar'),
    winnerName: $('winnerName'),
    winnerPrize: $('winnerPrize'),
    nickInput: $('nickInput'),
    betInput: $('betInput'),
    quickBets: $('quickBets'),
    addBetBtn: $('addBetBtn'),
    participantsList: $('participantsList'),
    timerRing: $('timerRing'),
    timerLabel: $('timerLabel'),
    roundTimerWrap: $('roundTimerWrap'),
    historyList: $('historyList'),
    historyEmpty: $('historyEmpty'),
    leadersList: $('leadersList'),
    leadersEmpty: $('leadersEmpty'),
    soundToggle: $('soundToggle'),
    soundIconOn: $('soundIconOn'),
    soundIconOff: $('soundIconOff'),
    confettiCanvas: $('confetti-canvas'),
  };

  const store = {
    load(key, fallback) {
      try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
      catch (e) { return fallback; }
    },
    save(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    },
  };
  const KEYS = { sound: 'luckyspin_sound_v1' };
  let soundOn = store.load(KEYS.sound, true);

  function fmt(n) { return '$' + Math.round(n).toLocaleString('ru-RU'); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------------------------------------------------------------
     Avatars — deterministic gradient + initials, no network dependency
     --------------------------------------------------------------------- */
  const avatarCache = new Map();
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function initialsOf(name) {
    const clean = (name || '').trim();
    if (!clean) return '?';
    const parts = clean.split(/\s+/);
    return parts.length === 1 ? clean.slice(0, 2).toUpperCase() : (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function avatarUri(name) {
    if (avatarCache.has(name)) return avatarCache.get(name);
    const [c1, c2] = AVATAR_PALETTES[hashStr(name) % AVATAR_PALETTES.length];
    const initials = initialsOf(name);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
      </linearGradient></defs>
      <rect width="80" height="80" rx="40" fill="url(#g)"/>
      <text x="40" y="47" font-family="Manrope, sans-serif" font-size="30" font-weight="800"
        fill="rgba(255,255,255,.95)" text-anchor="middle">${initials}</text>
    </svg>`;
    const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    avatarCache.set(name, uri);
    return uri;
  }

  /* ---------------------------------------------------------------------
     Sound
     --------------------------------------------------------------------- */
  let actx = null;
  function audioCtx() {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
    return actx;
  }
  function beep(freq, dur, type, gain, delay) {
    if (!soundOn) return;
    const ctx = audioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain || 0.08, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function sfxTick() { beep(880, 0.06, 'square', 0.04); }
  function sfxBet() { beep(520, 0.09, 'triangle', 0.06); }
  function sfxSpinStart() { beep(200, 0.4, 'sawtooth', 0.05); }
  function sfxWin() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.28, 'triangle', 0.09, i * 0.11)); }

  function refreshSoundIcon() {
    el.soundIconOn.style.display = soundOn ? '' : 'none';
    el.soundIconOff.style.display = soundOn ? 'none' : '';
    el.soundToggle.classList.toggle('is-muted', !soundOn);
  }
  refreshSoundIcon();
  el.soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    store.save(KEYS.sound, soundOn);
    refreshSoundIcon();
    if (soundOn) beep(700, 0.08, 'sine', 0.06);
  });

  /* ---------------------------------------------------------------------
     Confetti
     --------------------------------------------------------------------- */
  const ctxC = el.confettiCanvas.getContext('2d');
  let confettiParticles = [];
  let confettiRAF = null;
  function resizeCanvas() { el.confettiCanvas.width = window.innerWidth; el.confettiCanvas.height = window.innerHeight; }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  const CONFETTI_COLORS = ['#8b5cf6', '#ec4899', '#fbbf24', '#f472b6', '#a855f7', '#fde68a'];
  function fireConfetti() {
    const W = el.confettiCanvas.width, H = el.confettiCanvas.height;
    confettiParticles = Array.from({ length: 140 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.32,
      vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 4,
      size: 5 + Math.random() * 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? 'rect' : 'circle', life: 0,
    }));
    if (confettiRAF) cancelAnimationFrame(confettiRAF);
    const gravity = 0.22;
    function step() {
      ctxC.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of confettiParticles) {
        p.vy += gravity; p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.life++;
        if (p.y < H + 20) alive = true;
        const fade = Math.max(0, 1 - p.life / 220);
        ctxC.save(); ctxC.globalAlpha = fade; ctxC.translate(p.x, p.y); ctxC.rotate(p.rot); ctxC.fillStyle = p.color;
        if (p.shape === 'rect') ctxC.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
        else { ctxC.beginPath(); ctxC.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctxC.fill(); }
        ctxC.restore();
      }
      if (alive && confettiParticles.some(p => p.life < 260)) confettiRAF = requestAnimationFrame(step);
      else ctxC.clearRect(0, 0, W, H);
    }
    confettiRAF = requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------------------
     Reel building
     --------------------------------------------------------------------- */
  function cardHtml(p) {
    return `<div class="player-card" data-name="${escapeHtml(p.name)}">
      <img class="player-card__avatar" src="${avatarUri(p.name)}" alt="">
      <span class="player-card__name">${escapeHtml(p.name)}</span>
      <span class="player-card__bet">${fmt(p.bet)}</span>
    </div>`;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  function buildPreviewUnits(participants) {
    const units = [];
    const totalBet = participants.reduce((s, p) => s + p.bet, 0) || 1;
    const scale = totalBet > CFG.MAX_CARDS ? CFG.MAX_CARDS / totalBet : 1;
    for (const p of participants) {
      const count = Math.max(1, Math.round(p.bet * scale));
      for (let i = 0; i < count; i++) units.push(p);
    }
    return shuffle(units.slice());
  }
  function currentCardMetrics() {
    const sample = el.reelTrack.querySelector('.player-card');
    const gap = parseFloat(getComputedStyle(el.reelTrack).gap) || 10;
    const w = sample ? sample.getBoundingClientRect().width : (window.innerWidth < 360 ? 84 : 96);
    return { w, gap };
  }
  function renderReelPreview(participants) {
    if (!participants.length) {
      el.reelTrack.innerHTML = `<div class="reel-empty" id="reelEmpty">
        <span class="reel-empty__icon">🎴</span>
        <span>Ждём ставки от игроков</span>
      </div>`;
      return;
    }
    const units = buildPreviewUnits(participants.map(p => ({ name: p.username, bet: p.bet })));
    el.reelTrack.innerHTML = units.map(cardHtml).join('');
  }

  /* ---------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */
  function bump(elm) { elm.classList.remove('is-bumped'); void elm.offsetWidth; elm.classList.add('is-bumped'); }

  function renderBank(round) {
    el.bankValue.textContent = fmt(round.bank);
    bump(el.bankValue);
    el.participantsCount.textContent = `Участников: ${round.participants.length}`;
  }

  function renderParticipants(participants) {
    if (!participants.length) {
      el.participantsList.innerHTML = '<div class="empty-hint">Пока никто не поставил</div>';
      return;
    }
    const bank = participants.reduce((s, p) => s + p.bet, 0) || 1;
    el.participantsList.innerHTML = participants.map(p => {
      const pct = p.bet / bank * 100;
      return `<div class="p-row">
        <img class="p-row__avatar" src="${avatarUri(p.username)}" alt="">
        <div class="p-row__body">
          <div class="p-row__top">
            <span class="p-row__name">${escapeHtml(p.username)}</span>
            <span class="p-row__bet">${fmt(p.bet)}</span>
          </div>
          <div class="p-row__bar"><div class="p-row__bar-fill" style="width:${pct}%"></div></div>
          <div class="p-row__chance">Шанс: ${pct.toFixed(1)}%</div>
        </div>
      </div>`;
    }).join('');
  }

  function renderHistory(history) {
    el.historyEmpty.style.display = history.length ? 'none' : '';
    el.historyList.innerHTML = history.map(h => {
      const t = new Date(h.time);
      const time = t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      return `<div class="h-row">
        <img class="h-row__avatar" src="${avatarUri(h.winner)}" alt="">
        <div class="h-row__body">
          <div class="h-row__name">${escapeHtml(h.winner)}</div>
          <div class="h-row__meta">${time} · банк ${fmt(h.bank)} · шанс ${(h.chance * 100).toFixed(1)}% · комиссия ${Math.round(h.rate * 100)}%</div>
        </div>
        <div class="h-row__prize">+${fmt(h.prize)}</div>
      </div>`;
    }).join('');
  }

  function renderLeaders(leaders) {
    el.leadersEmpty.style.display = leaders.length ? 'none' : '';
    el.leadersList.innerHTML = leaders.map((p, i) => `
      <div class="l-row">
        <div class="l-row__rank">${i + 1}</div>
        <img class="l-row__avatar" src="${avatarUri(p.username)}" alt="">
        <div class="l-row__body">
          <div class="l-row__name">${escapeHtml(p.username)}</div>
          <div class="l-row__meta">${p.wins} побед · ${p.rounds} раундов</div>
        </div>
        <div class="l-row__score">${fmt(p.total_won)}</div>
      </div>`).join('');
  }

  function hideWinnerBanner() { el.winnerBanner.classList.remove('is-visible'); }

  /* ---------------------------------------------------------------------
     Server calls
     --------------------------------------------------------------------- */
  async function getBalance() {
    try {
      const r = await fetch(`${SERVER_URL}/api/balance?user_id=${myUserId}`);
      const data = await r.json();
      el.myBalance.textContent = fmt(data.balance);
    } catch (e) { /* network hiccup, keep last shown value */ }
  }

  async function sendBet(amount, username) {
    const r = await fetch(`${SERVER_URL}/api/bet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: myUserId, username, amount }),
    });
    return r.json();
  }

  async function fetchRound() {
    const r = await fetch(`${SERVER_URL}/api/round`);
    return r.json();
  }
  async function fetchHistory() {
    const r = await fetch(`${SERVER_URL}/api/history`);
    return (await r.json()).history;
  }
  async function fetchLeaders() {
    const r = await fetch(`${SERVER_URL}/api/leaders`);
    return (await r.json()).leaders;
  }

  /* ---------------------------------------------------------------------
     Timer ring
     --------------------------------------------------------------------- */
  const RING_C = 2 * Math.PI * 17;
  el.timerRing.style.strokeDasharray = String(RING_C);

  function renderTimer(round) {
    if (round.status === 'counting' && round.seconds_left !== null) {
      const ROUND_SECONDS = 30;
      el.timerLabel.textContent = round.seconds_left;
      const frac = round.seconds_left / ROUND_SECONDS;
      el.timerRing.style.strokeDashoffset = String(RING_C * (1 - frac));
      el.roundTimerWrap.classList.toggle('is-warning', round.seconds_left <= 10);
      el.roundTimerWrap.classList.toggle('is-critical', round.seconds_left <= 5);
    } else {
      el.timerLabel.textContent = '—';
      el.timerRing.style.strokeDashoffset = '0';
      el.roundTimerWrap.classList.remove('is-warning', 'is-critical');
    }
  }

  /* ---------------------------------------------------------------------
     Spin animation — winner is already decided by the server, this is
     purely the visual reel every client plays in sync.
     --------------------------------------------------------------------- */
  function spinReelTo(participants, winnerUsername) {
    el.reelShell.classList.add('is-spinning');
    el.pointer.style.animationPlayState = 'running';
    sfxSpinStart();

    const baseUnits = buildPreviewUnits(participants.map(p => ({ name: p.username, bet: p.bet })));
    let strip = [];
    for (let c = 0; c < CFG.CYCLES; c++) strip = strip.concat(shuffle(baseUnits.slice()));
    const landingCycle = shuffle(baseUnits.slice());
    const winnerIdxInCycle = landingCycle.reduce((arr, p, i) => { if (p.name === winnerUsername) arr.push(i); return arr; }, []);
    const chosenLocal = winnerIdxInCycle[Math.floor(winnerIdxInCycle.length / 2)] ?? 0;
    strip = strip.concat(landingCycle);
    const targetIndex = strip.length - landingCycle.length + chosenLocal;

    el.reelTrack.innerHTML = strip.map(cardHtml).join('');

    requestAnimationFrame(() => {
      const { w, gap } = currentCardMetrics();
      const step = w + gap;
      const viewportW = el.reelTrack.parentElement.getBoundingClientRect().width;
      const targetX = -(targetIndex * step + w / 2 - viewportW / 2);

      el.reelTrack.style.transition = 'none';
      el.reelTrack.style.transform = 'translateX(0px)';
      void el.reelTrack.offsetWidth;
      el.reelTrack.style.transition = `transform ${CFG.SPIN_MS}ms cubic-bezier(.09,.82,.13,1)`;
      el.reelTrack.style.transform = `translateX(${targetX}px)`;

      let ticked = 0;
      const tickTimer = setInterval(() => {
        ticked += 1;
        if (ticked < CFG.SPIN_MS / 220) sfxTick(); else clearInterval(tickTimer);
      }, 220);
      setTimeout(() => clearInterval(tickTimer), CFG.SPIN_MS + 100);
    });
  }

  function showWinnerBanner(winner) {
    const cards = el.reelTrack.querySelectorAll('.player-card');
    const vpRect = el.reelTrack.parentElement.getBoundingClientRect();
    const vpCenter = vpRect.left + vpRect.width / 2;
    let closest = null, closestDist = Infinity;
    cards.forEach(c => {
      if (c.dataset.name !== winner.username) return;
      const r = c.getBoundingClientRect();
      const dist = Math.abs((r.left + r.width / 2) - vpCenter);
      if (dist < closestDist) { closestDist = dist; closest = c; }
    });
    if (closest) closest.classList.add('is-winner');

    el.winnerAvatar.innerHTML = `<img src="${avatarUri(winner.username)}" alt="">`;
    el.winnerName.textContent = winner.username;
    el.winnerPrize.textContent = `+${fmt(winner.prize)} USDT · комиссия ${Math.round(winner.rate * 100)}%`;
    el.winnerBanner.classList.add('is-visible');

    fireConfetti();
    sfxWin();
    if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.notificationOccurred('success'); } catch (e) {} }

    el.reelShell.classList.remove('is-spinning');
    if (winner.user_id === myUserId) getBalance();
  }

  /* ---------------------------------------------------------------------
     Main polling loop — this is what keeps every player's screen in sync
     --------------------------------------------------------------------- */
  let lastStatus = null;

  async function pollRound() {
    let round;
    try { round = await fetchRound(); } catch (e) { return; }

    renderBank(round);
    renderParticipants(round.participants);
    renderTimer(round);

    if (round.status !== lastStatus) {
      if (round.status === 'waiting') {
        hideWinnerBanner();
        renderReelPreview(round.participants);
      } else if (round.status === 'spinning' && round.winner) {
        spinReelTo(round.participants, round.winner.username);
      } else if (round.status === 'finished' && round.winner) {
        showWinnerBanner(round.winner);
      }
      lastStatus = round.status;
    } else if (round.status === 'waiting') {
      renderReelPreview(round.participants);
    }
  }

  async function pollSide() {
    try {
      const [history, leaders] = await Promise.all([fetchHistory(), fetchLeaders()]);
      renderHistory(history);
      renderLeaders(leaders);
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------------
     Betting UI
     --------------------------------------------------------------------- */
  function shake(elm) { elm.classList.remove('is-shake'); void elm.offsetWidth; elm.classList.add('is-shake'); }
  function flashInsufficient() { shake(el.myBalance); }

  el.quickBets.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-btn');
    if (!btn) return;
    const cur = parseInt(el.betInput.value, 10) || 0;
    el.betInput.value = cur + parseInt(btn.dataset.amt, 10);
  });

  el.addBetBtn.addEventListener('click', async () => {
    const bet = Math.floor(Number(el.betInput.value));
    if (!bet || bet < CFG.MIN_BET) { shake(el.betInput); return; }
    const nick = (el.nickInput.value || '').trim().slice(0, 16) || myUsername;

    el.addBetBtn.disabled = true;
    try {
      const result = await sendBet(bet, nick);
      if (!result.success) {
        flashInsufficient();
      } else {
        el.myBalance.textContent = fmt(result.balance);
        sfxBet();
        pollRound(); // refresh immediately instead of waiting for the next tick
      }
    } finally {
      el.addBetBtn.disabled = false;
    }
  });

  /* ---------------------------------------------------------------------
     Tabs
     --------------------------------------------------------------------- */
  document.querySelectorAll('.tabs__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs__btn').forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      $('tab-' + btn.dataset.tab).classList.add('is-active');
    });
  });

  /* ---------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */
  function init() {
    el.nickInput.value = myUsername === 'Guest' ? '' : myUsername;
    getBalance();
    pollRound();
    pollSide();
    setInterval(pollRound, CFG.POLL_MS);
    setInterval(pollSide, CFG.SIDE_POLL_MS);
  }

  init();
})();
