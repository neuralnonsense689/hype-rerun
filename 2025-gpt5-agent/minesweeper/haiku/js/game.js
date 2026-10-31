/*
 * Minesweeper UI: rendering, mouse and touch input, menus, dialogs, best times, and surprise effects.
 * Game rules live in core.js; sounds live in sound.js.
 */
(function () {
  'use strict';

  const Core = window.MinesweeperCore;
  const Sound = window.Sound;
  const { LEVELS, MARK_FLAG, MARK_QUESTION, TOKEN_EVERY } = Core;

  const KEYS = { best: 'ms.best', custom: 'ms.custom', marks: 'ms.marks', level: 'ms.level' };
  const BEST_KEEP = 5;
  const MIN_CELL = 18;   // px; below this the board scrolls sideways on phones
  const MAX_CELL = 28;   // px; matches the chunky look of the classic game at this scale
  const LONG_PRESS_MS = 350;
  const MOVE_SLOP_PX = 10;

  const TOKEN_LABEL = { scan: '🔍 Scanner', shield: '🛡️ Shield', lucky: '✨ Lucky Reveal' };
  const TOKEN_ICON = { scan: '🔍', shield: '🛡️', lucky: '✨' };

  const SVG = {
    mine: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" stroke="#000" stroke-width="1.8"/><circle cx="8" cy="8" r="4.2" fill="#000"/><circle cx="6.6" cy="6.6" r="1.2" fill="#fff"/></svg>',
    flag: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="1.5" width="1.6" height="13" fill="#000"/><path d="M4.6 2L13.5 5 4.6 8.2Z" fill="#ff0000"/><rect x="1.5" y="14" width="8" height="1.6" fill="#000"/></svg>',
    shield: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l5.5 1.9v4.4c0 3.4-2.3 5.9-5.5 7-3.2-1.1-5.5-3.6-5.5-7V3.4z" fill="#2a7fff" stroke="#00316e"/><path d="M8 4v8" stroke="#fff" stroke-width="1.2" opacity=".6"/></svg>',
  };

  // Smiley face states, as in the Windows game.
  const faceSvg = (inner) =>
    `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="#ffff00" stroke="#000" stroke-width="1.5"/>${inner}</svg>`;
  const EYES = '<circle cx="11" cy="12" r="2.1" fill="#000"/><circle cx="21" cy="12" r="2.1" fill="#000"/>';
  const FACES = {
    smile: faceSvg(EYES + '<path d="M9 20Q16 27 23 20" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/>'),
    oh: faceSvg(EYES + '<ellipse cx="16" cy="22.5" rx="3" ry="3.6" fill="#000"/>'),
    cool: faceSvg('<rect x="5.5" y="9" width="9" height="5.5" rx="1" fill="#000"/><rect x="17.5" y="9" width="9" height="5.5" rx="1" fill="#000"/><path d="M14.5 11.5h3" stroke="#000" stroke-width="1.6"/><path d="M9 20Q16 26 23 20" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/>'),
    dead: faceSvg('<path d="M8 9l6 6M14 9l-6 6M18 9l6 6M24 9l-6 6" stroke="#000" stroke-width="1.8" stroke-linecap="round"/><path d="M9 24Q16 18 23 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/>'),
  };

  const $ = (sel) => document.querySelector(sel);
  const dom = {
    board: $('#board'),
    boardWrap: $('#board-wrap'),
    face: $('#face'),
    mines: $('#mines-left'),
    timer: $('#timer'),
    slots: [...document.querySelectorAll('.slot')],
    tokenProgress: $('#token-progress'),
    status: $('#status'),
    toast: $('#toast'),
    menubar: $('#menubar'),
    checkMarks: $('#check-marks'),
    checkSound: $('#check-sound'),
    dlgCustom: $('#dlg-custom'),
    formCustom: $('#form-custom'),
    customError: $('#custom-error'),
    dlgBest: $('#dlg-best'),
    bestList: $('#best-list'),
    dlgName: $('#dlg-name'),
    formName: $('#form-name'),
    nameMessage: $('#name-message'),
    nameInput: $('#form-name input[name="name"]'),
  };

  // ----- Persistent settings -----

  let custom = readJSON(KEYS.custom, null);
  if (!custom || Core.validateCustom(custom)) custom = { rows: 16, cols: 16, mines: 40 }; // ignore a corrupted saved value
  let marks = localStorage.getItem(KEYS.marks) === 'on';
  let levelKey = localStorage.getItem(KEYS.level) || 'beginner';
  if (levelKey !== 'custom' && !LEVELS[levelKey]) levelKey = 'beginner';

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  // ----- Game state -----

  let game = null;
  let cellEls = [];
  let cellKeys = [];
  let mouse = null;          // { i, hover, left, chord } while a mouse button is down
  let touch = null;          // { i, id, x, y, moved, chord, longFired, timer } while a finger is down
  let pressed = new Set();   // closed squares currently shown as pressed
  let flashing = new Set();  // squares briefly highlighted by a Scanner
  let timerId = null;
  let startedAt = 0;
  let endedAt = 0;
  let toastTimer = null;
  let pendingBest = null;

  function lcd(n) {
    const v = Math.max(-99, Math.min(999, n));
    return v < 0 ? '-' + String(-v).padStart(2, '0') : String(v).padStart(3, '0');
  }

  function buzz(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ----- Game lifecycle -----

  function newGame(key) {
    if (key === 'custom' || LEVELS[key]) levelKey = key;
    localStorage.setItem(KEYS.level, levelKey);
    const cfg = levelKey === 'custom' ? custom : LEVELS[levelKey];

    stopTimer();
    startedAt = 0;
    endedAt = 0;
    mouse = null;
    touch = null;
    pressed = new Set();
    flashing = new Set();
    game = new Core.Game({
      rows: cfg.rows,
      cols: cfg.cols,
      mines: cfg.mines,
      marks,
      onEvent: onGameEvent,
    });
    buildBoard();
    refresh();
    updateTimer();
  }

  function buildBoard() {
    dom.board.innerHTML = '';
    dom.board.style.gridTemplateColumns = `repeat(${game.cols}, var(--cell))`;
    cellEls = new Array(game.cells.length);
    cellKeys = new Array(game.cells.length);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < game.cells.length; i++) {
      const d = document.createElement('div');
      d.className = 'cell closed';
      d.dataset.i = i;
      d.setAttribute('role', 'gridcell');
      cellEls[i] = d;
      frag.appendChild(d);
    }
    dom.board.appendChild(frag);
    fitBoard();
  }

  /** Scales squares to the viewport: big on desktop, as small as MIN_CELL on phones (then it scrolls). */
  function fitBoard() {
    if (!game) return;
    const avail = window.innerWidth - 40;
    const size = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(avail / game.cols)));
    document.documentElement.style.setProperty('--cell', size + 'px');
  }

  function isOver() {
    return game.state === 'won' || game.state === 'lost';
  }

  // ----- Timer -----

  function startTimer() {
    startedAt = performance.now();
    clearInterval(timerId);
    timerId = setInterval(updateTimer, 200);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    if (startedAt && !endedAt) endedAt = performance.now();
  }

  function elapsedSeconds() {
    if (!startedAt) return 0;
    return Math.floor(((endedAt || performance.now()) - startedAt) / 1000);
  }

  function updateTimer() {
    dom.timer.textContent = lcd(Math.min(999, elapsedSeconds()));
  }

  // ----- Rendering -----

  function renderCell(i) {
    const c = game.cells[i];
    const d = cellEls[i];
    const lost = game.state === 'lost';
    let cls = 'cell';
    let html = '';

    if (c.revealed) {
      if (c.mine) {
        cls += c.exploded ? ' open boom' : ' open';
        html = SVG.mine;
      } else if (c.adj > 0) {
        cls += ` open n${c.adj}`;
        html = String(c.adj);
      } else {
        cls += ' open empty';
      }
    } else if (c.shield) {
      cls += ' closed shielded';
      html = SVG.shield;
    } else if (c.mark === MARK_FLAG) {
      cls += ' closed';
      html = SVG.flag;
      if (lost && !c.mine) cls += ' wrong';
    } else if (lost && c.mine) {
      // Show the mines the player didn't find.
      cls += ' open';
      html = SVG.mine;
    } else {
      cls += ' closed';
      if (c.mark === MARK_QUESTION) {
        cls += ' q';
        html = '?';
      }
      if (pressed.has(i)) cls += ' down';
    }
    if (flashing.has(i)) cls += ' flash';

    const scan = c.scan !== null && !c.revealed ? String(c.scan) : '';
    if (scan) cls += ' scanned';

    const key = `${cls}|${html}|${scan}`;
    if (cellKeys[i] === key) return;
    cellKeys[i] = key;
    d.className = cls;
    d.innerHTML = html;
    if (scan) d.dataset.scan = scan;
    else delete d.dataset.scan;
  }

  function refresh() {
    if (!game) return;
    pressed = computePressed();
    for (let i = 0; i < cellEls.length; i++) renderCell(i);
    dom.mines.textContent = lcd(game.minesLeft());
    setFace(faceName());
    renderTokens();
    dom.status.textContent = statusText();
    dom.checkMarks.classList.toggle('on', marks);
    dom.checkSound.classList.toggle('on', Sound.isEnabled());
  }

  function faceName() {
    if (game.state === 'won') return 'cool';
    if (game.state === 'lost') return 'dead';
    const leftDown = mouse && (mouse.left || mouse.chord);
    const fingerDown = touch && !touch.moved && !touch.longFired;
    return leftDown || fingerDown ? 'oh' : 'smile';
  }

  let currentFace = '';
  function setFace(name) {
    if (name === currentFace) return;
    currentFace = name;
    dom.face.innerHTML = FACES[name];
  }

  function renderTokens() {
    dom.slots.forEach((btn, k) => {
      const type = game.tokens[k];
      const armed = game.armedSlot === k;
      btn.className = 'slot ' + (type ? type : 'empty') + (armed ? ' armed' : '');
      btn.disabled = !type;
      btn.textContent = type ? TOKEN_ICON[type] : '';
      btn.title = type ? TOKEN_LABEL[type] : 'Empty slot';
      btn.setAttribute('aria-label', type ? `${TOKEN_LABEL[type]} token${armed ? ' (armed)' : ''}` : 'Empty slot');
    });
    dom.tokenProgress.textContent =
      game.state === 'playing' ? `next gift in ${game.tokenProgress()} safe` : `every ${TOKEN_EVERY} safe squares`;
  }

  function statusText() {
    switch (game.state) {
      case 'ready':
        return 'Click any square to start. Good luck!';
      case 'playing': {
        if (game.armedSlot !== null) {
          const type = game.tokens[game.armedSlot];
          const what = type === 'scan' ? 'tap a square to scan its 3×3 area' : 'the next mine you hit will be blocked';
          return `${TOKEN_LABEL[type]} armed: ${what}. Tap the token again to cancel.`;
        }
        return `${game.totalSafe - game.safeRevealed} safe square(s) to go.`;
      }
      case 'won':
        return '🎉 You cleared the minefield!';
      default:
        return '💥 Boom! Press the face or F2 to try again.';
    }
  }

  // ----- Surprise effects -----

  function toast(msg, surprise = false) {
    dom.toast.textContent = msg;
    dom.toast.classList.toggle('surprise', surprise);
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), surprise ? 3800 : 2400);
  }

  function confetti(count) {
    const colors = ['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#9d4edd', '#f8961e'];
    for (let k = 0; k < count; k++) {
      const s = document.createElement('span');
      s.className = 'confetti';
      s.style.left = Math.random() * 100 + 'vw';
      s.style.background = colors[k % colors.length];
      s.style.setProperty('--drift', Math.random() * 160 - 80 + 'px');
      s.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
      s.style.animationDelay = Math.random() * 0.4 + 's';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 4000);
    }
  }

  function flashArea(area) {
    const scanGame = game;
    for (const i of area) flashing.add(i);
    refresh();
    setTimeout(() => {
      if (game !== scanGame) return;
      for (const i of area) flashing.delete(i);
      refresh();
    }, 1400);
  }

  // ----- Game events (from core.js) -----

  function onGameEvent(type, p) {
    switch (type) {
      case 'start':
        startTimer();
        break;
      case 'reveal':
        Sound.reveal(p.count);
        break;
      case 'chord':
        Sound.chord();
        break;
      case 'flag':
        Sound.flag();
        break;
      case 'unflag':
        Sound.unflag();
        break;
      case 'lose':
        stopTimer();
        Sound.explode();
        setTimeout(Sound.lose, 300);
        buzz([80, 40, 220]);
        break;
      case 'win': {
        stopTimer();
        Sound.win();
        confetti(70);
        buzz([30, 40, 30]);
        // Capture the time now; the record check runs after a pause, by which point a new game may have started.
        const finishedGame = game;
        const secs = elapsedSeconds();
        setTimeout(() => {
          if (game === finishedGame) maybeRecordBest(secs);
        }, 900);
        break;
      }
      case 'shield':
        Sound.shield();
        buzz(20);
        toast('🛡️ Shield blocked a mine! It is now marked for you.', true);
        break;
      case 'token':
        Sound.token();
        confetti(18);
        buzz([20, 60, 20]);
        if (p.bagFull) {
          toast('🎁 Surprise! Your bag is full, so you get a free ✨ Lucky Reveal!', true);
        } else {
          toast(`🎁 Surprise! You found a ${TOKEN_LABEL[p.type]} token. Tap it below to use it.`, true);
        }
        break;
      case 'armed':
        Sound.armed();
        toast(p.type === 'scan' ? '🔍 Scanner armed: tap any square to see the mines in its 3×3 area.' : '🛡️ Shield armed: the next mine you hit will be blocked.');
        break;
      case 'scan':
        Sound.scan();
        flashArea(p.area);
        toast(`🔍 ${p.count} mine${p.count === 1 ? '' : 's'} in the 3×3 area around that square.`);
        break;
      case 'lucky':
        Sound.lucky();
        break;
      default:
        break;
    }
  }

  // ----- Input: mouse (Windows conventions) -----

  function cellIndexOf(target) {
    const d = target && target.closest ? target.closest('.cell') : null;
    return d ? Number(d.dataset.i) : -1;
  }

  function computePressed() {
    const s = new Set();
    const add = (i, withNeighbours) => {
      if (i < 0) return;
      s.add(i);
      if (withNeighbours) for (const nb of game.neighbors(i)) s.add(nb);
    };
    if (mouse && (mouse.left || mouse.chord)) add(mouse.hover, mouse.chord);
    if (touch && !touch.moved && !touch.longFired) add(touch.i, touch.chord);
    return s;
  }

  function onMouseDown(e) {
    if (!game || isOver() || e.button > 2) return;
    const i = cellIndexOf(e.target);
    if (i < 0) return;
    e.preventDefault(); // stops text selection and middle-click autoscroll
    if (touch) return;  // a finger is already on the board
    if (!mouse) mouse = { i, hover: i, left: false, chord: false };
    // Middle button, or left+right held together, chords.
    if (e.button === 1 || (e.button === 0 && (e.buttons & 2)) || (e.button === 2 && (e.buttons & 1))) {
      mouse.chord = true;
    } else if (e.button === 0) {
      mouse.left = true;
    }
    refresh();
  }

  function onMouseOver(e) {
    if (!mouse) return;
    const i = cellIndexOf(e.target);
    if (i >= 0 && i !== mouse.hover) {
      mouse.hover = i;
      refresh();
    }
  }

  function onMouseUp(e) {
    if (!mouse || !game) return;
    const at = cellIndexOf(e.target);
    if (mouse.chord) {
      // Chord fires once every button is up, so releasing one button first doesn't cancel it.
      if (e.buttons !== 0) {
        refresh();
        return;
      }
      if (at === mouse.i) game.chord(at);
      mouse = null;
    } else if (e.button === 0) {
      if (at === mouse.i) game.open(at);
      mouse = null;
    } else if (e.button === 2) {
      if (at === mouse.i) game.toggleMark(at);
      mouse = null;
    } else {
      mouse = null;
    }
    refresh();
  }

  function onWindowMouseUp(e) {
    // Released outside the board: cancel the press.
    if (mouse && e.buttons === 0 && cellIndexOf(e.target) < 0) {
      mouse = null;
      refresh();
    }
  }

  // ----- Input: touch -----

  function onTouchStart(e) {
    if (!game || isOver()) return;
    const t = e.changedTouches[0];
    if (!touch) {
      const i = cellIndexOf(e.target);
      if (i < 0 || mouse) return;
      touch = { i, id: t.identifier, x: t.clientX, y: t.clientY, moved: false, chord: false, longFired: false, timer: null };
      touch.timer = setTimeout(onLongPress, LONG_PRESS_MS);
    } else {
      // A second finger while the first is down is a two-finger tap: chord.
      touch.chord = true;
      clearTimeout(touch.timer);
    }
    refresh();
  }

  function onTouchMove(e) {
    if (!touch) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.id) continue;
      if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > MOVE_SLOP_PX && !touch.moved) {
        touch.moved = true; // treat as a scroll/pan, not a tap
        clearTimeout(touch.timer);
        refresh();
      }
    }
  }

  function onTouchEnd(e) {
    if (cellIndexOf(e.target) >= 0 || touch) e.preventDefault(); // suppress the emulated mouse click
    if (!touch || e.touches.length > 0) return; // wait until every finger is up
    const t = touch;
    touch = null;
    clearTimeout(t.timer);
    if (!t.longFired && !t.moved && game) {
      if (t.chord) {
        game.chord(t.i);
      } else if (game.cells[t.i].revealed) {
        game.chord(t.i); // tapping a number chords it (phones have no middle button)
      } else {
        game.open(t.i);
      }
    }
    refresh();
  }

  function onTouchCancel() {
    if (!touch) return;
    clearTimeout(touch.timer);
    touch = null;
    refresh();
  }

  function onLongPress() {
    if (!touch || touch.moved || touch.chord) return;
    touch.longFired = true;
    buzz(12);
    game.toggleMark(touch.i);
    refresh();
  }

  // ----- Best times -----

  function loadBest() {
    const all = readJSON(KEYS.best, {});
    for (const k of Object.keys(LEVELS)) if (!Array.isArray(all[k])) all[k] = [];
    return all;
  }

  function qualifiesForBest(key, secs) {
    const list = loadBest()[key];
    return list.length < BEST_KEEP || secs < list[list.length - 1].time;
  }

  function recordBest(key, secs, name) {
    const all = loadBest();
    all[key] = [...all[key], { name, time: secs }].sort((a, b) => a.time - b.time).slice(0, BEST_KEEP);
    localStorage.setItem(KEYS.best, JSON.stringify(all));
  }

  function maybeRecordBest(secs) {
    if (levelKey === 'custom' || !LEVELS[levelKey]) return; // custom boards don't have a ranking
    if (!qualifiesForBest(levelKey, secs)) return;
    pendingBest = { key: levelKey, secs };
    dom.nameMessage.textContent = `You have the fastest time for ${LEVELS[levelKey].name}: ${secs} second${secs === 1 ? '' : 's'}. Please enter your name.`;
    dom.nameInput.value = 'Anonymous';
    dom.dlgName.showModal();
    dom.nameInput.select();
  }

  function showBestTimes() {
    const all = loadBest();
    dom.bestList.innerHTML = '';
    for (const key of Object.keys(LEVELS)) {
      const wrap = document.createElement('div');
      wrap.className = 'best-level';
      const h = document.createElement('h3');
      h.textContent = LEVELS[key].name;
      wrap.appendChild(h);
      if (!all[key].length) {
        const p = document.createElement('p');
        p.className = 'best-empty';
        p.textContent = 'No times yet.';
        wrap.appendChild(p);
      } else {
        const ol = document.createElement('ol');
        for (const entry of all[key]) {
          const li = document.createElement('li');
          li.textContent = `${entry.time} s  ${entry.name}`; // textContent: names are user input
          ol.appendChild(li);
        }
        wrap.appendChild(ol);
      }
      dom.bestList.appendChild(wrap);
    }
    dom.dlgBest.showModal();
  }

  // ----- Menus and dialogs -----

  function closeMenus() {
    dom.menubar.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  }

  function openCustomDialog() {
    dom.formCustom.rows.value = custom.rows;
    dom.formCustom.cols.value = custom.cols;
    dom.formCustom.mines.value = custom.mines;
    dom.customError.textContent = '';
    dom.dlgCustom.showModal();
  }

  function runAction(action) {
    switch (action) {
      case 'new':
        newGame(levelKey);
        break;
      case 'beginner':
      case 'intermediate':
      case 'expert':
        newGame(action);
        break;
      case 'custom':
        openCustomDialog();
        break;
      case 'best':
        showBestTimes();
        break;
      case 'toggle-marks':
        marks = !marks;
        localStorage.setItem(KEYS.marks, marks ? 'on' : 'off');
        if (game) game.marks = marks;
        refresh();
        break;
      case 'toggle-sound':
        Sound.setEnabled(!Sound.isEnabled());
        refresh();
        break;
      case 'help':
        $('#dlg-help').showModal();
        break;
      case 'about':
        $('#dlg-about').showModal();
        break;
      default:
        break;
    }
  }

  // ----- Wiring -----

  function bind() {
    // Board input
    dom.board.addEventListener('mousedown', onMouseDown);
    dom.board.addEventListener('mouseover', onMouseOver);
    dom.board.addEventListener('mouseup', onMouseUp);
    dom.board.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', onWindowMouseUp);
    dom.board.addEventListener('touchstart', onTouchStart, { passive: true });
    dom.board.addEventListener('touchmove', onTouchMove, { passive: true });
    dom.board.addEventListener('touchend', onTouchEnd, { passive: false });
    dom.board.addEventListener('touchcancel', onTouchCancel, { passive: true });

    // Face: new game
    dom.face.addEventListener('click', () => newGame(levelKey));

    // Lucky token slots
    dom.slots.forEach((btn, k) => {
      btn.addEventListener('click', () => {
        if (!game) return;
        const type = game.tokens[k];
        if (!game.activateToken(k) && type === 'lucky') toast('✨ No safe squares left for a Lucky Reveal.');
        refresh();
      });
    });

    // Menus
    dom.menubar.addEventListener('click', (e) => {
      const title = e.target.closest('.menu-title');
      if (title) {
        const menu = title.parentElement;
        const open = !menu.classList.contains('open');
        closeMenus();
        if (open) menu.classList.add('open');
        return;
      }
      const item = e.target.closest('[data-action]');
      if (item) {
        closeMenus();
        runAction(item.dataset.action);
      }
    });
    // Once one menu is open, hovering the others switches to them (Windows behaviour).
    dom.menubar.addEventListener('mouseover', (e) => {
      const menu = e.target.closest('.menu');
      if (menu && dom.menubar.querySelector('.menu.open') && !menu.classList.contains('open')) {
        closeMenus();
        menu.classList.add('open');
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.menubar')) closeMenus();
    });

    // Custom field dialog
    dom.formCustom.addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const f = dom.formCustom;
      const next = { rows: Number(f.rows.value), cols: Number(f.cols.value), mines: Number(f.mines.value) };
      const err = Core.validateCustom(next);
      if (err) {
        e.preventDefault();
        dom.customError.textContent = err;
        return;
      }
      custom = next;
      localStorage.setItem(KEYS.custom, JSON.stringify(custom));
      newGame('custom');
    });
    $('#custom-cancel').addEventListener('click', () => dom.dlgCustom.close());

    // Name entry for best times. Closing the dialog by any means records the entry.
    dom.dlgName.addEventListener('close', () => {
      if (!pendingBest) return;
      const name = dom.nameInput.value.trim().slice(0, 20) || 'Anonymous';
      recordBest(pendingBest.key, pendingBest.secs, name);
      toast(`🏆 New ${LEVELS[pendingBest.key].name} record: ${pendingBest.secs} s!`, true);
      pendingBest = null;
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        newGame(levelKey);
      } else if (e.key === 'Escape' && game) {
        game.disarm();
        refresh();
      }
    });

    window.addEventListener('resize', () => {
      fitBoard();
      refresh();
    });
  }

  function init() {
    bind();
    newGame(levelKey);
  }

  init();
})();
