from flask import Flask, request, jsonify
import sqlite3
import threading
import time
import random

app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    # Manual CORS instead of flask-cors — avoids depending on a package
    # that may not be installed in the same environment the web app runs in.
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

conn = sqlite3.connect("lucky.db", check_same_thread=False)
cursor = conn.cursor()

cursor.execute('''CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    balance REAL DEFAULT 100,
    wins INTEGER DEFAULT 0,
    rounds INTEGER DEFAULT 0,
    total_won REAL DEFAULT 0
)''')
conn.commit()

# migration: add columns if this is an older db that only has (user_id, username, balance)
for col, ddl in [("wins", "INTEGER DEFAULT 0"), ("rounds", "INTEGER DEFAULT 0"), ("total_won", "REAL DEFAULT 0"), ("avatar_url", "TEXT")]:
    try:
        cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # column already exists

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ROUND_SECONDS = 30       # countdown once MIN_PARTICIPANTS is reached
SPIN_SECONDS = 8         # visual spin duration all clients animate for — must match CFG.SPIN_MS in app.js
RESET_SECONDS = 4        # how long the winner banner stays before a new round opens
MIN_PARTICIPANTS = 2
HISTORY_LIMIT = 25
LEADERS_LIMIT = 15

COMMISSION_TIERS = [
    (0.10, 0.20),
    (0.30, 0.15),
    (0.50, 0.10),
    (0.70, 0.05),
    (1.001, 0.02),
]


def commission_rate(chance):
    for max_chance, rate in COMMISSION_TIERS:
        if chance <= max_chance:
            return rate
    return COMMISSION_TIERS[-1][1]


# ---------------------------------------------------------------------------
# Shared state - this is what makes the game the same for every visitor
# instead of every browser having its own private round.
# ---------------------------------------------------------------------------
lock = threading.Lock()

round_state = {
    "status": "waiting",        # waiting -> counting -> spinning -> finished -> waiting
    "participants": [],         # [{user_id, username, bet}]
    "bank": 0.0,
    "countdown_end": None,
    "spin_end": None,
    "reset_at": None,
    "winner": None,             # {user_id, username, chance, rate, prize, bank}
}

history = []  # shared list, newest first, capped at HISTORY_LIMIT


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def get_user(user_id):
    cursor.execute("SELECT user_id, username, balance, wins, rounds, total_won, avatar_url FROM users WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    if not row:
        cursor.execute(
            "INSERT INTO users (user_id, username, balance) VALUES (?, ?, ?)",
            (user_id, "Player", 100),
        )
        conn.commit()
        return {"user_id": user_id, "username": "Player", "balance": 100, "wins": 0, "rounds": 0, "total_won": 0, "avatar_url": None}
    return {"user_id": row[0], "username": row[1], "balance": row[2], "wins": row[3], "rounds": row[4], "total_won": row[5], "avatar_url": row[6]}


def update_user(user_id, **fields):
    sets = ", ".join(f"{k} = ?" for k in fields)
    cursor.execute(f"UPDATE users SET {sets} WHERE user_id = ?", (*fields.values(), user_id))
    conn.commit()


# ---------------------------------------------------------------------------
# Round state machine — pulled out of the background thread so it also runs
# synchronously on every request. This is what actually fixes the "stuck
# round" bug: shared hosts like PythonAnywhere can recycle/kill background
# threads at any time, so the round must be able to advance itself whenever
# anyone hits the API, not only while a thread happens to be alive.
# MUST be called while holding `lock`.
# ---------------------------------------------------------------------------
def advance_round():
    now = time.time()

    if round_state["status"] == "counting" and now >= round_state["countdown_end"]:
        participants = round_state["participants"]
        bank = round_state["bank"]

        r = random.uniform(0, bank)
        acc = 0.0
        winner = participants[-1]
        for p in participants:
            acc += p["bet"]
            if r <= acc:
                winner = p
                break

        chance = winner["bet"] / bank if bank else 0
        rate = commission_rate(chance)
        prize = bank * (1 - rate)

        wu = get_user(winner["user_id"])
        update_user(
            winner["user_id"],
            balance=wu["balance"] + prize,
            wins=wu["wins"] + 1,
            total_won=wu["total_won"] + prize,
        )
        for p in participants:
            pu = get_user(p["user_id"])
            update_user(p["user_id"], rounds=pu["rounds"] + 1)

        history.insert(0, {
            "time": int(now * 1000),
            "names": [p["username"] for p in participants],
            "bank": bank,
            "winner": winner["username"],
            "winner_avatar_url": winner.get("avatar_url"),
            "chance": chance,
            "rate": rate,
            "prize": prize,
        })
        del history[HISTORY_LIMIT:]

        round_state["winner"] = {
            "user_id": winner["user_id"],
            "username": winner["username"],
            "avatar_url": winner.get("avatar_url"),
            "chance": chance,
            "rate": rate,
            "prize": prize,
            "bank": bank,
        }
        round_state["status"] = "spinning"
        round_state["spin_end"] = now + SPIN_SECONDS
        # a lot of time may have passed since the last check (e.g. thread was
        # dead) — fall through so a stale round can catch up in one call
        now = time.time()

    if round_state["status"] == "spinning" and now >= round_state["spin_end"]:
        round_state["status"] = "finished"
        round_state["reset_at"] = now + RESET_SECONDS

    if round_state["status"] == "finished" and now >= round_state["reset_at"]:
        round_state["status"] = "waiting"
        round_state["participants"] = []
        round_state["bank"] = 0.0
        round_state["winner"] = None
        round_state["countdown_end"] = None
        round_state["spin_end"] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def home():
    return "Lucky Spin Server Running!"


@app.route("/api/balance")
def get_balance():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"balance": 0})
    return jsonify({"balance": get_user(user_id)["balance"]})


