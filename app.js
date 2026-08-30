// ============================================
// GSK CASINO
// USDT Slots
// ============================================

const symbols = ["💎", "7️⃣", "🍒", "USDT", "🔔", "🍋", "$ "];

let balance = 1000;
let bet = 10;
let spinning = false;

const balanceEl = document.getElementById("balance");
const betEl = document.getElementById("bet");
const spinBtn = document.getElementById("spinBtn");
const plusBtn = document.getElementById("plusBtn");
const minusBtn = document.getElementById("minusBtn");
const resultEl = document.getElementById("result");
const historyEl = document.getElementById("history");
const reels = [
    document.getElementById("reel1"),
    document.getElementById("reel2"),
    document.getElementById("reel3")
];
const reelBoxes = document.querySelectorAll(".reel");
const clearHistoryBtn = document.getElementById("clearHistory");

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor("#07050d");
    if (tg.setBackgroundColor) tg.setBackgroundColor("#07050d");
}

function saveGame() {
    localStorage.setItem("gsk_casino_balance", balance);
    localStorage.setItem("gsk_casino_bet", bet);
}

function loadGame() {
    const savedBalance = localStorage.getItem("gsk_casino_balance");
    const savedBet = localStorage.getItem("gsk_casino_bet");
    if (savedBalance !== null) {
        balance = Number(savedBalance);
        if (!Number.isFinite(balance) || balance < 0) balance = 1000;
    }
    if (savedBet !== null) {
        bet = Number(savedBet);
        if (!Number.isFinite(bet)) bet = 10;
    }
    normalizeBet();
    updateUI();
}

function updateUI() {
    balanceEl.textContent = balance;
    betEl.textContent = bet;
    minusBtn.disabled = spinning || bet <= 1;
    plusBtn.disabled = spinning || bet >= Math.min(100, balance);
    spinBtn.disabled = spinning || balance < bet;
}

function normalizeBet() {
    if (balance <= 0) { bet = 1; return; }
    const maxBet = Math.min(100, balance);
    if (bet > maxBet) bet = maxBet;
    if (bet < 1) bet = 1;
}

minusBtn.addEventListener("click", () => {
    if (spinning) return;
    bet -= 1;
    if (bet < 1) bet = 1;
    saveGame();
    updateUI();
});

plusBtn.addEventListener("click", () => {
    if (spinning) return;
    const maxBet = Math.min(100, balance);
    bet += 1;
    if (bet > maxBet) bet = maxBet;
    saveGame();
    updateUI();
});

document.querySelectorAll(".quick-bets button").forEach(button => {
    button.addEventListener("click", () => {
        if (spinning) return;
        const value = Number(button.dataset.bet);
        bet = Math.min(value, 100, balance);
        if (bet < 1 && balance > 0) bet = 1;
        saveGame();
        updateUI();
    });
});

function randomSymbol() {
    return symbols[Math.floor(Math.random() * symbols.length)];
}

function animateReel(reel, duration) {
    return new Promise(resolve => {
        const box = reel.parentElement;
        box.classList.add("spinning");
        const interval = setInterval(() => {
            reel.textContent = randomSymbol();
        }, 80);
        setTimeout(() => {
            clearInterval(interval);
            box.classList.remove("spinning");
            resolve();
        }, duration);
    });
}

function calculateWin(result) {
    const [a, b, c] = result;
    if (a === b && b === c) return { multiplier: 10, type: "big" };
    if (a === b || a === c || b === c) return { multiplier: 2, type: "small" };
    return { multiplier: 0, type: "none" };
}

spinBtn.addEventListener("click", spin);

async function spin() {
    if (spinning) return;
    if (balance < bet) {
        resultEl.textContent = "Недостаточно USDT";
        resultEl.className = "result lose";
        return;
    }
    spinning = true;
    balance -= bet;
    saveGame();
    updateUI();
    resultEl.textContent = "Барабаны вращаются...";
    resultEl.className = "result";
    spinBtn.classList.add("spinning");
    reelBoxes.forEach(box => box.classList.remove("win"));

    const result = [randomSymbol(), randomSymbol(), randomSymbol()];

    await Promise.all([
        animateReel(reels[0], 900),
        animateReel(reels[1], 1250),
        animateReel(reels[2], 1600)
    ]);

    reels.forEach((reel, index) => {
        reel.textContent = result[index];
    });

    const winData = calculateWin(result);
    let winAmount = 0;

    if (winData.multiplier > 0) {
        winAmount = bet * winData.multiplier;
        balance += winAmount;
        resultEl.className = "result win";
        if (winData.multiplier === 10) {
            resultEl.textContent = `🎉 ДЖЕКПОТ! +${winAmount} USDT`;
        } else {
            resultEl.textContent = `✨ ВЫИГРЫШ! +${winAmount} USDT`;
        }
        const [a, b, c] = result;
        if (a === b) { reelBoxes[0].classList.add("win"); reelBoxes[1].classList.add("win"); }
        if (a === c) { reelBoxes[0].classList.add("win"); reelBoxes[2].classList.add("win"); }
        if (b === c) { reelBoxes[1].classList.add("win"); reelBoxes[2].classList.add("win"); }
        if (winData.multiplier === 10) reelBoxes.forEach(box => box.classList.add("win"));
        createConfetti();
    } else {
        resultEl.className = "result lose";
        resultEl.textContent = `Не повезло. −${bet} USDT`;
    }

    addHistory(result, bet, winAmount, winData.multiplier);
    saveGame();
    spinning = false;
    spinBtn.classList.remove("spinning");
    normalizeBet();
    updateUI();

    if (balance === 0) {
        resultEl.textContent = "Баланс закончился";
        resultEl.className = "result lose";
    }
}

function getHistory() {
    try { return JSON.parse(localStorage.getItem("gsk_casino_history")) || []; } catch { return []; }
}

function saveHistory(history) {
    localStorage.setItem("gsk_casino_history", JSON.stringify(history));
}

function addHistory(result, betAmount, winAmount, multiplier) {
    const history = getHistory();
    history.unshift({
        result, bet: betAmount, win: winAmount, multiplier,
        time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    });
    history.splice(20);
    saveHistory(history);
    renderHistory();
}

function renderHistory() {
    const history = getHistory();
    if (history.length === 0) {
        historyEl.innerHTML = `<div class="empty-history">Здесь появятся результаты вращений</div>`;
        return;
    }
    historyEl.innerHTML = history.map(game => {
        const win = game.multiplier > 0;
        return `
            <div class="history-item">
                <div class="history-symbols">${game.result.join(" ")}</div>
                <div class="history-info">
                    <small>${game.time}</small>
                    ${win ? `<span class="history-win">+${game.win} $</span>` : `<span class="history-loss">−${game.bet} $</span>`}
                </div>
            </div>
        `;
    }).join("");
}

clearHistoryBtn.addEventListener("click", () => {
    localStorage.removeItem("gsk_casino_history");
    renderHistory();
});

function createConfetti() {
    const container = document.getElementById("confetti");
    const pieces = 70;
    for (let i = 0; i < pieces; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-piece";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.animationDelay = Math.random() * .5 + "s";
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        const type = Math.floor(Math.random() * 3);
        if (type === 0) piece.style.background = "#ffd35a";
        else if (type === 1) piece.style.background = "#a855f7";
        else piece.style.background = "#ffffff";
        container.appendChild(piece);
        setTimeout(() => piece.remove(), 2500);
    }
}

loadGame();
renderHistory();
