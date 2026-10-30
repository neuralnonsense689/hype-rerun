/*
 * Minesweeper rules engine. No DOM access, so it can run in the browser and in Node tests.
 *
 * Classic Windows rules: first click is always safe, flags cycle (and optional "?" marks),
 * chording on a satisfied number opens its neighbours, flood-fill opens zero regions,
 * and a win auto-flags every remaining mine.
 *
 * Surprise feature, "Lucky Tiles": about 1.5% of safe tiles hide a power-up. Revealing one
 * gives you a random power-up: Shield (defuses the next mine you hit), Sonar (reveals a safe
 * tile) or Magnet (flags a mine).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Board = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const PRESETS = {
    beginner: { cols: 9, rows: 9, mines: 10 },
    intermediate: { cols: 16, rows: 16, mines: 40 },
    expert: { cols: 30, rows: 16, mines: 99 },
  };

  const CUSTOM_LIMITS = { minCols: 8, maxCols: 30, minRows: 8, maxRows: 24, minMines: 10, maxMines: 667 };
  const POWERS = ['shield', 'sonar', 'magnet'];
  const MAX_POWER = 3;
  const LUCKY_RATE = 0.015;

  function maxMines(cols, rows) {
    return Math.min(CUSTOM_LIMITS.maxMines, (cols - 1) * (rows - 1));
  }

  function clampCustom(v) {
    const L = CUSTOM_LIMITS;
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const cols = clamp(Math.round(v.cols), L.minCols, L.maxCols);
    const rows = clamp(Math.round(v.rows), L.minRows, L.maxRows);
    const mines = clamp(Math.round(v.mines), L.minMines, maxMines(cols, rows));
    return { cols, rows, mines };
  }

  function createGame(opts) {
    const n = opts.cols * opts.rows;
    return {
      cols: opts.cols,
      rows: opts.rows,
      n,
      mineTotal: opts.mines,
      rng: opts.rng || Math.random,
      marks: opts.marks !== false,
      state: 'ready', // ready | playing | won | lost
      placed: false,
      mine: new Uint8Array(n),
      num: new Uint8Array(n),
      lucky: new Uint8Array(n),
      revealed: new Uint8Array(n),
      flag: new Uint8Array(n), // 0 none, 1 flag, 2 question mark
      defused: new Uint8Array(n),
      exploded: -1,
      inventory: { shield: 0, sonar: 0, magnet: 0 },
    };
  }

  function neighbors(g, i) {
    const x = i % g.cols;
    const y = (i - x) / g.cols;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < g.cols && ny >= 0 && ny < g.rows) out.push(ny * g.cols + nx);
      }
    }
    return out;
  }

  const isLive = (g) => g.state === 'ready' || g.state === 'playing';

  // Mines are placed on the first reveal so that the first click is always safe.
  function placeMines(g, safe) {
    const order = [];
    for (let i = 0; i < g.n; i++) if (i !== safe) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(g.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let k = 0; k < g.mineTotal; k++) g.mine[order[k]] = 1;

    const safeCells = order.slice(g.mineTotal);
    const luckyCount = Math.min(safeCells.length, Math.max(1, Math.round(safeCells.length * LUCKY_RATE)));
    for (let k = 0; k < luckyCount; k++) g.lucky[safeCells[k]] = 1;

    for (let i = 0; i < g.n; i++) {
      if (g.mine[i]) continue;
      let count = 0;
      for (const j of neighbors(g, i)) count += g.mine[j];
      g.num[i] = count;
    }
    g.placed = true;
  }

  function grantPower(g, idx, events) {
    const power = POWERS[Math.floor(g.rng() * POWERS.length)];
    if (g.inventory[power] < MAX_POWER) g.inventory[power]++;
    events.push({ type: 'lucky', idx, power });
  }

  // Opens `start` and flood-fills through zero-count tiles. Flagged tiles are left alone, as in Windows.
  function openCell(g, start, events) {
    const stack = [start];
    let opened = 0;
    while (stack.length) {
      const i = stack.pop();
      if (g.revealed[i] || g.flag[i] === 1 || g.mine[i]) continue;
      g.revealed[i] = 1;
      opened++;
      if (g.lucky[i]) {
        g.lucky[i] = 0;
        grantPower(g, i, events);
      }
      if (g.num[i] === 0) {
        for (const j of neighbors(g, i)) if (!g.revealed[j]) stack.push(j);
      }
    }
    if (opened) events.push({ type: 'open', count: opened });
    return opened;
  }

  // A game is won when every tile that is not a live mine has been opened.
  function checkWin(g, events) {
    if (g.state !== 'playing') return;
    for (let i = 0; i < g.n; i++) if (!g.mine[i] && !g.revealed[i]) return;
    g.state = 'won';
    for (let i = 0; i < g.n; i++) if (g.mine[i] && !g.defused[i]) g.flag[i] = 1;
    events.push({ type: 'win' });
  }

  function reveal(g, i) {
    const events = [];
    if (!isLive(g) || g.revealed[i] || g.flag[i] === 1) return events;
    if (!g.placed) {
      placeMines(g, i);
      g.state = 'playing';
      events.push({ type: 'start' });
    }
    if (g.mine[i]) {
      if (g.inventory.shield > 0) {
        // The shield turns the mine into a defused tile. Numbers stay correct because the mine still counts for its neighbours.
        g.inventory.shield--;
        g.defused[i] = 1;
        g.revealed[i] = 1;
        events.push({ type: 'defuse', idx: i });
      } else {
        g.state = 'lost';
        g.exploded = i;
        g.revealed[i] = 1;
        events.push({ type: 'lose', idx: i });
        return events;
      }
    } else {
      openCell(g, i, events);
    }
    checkWin(g, events);
    return events;
  }

  // Classic chord: on a satisfied number, open all unmarked neighbours.
  function chord(g, i) {
    const events = [];
    if (g.state !== 'playing' || !g.revealed[i] || g.mine[i] || g.num[i] === 0) return events;
    const nb = neighbors(g, i);
    let marked = 0;
    for (const j of nb) if (g.flag[j] === 1 || g.defused[j]) marked++;
    if (marked !== g.num[i]) return events;
    for (const j of nb) {
      if (g.revealed[j] || g.flag[j] === 1) continue;
      events.push(...reveal(g, j));
      if (g.state !== 'playing') break;
    }
    return events;
  }

  function toggleFlag(g, i) {
    if (!isLive(g) || g.revealed[i]) return [];
    const prev = g.flag[i];
    const next = prev === 0 ? 1 : prev === 1 && g.marks ? 2 : 0;
    g.flag[i] = next;
    return [{ type: 'flag', idx: i, value: next }];
  }

  function setMarks(g, on) {
    g.marks = on;
    if (!on) for (let i = 0; i < g.n; i++) if (g.flag[i] === 2) g.flag[i] = 0;
  }

  // Sonar: open a random safe tile that is not flagged.
  function useSonar(g) {
    const events = [];
    if (g.state !== 'playing' || g.inventory.sonar <= 0) return events;
    const candidates = [];
    for (let i = 0; i < g.n; i++) if (!g.mine[i] && !g.revealed[i] && g.flag[i] !== 1) candidates.push(i);
    if (!candidates.length) return events;
    g.inventory.sonar--;
    const pick = candidates[Math.floor(g.rng() * candidates.length)];
    events.push({ type: 'sonar', idx: pick });
    openCell(g, pick, events);
    checkWin(g, events);
    return events;
  }

  // Magnet: flag a random live mine that is not flagged yet.
  function useMagnet(g) {
    const events = [];
    if (g.state !== 'playing' || g.inventory.magnet <= 0) return events;
    const candidates = [];
    for (let i = 0; i < g.n; i++) if (g.mine[i] && !g.revealed[i] && g.flag[i] !== 1) candidates.push(i);
    if (!candidates.length) return events;
    g.inventory.magnet--;
    const pick = candidates[Math.floor(g.rng() * candidates.length)];
    g.flag[pick] = 1;
    events.push({ type: 'magnet', idx: pick });
    return events;
  }

  function minesLeft(g) {
    let flags = 0;
    let defused = 0;
    for (let i = 0; i < g.n; i++) {
      if (g.flag[i] === 1) flags++;
      if (g.defused[i]) defused++;
    }
    return g.mineTotal - flags - defused;
  }

  return {
    PRESETS,
    CUSTOM_LIMITS,
    POWERS,
    maxMines,
    clampCustom,
    createGame,
    neighbors,
    reveal,
    chord,
    toggleFlag,
    setMarks,
    useSonar,
    useMagnet,
    minesLeft,
  };
});
