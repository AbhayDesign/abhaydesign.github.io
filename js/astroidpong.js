/* AstroidPong – Pong meets Asteroids.
   Two CPUs rally balls in a Pong court. You are the ship in the middle:
   rotate, shoot the balls, and don't get hit. Every 10-second round adds one more ball. */
(() => {
  "use strict";

  /* ---------- Setup ---------- */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 320
  const H = canvas.height;  // 240
  ctx.imageSmoothingEnabled = false;

  const C = {
    bg: "#fff2df",
    ink: "#000",
    ball: "#2f6fe0",
    dim: "rgba(0,0,0,0.16)",
  };

  const ROUND_TIME = 10;      // seconds per round
  const START_LIVES = 3;
  const ROT_SPEED = 3.6;      // radians / second
  const SHIP_SPEED = 105;     // pixels / second (WASD movement)
  const BULLET_SPEED = 240;
  const FIRE_COOLDOWN = 0.2;
  const MAX_BULLETS = 5;
  const PAD_SPEED = 90;
  const MAX_BALL_SPEED = 170;
  const RESPAWN_DELAY = 0.9;
  const BEST_KEY = "astroidpong-best";

  /* ---------- DOM (HUD) ---------- */
  const $ = (id) => document.getElementById(id);
  const hud = {
    score: $("hud-score"),
    best: $("hud-best"),
    round: $("hud-round"),
    bar: $("hud-bar"),
    lives: $("hud-lives"),
  };
  const stage = $("stage");
  const soundBtn = $("sound-btn");

  const HEART = "M1 0h2v1h1v1h1V1h1V0h2v1h1v3H9v1H8v1H7v1H6v1H5V8H4V7H3V6H2V5H1V4H0V1h1z";
  const hearts = [];
  for (let i = 0; i < START_LIVES; i++) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 10 9");
    s.setAttribute("width", "20");
    s.setAttribute("height", "18");
    s.setAttribute("shape-rendering", "crispEdges");
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", HEART);
    p.setAttribute("fill", "currentColor");
    s.appendChild(p);
    hud.lives.appendChild(s);
    hearts.push(s);
  }

  /* ---------- State ---------- */
  let state = "title"; // title | intermission | playing | paused | over
  let prevState = "playing";
  let score = 0;
  let lives = START_LIVES;
  let round = 0;
  let interRound = 1;
  let interT = 0;
  let timeLeft = ROUND_TIME;
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { /* storage unavailable */ }
  let clock = 0;
  let newBest = false;

  const ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, cool: 0, inv: 0 };
  let balls = [];
  let bullets = [];
  let parts = [];
  let spawnQ = [];
  const paddles = [
    { x: 8,     y: H / 2, w: 4, h: 30, dir: 1,  err: 0, errT: 0, score: 0 },
    { x: W - 8, y: H / 2, w: 4, h: 30, dir: -1, err: 0, errT: 0, score: 0 },
  ];

  /* ---------- Input ---------- */
  // left / right = rotate (arrow keys), mleft / mright / up / down = move (WASD)
  const keys = { left: false, right: false, fire: false, mleft: false, mright: false, up: false, down: false };
  const touch = { left: false, right: false, fire: false, mleft: false, mright: false, up: false, down: false };

  const isButton = (el) => el && el.closest && el.closest("button, a");

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if ([" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(k) && !isButton(e.target)) e.preventDefault();

    if (k === "ArrowLeft") keys.left = true;
    else if (k === "ArrowRight") keys.right = true;
    else if (k === "a" || k === "A") keys.mleft = true;
    else if (k === "d" || k === "D") keys.mright = true;
    else if (k === "w" || k === "W") keys.up = true;
    else if (k === "s" || k === "S") keys.down = true;
    else if (k === " ") {
      keys.fire = true;
      if ((state === "title" || state === "over") && !isButton(e.target)) startGame();
    } else if (k === "Enter") {
      if ((state === "title" || state === "over") && !isButton(e.target)) startGame();
    } else if (k === "p" || k === "P" || k === "Escape") togglePause();
    else if (k === "m" || k === "M") toggleMute();
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") keys.left = false;
    else if (k === "ArrowRight") keys.right = false;
    else if (k === "a" || k === "A") keys.mleft = false;
    else if (k === "d" || k === "D") keys.mright = false;
    else if (k === "w" || k === "W") keys.up = false;
    else if (k === "s" || k === "S") keys.down = false;
    else if (k === " ") keys.fire = false;
  });

  window.addEventListener("blur", () => { Object.keys(keys).forEach((k) => { keys[k] = false; }); });

  document.querySelectorAll("[data-touch]").forEach((btn) => {
    const key = btn.dataset.touch;
    const on = (e) => { e.preventDefault(); touch[key] = true; btn.classList.add("is-down"); };
    const off = (e) => { e.preventDefault(); touch[key] = false; btn.classList.remove("is-down"); };
    btn.addEventListener("pointerdown", on);
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
    btn.addEventListener("pointerleave", off);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  canvas.addEventListener("pointerdown", () => {
    if (state === "title" || state === "over") startGame();
    else if (state === "paused") togglePause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (state === "playing" || state === "intermission")) togglePause();
  });

  /* ---------- Sound (tiny square-wave synth) ---------- */
  let ac = null;
  let muted = false;

  const ensureAudio = () => {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ac = new AC();
  };

  const tone = (freq, dur, type = "square", vol = 0.04, slide = 0, delay = 0) => {
    if (muted || !ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  };

  const sfx = {
    shoot:   () => tone(900, 0.09, "square", 0.03, -600),
    destroy: () => { tone(220, 0.22, "sawtooth", 0.05, -160); tone(520, 0.08, "square", 0.03, 200); },
    hit:     () => { tone(140, 0.4, "sawtooth", 0.07, -100); tone(90, 0.4, "square", 0.05, -50); },
    round:   () => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.1, "square", 0.04, 0, i * 0.09)); },
    start:   () => { [262, 330, 392].forEach((f, i) => tone(f, 0.09, "square", 0.04, 0, i * 0.08)); },
    over:    () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.18, "square", 0.05, 0, i * 0.16)); },
  };

  const toggleMute = () => {
    muted = !muted;
    soundBtn.textContent = muted ? "SOUND OFF" : "SOUND ON";
    soundBtn.setAttribute("aria-pressed", String(!muted));
  };
  soundBtn.addEventListener("click", toggleMute);

  /* ---------- Ship sprites (pre-rasterised so the ship stays chunky pixel art) ---------- */
  const SPRITES = 32;
  const SS = 13;
  const SHIP_POLY = [[6, 0], [-4.5, -4.8], [-2, 0], [-4.5, 4.8]];

  const inPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  const sprites = [];
  for (let k = 0; k < SPRITES; k++) {
    const a = (k / SPRITES) * Math.PI * 2;
    const cv = document.createElement("canvas");
    cv.width = cv.height = SS;
    const g = cv.getContext("2d");
    g.fillStyle = C.ink;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const px = i + 0.5 - SS / 2;
        const py = j + 0.5 - SS / 2;
        const lx = px * ca + py * sa;
        const ly = -px * sa + py * ca;
        if (inPoly(lx, ly, SHIP_POLY)) g.fillRect(i, j, 1, 1);
      }
    }
    sprites.push(cv);
  }

  /* ---------- Helpers ---------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ballSpeed = () => Math.min(150, 100 + Math.max(round, interRound) * 5);

  // Reflect a predicted y position back into the court (ball bouncing off top/bottom walls)
  const fold = (y) => {
    const lo = 3;
    const r = H - 6;
    let m = (y - lo) % (2 * r);
    if (m < 0) m += 2 * r;
    return lo + (m > r ? 2 * r - m : m);
  };

  const spawnBall = () => {
    const dir = Math.random() < 0.5 ? 1 : -1; // 1 = heads right (served by the left CPU)
    const ang = rand(-0.6, 0.6);
    const sp = ballSpeed();
    balls.push({
      x: dir > 0 ? 26 : W - 26,
      y: rand(30, H - 30),
      vx: dir * Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      s: 6,
      age: 0,
    });
  };

  const explode = (x, y, n, color) => {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(25, 90);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.6), c: Math.random() < 0.3 ? C.ink : color });
    }
  };

  const shake = () => {
    stage.classList.remove("shake");
    void stage.offsetWidth; // restart animation
    stage.classList.add("shake");
  };

  /* ---------- Game flow ---------- */
  const resetWorld = () => {
    balls = [];
    bullets = [];
    parts = [];
    spawnQ = [];
    ship.x = W / 2;
    ship.y = H / 2;
    ship.a = -Math.PI / 2;
    ship.cool = 0;
    ship.inv = 0;
    paddles.forEach((p) => { p.y = H / 2; p.score = 0; });
  };

  const startGame = () => {
    ensureAudio();
    if (ac && ac.state === "suspended") ac.resume();
    resetWorld();
    score = 0;
    lives = START_LIVES;
    round = 0;
    interRound = 1;
    interT = 1.6;
    timeLeft = ROUND_TIME;
    newBest = false;
    state = "intermission";
    sfx.start();
  };

  const endRound = () => {
    score += 50 * round;
    bullets = [];
    interRound = round + 1;
    interT = 1.6;
    state = "intermission";
    sfx.round();
  };

  const gameOver = () => {
    state = "over";
    explode(ship.x, ship.y, 24, C.ball);
    if (score > best) {
      best = score;
      newBest = true;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    balls = [];
    spawnQ = [];
    bullets = [];
    sfx.over();
  };

  function togglePause() {
    if (state === "playing" || state === "intermission") {
      prevState = state;
      state = "paused";
    } else if (state === "paused") {
      state = prevState;
    }
  }

  /* ---------- Update ---------- */
  const updateParticles = (dt) => {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) parts.splice(i, 1);
    }
  };

  const updatePaddles = (dt) => {
    for (const p of paddles) {
      let target = null;
      let soonest = Infinity;
      for (const b of balls) {
        const toward = p.dir > 0 ? b.vx < 0 : b.vx > 0;
        if (!toward) continue;
        const t = Math.abs(b.x - p.x) / Math.abs(b.vx);
        if (t < soonest) { soonest = t; target = b; }
      }

      p.errT -= dt;
      if (p.errT <= 0) {
        p.errT = 0.4;
        p.err = rand(-1, 1) * (5 + Math.min(round, 8) * 1.2);
      }

      let ty = H / 2;
      if (target) ty = fold(target.y + target.vy * soonest) + p.err;

      const d = ty - p.y;
      if (Math.abs(d) > 2) p.y += Math.sign(d) * Math.min(PAD_SPEED * dt, Math.abs(d));
      p.y = clamp(p.y, p.h / 2 + 2, H - p.h / 2 - 2);
    }
  };

  const updateBalls = (dt) => {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.age += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // top / bottom walls
      if (b.y < b.s / 2) { b.y = b.s / 2; b.vy = Math.abs(b.vy); }
      else if (b.y > H - b.s / 2) { b.y = H - b.s / 2; b.vy = -Math.abs(b.vy); }

      // paddles
      for (const p of paddles) {
        const toward = p.dir > 0 ? b.vx < 0 : b.vx > 0;
        if (!toward) continue;
        const edge = p.x + p.dir * (p.w / 2 + b.s / 2);
        const crossed = p.dir > 0 ? b.x <= edge : b.x >= edge;
        if (crossed && Math.abs(b.x - p.x) <= p.w / 2 + b.s / 2 + 2 && Math.abs(b.y - p.y) <= p.h / 2 + b.s / 2) {
          const rel = clamp((b.y - p.y) / (p.h / 2 + b.s / 2), -1, 1);
          const ang = rel * 0.85;
          const sp = Math.min(MAX_BALL_SPEED, Math.hypot(b.vx, b.vy) * 1.04);
          b.vx = p.dir * Math.cos(ang) * sp;
          b.vy = Math.sin(ang) * sp;
          b.x = edge;
        }
      }

      // got past a CPU: the other CPU scores, a new ball is served
      if (b.x < -6 || b.x > W + 6) {
        (b.x < 0 ? paddles[1] : paddles[0]).score++;
        balls.splice(i, 1);
        spawnQ.push(RESPAWN_DELAY);
      }
    }
  };

  const updateSpawns = (dt) => {
    for (let i = spawnQ.length - 1; i >= 0; i--) {
      spawnQ[i] -= dt;
      if (spawnQ[i] <= 0) { spawnQ.splice(i, 1); spawnBall(); }
    }
  };

  const updatePlay = (dt) => {
    // ship
    const dirInput = (keys.right || touch.right ? 1 : 0) - (keys.left || touch.left ? 1 : 0);
    ship.a += dirInput * ROT_SPEED * dt;

    // free movement with WASD (diagonals are normalised), kept inside the court
    const mx = (keys.mright || touch.mright ? 1 : 0) - (keys.mleft || touch.mleft ? 1 : 0);
    const my = (keys.down || touch.down ? 1 : 0) - (keys.up || touch.up ? 1 : 0);
    if (mx || my) {
      const len = Math.hypot(mx, my);
      ship.x += (mx / len) * SHIP_SPEED * dt;
      ship.y += (my / len) * SHIP_SPEED * dt;
    }
    ship.x = clamp(ship.x, 18, W - 18);
    ship.y = clamp(ship.y, 8, H - 8);
    ship.cool -= dt;
    if (ship.inv > 0) ship.inv -= dt;

    if ((keys.fire || touch.fire) && ship.cool <= 0 && bullets.length < MAX_BULLETS) {
      ship.cool = FIRE_COOLDOWN;
      bullets.push({
        x: ship.x + Math.cos(ship.a) * 7,
        y: ship.y + Math.sin(ship.a) * 7,
        vx: Math.cos(ship.a) * BULLET_SPEED,
        vy: Math.sin(ship.a) * BULLET_SPEED,
      });
      sfx.shoot();
    }

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bl = bullets[i];
      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      if (bl.x < 11 || bl.x > W - 11 || bl.y < 0 || bl.y > H) bullets.splice(i, 1);
    }

    updatePaddles(dt);
    updateBalls(dt);
    updateSpawns(dt);

    // bullet vs ball
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bl = bullets[i];
      for (let j = balls.length - 1; j >= 0; j--) {
        const b = balls[j];
        if (Math.abs(bl.x - b.x) <= b.s / 2 + 1.5 && Math.abs(bl.y - b.y) <= b.s / 2 + 1.5) {
          score += 100;
          explode(b.x, b.y, 10, C.ball);
          balls.splice(j, 1);
          bullets.splice(i, 1);
          spawnQ.push(RESPAWN_DELAY);
          sfx.destroy();
          break;
        }
      }
    }

    // ball vs ship
    if (ship.inv <= 0) {
      for (let j = balls.length - 1; j >= 0; j--) {
        const b = balls[j];
        if (Math.hypot(b.x - ship.x, b.y - ship.y) < 7.5) {
          lives--;
          ship.inv = 1.8;
          explode(b.x, b.y, 14, C.ball);
          balls.splice(j, 1);
          spawnQ.push(RESPAWN_DELAY + 0.3);
          sfx.hit();
          shake();
          if (lives <= 0) gameOver();
          break;
        }
      }
    }

    if (state === "playing") {
      timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; endRound(); }
    }
  };

  const updateAttract = (dt) => {
    if (balls.length + spawnQ.length < 1) spawnBall();
    updatePaddles(dt);
    updateBalls(dt);
    updateSpawns(dt);
  };

  const update = (dt) => {
    clock += dt;
    updateParticles(dt);

    if (state === "title" || state === "over") {
      updateAttract(dt);
    } else if (state === "intermission") {
      interT -= dt;
      if (interT <= 0) {
        round = interRound;
        timeLeft = ROUND_TIME;
        while (balls.length + spawnQ.length < round) spawnBall();
        state = "playing";
      }
    } else if (state === "playing") {
      updatePlay(dt);
    }
  };

  /* ---------- Drawing ---------- */
  const text = (str, x, y, size = 8, color = C.ink, align = "center") => {
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.fillStyle = color;
    ctx.fillText(str, Math.round(x), Math.round(y));
  };

  const panel = (w, h) => {
    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    ctx.fillStyle = C.ink;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = C.bg;
    ctx.fillRect(x, y, w, h);
    return { x, y };
  };

  const blink = (rate = 2) => Math.floor(clock * rate) % 2 === 0;

  const draw = () => {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // centre line
    ctx.fillStyle = C.dim;
    for (let y = 2; y < H; y += 10) ctx.fillRect(W / 2 - 1, y, 2, 5);

    // CPU scores
    text(String(paddles[0].score), W / 2 - 34, 10, 16, C.dim);
    text(String(paddles[1].score), W / 2 + 34, 10, 16, C.dim);

    // paddles
    ctx.fillStyle = C.ink;
    for (const p of paddles) ctx.fillRect(Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h);

    // balls
    for (const b of balls) {
      if (b.age < 0.5 && Math.floor(b.age * 16) % 2 === 0) continue; // blink in
      ctx.fillStyle = C.ball;
      ctx.fillRect(Math.round(b.x - b.s / 2), Math.round(b.y - b.s / 2), b.s, b.s);
    }

    // bullets
    ctx.fillStyle = C.ink;
    for (const bl of bullets) ctx.fillRect(Math.round(bl.x - 1), Math.round(bl.y - 1), 3, 3);

    // ship
    const showShip = state === "playing" || state === "intermission" || state === "paused";
    if (showShip && !(ship.inv > 0 && Math.floor(ship.inv * 12) % 2 === 0)) {
      const k = Math.round((((ship.a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * SPRITES) % SPRITES;
      ctx.drawImage(sprites[k], Math.round(ship.x - SS / 2), Math.round(ship.y - SS / 2));
    }

    // particles
    for (const p of parts) {
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }

    // overlays
    if (state === "title") {
      const { y } = panel(236, 138);
      text("ASTROIDPONG", W / 2, y + 12, 16);
      text("SHOOT THE BALLS", W / 2, y + 38, 8);
      text("WASD: MOVE", W / 2, y + 58, 8, C.ink);
      text("ARROWS: AIM", W / 2, y + 72, 8, C.ink);
      text("SPACE: FIRE", W / 2, y + 86, 8, C.ink);
      if (blink()) text("PRESS ENTER", W / 2, y + 112, 8, C.ball);
    } else if (state === "over") {
      const { y } = panel(200, 112);
      text("GAME OVER", W / 2, y + 12, 16);
      text("SCORE " + score, W / 2, y + 42, 8);
      text(newBest ? "NEW BEST!" : "BEST " + best, W / 2, y + 58, 8, newBest ? C.ball : C.ink);
      if (blink()) text("PRESS ENTER", W / 2, y + 86, 8, C.ball);
    } else if (state === "intermission") {
      text("ROUND " + interRound, W / 2, H / 2 - 44, 16);
      text(interRound + (interRound === 1 ? " BALL" : " BALLS"), W / 2, H / 2 + 34, 8, C.ball);
    } else if (state === "paused") {
      const { y } = panel(150, 54);
      text("PAUSED", W / 2, y + 12, 16);
      text("PRESS P", W / 2, y + 36, 8, C.ball);
    }
  };

  /* ---------- HUD ---------- */
  const hudCache = {};
  const setText = (el, key, val) => {
    if (hudCache[key] !== val) { hudCache[key] = val; el.textContent = val; }
  };

  const updateHud = () => {
    setText(hud.score, "score", String(score).padStart(5, "0"));
    setText(hud.best, "best", String(best).padStart(5, "0"));
    setText(hud.round, "round", String(Math.max(round, state === "intermission" ? interRound : 1)));
    hud.bar.style.width = (state === "intermission" ? 100 : (timeLeft / ROUND_TIME) * 100) + "%";
    hearts.forEach((h, i) => h.classList.toggle("lost", i >= lives));
  };

  /* ---------- Loop ---------- */
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state !== "paused") update(dt);
    else clock += dt;
    draw();
    updateHud();
    requestAnimationFrame(frame);
  };

  // Make sure the pixel font is ready before the first frame (falls back to monospace if it can't load)
  const go = () => requestAnimationFrame((t) => { last = t; frame(t); });
  if (document.fonts && document.fonts.load) {
    Promise.race([
      document.fonts.load('16px "Press Start 2P"'),
      new Promise((r) => setTimeout(r, 1500)),
    ]).then(go, go);
  } else {
    go();
  }
})();
