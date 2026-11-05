(() => {
  "use strict";

  const TILE = 32;
  const COLS = 25;
  const ROWS = 19;
  const SEEDS_PER_SECTOR = 5;
  const MAX_SECTOR = 3;
  const STORAGE_KEY = "burrow-circuit-records-v1";
  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("screen-overlay");
  const runHud = document.getElementById("run-hud");
  const announcer = document.getElementById("announcer");
  const toast = document.getElementById("toast");
  const keys = new Set();
  const today = localDateString();
  document.getElementById("today-date").textContent = formatDate(today);

  const game = {
    state: "home", mode: "daily", seedLabel: today, sector: 1, score: 0,
    elapsed: 0, sectorElapsed: 0, lives: 3, collected: 0, map: null,
    crystals: [], enemies: [], exit: { x: 0, y: 0 }, worldTime: 0,
    player: { x: TILE * 1.5, y: TILE * 1.5, radius: 9, lastX: 1, lastY: 0, invulnerable: 0, dashTime: 0, dashCooldown: 0 },
    muted: true, audio: null, toastTimer: 0, sharedSeed: readSharedSeed(), stats: readStats()
  };

  function localDateString() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }
  function formatDate(value) {
    const parts = value.split("-");
    return parts.length === 3 ? parts[2] + " / " + parts[1] + " / " + parts[0] : value;
  }
  function readSharedSeed() {
    const seed = new URLSearchParams(location.search).get("seed");
    return seed && /^[a-zA-Z0-9_-]{3,32}$/.test(seed) ? seed : "";
  }
  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }
  function randomGenerator(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function createMaze(seed) {
    const random = randomGenerator(seed);
    const map = Array.from({ length: ROWS }, () => Array(COLS).fill(1));
    const stack = [{ x: 1, y: 1 }];
    map[1][1] = 0;
    while (stack.length) {
      const cell = stack[stack.length - 1];
      const choices = [{ x: cell.x, y: cell.y - 2 }, { x: cell.x + 2, y: cell.y }, { x: cell.x, y: cell.y + 2 }, { x: cell.x - 2, y: cell.y }]
        .filter((p) => p.x > 0 && p.y > 0 && p.x < COLS - 1 && p.y < ROWS - 1 && map[p.y][p.x] === 1);
      if (!choices.length) { stack.pop(); continue; }
      const next = choices[Math.floor(random() * choices.length)];
      map[(cell.y + next.y) / 2][(cell.x + next.x) / 2] = 0;
      map[next.y][next.x] = 0;
      stack.push(next);
    }
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (map[y][x] === 1 && random() < .075 && ((map[y][x - 1] === 0 && map[y][x + 1] === 0) || (map[y - 1][x] === 0 && map[y + 1][x] === 0))) map[y][x] = 0;
    }
    return { map, random };
  }
  function floorCells(map) {
    const cells = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (map[y][x] === 0) cells.push({ x, y });
    return cells;
  }
  function neighbors(x, y) { return [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]; }
  function getDistances(map, startX, startY) {
    const distance = Array.from({ length: ROWS }, () => Array(COLS).fill(Infinity));
    const queue = [{ x: startX, y: startY }];
    distance[startY][startX] = 0;
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head];
      for (const n of neighbors(p.x, p.y)) {
        if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS || map[n.y][n.x] !== 0 || distance[n.y][n.x] !== Infinity) continue;
        distance[n.y][n.x] = distance[p.y][p.x] + 1;
        queue.push(n);
      }
    }
    return distance;
  }
  function buildSector(seedLabel, sector) {
    const generated = createMaze(hashString(seedLabel + "::sector-" + sector));
    const map = generated.map;
    const random = generated.random;
    const cells = floorCells(map);
    const distance = getDistances(map, 1, 1);
    const distant = cells.filter((p) => distance[p.y][p.x] > 14);
    distant.sort((a, b) => distance[b.y][b.x] - distance[a.y][a.x]);
    const exit = distant[0] || cells[cells.length - 1];
    const pool = cells.filter((p) => distance[p.y][p.x] > 5 && !(p.x === exit.x && p.y === exit.y));
    const crystals = [];
    while (crystals.length < SEEDS_PER_SECTOR && pool.length) {
      const i = Math.floor(random() * pool.length);
      crystals.push({ x: pool[i].x, y: pool[i].y, pulse: random() * Math.PI * 2, collected: false });
      pool.splice(i, 1);
    }
    const enemyPool = cells.filter((p) => distance[p.y][p.x] > 11 && !(p.x === exit.x && p.y === exit.y));
    const enemies = [];
    const enemyCount = Math.min(3, sector);
    while (enemies.length < enemyCount && enemyPool.length) {
      const i = Math.floor(random() * enemyPool.length);
      const p = enemyPool[i];
      enemies.push({ x: (p.x + .5) * TILE, y: (p.y + .5) * TILE, targetX: (p.x + .5) * TILE, targetY: (p.y + .5) * TILE, speed: 38 + sector * 9 + random() * 9, delay: .8 + enemies.length * .35, shell: random() * Math.PI * 2 });
      enemyPool.splice(i, 1);
    }
    return { map, crystals, enemies, exit };
  }
  function setSector(seedLabel, sector) {
    const level = buildSector(seedLabel, sector);
    game.map = level.map;
    game.crystals = level.crystals;
    game.enemies = level.enemies;
    game.exit = level.exit;
    game.sector = sector;
    game.collected = 0;
    game.sectorElapsed = 0;
    game.player.x = TILE * 1.5;
    game.player.y = TILE * 1.5;
    game.player.invulnerable = .9;
    game.player.dashTime = 0;
    game.player.dashCooldown = 0;
    updateHud();
  }
  function startRun(mode, seedLabel) {
    game.mode = mode;
    game.seedLabel = seedLabel;
    game.state = "playing";
    game.score = 0;
    game.elapsed = 0;
    game.lives = 3;
    game.worldTime = 0;
    keys.clear();
    setSector(seedLabel, 1);
    overlay.hidden = true;
    overlay.innerHTML = "";
    document.getElementById("share-button").disabled = false;
    setRunLabel(mode === "daily" ? "DAILY RUN IN PROGRESS" : mode === "challenge" ? "CHALLENGE RUN IN PROGRESS" : "FREE RUN IN PROGRESS", true);
    updateHud();
    announce("Run started. Collect five glowseeds to open the exit.");
  }
  function randomSeed() {
    const values = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
    else values[0] = Math.floor(Math.random() * 4294967295);
    return "run-" + values[0].toString(36);
  }
  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function showHome() {
    game.state = "home";
    game.mode = "daily";
    game.seedLabel = today;
    const level = buildSector("burrow-circuit-showcase", 1);
    game.map = level.map;
    game.crystals = level.crystals;
    game.enemies = level.enemies;
    game.exit = level.exit;
    game.collected = 0;
    game.player.x = TILE * 1.5;
    game.player.y = TILE * 1.5;
    game.player.invulnerable = 0;
    game.lives = 3;
    document.getElementById("share-button").disabled = true;
    setRunLabel("READY WHEN YOU ARE", false);
    const shared = game.sharedSeed ? '<button class="secondary-button" id="start-shared">PLAY SHARED SEED · ' + escapeHtml(game.sharedSeed) + '</button>' : "";
    overlay.innerHTML = '<div class="overlay-card"><div class="overlay-emblem" aria-hidden="true">✦</div><p class="overlay-kicker">THREE SECTORS · ONE RUN</p><h2>Ready to burrow?</h2><p>Collect the seeds, shake off the bots, and find your way to the gate.</p><div class="overlay-actions"><button class="primary-button" id="start-daily">PLAY TODAY’S MAZE</button><button class="secondary-button" id="start-free">FRESH RANDOM MAZE</button>' + shared + '</div><div class="overlay-note">WASD / ARROWS TO MOVE · SPACE TO DASH · P TO PAUSE</div></div>';
    overlay.hidden = false;
    document.getElementById("start-daily").addEventListener("click", () => startRun("daily", today));
    document.getElementById("start-free").addEventListener("click", () => startRun("free", randomSeed()));
    const sharedButton = document.getElementById("start-shared");
    if (sharedButton) sharedButton.addEventListener("click", () => startRun("challenge", game.sharedSeed));
    updateHud();
  }
  function setRunLabel(text, live) {
    document.getElementById("run-label").textContent = text;
    document.getElementById("state-indicator").classList.toggle("is-live", live);
  }
  function formatNumber(value) { return Number(value || 0).toLocaleString("en-US"); }
  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(value));
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }
  function updateHud() {
    runHud.hidden = game.state === "home";
    document.getElementById("hud-sector").textContent = String(game.sector).padStart(2, "0") + " / 03";
    document.getElementById("hud-score").textContent = formatNumber(game.score);
    document.getElementById("hud-time").textContent = formatTime(game.elapsed);
    document.getElementById("hud-seeds").textContent = game.collected + " / " + SEEDS_PER_SECTOR;
    document.getElementById("life-display").textContent = "● ".repeat(Math.max(0, game.lives)).trim() || "—";
    document.getElementById("life-display").setAttribute("aria-label", game.lives + (game.lives === 1 ? " life remaining" : " lives remaining"));
    document.getElementById("best-score").textContent = formatNumber(game.stats.best || 0);
    const daily = game.stats.daily && game.stats.daily[today] ? game.stats.daily[today] : 0;
    document.getElementById("daily-score").textContent = formatNumber(daily);
    document.getElementById("record-note").textContent = game.mode === "daily" && game.state === "playing"
      ? game.collected + " of " + SEEDS_PER_SECTOR + " glowseeds in this sector."
      : "Your scores stay in this browser.";
  }
  function readStats() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { best: Number(stored.best) || 0, daily: stored.daily && typeof stored.daily === "object" ? stored.daily : {} };
    } catch (_error) { return { best: 0, daily: {} }; }
  }
  function saveRun() {
    game.stats.best = Math.max(game.stats.best || 0, game.score);
    if (game.mode === "daily") game.stats.daily[today] = Math.max(game.stats.daily[today] || 0, game.score);
    const keep = Object.keys(game.stats.daily).sort().slice(-14);
    const daily = {};
    for (const date of keep) daily[date] = game.stats.daily[date];
    game.stats.daily = daily;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(game.stats)); } catch (_error) { /* Storage may be disabled. */ }
  }
  function finishRun(won) {
    if (game.state !== "playing") return;
    game.state = "finished";
    saveRun();
    setRunLabel(won ? "SECTOR CLEAR · RUN COMPLETE" : "RUN COMPLETE", false);
    updateHud();
    const title = won ? "Circuit cleared!" : "The bots caught up.";
    const detail = won ? "Three sectors down. The burrow is safe for another day." : "The run is over. Every maze is a new route to learn.";
    overlay.innerHTML = '<div class="overlay-card"><div class="overlay-emblem" aria-hidden="true">' + (won ? "✓" : "↻") + '</div><p class="overlay-kicker">' + (won ? "FULL CIRCUIT" : "RUN ENDED") + '</p><h2>' + title + '</h2><p>' + detail + '</p><div class="overlay-result"><div><span>SCORE</span><strong>' + formatNumber(game.score) + '</strong></div><span class="result-divider"></span><div><span>TIME</span><strong>' + formatTime(game.elapsed) + '</strong></div><span class="result-divider"></span><div><span>SECTOR</span><strong>' + game.sector + ' / 3</strong></div></div><div class="overlay-actions"><button class="primary-button" id="play-again">RUN IT BACK</button><button class="secondary-button" id="back-home">BACK TO READY ROOM</button></div></div>';
    overlay.hidden = false;
    document.getElementById("play-again").addEventListener("click", () => {
      if (game.mode === "daily") startRun("daily", today);
      else if (game.mode === "challenge") startRun("challenge", game.seedLabel);
      else startRun("free", randomSeed());
    });
    document.getElementById("back-home").addEventListener("click", showHome);
    announce(title + " Final score " + game.score + " points.");
  }
  function showPause() {
    if (game.state !== "playing") return;
    game.state = "paused";
    overlay.innerHTML = '<div class="overlay-card"><div class="overlay-emblem" aria-hidden="true">Ⅱ</div><p class="overlay-kicker">TAKE YOUR TIME</p><h2>Paused.</h2><p>Your run is safe. The bots are holding position.</p><div class="overlay-actions"><button class="primary-button" id="resume-run">RESUME RUN</button><button class="secondary-button" id="restart-run">RESTART THIS MAZE</button></div><div class="pause-help">PRESS P OR ESC TO RESUME</div></div>';
    overlay.hidden = false;
    document.getElementById("resume-run").addEventListener("click", resumeRun);
    document.getElementById("restart-run").addEventListener("click", () => startRun(game.mode, game.seedLabel));
    announce("Run paused.");
  }
  function resumeRun() {
    if (game.state !== "paused") return;
    game.state = "playing";
    overlay.hidden = true;
    overlay.innerHTML = "";
    announce("Run resumed.");
  }
  function announce(message) {
    announcer.textContent = "";
    window.setTimeout(() => { announcer.textContent = message; }, 20);
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(game.toastTimer);
    game.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2100);
  }
  function playTone(frequency, duration, type, volume) {
    if (game.muted) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!game.audio) game.audio = new AudioContextClass();
      if (game.audio.state === "suspended") game.audio.resume();
      const oscillator = game.audio.createOscillator();
      const gain = game.audio.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume || .045, game.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, game.audio.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(game.audio.destination);
      oscillator.start();
      oscillator.stop(game.audio.currentTime + duration);
    } catch (_error) { /* Audio is optional. */ }
  }
  function setSound(enabled) {
    game.muted = !enabled;
    const button = document.getElementById("sound-toggle");
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Turn sound off" : "Turn sound on");
    button.querySelector("span").textContent = enabled ? "Sound on" : "Sound off";
    if (enabled) playTone(660, .06, "sine", .025);
  }
  function movementVector() {
    let x = 0, y = 0;
    if (keys.has("ArrowLeft") || keys.has("KeyA") || keys.has("left")) x--;
    if (keys.has("ArrowRight") || keys.has("KeyD") || keys.has("right")) x++;
    if (keys.has("ArrowUp") || keys.has("KeyW") || keys.has("up")) y--;
    if (keys.has("ArrowDown") || keys.has("KeyS") || keys.has("down")) y++;
    const length = Math.hypot(x, y);
    return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  }
  function startDash() {
    if (game.state !== "playing" || game.player.dashCooldown > 0) return;
    const v = movementVector();
    if (v.x || v.y) { game.player.lastX = v.x; game.player.lastY = v.y; }
    game.player.dashTime = .17;
    game.player.dashCooldown = 1.25;
    playTone(235, .12, "triangle", .04);
  }
  function blockedAt(x, y, radius) {
    for (let ty = Math.floor((y - radius) / TILE); ty <= Math.floor((y + radius) / TILE); ty++) {
      for (let tx = Math.floor((x - radius) / TILE); tx <= Math.floor((x + radius) / TILE); tx++) {
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || game.map[ty][tx] !== 1) continue;
        const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
        const cy = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
        if ((x - cx) ** 2 + (y - cy) ** 2 < radius ** 2) return true;
      }
    }
    return false;
  }
  function updatePlayer(dt) {
    const p = game.player;
    const v = movementVector();
    if (v.x || v.y) { p.lastX = v.x; p.lastY = v.y; }
    const speed = p.dashTime > 0 ? 335 : 177;
    const dx = (p.dashTime > 0 ? p.lastX : v.x) * speed * dt;
    const dy = (p.dashTime > 0 ? p.lastY : v.y) * speed * dt;
    if (!blockedAt(p.x + dx, p.y, p.radius)) p.x += dx;
    if (!blockedAt(p.x, p.y + dy, p.radius)) p.y += dy;
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.invulnerable = Math.max(0, p.invulnerable - dt);
  }
  function updateEnemies(dt) {
    const playerCell = { x: Math.floor(game.player.x / TILE), y: Math.floor(game.player.y / TILE) };
    const distance = getDistances(game.map, playerCell.x, playerCell.y);
    for (const enemy of game.enemies) {
      if (game.state !== "playing") break;
      enemy.delay = Math.max(0, enemy.delay - dt);
      if (enemy.delay > 0) continue;
      if (Math.hypot(enemy.targetX - enemy.x, enemy.targetY - enemy.y) < 1) {
        const cx = Math.floor(enemy.x / TILE), cy = Math.floor(enemy.y / TILE);
        const options = neighbors(cx, cy).filter((n) => n.x >= 0 && n.y >= 0 && n.x < COLS && n.y < ROWS && game.map[n.y][n.x] === 0).sort((a, b) => distance[a.y][a.x] - distance[b.y][b.x]);
        const next = options[0];
        if (next && distance[next.y][next.x] < distance[cy][cx]) {
          enemy.targetX = (next.x + .5) * TILE;
          enemy.targetY = (next.y + .5) * TILE;
        } else { enemy.delay = .35; }
      }
      const dx = enemy.targetX - enemy.x, dy = enemy.targetY - enemy.y;
      const length = Math.hypot(dx, dy);
      const step = enemy.speed * (1 + game.collected * .045) * dt;
      if (length <= step || length < 1) { enemy.x = enemy.targetX; enemy.y = enemy.targetY; }
      else { enemy.x += dx / length * step; enemy.y += dy / length * step; }
      enemy.shell += dt * 3;
      if (game.player.invulnerable <= 0 && game.player.dashTime <= 0 && Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y) < 19) hitPlayer();
    }
  }
  function hitPlayer() {
    game.lives--;
    game.score = Math.max(0, game.score - 75);
    game.player.x = TILE * 1.5;
    game.player.y = TILE * 1.5;
    game.player.invulnerable = 1.45;
    game.player.dashTime = 0;
    playTone(110, .24, "sawtooth", .05);
    updateHud();
    announce(game.lives + (game.lives === 1 ? " life remains." : " lives remain."));
    if (game.lives <= 0) finishRun(false);
    else showToast("A bot clipped you · 75 points lost");
  }
  function updatePickupsAndExit() {
    for (const crystal of game.crystals) {
      if (crystal.collected) continue;
      const x = (crystal.x + .5) * TILE, y = (crystal.y + .5) * TILE;
      if (Math.hypot(game.player.x - x, game.player.y - y) < 16) {
        crystal.collected = true;
        game.collected++;
        game.score += 125;
        playTone(650 + game.collected * 70, .11, "sine", .045);
        updateHud();
        announce(game.collected + " of " + SEEDS_PER_SECTOR + " glowseeds collected.");
        if (game.collected === SEEDS_PER_SECTOR) showToast("Exit charged · find the mint gate");
      }
    }
    if (game.collected < SEEDS_PER_SECTOR) return;
    const ex = (game.exit.x + .5) * TILE, ey = (game.exit.y + .5) * TILE;
    if (Math.hypot(game.player.x - ex, game.player.y - ey) >= 17) return;
    if (game.sector >= MAX_SECTOR) {
      game.score += Math.max(0, Math.round((110 - game.sectorElapsed) * 7)) + game.lives * 125;
      finishRun(true);
    } else {
      game.score += 250 + game.lives * 40;
      playTone(520, .18, "triangle", .045);
      const next = game.sector + 1;
      showToast("Sector " + game.sector + " clear · entering sector " + next);
      setSector(game.seedLabel, next);
    }
  }
  function update(dt) {
    game.worldTime += dt;
    game.elapsed += dt;
    game.sectorElapsed += dt;
    updatePlayer(dt);
    updateEnemies(dt);
    if (game.state === "playing") updatePickupsAndExit();
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#081a1d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!game.map) return;
    drawMap();
    drawExit();
    drawCrystals();
    drawEnemies();
    drawPlayer();
    ctx.fillStyle = "rgba(168,231,202,.018)";
    for (let y = 0; y < canvas.height; y += 4) ctx.fillRect(0, y, canvas.width, 1);
  }
  function drawMap() {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const px = x * TILE, py = y * TILE;
      if (game.map[y][x] === 1) {
        ctx.fillStyle = "#102d30";
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "rgba(132,194,169,.045)";
        ctx.fillRect(px + 3, py + 3, TILE - 6, 2);
        ctx.strokeStyle = "rgba(2,14,17,.44)";
        ctx.strokeRect(px + .5, py + .5, TILE - 1, TILE - 1);
      } else {
        ctx.fillStyle = (x * 3 + y * 5) % 4 === 0 ? "#0b2225" : "#0a1f22";
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "rgba(151,209,185,.035)";
        ctx.fillRect(px + 4, py + 5, 1, 1);
        ctx.fillRect(px + TILE - 6, py + TILE - 7, 1, 1);
      }
    }
    const glow = ctx.createRadialGradient(48, 48, 6, 48, 48, 125);
    glow.addColorStop(0, "rgba(80,176,143,.09)");
    glow.addColorStop(1, "rgba(80,176,143,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 250, 250);
  }
  function drawExit() {
    if (!game.exit) return;
    const x = (game.exit.x + .5) * TILE, y = (game.exit.y + .5) * TILE;
    const open = game.collected >= SEEDS_PER_SECTOR;
    const pulse = .5 + Math.sin(game.worldTime * 4) * .12;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = open ? 1 : .46;
    ctx.shadowColor = open ? "#9ce8c1" : "#6e8d85";
    ctx.shadowBlur = open ? 18 + pulse * 9 : 7;
    ctx.strokeStyle = open ? "#a9f0cd" : "#65817a";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 10 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = open ? "rgba(151,235,190,.2)" : "rgba(101,129,122,.1)";
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = open ? "#d4ffe7" : "#78968d";
    ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(open ? "↗" : "·", 0, 0);
    ctx.restore();
  }
  function drawCrystals() {
    for (const crystal of game.crystals) {
      if (crystal.collected) continue;
      const x = (crystal.x + .5) * TILE, y = (crystal.y + .5) * TILE;
      const pulse = Math.sin(game.worldTime * 4 + crystal.pulse);
      ctx.save(); ctx.translate(x, y);
      ctx.rotate(Math.PI / 4 + Math.sin(game.worldTime * 1.2 + crystal.pulse) * .15);
      ctx.shadowColor = "#f5c979"; ctx.shadowBlur = 13 + pulse * 4;
      ctx.fillStyle = "#f3cd83"; ctx.fillRect(-5, -5, 10, 10);
      ctx.shadowBlur = 0; ctx.fillStyle = "#fff2cb"; ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }
  }
  function drawEnemies() {
    for (const enemy of game.enemies) {
      ctx.save(); ctx.translate(enemy.x, enemy.y);
      const bob = Math.sin(enemy.shell) * 1.4;
      ctx.shadowColor = "#ea817a"; ctx.shadowBlur = 11; ctx.fillStyle = "#d87972";
      ctx.beginPath(); ctx.ellipse(0, bob, 9, 8, 0, Math.PI, 0); ctx.lineTo(9, bob + 4); ctx.quadraticCurveTo(0, bob + 13, -9, bob + 4); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = "#ffb09a"; ctx.fillRect(-6, bob - 7, 3, 4); ctx.fillRect(3, bob - 7, 3, 4);
      ctx.fillStyle = "#2a2828"; ctx.fillRect(-4, bob - 1, 2, 2); ctx.fillRect(3, bob - 1, 2, 2);
      ctx.restore();
    }
  }
  function drawPlayer() {
    const p = game.player;
    if (p.invulnerable > 0 && Math.floor(game.worldTime * 13) % 2 === 0) return;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.rotate(p.dashTime > 0 ? Math.atan2(p.lastY, p.lastX) * .12 : 0);
    if (p.dashTime > 0) {
      ctx.globalAlpha = .32; ctx.fillStyle = "#9ce6c7"; ctx.beginPath(); ctx.ellipse(-p.lastX * 12, -p.lastY * 12, 11, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.shadowColor = "#9ce6c7"; ctx.shadowBlur = 11; ctx.fillStyle = "#b5e5c8";
    ctx.beginPath(); ctx.ellipse(0, 1, 10, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = "#d99b9e"; ctx.beginPath(); ctx.ellipse(-5, -6, 3.3, 5, -.24, 0, Math.PI * 2); ctx.ellipse(5, -6, 3.3, 5, .24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ecb7ae"; ctx.beginPath(); ctx.ellipse(-5, -6, 1.6, 3, -.24, 0, Math.PI * 2); ctx.ellipse(5, -6, 1.6, 3, .24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#15302d"; ctx.beginPath(); ctx.arc(-3.4, 0, 1.2, 0, Math.PI * 2); ctx.arc(3.4, 0, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d98486"; ctx.beginPath(); ctx.arc(0, 3.3, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  async function shareChallenge() {
    if (!game.seedLabel) return;
    const url = new URL(location.href);
    url.searchParams.set("seed", game.seedLabel);
    const text = "Try my Burrow Circuit maze: " + formatNumber(game.score) + " points in " + formatTime(game.elapsed) + ".";
    try {
      if (navigator.share) await navigator.share({ title: "Burrow Circuit challenge", text, url: url.toString() });
      else if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url.toString()); showToast("Challenge link copied"); }
      else showToast("Copy this page address to share the seed");
    } catch (error) { if (error && error.name !== "AbortError") showToast("Could not open the share sheet"); }
  }

  document.addEventListener("keydown", (event) => {
    if (game.state !== "playing" && game.state !== "paused") return;
    if (event.target && event.target.closest && event.target.closest("button,a,input,textarea,select,[contenteditable=true]") && event.code !== "KeyP" && event.code !== "Escape") return;
    if (game.state === "paused" && (event.code === "Space" || event.code.startsWith("Arrow"))) event.preventDefault();
    if (game.state === "playing" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
    if (event.code === "Space" || event.code === "ShiftLeft" || event.code === "ShiftRight") { if (!event.repeat) startDash(); return; }
    if (event.code === "KeyP" || event.code === "Escape") { if (game.state === "playing") showPause(); else resumeRun(); return; }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) keys.add(event.code);
  });
  document.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => { keys.clear(); if (game.state === "playing") showPause(); });
  document.querySelectorAll(".mobile-pad [data-dir]").forEach((button) => {
    const direction = button.dataset.dir;
    const release = () => keys.delete(direction);
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); keys.add(direction); button.setPointerCapture(event.pointerId); });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  });
  document.querySelector('[data-action="dash"]').addEventListener("pointerdown", (event) => { event.preventDefault(); startDash(); });
  document.getElementById("share-button").addEventListener("click", shareChallenge);
  document.getElementById("sound-toggle").addEventListener("click", () => setSound(game.muted));

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(.04, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (game.state === "playing") { update(dt); updateHud(); }
    else game.worldTime += dt * .35;
    draw();
    window.requestAnimationFrame(frame);
  }
  showHome();
  window.requestAnimationFrame(frame);
})();
