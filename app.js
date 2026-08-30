const SERVER_URL = "https://lagger.pythonanywhere.com";
let myUserId = null;
let myUsername = "Player";

const tg = window.Telegram?.WebApp;
if (tg && tg.initDataUnsafe?.user) {
    myUserId = tg.initDataUnsafe.user.id;
    myUsername = tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name || "Player";
}

async function getBalance() {
    if (!myUserId) return 100;
    const response = await fetch(`${SERVER_URL}/api/balance?user_id=${myUserId}`);
    const data = await response.json();
    return data.balance;
}

async function sendBet(amount) {
    if (!myUserId) return false;
    const response = await fetch(`${SERVER_URL}/api/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: myUserId, username: myUsername, amount: amount })
    });
    const data = await response.json();
    return data;
}
/* ==========================================================================
   LUCKY SPIN — app.js
   ========================================================================== */
(() => {
  'use strict';

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

  /* ---------------------------------------------------------------------
     Config
     --------------------------------------------------------------------- */
  const CFG = {
    ROUND_SECONDS: 30,
    SPIN_MS: 5000,
    MIN_BET: 1,
    START_BALANCE: 1000,
    MIN_PARTICIPANTS: 2,
    MAX_CARDS: 420,          // safety cap on total reel cards
    CYCLES: 7,                // repeated shuffled cycles before the landing cycle
    HISTORY_LIMIT: 25,
  };

  const COMMISSION_TIERS = [
    { max: 0.10, rate: 0.20 },
    { max: 0.30, rate: 0.15 },
    { max: 0.50, rate: 0.10 },
    { max: 0.70, rate: 0.05 },
    { max: 1.001, rate: 0.02 },
  ];

  const BOT_NAMES = [
    'NeonFox', 'StreamKitty', 'LuckyDan', 'PixelWolf', 'MissGold',
    'ToxicRain', 'СашаКрут', 'ГрозаЧата', 'КотЛеонид', 'Zerkalo',
    'НочнойДождь', 'VeraSpin', 'MaxWinner', 'ТихийШторм', 'RubyHeart',
    'DimaLive', 'ЗвёздныйКит', 'NovaStrike', 'КириллPRO', 'GoldenEcho',
  ];

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
    reelEmpty: $('reelEmpty'),
    pointer: $('pointer'),
    winnerBanner: $('winnerBanner'),
    winnerAvatar: $('winnerAvatar'),
    winnerName: $('winnerName'),
    winnerPrize: $('winnerPrize'),
    nickInput: $('nickInput'),
    betInput: $('betInput'),
    quickBets: $('quickBets'),
    addBetBtn: $('addBetBtn'),
    botBtn: $('botBtn'),
    spinBtn: $('spinBtn'),
    spinBtnLabel: $('spinBtnLabel'),
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

  /* ---------------------------------------------------------------------
     Persistence
     --------------------------------------------------------------------- */
  const store = {
    load(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    save(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota / privacy mode */ }
    },
  };

  const KEYS = { players: 'luckyspin_players_v1', history: 'luckyspin_history_v1', sound: 'luckyspin_sound_v1' };

  let players = store.load(KEYS.players, {});   // { name: { balance, wins, rounds, totalWon } }
  let history = store.load(KEYS.history, []);   // [{ time, names, bank, winner, chance, rate, prize }]
  let soundOn = store.load(KEYS.sound, true);

  function getMyName() {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      return (u.username || u.first_name || 'Вы').slice(0, 16);
    }
    return 'Вы';
  }
  const MY_NAME = getMyName();

  function ensurePlayer(name) {
    if (!players[name]) {
      players[name] = { balance: CFG.START_BALANCE, wins: 0, rounds: 0, totalWon: 0 };
    }
    return players[name];
  }
  ensurePlayer(MY_NAME);
  store.save(KEYS.players, players);

  /* ---------------------------------------------------------------------
     Avatars — deterministic gradient + initials, no network dependency
     --------------------------------------------------------------------- */
  const avatarCache = new Map();
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  function initialsOf(name) {
    const clean = name.trim();
    if (!clean) return '?';
    const parts = clean.split(/\s+/);
    if (parts.length === 1) return clean.slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
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
     Round state
     --------------------------------------------------------------------- */
  const round = {
    participants: [],   // [{ name, bet }]
    bank: 0,
    timeLeft: CFG.ROUND_SECONDS,
    timerId: null,
    spinning: false,
    hasWinnerShown: false,
  };

  function fmt(n) {
    return '$' + Math.round(n).toLocaleString('ru-RU');
  }

  /* ---------------------------------------------------------------------
     Sound (WebAudio, tiny synthesized blips — no external files)
     --------------------------------------------------------------------- */
  let actx = null;
  function audioCtx() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
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
  function sfxWin() {
    [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.28, 'triangle', 0.09, i * 0.11));
  }

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

  function resizeCanvas() {
    el.confettiCanvas.width = window.innerWidth;
    el.confettiCanvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const CONFETTI_COLORS = ['#8b5cf6', '#ec4899', '#fbbf24', '#f472b6', '#a855f7', '#fde68a'];

  function fireConfetti() {
    const W = el.confettiCanvas.width, H = el.confettiCanvas.height;
    const n = 140;
    confettiParticles = Array.from({ length: n }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 60,
      y: H * 0.32,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 9 - 4,
      size: 5 + Math.random() * 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
      life: 0,
    }));
    if (confettiRAF) cancelAnimationFrame(confettiRAF);
    const gravity = 0.22;
    const start = performance.now();
    function step(now) {
      const dt = Math.min(2, (now - start) / 16 - (step.lastT || 0));
      step.lastT = (now - start) / 16;
      ctxC.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of confettiParticles) {
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        p.life++;
        if (p.y < H + 20) alive = true;
        const fade = Math.max(0, 1 - p.life / 220);
        ctxC.save();
        ctxC.globalAlpha = fade;
        ctxC.translate(p.x, p.y);
        ctxC.rotate(p.rot);
        ctxC.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctxC.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
        } else {
          ctxC.beginPath();
          ctxC.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctxC.fill();
        }
        ctxC.restore();
      }
      if (alive && confettiParticles.some(p => p.life < 260)) {
        confettiRAF = requestAnimationFrame(step);
      } else {
        ctxC.clearRect(0, 0, W, H);
      }
    }
    confettiRAF = requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------------------
     Rendering: bank / balance / participants
     --------------------------------------------------------------------- */
  function bump(elm) {
    elm.classList.remove('is-bumped');
    void elm.offsetWidth;
    elm.classList.add('is-bumped');
  }

  function renderBank() {
    el.bankValue.textContent = fmt(round.bank);
    bump(el.bankValue);
    el.myBalance.textContent = fmt(ensurePlayer(MY_NAME).balance);
    el.participantsCount.textContent = `Участников: ${round.participants.length}`;
  }

  function renderParticipants() {
    if (!round.participants.length) {
      el.participantsList.innerHTML = '<div class="empty-hint">Пока никто не поставил</div>';
      return;
    }
    el.participantsList.innerHTML = round.participants.map(p => {
      const pct = round.bank ? (p.bet / round.bank * 100) : 0;
      return `<div class="p-row">
        <img class="p-row__avatar" src="${avatarUri(p.name)}" alt="">
        <div class="p-row__body">
          <div class="p-row__top">
            <span class="p-row__name">${escapeHtml(p.name)}</span>
            <span class="p-row__bet">${fmt(p.bet)}</span>
          </div>
          <div class="p-row__bar"><div class="p-row__bar-fill" style="width:${pct}%"></div></div>
          <div class="p-row__chance">Шанс на победу: ${pct.toFixed(1)}%</div>
        </div>
      </div>`;
    }).join('');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------------------------------------------------------------
     Reel building (preview, before spin)
     --------------------------------------------------------------------- */
  function cardHtml(p, extraClass) {
    return `<div class="player-card ${extraClass || ''}" data-name="${escapeHtml(p.name)}">
      <img class="player-card__avatar" src="${avatarUri(p.name)}" alt="">
      <span class="player-card__name">${escapeHtml(p.name)}</span>
      <span class="player-card__bet">${fmt(p.bet)}</span>
    </div>`;
  }

  function buildPreviewUnits() {
    // one card per bet-point, capped for performance
    const units = [];
    const totalBet = round.participants.reduce((s, p) => s + p.bet, 0) || 1;
    const scale = totalBet > CFG.MAX_CARDS ? CFG.MAX_CARDS / totalBet : 1;
    for (const p of round.participants) {
      const count = Math.max(1, Math.round(p.bet * scale));
      for (let i = 0; i < count; i++) units.push(p);
    }
    return shuffle(units.slice());
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function renderReelPreview() {
    if (round.spinning) return;
    el.reelTrack.style.transition = 'none';
    el.reelTrack.style.transform = 'translateX(0)';
    if (!round.participants.length) {
      el.reelTrack.innerHTML = `<div class="reel-empty" id="reelEmpty">
        <span class="reel-empty__icon">🎴</span>
        <span>Добавьте участников, чтобы начать спин</span>
      </div>`;
      return;
    }
    const units = buildPreviewUnits();
    el.reelTrack.innerHTML = units.map(p => cardHtml(p)).join('');
  }

  /* ---------------------------------------------------------------------
     Betting
     --------------------------------------------------------------------- */
  function currentCardMetrics() {
    const sample = el.reelTrack.querySelector('.player-card');
    const gap = parseFloat(getComputedStyle(el.reelTrack).gap) || 10;
    const w = sample ? sample.getBoundingClientRect().width : (window.innerWidth < 360 ? 84 : 96);
    return { w, gap };
  }

  function placeBet(name, bet) {
    name = (name || '').trim().slice(0, 16) || MY_NAME;
    bet = Math.floor(Number(bet));
    if (!bet || bet < CFG.MIN_BET) { shake(el.betInput); return; }
    if (round.spinning) return;

    const player = ensurePlayer(name);
    if (player.balance < bet) { shake(el.betInput); flashInsufficient(); return; }

    player.balance -= bet;
    store.save(KEYS.players, players);

    const existing = round.participants.find(p => p.name === name);
    if (existing) existing.bet += bet;
    else round.participants.push({ name, bet });

    round.bank += bet;
    sfxBet();

    hideWinnerBanner();
    renderBank();
    renderParticipants();
    renderReelPreview();
    updateSpinButton();

    if (!round.timerId) startRoundTimer();
  }

  function flashInsufficient() {
    el.nickInput.placeholder = 'Недостаточно USDT!';
    setTimeout(() => { el.nickInput.placeholder = 'Ник зрителя'; }, 1400);
  }
  function shake(elm) {
    elm.style.animation = 'none';
    void elm.offsetWidth;
    elm.style.animation = 'shake .3s ease';
  }
  // lightweight shake keyframes injected once
  const shakeStyle = document.createElement('style');
  shakeStyle.textContent = `@keyframes shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}`;
  document.head.appendChild(shakeStyle);

  el.addBetBtn.addEventListener('click', () => {
    placeBet(el.nickInput.value, el.betInput.value);
    el.nickInput.value = '';
  });
  el.betInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.addBetBtn.click(); });
  el.nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.addBetBtn.click(); });

  el.quickBets.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-btn');
    if (!btn) return;
    const cur = parseInt(el.betInput.value, 10) || 0;
    el.betInput.value = cur + parseInt(btn.dataset.amt, 10);
  });

  el.botBtn.addEventListener('click', () => {
    const used = new Set(round.participants.map(p => p.name));
    const pool = BOT_NAMES.filter(n => !used.has(n));
    const name = (pool.length ? pool : BOT_NAMES)[Math.floor(Math.random() * (pool.length ? pool.length : BOT_NAMES.length))];
    ensurePlayer(name);
    const bet = [5, 10, 15, 20, 25, 30, 50, 75][Math.floor(Math.random() * 8)];
    if (players[name].balance < bet) players[name].balance = CFG.START_BALANCE;
    placeBet(name, bet);
  });

  /* ---------------------------------------------------------------------
     Round timer
     --------------------------------------------------------------------- */
  const RING_C = 2 * Math.PI * 17; // ~106.8

  function updateSpinButton() {
    const can = round.participants.length >= CFG.MIN_PARTICIPANTS && !round.spinning;
    el.spinBtn.disabled = !can;
  }

  function startRoundTimer() {
    round.timeLeft = CFG.ROUND_SECONDS;
    el.timerLabel.textContent = round.timeLeft;
    el.timerRing.style.strokeDasharray = String(RING_C);
    el.timerRing.style.strokeDashoffset = '0';
    el.roundTimerWrap.classList.remove('is-warning', 'is-critical');

    round.timerId = setInterval(() => {
      round.timeLeft -= 1;
      el.timerLabel.textContent = Math.max(0, round.timeLeft);
      const off = RING_C * (1 - round.timeLeft / CFG.ROUND_SECONDS);
      el.timerRing.style.strokeDashoffset = String(off);

      el.roundTimerWrap.classList.toggle('is-warning', round.timeLeft <= 10 && round.timeLeft > 5);
      el.roundTimerWrap.classList.toggle('is-critical', round.timeLeft <= 5);
      if (round.timeLeft <= 5 && round.timeLeft > 0) sfxTick();

      if (round.timeLeft <= 0) {
        clearRoundTimer();
        if (round.participants.length >= CFG.MIN_PARTICIPANTS) {
          spinReel();
        } else {
          refundRound('Недостаточно участников — ставки возвращены');
        }
      }
    }, 1000);
  }

  function clearRoundTimer() {
    if (round.timerId) { clearInterval(round.timerId); round.timerId = null; }
  }

  function refundRound(reason) {
    for (const p of round.participants) {
      ensurePlayer(p.name).balance += p.bet;
    }
    store.save(KEYS.players, players);
    resetRound();
    el.reelTrack.innerHTML = `<div class="reel-empty">
      <span class="reel-empty__icon">↩️</span>
      <span>${escapeHtml(reason)}</span>
    </div>`;
  }

  el.spinBtn.addEventListener('click', () => {
    if (round.participants.length >= CFG.MIN_PARTICIPANTS && !round.spinning) {
      clearRoundTimer();
      spinReel();
    }
  });

  /* ---------------------------------------------------------------------
     Commission
     --------------------------------------------------------------------- */
  function commissionRateFor(chance) {
    for (const tier of COMMISSION_TIERS) {
      if (chance <= tier.max) return tier.rate;
    }
    return COMMISSION_TIERS[COMMISSION_TIERS.length - 1].rate;
  }

  /* ---------------------------------------------------------------------
     Spin
     --------------------------------------------------------------------- */
  function weightedWinner() {
    const r = Math.random() * round.bank;
    let acc = 0;
    for (const p of round.participants) {
      acc += p.bet;
      if (r <= acc) return p;
    }
    return round.participants[round.participants.length - 1];
  }

  function spinReel() {
    if (round.spinning || round.participants.length < CFG.MIN_PARTICIPANTS) return;
    round.spinning = true;
    updateSpinButton();
    hideWinnerBanner();
    el.reelShell.classList.add('is-spinning');
    el.pointer.style.animationPlayState = 'running';
    sfxSpinStart();

    const winner = weightedWinner();
    const baseUnits = buildPreviewUnits(); // proportional & shuffled

    // Build the full strip: several shuffled cycles + a final cycle guaranteed to contain the winner
    let strip = [];
    for (let c = 0; c < CFG.CYCLES; c++) strip = strip.concat(shuffle(baseUnits.slice()));
    const landingCycle = shuffle(baseUnits.slice());
    const winnerIdxInCycle = landingCycle.reduce((arr, p, i) => { if (p.name === winner.name) arr.push(i); return arr; }, []);
    const chosenLocal = winnerIdxInCycle[Math.floor(winnerIdxInCycle.length / 2)] ?? 0;
    strip = strip.concat(landingCycle);
    const targetIndex = strip.length - landingCycle.length + chosenLocal;

    el.reelTrack.innerHTML = strip.map(p => cardHtml(p)).join('');

    // measure after render
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
        if (ticked < CFG.SPIN_MS / 220) sfxTick();
        else clearInterval(tickTimer);
      }, 220);

      const onEnd = (e) => {
        if (e.propertyName !== 'transform') return;
        el.reelTrack.removeEventListener('transitionend', onEnd);
        clearInterval(tickTimer);
        finishRound(winner, targetIndex);
      };
      el.reelTrack.addEventListener('transitionend', onEnd);
    });
  }

  function finishRound(winner) {
    const chance = winner.bet / round.bank;
    const rate = commissionRateFor(chance);
    const prize = round.bank * (1 - rate);
    const bankAtWin = round.bank;

    // highlight winner card(s)
    const cards = el.reelTrack.querySelectorAll('.player-card');
    const vpRect = el.reelTrack.parentElement.getBoundingClientRect();
    const vpCenter = vpRect.left + vpRect.width / 2;
    let closest = null, closestDist = Infinity;
    cards.forEach(c => {
      if (c.dataset.name !== winner.name) return;
      const r = c.getBoundingClientRect();
      const center = r.left + r.width / 2;
      const dist = Math.abs(center - vpCenter);
      if (dist < closestDist) { closestDist = dist; closest = c; }
    });
    if (closest) closest.classList.add('is-winner');

    // payout
    const wp = ensurePlayer(winner.name);
    wp.balance += prize;
    wp.wins += 1;
    wp.totalWon += prize;
    for (const p of round.participants) ensurePlayer(p.name).rounds += 1;
    store.save(KEYS.players, players);

    // history
    history.unshift({
      time: Date.now(),
      names: round.participants.map(p => p.name),
      bank: bankAtWin,
      winner: winner.name,
      chance,
      rate,
      prize,
    });
    history = history.slice(0, CFG.HISTORY_LIMIT);
    store.save(KEYS.history, history);

    // UI
    el.winnerAvatar.innerHTML = `<img src="${avatarUri(winner.name)}" alt="">`;
    el.winnerName.textContent = winner.name;
    el.winnerPrize.textContent = `+${fmt(prize)} USDT · комиссия ${Math.round(rate * 100)}%`;
    el.winnerBanner.classList.add('is-visible');

    fireConfetti();
    sfxWin();
    if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.notificationOccurred('success'); } catch (e) {} }

    renderHistory();
    renderLeaders();
    renderBank();

    el.reelShell.classList.remove('is-spinning');
    round.spinning = false;

    setTimeout(() => {
      round.participants = [];
      round.bank = 0;
      renderParticipants();
      updateSpinButton();
      renderBank();
    }, 1400);
  }

  function resetRound() {
    round.participants = [];
    round.bank = 0;
    round.spinning = false;
    clearRoundTimer();
    el.timerLabel.textContent = CFG.ROUND_SECONDS;
    el.timerRing.style.strokeDashoffset = '0';
    el.roundTimerWrap.classList.remove('is-warning', 'is-critical');
    renderParticipants();
    updateSpinButton();
    renderBank();
  }

  function hideWinnerBanner() {
    el.winnerBanner.classList.remove('is-visible');
  }

  /* ---------------------------------------------------------------------
     History & leaderboard rendering
     --------------------------------------------------------------------- */
  function renderHistory() {
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

  function renderLeaders() {
    const list = Object.entries(players)
      .map(([name, d]) => ({ name, ...d }))
      .filter(p => p.wins > 0 || p.rounds > 0)
      .sort((a, b) => b.totalWon - a.totalWon)
      .slice(0, 15);

    el.leadersEmpty.style.display = list.length ? 'none' : '';
    el.leadersList.innerHTML = list.map((p, i) => `
      <div class="l-row">
        <div class="l-row__rank">${i + 1}</div>
        <img class="l-row__avatar" src="${avatarUri(p.name)}" alt="">
        <div class="l-row__body">
          <div class="l-row__name">${escapeHtml(p.name)}</div>
          <div class="l-row__meta">${p.wins} побед · ${p.rounds} раундов</div>
        </div>
        <div class="l-row__score">${fmt(p.totalWon)}</div>
      </div>`).join('');
  }

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
    el.timerLabel.textContent = CFG.ROUND_SECONDS;
    el.timerRing.style.strokeDasharray = String(RING_C);
    el.timerRing.style.strokeDashoffset = '0';
    renderBank();
    renderParticipants();
    renderReelPreview();
    renderHistory();
    renderLeaders();
    updateSpinButton();
  }

  init();
})();