@app.route("/api/round")
def get_round():
    with lock:
        advance_round()
        seconds_left = None
        if round_state["status"] == "counting":
            seconds_left = max(0, round(round_state["countdown_end"] - time.time()))
        return jsonify({
            "status": round_state["status"],
            "participants": round_state["participants"],
            "bank": round_state["bank"],
            "seconds_left": seconds_left,
            "winner": round_state["winner"],
        })


@app.route("/api/history")
def get_history():
    with lock:
        return jsonify({"history": history[:HISTORY_LIMIT]})


@app.route("/api/leaders")
def get_leaders():
    cursor.execute(
        "SELECT username, wins, rounds, total_won, avatar_url FROM users WHERE wins > 0 OR rounds > 0 ORDER BY total_won DESC LIMIT ?",
        (LEADERS_LIMIT,),
    )
    rows = cursor.fetchall()
    leaders = [{"username": r[0], "wins": r[1], "rounds": r[2], "total_won": r[3], "avatar_url": r[4]} for r in rows]
    return jsonify({"leaders": leaders})


@app.route("/api/bet", methods=["POST"])
def place_bet():
    data = request.json or {}
    user_id = str(data.get("user_id") or "")
    username = (data.get("username") or "Player")[:16]
    avatar_url = data.get("avatar_url") or None
    if avatar_url and not str(avatar_url).startswith(("https://", "http://")):
        avatar_url = None  # ignore anything that isn't a real URL
    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        amount = 0

    if not user_id:
        return jsonify({"success": False, "error": "Missing user_id"})
    if amount <= 0:
        return jsonify({"success": False, "error": "Invalid amount"})

    with lock:
        advance_round()
        if round_state["status"] in ("spinning", "finished"):
            return jsonify({"success": False, "error": "Round is wrapping up, wait for the next one"})

        user = get_user(user_id)
        if user["balance"] < amount:
            return jsonify({"success": False, "error": "Insufficient funds"})

        new_balance = user["balance"] - amount
        update_fields = {"balance": new_balance, "username": username}
        if avatar_url:
            update_fields["avatar_url"] = avatar_url
        update_user(user_id, **update_fields)
        stored_avatar_url = avatar_url or user.get("avatar_url")

        existing = next((p for p in round_state["participants"] if p["user_id"] == user_id), None)
        if existing:
            existing["bet"] += amount
            if stored_avatar_url:
                existing["avatar_url"] = stored_avatar_url
        else:
            round_state["participants"].append({
                "user_id": user_id, "username": username, "bet": amount, "avatar_url": stored_avatar_url,
            })

        round_state["bank"] += amount

        if round_state["status"] == "waiting" and len(round_state["participants"]) >= MIN_PARTICIPANTS:
            round_state["status"] = "counting"
            round_state["countdown_end"] = time.time() + ROUND_SECONDS

        return jsonify({"success": True, "balance": new_balance})


# ---------------------------------------------------------------------------
# Background worker - a nice-to-have that keeps the round moving even when
# nobody is actively polling. Not load-bearing anymore: advance_round() runs
# on every request too, so a dead/recycled thread on a host like
# PythonAnywhere can no longer freeze the round.
# ---------------------------------------------------------------------------
def round_worker():
    while True:
        time.sleep(1)
        with lock:
            advance_round()


threading.Thread(target=round_worker, daemon=True).start()

if __name__ == "__main__":
    app.run()
