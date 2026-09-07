const socket = io();
const form = document.querySelector("#joinForm"),
  pinInput = document.querySelector("#pinInput"),
  nameInput = document.querySelector("#nameInput"),
  error = document.querySelector("#error"),
  card = document.querySelector("#joinCard"),
  game = document.querySelector("#playerGame");
const params = new URLSearchParams(location.search);
if (params.get("pin")) pinInput.value = params.get("pin");
const STORAGE = "notebookLiveQuizPlayerSession";
let current = null,
  pin = null;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function err(m) {
  error.textContent = m || "";
}
function saved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || "null");
  } catch {
    return null;
  }
}
function saveSession(data) {
  localStorage.setItem(STORAGE, JSON.stringify(data));
}
function resume() {
  const s = saved();
  if (!s?.pin || !s?.sessionId) return false;
  if (params.get("pin") && params.get("pin") !== s.pin) return false;
  pin = s.pin;
  pinInput.value = s.pin;
  nameInput.value = s.name || "";
  socket.emit("player:join", {
    pin: s.pin,
    name: s.name,
    sessionId: s.sessionId,
  });
  return true;
}
socket.on("connect", () => {
  if (current) {
    const s = saved();
    if (s)
      socket.emit("player:join", {
        pin: s.pin,
        name: s.name,
        sessionId: s.sessionId,
      });
  } else resume();
});
form.addEventListener("submit", (e) => {
  e.preventDefault();
  err("");
  pin = pinInput.value.replace(/\D/g, "");
  socket.emit("player:join", { pin, name: nameInput.value, sessionId: null });
});
socket.on("error:message", (m) => {
  err(m);
  if (
    String(m).includes("invalid") ||
    String(m).includes("expired") ||
    String(m).includes("Game not found")
  )
    localStorage.removeItem(STORAGE);
});
socket.on("player:joined", (d) => {
  current = d.player;
  pin = d.room.pin;
  if (d.sessionId)
    saveSession({ pin, sessionId: d.sessionId, name: d.player.name });
  card.classList.add("hidden");
  game.classList.remove("hidden");
  if (d.room.state === "results" && d.room.lastResult)
    renderPlayerResults(d.room.lastResult);
  else if (d.room.state === "lobby") renderLobby(d.room);
});
socket.on("room:update", (r) => {
  if (!current) return;
  if (r.state === "lobby") renderLobby(r);
  if (r.state === "results" && r.lastResult) renderPlayerResults(r.lastResult);
  if (r.state === "finished")
    renderFinished({
      leaderboard: [...r.players]
        .sort((a, b) => b.score - a.score)
        .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score })),
    });
});
socket.on("question:started", renderQuestion);
socket.on("answer:accepted", () => {
  game.innerHTML = `<div class="card status"><h1>Answer locked in</h1><p>Watch the host screen for the result.</p></div>`;
});
socket.on("question:ended", renderPlayerResults);
socket.on("game:finished", renderFinished);
socket.on("game:closed", (d) => {
  localStorage.removeItem(STORAGE);
  game.innerHTML = `<div class="card status"><h2>Game closed</h2><p>${esc(d.reason)}</p></div>`;
});
function renderLobby(r) {
  game.innerHTML = `<div class="card status"><div class="eyebrow">JOINED</div><h1>${esc(current.name)}</h1><p>You're in! Wait for the host to start.</p><div class="players">${r.players.map((p) => `<div class="player">${esc(p.name)}</div>`).join("")}</div></div>`;
}
function renderQuestion(q) {
  current.question = q;
  const hint = q.hint
    ? `<div class="hint-wrap"><button type="button" class="button hint-toggle" id="hintToggle">Show hint</button><div class="hint hidden" id="hintText">${esc(q.hint)}</div></div>`
    : "";
  game.innerHTML = `<div class="card"><div class="eyebrow">QUESTION ${q.number} / ${q.total}</div><div class="question">${esc(q.question)}</div><div>${Object.entries(
    q.options,
  )
    .map(
      ([k, v]) =>
        `<button class="answer-button" data-answer="${k}"><b>${k}</b><br>${esc(v)}</button>`,
    )
    .join("")}</div>${hint}<div class="muted" id="countdown"></div></div>`;
  document.querySelectorAll(".answer-button").forEach(
    (b) =>
      (b.onclick = () => {
        document
          .querySelectorAll(".answer-button")
          .forEach((x) => (x.disabled = true));
        b.classList.add("selected");
        socket.emit("player:answer", { answer: b.dataset.answer });
      }),
  );
  const toggle = document.querySelector("#hintToggle"),
    hintText = document.querySelector("#hintText");
  if (toggle && hintText)
    toggle.onclick = () => {
      const hidden = hintText.classList.toggle("hidden");
      toggle.textContent = hidden ? "Show hint" : "Hide hint";
    };
  clock(q.endsAt);
}
function clock(end) {
  const el = document.querySelector("#countdown");
  if (!el) return;
  const tick = () => {
    const ms = Math.max(0, end - Date.now());
    el.textContent = `${(ms / 1000).toFixed(1)} seconds`;
    if (ms > 0) requestAnimationFrame(tick);
  };
  tick();
}
function renderPlayerResults(r) {
  game.innerHTML = `<div class="card result-card"><div class="eyebrow">CORRECT ANSWER</div><h1>${esc(r.correctAnswer)}</h1><p>${esc(r.rationale)}</p><h2>Leaderboard</h2>${table(r.leaderboard)}</div>`;
}
function table(rows = []) {
  return `<table class="leaderboard"><tbody>${rows
    .slice(0, 10)
    .map(
      (p) => `<tr><td>${p.rank}. ${esc(p.name)}</td><td>${p.score}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}
function renderFinished(r) {
  localStorage.removeItem(STORAGE);
  game.innerHTML = `<div class="card result-card"><div class="eyebrow">FINAL RESULTS</div><h1>Game complete</h1>${table(r.leaderboard)}</div>`;
}
