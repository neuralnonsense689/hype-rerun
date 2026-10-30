/*
 * UI layer: rendering, mouse and touch input, menus, dialogs, and best times.
 * All rules live in board.js.
 */
(function () {
  'use strict';

  const SETTINGS_KEY = 'minesweeper.settings';
  const BEST_KEY = 'minesweeper.best';
  const LONG_PRESS_MS = 380;
  const MOVE_TOLERANCE_PX = 10;
  const MIN_CELL_PX = 20;
  const MAX_CELL_PX = 32;
  const FACES = { smile: '🙂', oh: '😮', dead: '😵', cool: '😎' };
  const LABELS = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert', custom: 'Custom' };
  const POWER_INFO = {
    shield: { icon: '🛡️', name: 'Shield' },
    sonar: { icon: '📡', name: 'Sonar' },
    magnet: { icon: '🧲', name: 'Magnet' },
  };

  const $ = (sel) => document.querySelector(sel);
  const boardEl = $('#board');
  const wrapEl = $('#board-wrap');
  const faceEl = $('#face');
  const statusEl = $('#status');
  const toastEl = $('#toast');

  const load = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch (_) {
      return fallback;
    }
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* storage unavailable (private mode): settings just won't persist */
    }
  };

  const settings = Object.assign(
    { difficulty: 'beginner', custom: { cols: 16, rows: 16, mines: 40 }, marks: false, sound: true },
    load(SETTINGS_KEY, {})
  );
  const saveSettings = () => save(SETTINGS_KEY, settings);

  let game = null;
  let cells = [];
  let timerId = null;
  let t0 = 0;
  let finalSecs = 0;
  let touchPress = null;
  let toastTimer = 0;
  const mouse = { left: false, right: false, used: false, idx: -1, ridx: -1 };

  const dims = () => (settings.difficulty === 'custom' ? settings.custom : Board.PRESETS[settings.difficulty]);
  const fmtLed = (v) => (v < 0 ? '-' + String(-v).padStart(2, '0') : String(v).padStart(3, '0'));
  const cellAt = (target) => {
    const cell = target && target.closest ? target.closest('.cell') : null;
    return cell ? Number(cell.dataset.i) : -1;
  };
  const vibrate = () => navigator.vibrate && navigator.vibrate(15);

  /* ---------- Rendering ---------- */

  function newGame() {
    const d = dims();
    game = Board.createGame({ cols: d.cols, rows: d.rows, mines: d.mines, marks: settings.marks });
    clearInterval(timerId);
    timerId = null;
    finalSecs = 0;
    tickTimer();
    buildBoard();
    layout();
    refresh();
    faceRest();
    setStatus('Click any tile to start. Some tiles hide surprises ✨');
  }

  function buildBoard() {
    boardEl.textContent = '';
    boardEl.style.gridTemplateColumns = `repeat(${game.cols}, var(--cell))`;
    cells = new Array(game.n);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < game.n; i++) {
      const el = document.createElement('div');
      el.className = 'cell hidden';
      el.dataset.i = i;
      cells[i] = el;
      frag.appendChild(el);
    }
    boardEl.appendChild(frag);
  }

  // Scales tiles to fit the window, within sensible tap-target limits. Wide boards scroll.
  function layout() {
    if (!game) return;
    const avail = Math.min(window.innerWidth - 32, 960) - 40;
    const size = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, Math.floor(avail / game.cols)));
    document.documentElement.style.setProperty('--cell', size + 'px');
  }

  function cellView(i) {
    const g = game;
    if (g.revealed[i]) {
      if (g.defused[i]) return { cls: 'cell open defused', txt: '🛡️' };
      if (g.mine[i]) return { cls: 'cell open mine boom', txt: '💣' };
      const n = g.num[i];
      return { cls: n ? `cell open n${n}` : 'cell open', txt: n ? String(n) : '' };
    }
    if (g.state === 'lost') {
      if (g.mine[i] && g.flag[i] !== 1) return { cls: 'cell open mine', txt: '💣' };
      if (!g.mine[i] && g.flag[i] === 1) return { cls: 'cell open wrong', txt: '❌' };
    }
    if (g.flag[i] === 1) return { cls: 'cell hidden', txt: '🚩' };
    if (g.flag[i] === 2) return { cls: 'cell hidden', txt: '?' };
    return { cls: 'cell hidden', txt: '' };
  }

  // Redraws tiles and HUD. Does not touch the face, so the pressed "😮" state survives.
  function refresh() {
    for (let i = 0; i < game.n; i++) {
      const v = cellView(i);
      cells[i].className = v.cls;
      cells[i].textContent = v.txt;
    }
    $('#mines').textContent = fmtLed(Board.minesLeft(game));
    updatePowers();
  }

  function updatePowers() {
    const inv = game.inventory;
    const live = game.state === 'playing';
    $('#pow-shield b').textContent = inv.shield;
    $('#pow-sonar b').textContent = inv.sonar;
    $('#pow-magnet b').textContent = inv.magnet;
    $('#pow-sonar').disabled = !live || inv.sonar === 0;
    $('#pow-magnet').disabled = !live || inv.magnet === 0;
  }

  function setFace(name) {
    faceEl.textContent = FACES[name];
  }

  function faceRest() {
    const state = game ? game.state : 'ready';
    setFace(state === 'lost' ? 'dead' : state === 'won' ? 'cool' : 'smile');
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ---------- Timer ---------- */

  function elapsedSecs() {
    return timerId ? Math.min(999, Math.floor((Date.now() - t0) / 1000)) : finalSecs;
  }

  function tickTimer() {
    $('#timer').textContent = fmtLed(elapsedSecs());
  }

  function startTimer() {
    if (timerId) return;
    t0 = Date.now();
    timerId = setInterval(tickTimer, 250);
    tickTimer();
  }

  function stopTimer() {
    if (!timerId) return;
    finalSecs = elapsedSecs();
    clearInterval(timerId);
    timerId = null;
    tickTimer();
  }

  /* ---------- Game actions ---------- */

  function act(fn, arg) {
    if (!game) return;
    const events = fn(game, arg);
    if (events.length) apply(events);
  }

  // Left click on a hidden tile reveals it. Left click on an open number chords.
  const leftAction = (g, idx) => (g.revealed[idx] ? Board.chord(g, idx) : Board.reveal(g, idx));

  function apply(events) {
    const types = new Set(events.map((e) => e.type));
    if (types.has('start')) startTimer();
    if (types.has('lose') || types.has('win')) stopTimer();

    const flagEv = events.find((e) => e.type === 'flag');
    let sfx = null;
    if (types.has('lose')) sfx = 'explode';
    else if (types.has('win')) sfx = onWin();
    else if (types.has('defuse')) sfx = 'defuse';
    else if (types.has('lucky')) sfx = 'lucky';
    else if (types.has('sonar')) sfx = 'sonar';
    else if (types.has('magnet')) sfx = 'magnet';
    else if (flagEv) sfx = flagEv.value === 1 ? 'flag' : flagEv.value === 2 ? 'question' : 'unflag';
    else if (types.has('open')) sfx = 'open';
    if (sfx) Sound.play(sfx);

    const sparkles = [];
    for (const e of events) {
      if (e.type === 'lucky') {
        const p = POWER_INFO[e.power];
        sparkles.push(e.idx);
        toast(`✨ Lucky Tile! +1 ${p.icon} ${p.name}`);
      } else if (e.type === 'defuse') {
        toast('🛡️ Shield defused a mine!');
      } else if (e.type === 'sonar') {
        toast('📡 Sonar opened a safe tile');
      } else if (e.type === 'magnet') {
        toast('🧲 Magnet flagged a mine');
      } else if (e.type === 'lose') {
        setStatus('💥 Boom! Click 😵 or press F2 to try again.');
      }
    }

    refresh();
    for (const i of sparkles) cells[i].classList.add('sparkle');
    faceRest();
  }

  function onWin() {
    const secs = finalSecs;
    const key = settings.difficulty;
    if (key === 'custom') {
      setStatus(`You win in ${secs}s! 🎉`);
      return 'win';
    }
    const best = load(BEST_KEY, {});
    if (best[key] == null || secs < best[key]) {
      best[key] = secs;
      save(BEST_KEY, best);
      setStatus(`🏆 New best ${LABELS[key]} time: ${secs}s!`);
      return 'record';
    }
    setStatus(`You win in ${secs}s! 🎉 (best: ${best[key]}s)`);
    return 'win';
  }

  /* ---------- Pointer input ---------- */

  // Mouse: left reveals on release, right flags on release, both buttons or middle button chords.
  function mouseDown(e, idx) {
    if (e.button === 0) {
      mouse.left = true;
      mouse.idx = idx;
      if (mouse.right) {
        mouse.used = true;
        act(Board.chord, idx);
      }
      if (game.state !== 'won' && game.state !== 'lost') setFace('oh');
    } else if (e.button === 2) {
      mouse.right = true;
      mouse.ridx = idx;
      if (mouse.left) {
        mouse.used = true;
        act(Board.chord, mouse.idx);
      }
    } else if (e.button === 1) {
      act(Board.chord, idx);
    }
  }

  function mouseUp(e, idx) {
    if (e.button === 0) {
      if (mouse.left && !mouse.used && idx === mouse.idx) act(leftAction, idx);
      mouse.left = false;
      mouse.idx = -1;
    } else if (e.button === 2) {
      if (mouse.right && !mouse.used && idx === mouse.ridx) act(Board.toggleFlag, idx);
      mouse.right = false;
      mouse.ridx = -1;
    }
    if (!mouse.left && !mouse.right) mouse.used = false;
    if (!mouse.left) faceRest();
  }

  // Touch: tap reveals. Hold for LONG_PRESS_MS to flag. Moving cancels the tap so scrolling works.
  function touchDown(e, idx) {
    if (touchPress) return;
    touchPress = { idx, x: e.clientX, y: e.clientY, fired: false, moved: false, timer: 0 };
    setFace('oh');
    touchPress.timer = setTimeout(() => {
      touchPress.fired = true;
      touchPress.timer = 0;
      vibrate();
      act(Board.toggleFlag, idx);
    }, LONG_PRESS_MS);
  }

  function touchMove(e) {
    const p = touchPress;
    if (!p || p.moved) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) {
      p.moved = true;
      clearTimeout(p.timer);
    }
  }

  function touchEnd(e) {
    const p = touchPress;
    if (!p) return;
    touchPress = null;
    clearTimeout(p.timer);
    if (!p.fired && !p.moved && cellAt(e.target) === p.idx) act(leftAction, p.idx);
    faceRest();
  }

  boardEl.addEventListener('pointerdown', (e) => {
    Sound.unlock();
    const idx = cellAt(e.target);
    if (!game || idx < 0) return;
    if (e.pointerType === 'mouse') mouseDown(e, idx);
    else touchDown(e, idx);
  });

  boardEl.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
  });
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  boardEl.addEventListener('animationend', (e) => e.target.classList.remove('sparkle'));

  window.addEventListener('pointermove', touchMove);
  window.addEventListener('pointerup', (e) => {
    if (!game) return;
    if (e.pointerType === 'mouse') mouseUp(e, cellAt(e.target));
    else touchEnd(e);
  });
  window.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'mouse' || !touchPress) return;
    clearTimeout(touchPress.timer);
    touchPress = null;
    faceRest();
  });

  document.addEventListener('pointerdown', () => Sound.unlock());

  faceEl.addEventListener('click', newGame);
  $('#pow-sonar').addEventListener('click', () => act(Board.useSonar));
  $('#pow-magnet').addEventListener('click', () => act(Board.useMagnet));

  /* ---------- Keyboard ---------- */

  document.addEventListener('keydown', (e) => {
    Sound.unlock();
    if (e.key === 'F2') {
      e.preventDefault();
      newGame();
    }
  });

  /* ---------- Menus and dialogs ---------- */

  function closeMenus() {
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  }

  document.querySelectorAll('.menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.parentElement;
      const wasOpen = menu.classList.contains('open');
      closeMenus();
      if (!wasOpen) menu.classList.add('open');
    });
  });

  document.addEventListener('click', closeMenus);

  $('#menubar').addEventListener('click', (e) => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    closeMenus();
    runAction(item.dataset.action);
  });

  function syncMenuLabels() {
    $('#opt-marks').textContent = `Question marks: ${settings.marks ? 'On' : 'Off'}`;
    $('#opt-sound').textContent = `Sound: ${settings.sound ? 'On' : 'Off'}`;
  }

  function runAction(action) {
    switch (action) {
      case 'new':
        newGame();
        break;
      case 'beginner':
      case 'intermediate':
      case 'expert':
        settings.difficulty = action;
        saveSettings();
        newGame();
        break;
      case 'custom':
        openCustom();
        break;
      case 'best':
        showBest();
        break;
      case 'marks':
        settings.marks = !settings.marks;
        if (game) {
          Board.setMarks(game, settings.marks);
          refresh();
        }
        saveSettings();
        syncMenuLabels();
        break;
      case 'sound':
        settings.sound = !settings.sound;
        Sound.setEnabled(settings.sound);
        saveSettings();
        syncMenuLabels();
        if (settings.sound) Sound.play('open');
        break;
      case 'help':
        $('#help-dlg').showModal();
        break;
    }
  }

  const customDlg = $('#custom-dlg');
  function openCustom() {
    const d = settings.custom;
    $('#c-cols').value = d.cols;
    $('#c-rows').value = d.rows;
    $('#c-mines').value = d.mines;
    customDlg.showModal();
  }

  $('#custom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    settings.custom = Board.clampCustom({
      cols: Number($('#c-cols').value),
      rows: Number($('#c-rows').value),
      mines: Number($('#c-mines').value),
    });
    settings.difficulty = 'custom';
    saveSettings();
    customDlg.close();
    newGame();
  });
  $('#c-cancel').addEventListener('click', () => customDlg.close());

  function showBest() {
    const best = load(BEST_KEY, {});
    $('#best-table').innerHTML = ['beginner', 'intermediate', 'expert']
      .map((k) => `<tr><td>${LABELS[k]}</td><td>${best[k] != null ? best[k] + ' s' : '—'}</td></tr>`)
      .join('');
    $('#best-dlg').showModal();
  }

  $('#best-reset').addEventListener('click', () => {
    save(BEST_KEY, {});
    showBest();
  });
  $('#best-close').addEventListener('click', () => $('#best-dlg').close());
  $('#help-close').addEventListener('click', () => $('#help-dlg').close());

  /* ---------- Boot ---------- */

  Sound.setEnabled(settings.sound);
  syncMenuLabels();
  newGame();
  window.addEventListener('resize', layout);
})();
