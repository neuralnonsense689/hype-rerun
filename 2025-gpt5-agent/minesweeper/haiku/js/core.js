/*
 * Minesweeper core: pure game logic with no DOM access.
 * Works as a browser global (window.MinesweeperCore) and as a CommonJS module for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MinesweeperCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MARK_NONE = 0;
  const MARK_FLAG = 1;
  const MARK_QUESTION = 2;

  // Classic Windows difficulty levels.
  const LEVELS = {
    beginner: { name: 'Beginner', rows: 9, cols: 9, mines: 10 },
    intermediate: { name: 'Intermediate', rows: 16, cols: 16, mines: 40 },
    expert: { name: 'Expert', rows: 16, cols: 30, mines: 99 },
  };

  // Same bounds as the Windows "Custom Field" dialog.
  const LIMITS = { minRows: 8, maxRows: 24, minCols: 8, maxCols: 30, minMines: 10, maxMines: 667 };

  // Surprise feature: a Lucky Token is awarded every N safely opened squares.
  const TOKEN_EVERY = 10;
  const MAX_TOKENS = 3;
  const TOKEN_TYPES = ['scan', 'shield', 'lucky'];

  function maxMinesFor(rows, cols) {
    return Math.min(LIMITS.maxMines, (rows - 1) * (cols - 1));
  }

  /** Returns an error message, or null when the custom settings are valid. */
  function validateCustom({ rows, cols, mines }) {
    if (!Number.isInteger(cols) || cols < LIMITS.minCols || cols > LIMITS.maxCols) {
      return `Width must be between ${LIMITS.minCols} and ${LIMITS.maxCols}.`;
    }
    if (!Number.isInteger(rows) || rows < LIMITS.minRows || rows > LIMITS.maxRows) {
      return `Height must be between ${LIMITS.minRows} and ${LIMITS.maxRows}.`;
    }
    const max = maxMinesFor(rows, cols);
    if (!Number.isInteger(mines) || mines < LIMITS.minMines || mines > max) {
      return `Mines must be between ${LIMITS.minMines} and ${max}.`;
    }
    return null;
  }

  class Game {
    /**
     * @param {object} opts
     * @param {number} opts.rows
     * @param {number} opts.cols
     * @param {number} opts.mines
     * @param {boolean} [opts.marks=false]  enable the Windows "?" marks
     * @param {function} [opts.rng=Math.random]
     * @param {function} [opts.onEvent]  receives (type, payload) for sound/UI hooks
     */
    constructor({ rows, cols, mines, marks = false, rng = Math.random, onEvent = () => {} }) {
      const err = validateCustom({ rows, cols, mines });
      if (err) throw new RangeError(err);

      this.rows = rows;
      this.cols = cols;
      this.mines = mines;
      this.marks = marks;
      this.rng = rng;
      this.onEvent = onEvent;

      this.cells = [];
      for (let i = 0; i < rows * cols; i++) {
        this.cells.push({ mine: false, adj: 0, revealed: false, mark: MARK_NONE, shield: false, scan: null, exploded: false });
      }
      this.totalSafe = rows * cols - mines;
      this.safeRevealed = 0;
      this.state = 'ready'; // ready -> playing -> won | lost
      this.minesPlaced = false;

      this.tokens = [];        // held Lucky Tokens, in slot order
      this.tokensAwarded = 0;  // how many milestones have been reached
      this.armedSlot = null;   // slot index of a token waiting for a target (scan/shield)
    }

    emit(type, payload) {
      this.onEvent(type, payload);
    }

    neighbors(i) {
      const r = Math.floor(i / this.cols);
      const c = i % this.cols;
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols) continue;
          out.push(nr * this.cols + nc);
        }
      }
      return out;
    }

    flagCount() {
      let n = 0;
      for (const c of this.cells) if (c.mark === MARK_FLAG) n++;
      return n;
    }

    minesLeft() {
      return this.mines - this.flagCount();
    }

    /** Safe squares remaining until the next Lucky Token. */
    tokenProgress() {
      return TOKEN_EVERY - (this.safeRevealed % TOKEN_EVERY);
    }

    placeMines(safeIndex) {
      // Windows guarantees the first click is never a mine; we also keep its 3x3 clear when possible.
      const forbidden = new Set([safeIndex, ...this.neighbors(safeIndex)]);
      let pool = [];
      for (let i = 0; i < this.cells.length; i++) if (!forbidden.has(i)) pool.push(i);
      if (pool.length < this.mines) {
        pool = [];
        for (let i = 0; i < this.cells.length; i++) if (i !== safeIndex) pool.push(i);
      }
      for (let k = 0; k < this.mines; k++) {
        const j = k + Math.floor(this.rng() * (pool.length - k));
        [pool[k], pool[j]] = [pool[j], pool[k]];
        this.cells[pool[k]].mine = true;
      }
      for (let i = 0; i < this.cells.length; i++) {
        this.cells[i].adj = this.neighbors(i).reduce((n, nb) => n + (this.cells[nb].mine ? 1 : 0), 0);
      }
      this.minesPlaced = true;
    }

    /** Left-click / tap: opens a square, or scans it if a Scanner is armed. */
    open(i) {
      if (this.isScanArmed()) return this.scanAt(i);
      return this.reveal(i);
    }

    reveal(i) {
      if (this.state === 'won' || this.state === 'lost') return false;
      const c = this.cells[i];
      if (c.revealed || c.mark === MARK_FLAG) return false;

      if (!this.minesPlaced) {
        this.placeMines(i);
        this.state = 'playing';
        this.emit('start', {});
      }

      if (c.mine) {
        if (this.armedSlot !== null && this.tokens[this.armedSlot] === 'shield') {
          this.tokens.splice(this.armedSlot, 1);
          this.armedSlot = null;
          c.mark = MARK_FLAG;
          c.shield = true;
          this.emit('shield', { i });
          return true;
        }
        c.revealed = true;
        c.exploded = true;
        this.state = 'lost';
        this.emit('lose', { i });
        return true;
      }

      const count = this.floodOpen(i);
      this.emit('reveal', { i, count });
      this.afterMove();
      return true;
    }

    floodOpen(start) {
      let count = 0;
      const stack = [start];
      while (stack.length) {
        const i = stack.pop();
        const c = this.cells[i];
        if (c.revealed || c.mark === MARK_FLAG || c.mine) continue;
        c.revealed = true;
        c.mark = MARK_NONE;
        count++;
        this.safeRevealed++;
        if (c.adj === 0) {
          for (const nb of this.neighbors(i)) {
            if (!this.cells[nb].revealed) stack.push(nb);
          }
        }
      }
      return count;
    }

    afterMove() {
      if (this.state !== 'playing') return;
      if (this.safeRevealed === this.totalSafe) {
        this.win();
        return;
      }
      while (this.safeRevealed >= (this.tokensAwarded + 1) * TOKEN_EVERY && this.state === 'playing') {
        this.tokensAwarded++;
        this.awardToken();
      }
    }

    win() {
      this.state = 'won';
      for (const c of this.cells) {
        if (c.mine && c.mark !== MARK_FLAG) c.mark = MARK_FLAG;
      }
      this.armedSlot = null;
      this.emit('win', {});
    }

    /** Right-click / long-press: cycles none -> flag -> ? (if marks enabled) -> none. */
    toggleMark(i) {
      if (this.state === 'won' || this.state === 'lost') return false;
      const c = this.cells[i];
      if (c.revealed || c.shield) return false;
      if (c.mark === MARK_NONE) {
        c.mark = MARK_FLAG;
        this.emit('flag', { i });
      } else if (c.mark === MARK_FLAG) {
        c.mark = this.marks ? MARK_QUESTION : MARK_NONE;
        this.emit('unflag', { i });
      } else {
        c.mark = MARK_NONE;
        this.emit('unflag', { i });
      }
      return true;
    }

    /** Chord: on a revealed number whose flag count matches, open the remaining neighbours. */
    chord(i) {
      if (this.state !== 'playing') return false;
      const c = this.cells[i];
      if (!c.revealed || c.adj === 0) return false;
      const nbs = this.neighbors(i);
      const flagged = nbs.reduce((n, nb) => n + (this.cells[nb].mark === MARK_FLAG ? 1 : 0), 0);
      if (flagged !== c.adj) return false;
      this.emit('chord', { i });
      let opened = false;
      for (const nb of nbs) {
        const d = this.cells[nb];
        if (!d.revealed && d.mark !== MARK_FLAG && this.reveal(nb)) opened = true;
      }
      return opened;
    }

    // ----- Lucky Tokens -----

    awardToken() {
      if (this.tokens.length >= MAX_TOKENS) {
        // Bag is full: the surprise is upgraded to an immediate Lucky Reveal instead of being wasted.
        this.emit('token', { type: 'lucky', bagFull: true });
        this.luckyReveal();
        return;
      }
      const type = TOKEN_TYPES[Math.floor(this.rng() * TOKEN_TYPES.length)];
      this.tokens.push(type);
      this.emit('token', { type, slot: this.tokens.length - 1, bagFull: false });
    }

    /** Clicking a token slot: Lucky acts at once; Scanner/Shield arm (click again to disarm). */
    activateToken(slot) {
      if (this.state !== 'playing' && this.state !== 'ready') return false;
      const type = this.tokens[slot];
      if (type === undefined) return false;
      if (this.armedSlot === slot) {
        this.disarm();
        return true;
      }
      this.disarm();
      if (type === 'lucky') {
        if (!this.luckyTargets().length) return false;
        this.tokens.splice(slot, 1);
        return this.luckyReveal();
      }
      this.armedSlot = slot;
      this.emit('armed', { type, slot });
      return true;
    }

    disarm() {
      if (this.armedSlot !== null) {
        this.armedSlot = null;
        this.emit('disarmed', {});
      }
    }

    isScanArmed() {
      return this.armedSlot !== null && this.tokens[this.armedSlot] === 'scan';
    }

    scanAt(i) {
      if (!this.isScanArmed() || this.state !== 'playing') return false;
      let count = 0;
      const area = [i, ...this.neighbors(i)];
      for (const a of area) if (this.cells[a].mine) count++;
      this.cells[i].scan = count;
      this.tokens.splice(this.armedSlot, 1);
      this.armedSlot = null;
      this.emit('scan', { i, count, area });
      return true;
    }

    /** Safe, closed, unmarked squares: the only ones a Lucky Reveal may open. */
    luckyTargets() {
      const out = [];
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i];
        if (!c.mine && !c.revealed && c.mark === MARK_NONE) out.push(i);
      }
      return out;
    }

    luckyReveal() {
      if (this.state === 'won' || this.state === 'lost') return false;
      const candidates = this.luckyTargets();
      if (!candidates.length) return false;
      const i = candidates[Math.floor(this.rng() * candidates.length)];
      this.emit('lucky', { i });
      return this.reveal(i);
    }
  }

  return {
    Game,
    LEVELS,
    LIMITS,
    TOKEN_EVERY,
    MAX_TOKENS,
    TOKEN_TYPES,
    MARK_NONE,
    MARK_FLAG,
    MARK_QUESTION,
    maxMinesFor,
    validateCustom,
  };
});
