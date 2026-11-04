/* ============================================================
   ChessHub — клиентская логика
   ============================================================ */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const PIECE_URL = {
  wK: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_klt45.svg',
  wQ: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_qlt45.svg',
  wR: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_rlt45.svg',
  wB: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_blt45.svg',
  wN: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_nlt45.svg',
  wP: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_plt45.svg',
  bK: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_kdt45.svg',
  bQ: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_qdt45.svg',
  bR: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_rdt45.svg',
  bB: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_bdt45.svg',
  bN: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_ndt45.svg',
  bP: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chess_pdt45.svg'
};
const FEN_TO_KEY = { P:'wP',N:'wN',B:'wB',R:'wR',Q:'wQ',K:'wK',p:'bP',n:'bN',b:'bB',r:'bR',q:'bQ',k:'bK' };
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MEDALS = ['🥇', '🥈', '🥉'];
const TC_LABELS = {
  '1+0': 'Пуля 1+0', '3+0': 'Блиц 3+0', '3+2': 'Блиц 3+2', '5+0': 'Блиц 5+0',
  '10+5': 'Рапид 10+5', '15+10': 'Рапид 15+10', '30+0': 'Классика 30+0'
};

function parseFen(fen) {
  const rows = String(fen || '').split(' ')[0].split('/');
  const grid = [];
  for (const row of rows) {
    const line = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { for (let i = 0; i < +ch; i++) line.push(null); }
      else line.push(ch);
    }
    grid.push(line);
  }
  return grid;
}
function kingSquare(fen, color) {
  const target = color === 'w' ? 'K' : 'k';
  const grid = parseFen(fen);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (grid[r][c] === target) return 'abcdefgh'[c] + (8 - r);
  return null;
}
function pieceAt(fen, key) {
  const c = 'abcdefgh'.indexOf(key[0]);
  const r = 8 - parseInt(key[1], 10);
  const grid = parseFen(fen);
  return (grid[r] && grid[r][c]) ? grid[r][c] : null;
}
function renderBoard(container, fen, opts) {
  opts = opts || {};
  const lastMove = opts.lastMove || null, sel = opts.sel || null,
    targets = opts.targets || [], onSquare = opts.onSquare || null,
    flip = !!opts.flip, checkSq = opts.checkSq || null;
  const grid = parseFen(fen);
  container.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'board';
  const rows = [0,1,2,3,4,5,6,7], cols = [0,1,2,3,4,5,6,7];
  if (flip) { rows.reverse(); cols.reverse(); }
  for (const r of rows) for (const c of cols) {
    const key = 'abcdefgh'[c] + (8 - r);
    const sq = document.createElement('div');
    sq.className = 'sq ' + (((r + c) % 2 === 0) ? 'light' : 'dark');
    if (lastMove && (lastMove.from === key || lastMove.to === key)) sq.classList.add('last');
    if (sel === key) sq.classList.add('sel');
    if (targets.indexOf(key) >= 0) sq.classList.add('target');
    if (checkSq === key) sq.classList.add('check');
    sq.dataset.sq = key;
    const p = grid[r][c];
    if (p) sq.innerHTML = '<img class="piece" src="' + PIECE_URL[FEN_TO_KEY[p]] + '" alt="" draggable="false">';
    if (onSquare) sq.addEventListener('click', function () { onSquare(key); });
    board.appendChild(sq);
  }
  container.appendChild(board);
}

const state = { user: null, token: localStorage.getItem('ch_token') || null };

async function api(path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || ('Ошибка ' + res.status));
  return data;
}

function toast(text, type) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.className = 'toast'; }, 3200);
}

function fmtClock(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function avatarHTML(name, cls) {
  return '<span class="avatar ' + (cls || '') + '">' + esc((name || '?')[0].toUpperCase()) + '</span>';
}
function resultBadge(result) {
  if (result === 'white') return '<span class="res-badge res-white">1–0</span>';
  if (result === 'black') return '<span class="res-badge res-black">0–1</span>';
  if (result === 'draw') return '<span class="res-badge res-draw">½–½</span>';
  return '<span class="res-badge res-live">идёт</span>';
}
function reasonText(r) {
  return {
    checkmate: 'мат', timeout: 'время', resign: 'сдача', agreement: 'согласие',
    stalemate: 'пат', repetition: 'троекратное повторение', material: 'недостаточный материал', '50-move': 'правило 50 ходов'
  }[r] || r || '';
}

/* ============================================================
   АВТОРИЗАЦИЯ
   ============================================================ */
let authMode = 'login';

function renderAuthArea() {
  const area = $('#authArea');
  if (!area) return;
  if (state.user) {
    area.innerHTML =
      '<a class="userchip" href="#/profile/' + state.user.id + '">' +
      avatarHTML(state.user.name, 'sm') + '<b>' + esc(state.user.name) + '</b>' +
      '<span class="chip-rating">' + state.user.rating + '</span></a>';
  } else {
    area.innerHTML =
      '<button class="btn btn-ghost" id="loginBtn">Войти</button>' +
      '<button class="btn btn-primary" id="signupBtn">Регистрация</button>';
    $('#loginBtn').onclick = function () { openAuth('login'); };
    $('#signupBtn').onclick = function () { openAuth('signup'); };
  }
  const mm = $('#mobileMenu');
  if (mm) {
    mm.innerHTML = '<a href="#/lobby">Играть</a><a href="#/tournaments">Турниры</a>' +
      '<a href="#/rankings">Рейтинги</a><a href="#/tasks">Задачи</a><a href="#/learn">Обучение</a>' +
      (state.user
        ? '<a href="#/profile/' + state.user.id + '">Профиль</a>'
        : '<a href="#" data-auth="login">Войти</a><a href="#" data-auth="signup">Регистрация</a>');
    $$('a[data-auth]', mm).forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); mm.classList.remove('open'); openAuth(a.dataset.auth); };
    });
  }
}

function openAuth(tab) {
  $('#authOverlay').classList.remove('hidden');
  $('#authError').classList.add('hidden');
  setAuthTab(tab || 'login');
}
function closeAuth() { $('#authOverlay').classList.add('hidden'); }
function setAuthTab(tab) {
  authMode = tab;
  $$('.auth-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
  $('#emailField').classList.toggle('hidden', tab !== 'signup');
  $('#nameField').childNodes[0].textContent = tab === 'signup' ? 'Ник ' : 'Ник или email ';
  $('#authName').placeholder = tab === 'signup' ? 'Придумайте ник' : 'Ваш ник или email';
  $('#authSubmit').textContent = tab === 'signup' ? 'Создать аккаунт' : 'Войти';
}

$('#authClose').onclick = closeAuth;
$('#authOverlay').addEventListener('click', function (e) { if (e.target === this) closeAuth(); });
$$('.auth-tab').forEach(function (b) {
  b.onclick = function () { setAuthTab(b.dataset.tab); $('#authError').classList.add('hidden'); };
});
$('#authForm').onsubmit = async function (e) {
  e.preventDefault();
  const err = $('#authError');
  err.classList.add('hidden');
  try {
    let data;
    if (authMode === 'signup') {
      data = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#authName').value.trim(),
          email: $('#authEmail').value.trim(),
          password: $('#authPass').value
        })
      });
    } else {
      data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ name: $('#authName').value.trim(), password: $('#authPass').value })
      });
    }
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('ch_token', data.token);
    renderAuthArea();
    closeAuth();
    if (socket) socket.emit('auth', data.token);
    toast('Добро пожаловать, ' + data.user.name + '!');
    render();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
};

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  state.token = null; state.user = null;
  localStorage.removeItem('ch_token');
  renderAuthArea();
  location.hash = '#/';
  render();
}

/* ============================================================
   SOCKET.IO
   ============================================================ */
let socket = null;
const socketRooms = new Set();
let gameWatchId = null;

function sjoin(r) {
  if (!socketRooms.has(r)) { socketRooms.add(r); if (socket) socket.emit('room-join', r); }
}
function sleave(r) {
  if (socketRooms.has(r)) { socketRooms.delete(r); if (socket) socket.emit('room-leave', r); }
}
function leaveAllRooms() {
  for (const r of Array.from(socketRooms)) sleave(r);
  if (gameWatchId) { if (socket) socket.emit('unwatch-game'); gameWatchId = null; }
}

function initSocket() {
  socket = io();
  socket.on('connect', function () {
    if (state.token) socket.emit('auth', state.token);
    if (gameWatchId) socket.emit('watch-game', gameWatchId);
    for (const r of socketRooms) socket.emit('room-join', r);
  });
  socket.on('chat:msg', function (m) {
    for (const box of $$('.chat-msgs')) {
      if (box.dataset.chat !== m.room) continue;
      const empty = box.querySelector('.chat-empty');
      if (empty) empty.remove();
      box.insertAdjacentHTML('beforeend', chatMsgHTML(m));
      box.scrollTop = box.scrollHeight;
    }
  });
  socket.on('chat:error', function (e) { toast(e.message, 'err'); });
  socket.on('lobby:update', function () {
    const m = parseHash();
    if (m.page === 'lobby') refreshLobbyLists();
  });
  socket.on('arena:matched', function (d) {
    toast('Соперник найден!');
    location.hash = '#/game/' + d.gameId;
  });
  socket.on('tournament:update', function () {
    const m = parseHash();
    if (m.page === 'tournament' && m.arg) loadTournamentInto(m.arg);
  });
  socket.on('tournament:view', function (t) {
    const m = parseHash();
    if (m.page === 'tournament' && m.arg === t.id) paintTournament(t);
  });
  socket.on('game:update', function (g) {
    if (G && G.id === g.id) updateGameUI(g);
  });
}

/* ============================================================
   ЧАТ
   ============================================================ */
function chatMsgHTML(m) {
  return '<div class="chat-msg"><span class="chat-name" data-uid="' + esc(m.userId) + '">' +
    esc(m.name) + '</span><span class="chat-text">' + esc(m.text) + '</span></div>';
}
function chatHTML(room, heading) {
  return '<div class="chat-panel">' +
    '<div class="chat-head">' + esc(heading) + '</div>' +
    '<div class="chat-msgs" data-chat="' + esc(room) + '"></div>' +
    '<form class="chat-form" data-room="' + esc(room) + '">' +
    '<input class="chat-input" maxlength="300" placeholder="' + (state.user ? 'Сообщение…' : 'Войдите, чтобы писать') + '"' + (state.user ? '' : ' disabled') + '>' +
    '<button class="btn btn-primary chat-send" type="submit"' + (state.user ? '' : ' disabled') + '>➤</button>' +
    '</form></div>';
}
async function bindChats() {
  for (const box of $$('.chat-msgs')) {
    const room = box.dataset.chat;
    try {
      const msgs = await api('/api/chat?room=' + encodeURIComponent(room));
      box.innerHTML = msgs.map(chatMsgHTML).join('') || '<div class="chat-empty">Пока тихо. Напишите первым!</div>';
      box.scrollTop = box.scrollHeight;
    } catch (e) {
      box.innerHTML = '<div class="chat-empty">Чат недоступен</div>';
    }
  }
  $$('.chat-form').forEach(function (f) {
    f.onsubmit = function (e) {
      e.preventDefault();
      if (!state.user) return;
      const input = f.querySelector('.chat-input');
      const text = input.value.trim();
      if (!text) return;
      socket.emit('chat', { room: f.dataset.room, text });
      input.value = '';
    };
  });
}
document.addEventListener('click', function (e) {
  const n = e.target.closest('.chat-name');
  if (n && n.dataset.uid) location.hash = '#/profile/' + n.dataset.uid;
});

/* ============================================================
   РОУТЕР
   ============================================================ */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  return { page: parts[0] || '', arg: parts[1] || null };
}

async function render() {
  leaveAllRooms();
  selSq = null; G = null;
  const m = parseHash();
  $$('.nav-links a').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === m.page || (m.page === '' && a.dataset.nav === 'home')); });
  const view = $('#view');
  view.innerHTML = '<div class="loading">Загрузка…</div>';
  try {
    if (m.page === '' || m.page === 'home') await homeView(view);
    else if (m.page === 'lobby') await lobbyView(view);
    else if (m.page === 'tournaments') await tournamentsView(view);
    else if (m.page === 'tournament') await tournamentPage(view, m.arg);
    else if (m.page === 'game') await gamePage(view, m.arg);
    else if (m.page === 'rankings') await rankingsView(view);
    else if (m.page === 'profile') await profileView(view, m.arg);
    else if (m.page === 'tasks') tasksView(view);
    else if (m.page === 'learn') learnView(view);
    else await homeView(view);
  } catch (e) {
    view.innerHTML = '<section class="block"><div class="panel page-error"><h2>Ой</h2><p>' + esc(e.message) + '</p><a class="btn btn-primary" href="#/">На главную</a></div></section>';
  }
}

/* ============================================================
   ГЛАВНАЯ
   ============================================================ */
async function homeView(view) {
  view.innerHTML =
    '<section class="hero">' +
    '<div class="hero-text">' +
    '<h1>Играй в шахматы<br>с <em>кем угодно</em><br>в любое время</h1>' +
    '<p>Онлайн-платформа с рейтинговыми партиями, швейцарскими турнирами, задачами и живым чатом. Учись, играй и расти вместе с сообществом.</p>' +
    '<div class="hero-actions">' +
    '<button class="btn btn-primary btn-lg" id="playBtn">Играть сейчас</button>' +
    '<a class="btn btn-ghost btn-lg" href="#/tournaments">Смотреть турниры</a>' +
    '</div>' +
    '<div class="hero-stats">' +
    '<div class="stat"><b id="statOnline">…</b><span>игроков онлайн</span></div>' +
    '<div class="stat"><b id="statGames">…</b><span>партий сегодня</span></div>' +
    '<div class="stat"><b id="statPlayers">…</b><span>зарегистрировано</span></div>' +
    '</div></div>' +
    '<div class="board-wrap" id="demoBoard"></div>' +
    '</section>' +
    '<section class="block"><div class="block-head"><div><h2>Выбери режим</h2><p>От пули до классики — играй так, как удобно</p></div></div>' +
    '<div class="cards">' +
    '<div class="card" data-go="#/lobby"><div class="icon">⚡</div><h3>Блиц и пуля</h3><p>Быстрые партии для разогрева и тренировки тактики.</p></div>' +
    '<div class="card" data-go="#/lobby"><div class="icon">⏱️</div><h3>Рапид</h3><p>Баланс скорости и вдумчивой игры. Самый популярный режим.</p></div>' +
    '<div class="card" data-go="#/tournaments"><div class="icon">🏆</div><h3>Турниры</h3><p>Швейцарская система, таблица очков и кубки победителям.</p></div>' +
    '<div class="card" data-go="#/tasks"><div class="icon">🎯</div><h3>Задачи</h3><p>Найди мат в один ход и прокачай tactical vision.</p></div>' +
    '</div></section>' +
    '<section class="block"><div class="block-head"><div><h2>Топ игроков</h2><p>Рейтинг Эло формируется по результатам партий</p></div><a class="btn btn-ghost" href="#/rankings">Вся таблица →</a></div>' +
    '<div class="players" id="playersList"></div></section>' +
    '<section class="cta"><div class="cta-inner"><div><h2>Готов сыграть первую партию?</h2><p>Регистрация занимает 30 секунд. Без рекламы и ограничений.</p></div><button class="btn btn-primary btn-lg" id="ctaSignup">Создать аккаунт</button></div></section>';

  renderBoard($('#demoBoard'), START_FEN, {});
  $('#playBtn').onclick = function () { location.hash = '#/lobby'; };
  $('#ctaSignup').onclick = function () { openAuth(state.user ? 'login' : 'signup'); if (state.user) toast('Вы уже вошли'); };
  $$('[data-go]', view).forEach(function (c) { c.onclick = function () { location.hash = c.dataset.go; }; });

  try {
    const st = await api('/api/stats');
    $('#statOnline').textContent = st.online;
    $('#statGames').textContent = st.gamesToday;
    $('#statPlayers').textContent = st.totalPlayers;
  } catch (e) {}
  try {
    const players = await api('/api/players?limit=8');
    const list = $('#playersList');
    list.innerHTML = players.length ? players.map(function (p, i) {
      return '<a class="player" href="#/profile/' + p.id + '">' + avatarHTML(p.name) +
        '<div class="info"><b>' + esc(p.name) + '</b><span>' + (i < 3 ? MEDALS[i] + ' ' : '') + 'Рейтинг</span></div>' +
        '<div class="rating">' + p.rating + '</div></a>';
    }).join('') : '<div class="players-empty">Пока нет игроков в рейтинге.<br>Сыграй первую партию — и окажешься здесь!</div>';
  } catch (e) {}
}

/* ============================================================
   ЛОББИ (чат убран)
   ============================================================ */
function tcPickerHTML(id, active) {
  const tcs = Object.keys(TC_LABELS);
  return '<div class="tc-picker" id="' + id + '">' + tcs.map(function (tc) {
    return '<button type="button" class="tc-chip' + (tc === (active || '10+5') ? ' active' : '') + '" data-tc="' + tc + '">' + TC_LABELS[tc] + '</button>';
  }).join('') + '</div>';
}
function bindTcPicker(id) {
  const box = $('#' + id);
  box.addEventListener('click', function (e) {
    const chip = e.target.closest('.tc-chip');
    if (!chip) return;
    $$('.tc-chip', box).forEach(function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
  });
}
function tcOf(id) {
  const chip = $('#' + id + ' .tc-chip.active');
  return chip ? chip.dataset.tc : '10+5';
}

async function lobbyView(view) {
  sjoin('lobby');
  view.innerHTML =
    '<section class="block">' +
    '<div class="page-head"><div><h1>Играть</h1><p>Создайте вызов, займите очередь в арене или присоединитесь к открытой партии</p></div></div>' +
    '<div class="lobby-grid">' +
    '<div class="lobby-main">' +
    '<div class="panel"><h2>Создать вызов</h2>' +
    tcPickerHTML('tcPicker', '10+5') +
    '<div class="color-picker" id="colorPicker">' +
    '<button type="button" class="color-chip active" data-color="random">🎲 Случайно</button>' +
    '<button type="button" class="color-chip" data-color="white">♔ Белыми</button>' +
    '<button type="button" class="color-chip" data-color="black">♚ Чёрными</button>' +
    '</div>' +
    '<button class="btn btn-primary btn-lg btn-block" id="createChallenge">Создать вызов</button></div>' +
    '<div class="panel"><h2>Арена — быстрый подбор</h2><p class="sub">Как только найдётся второй игрок, сервер сам создаст партию</p>' +
    tcPickerHTML('arenaTcPicker', '3+2') +
    '<button class="btn btn-accent btn-lg btn-block" id="arenaBtn">Найти соперника</button>' +
    '<div class="arena-status" id="arenaStatus"></div></div>' +
    '<div class="panel"><h2>Открытые вызовы</h2><div id="openList"><div class="empty-note">Загрузка…</div></div></div>' +
    '<div class="panel"><h2>Идут сейчас</h2><div id="liveList"><div class="empty-note">Загрузка…</div></div></div>' +
    '</div>' +
    '</div></section>';

  bindTcPicker('tcPicker');
  bindTcPicker('arenaTcPicker');
  $('#colorPicker').addEventListener('click', function (e) {
    const chip = e.target.closest('.color-chip');
    if (!chip) return;
    $$('.color-chip', this).forEach(function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
  });
  $('#createChallenge').onclick = async function () {
    try {
      if (!state.user) return openAuth('signup');
      const color = $('#colorPicker .color-chip.active').dataset.color;
      const r = await api('/api/challenges', { method: 'POST', body: JSON.stringify({ tc: tcOf('tcPicker'), color }) });
      location.hash = '#/game/' + r.id;
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#arenaBtn').onclick = async function () {
    try {
      if (!state.user) return openAuth('signup');
      const r = await api('/api/arena/join', { method: 'POST', body: JSON.stringify({ tc: tcOf('arenaTcPicker') }) });
      if (r.matched) location.hash = '#/game/' + r.gameId;
      else paintArenaWaiting();
    } catch (e) { toast(e.message, 'err'); }
  };
  await refreshLobbyLists();
}

function paintArenaWaiting() {
  const box = $('#arenaStatus');
  if (!box) return;
  box.innerHTML = '<span class="pulse">⏳ В очереди…</span> <button class="btn btn-ghost btn-sm" id="arenaLeave">Отменить</button>';
  $('#arenaLeave').onclick = async function () {
    try { await api('/api/arena/leave', { method: 'POST' }); } catch (e) {}
    box.innerHTML = '';
  };
}

async function refreshLobbyLists() {
  let data;
  try { data = await api('/api/lobby'); } catch (e) { return; }
  const openBox = $('#openList'), liveBox = $('#liveList');
  if (!openBox || !liveBox) return;
  openBox.innerHTML = data.open.length ? data.open.map(function (c) {
    const mine = state.user && c.host && c.host.id === state.user.id;
    return '<div class="row-item">' + avatarHTML(c.host && c.host.name) +
      '<div class="info"><b>' + esc(c.host ? c.host.name : '?') + '</b><span>' + TC_LABELS[c.tcKey] + ' · ' +
      (c.side === 'w' ? 'играет белыми' : 'играет чёрными') + '</span></div>' +
      (mine
        ? '<button class="btn btn-ghost btn-sm abort-btn" data-id="' + c.id + '">Отменить</button>'
        : '<button class="btn btn-primary btn-sm join-btn" data-id="' + c.id + '">Принять</button>') +
      '</div>';
  }).join('') : '<div class="empty-note">Пока нет открытых вызовов — создайте первый!</div>';

  liveBox.innerHTML = data.live.length ? data.live.map(function (g) {
    return '<a class="row-item" href="#/game/' + g.id + '">' +
      '<div class="info"><b>' + esc(g.white ? g.white.name : '?') + ' vs ' + esc(g.black ? g.black.name : '?') + '</b>' +
      '<span>' + TC_LABELS[g.tcKey] + ' · ходов: ' + g.ply + '</span></div>' +
      '<span class="watch-link">Смотреть →</span></a>';
  }).join('') : '<div class="empty-note">Сейчас никто не играет. Будьте первыми!</div>';

  $$('.join-btn').forEach(function (b) {
    b.onclick = async function () {
      try {
        if (!state.user) return openAuth('signup');
        const r = await api('/api/games/' + b.dataset.id + '/join', { method: 'POST' });
        location.hash = '#/game/' + r.id;
      } catch (e) { toast(e.message, 'err'); }
    };
  });
  $$('.abort-btn').forEach(function (b) {
    b.onclick = async function () {
      try { await api('/api/games/' + b.dataset.id + '/abort', { method: 'POST' }); } catch (e) { toast(e.message, 'err'); }
    };
  });
}

/* ============================================================
   ТУРНИРЫ: СПИСОК
   ============================================================ */
async function tournamentsView(view) {
  sjoin('lobby');
  view.innerHTML =
    '<section class="block">' +
    '<div class="page-head"><div><h1>Турниры</h1><p>Швейцарская система: каждый играет с каждым по разу, пары формируются по очкам</p></div>' +
    '<button class="btn btn-primary" id="newTourBtn">+ Создать турнир</button></div>' +
    '<div class="panel hidden" id="tourCreateForm">' +
    '<label class="field">Название<input id="tourName" maxlength="40" placeholder="Вечерний блиц-турнир"></label>' +
    tcPickerHTML('tourTcPicker', '5+0') +
    '<button class="btn btn-primary" id="tourCreateBtn">Создать</button></div>' +
    '<div id="toursList"><div class="empty-note">Загрузка…</div></div>' +
    '</section>';
  bindTcPicker('tourTcPicker');
  $('#newTourBtn').onclick = function () {
    if (!state.user) return openAuth('signup');
    $('#tourCreateForm').classList.toggle('hidden');
  };
  $('#tourCreateBtn').onclick = async function () {
    try {
      const r = await api('/api/tournaments', {
        method: 'POST',
        body: JSON.stringify({ name: $('#tourName').value.trim(), tc: tcOf('tourTcPicker') })
      });
      location.hash = '#/tournament/' + r.id;
    } catch (e) { toast(e.message, 'err'); }
  };
  await refreshTournaments();
}

async function refreshTournaments() {
  let data;
  try { data = await api('/api/tournaments'); } catch (e) { return; }
  const box = $('#toursList');
  if (!box) return;
  box.innerHTML = data.items.length ? data.items.map(function (t) {
    const statusLabel = { open: 'Регистрация открыта', running: 'Идёт · раунд ' + t.round + '/' + t.totalRounds, finished: 'Завершён' }[t.status];
    const actions = [];
    if (!t.joined && t.status === 'open') actions.push('<button class="btn btn-primary btn-sm join-tour" data-id="' + t.id + '">Вступить</button>');
    actions.push('<a class="btn btn-ghost btn-sm" href="#/tournament/' + t.id + '">Открыть</a>');
    return '<a class="tour-card" href="#/tournament/' + t.id + '">' +
      '<div class="tour-card-head"><b>' + esc(t.name) + '</b>' +
      '<span class="badge ' + t.status + '">' + statusLabel + '</span></div>' +
      '<div class="tour-card-meta"><span>⏱ ' + TC_LABELS[t.tcKey] + '</span><span>👥 ' + t.playersCount + ' участников</span><span>' + fmtDate(t.createdAt) + '</span></div>' +
      '<div class="tour-card-actions">' + actions.join('') + '</div></a>';
  }).join('') : '<div class="empty-note">Турниров пока нет. Создайте первый — и пригласите друзей!</div>';

  $$('.join-tour', box).forEach(function (b) {
    b.onclick = async function (e) {
      e.preventDefault();
      if (!state.user) return openAuth('signup');
      try { await api('/api/tournaments/' + b.dataset.id + '/join', { method: 'POST' }); toast('Вы в турнире!'); }
      catch (ex) { toast(ex.message, 'err'); }
    };
  });
}

/* ============================================================
   ТУРНИР: СТРАНИЦА
   ============================================================ */
async function tournamentPage(view, id) {
  sjoin('t:' + id);
  view.innerHTML =
    '<section class="block">' +
    '<div class="tour-layout">' +
    '<aside class="tour-chat">' + chatHTML('t:' + id, 'Чат турнира') + '</aside>' +
    '<div class="tour-main" id="tourContent"><div class="loading">Загрузка…</div></div>' +
    '</div></section>';
  await loadTournamentInto(id);
  await bindChats();
}

async function loadTournamentInto(id) {
  let t;
  try { t = await api('/api/tournaments/' + id); }
  catch (e) {
    const box = $('#tourContent');
    if (box) box.innerHTML = '<div class="panel page-error"><h2>Турнир не найден</h2><p>' + esc(e.message) + '</p></div>';
    return;
  }
  paintTournament(t);
}

function statusBadge(t) {
  if (t.status === 'open') return '<span class="badge open">Регистрация открыта</span>';
  if (t.status === 'running') return '<span class="badge running">Идёт · раунд ' + t.round + ' из ' + t.totalRounds + '</span>';
  return '<span class="badge finished">Завершён' + (t.finishedAt ? ' · ' + fmtDate(t.finishedAt) : '') + '</span>';
}

function podiumHTML(t) {
  if (!t.podium || !t.podium.length) return '';
  const cards = { gold: '', silver: '', bronze: '' };
  t.podium.forEach(function (p) {
    cards[p.cup] =
      '<div class="podium-card ' + p.cup + '">' +
      '<div class="podium-medal">' + MEDALS[t.podium.indexOf(p)] + '</div>' +
      '<div class="podium-name">' + esc(p.name) + '</div>' +
      '<div class="podium-rating">' + p.rating + '</div>' +
      '<div class="podium-stats">' +
      '<span><b>' + p.points + '</b> очк.</span>' +
      '<span><b>' + p.winPct + '%</b> побед</span>' +
      '<span><b>' + p.perf + '</b> перформанс</span>' +
      '</div>' +
      '<a class="btn btn-ghost btn-sm" href="#/profile/' + p.id + '">Профиль</a>' +
      '</div>';
  });
  return '<div class="podium-wrap"><h2>🏆 Итоги турнира</h2>' +
    '<div class="podium">' +
    (cards.silver || '<div class="podium-card empty"></div>') +
    (cards.gold || '') +
    (cards.bronze || '<div class="podium-card empty"></div>') +
    '</div></div>';
}

function paintTournament(t) {
  const box = $('#tourContent');
  if (!box) return;
  let actions = '';
  if (t.status === 'open') {
    if (t.isCreator) {
      actions = '<button class="btn btn-primary" id="tourStartBtn"' + (t.playersCount < 2 ? ' disabled' : '') + '>▶ Стартовать</button>';
    } else if (t.joined) {
      actions = '<button class="btn btn-ghost" id="tourLeaveBtn">Покинуть</button>';
    } else {
      actions = '<button class="btn btn-primary" id="tourJoinBtn">Вступить в турнир</button>';
    }
  }
  let html =
    '<div class="tour-head">' +
    '<div><h1>' + esc(t.name) + '</h1>' +
    '<div class="tour-meta"><span class="badge tc">' + TC_LABELS[t.tcKey] + '</span>' + statusBadge(t) +
    '<span class="sub">Организатор: <a class="link" href="#/profile/' + esc(t.createdBy) + '">' + esc(t.creatorName) + '</a></span></div></div>' +
    '<div class="tour-actions">' + actions +
    '<button class="btn btn-ghost" id="copyTourLink">🔗 Ссылка</button></div>' +
    '</div>';

  if (t.status === 'finished') html += podiumHTML(t);

  html += '<div class="panel"><h2>Участники и таблица</h2>';
  html += '<table class="table"><thead><tr><th>#</th><th>Игрок</th><th>Очки</th><th>Бухгольц</th><th>В</th><th>Н</th><th>П</th></tr></thead><tbody>';
  html += t.standings.map(function (p) {
    return '<tr class="' + (p.place <= 3 ? 'top-row' : '') + '">' +
      '<td>' + (p.place <= 3 ? MEDALS[p.place - 1] : p.place) + '</td>' +
      '<td><a class="link" href="#/profile/' + esc(p.id) + '">' + esc(p.name) + '</a> <span class="sub">(' + p.rating + ')</span></td>' +
      '<td><b>' + p.score + '</b></td><td>' + p.buchholz + '</td><td>' + p.wins + '</td><td>' + p.draws + '</td><td>' + p.losses + '</td></tr>';
  }).join('');
  html += '</tbody></table></div>';

  if (t.status !== 'open') {
    html += '<div class="panel"><h2>Партии турнира</h2>';
    html += t.rounds.map(function (round, i) {
      return '<div class="round-box"><h3>Раунд ' + (i + 1) + '</h3>' +
        round.map(function (r) {
          if (r.bye) return '<div class="game-row bye">💤 ' + esc(r.name) + ' — свободный ход (+1 очко)</div>';
          const res = r.result === 'white' ? '1–0' : r.result === 'black' ? '0–1' : r.result === 'draw' ? '½–½' : '•••';
          return '<div class="game-row">' +
            '<span class="gr-players"><a class="link" href="#/profile/' + esc(r.white.id) + '">' + esc(r.white.name) + '</a>' +
            ' <b class="gr-score">' + res + '</b> <a class="link" href="#/profile/' + esc(r.black.id) + '">' + esc(r.black.name) + '</a></span>' +
            '<span class="gr-info">' + reasonText(r.reason) + '</span>' +
            '<a class="btn btn-ghost btn-sm" href="#/game/' + esc(r.id) + '">Смотреть</a></div>';
        }).join('') + '</div>';
    }).join('');
    html += '</div>';
  } else {
    html += '<div class="panel"><h2>Как это будет работать</h2><p class="sub">После старта игроки разбиваются на пары по очкам каждый раунд. Победитель определится по сумме очков.</p></div>';
  }

  box.innerHTML = html;

  const jb = $('#tourJoinBtn');
  if (jb) jb.onclick = async function () {
    if (!state.user) return openAuth('signup');
    try { await api('/api/tournaments/' + t.id + '/join', { method: 'POST' }); toast('Вы в турнире!'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const lb = $('#tourLeaveBtn');
  if (lb) lb.onclick = async function () {
    try { await api('/api/tournaments/' + t.id + '/leave', { method: 'POST' }); }
    catch (e) { toast(e.message, 'err'); }
  };
  const sb = $('#tourStartBtn');
  if (sb) sb.onclick = async function () {
    try { await api('/api/tournaments/' + t.id + '/start', { method: 'POST' }); toast('Турнир начался!'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const cb = $('#copyTourLink');
  if (cb) cb.onclick = function () {
    const url = location.origin + '/#/tournament/' + t.id;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Ссылка скопирована!'); });
    else toast(url);
  };
}

/* ============================================================
   ПАРТИЯ (чат слева, доска справа)
   ============================================================ */
let G = null;
let selSq = null;
let promoCallback = null;

function myColor() {
  if (!state.user || !G) return null;
  if (G.white && G.white.id === state.user.id) return 'w';
  if (G.black && G.black.id === state.user.id) return 'b';
  return null;
}

async function gamePage(view, id) {
  try { G = await api('/api/games/' + id); }
  catch (e) {
    view.innerHTML = '<section class="block"><div class="panel page-error"><h2>Партия не найдена</h2><p>' + esc(e.message) + '</p></div></section>';
    return;
  }
  gameWatchId = id;
  socket.emit('watch-game', id);
  sjoin('g:' + id);

  view.innerHTML =
    '<section class="block game-block">' +
    '<div class="game-layout">' +
    '<div class="game-side">' +
    chatHTML('g:' + id, 'Чат партии') +
    '<div class="panel moves-panel"><h3>Ходы</h3><div class="move-list" id="moveList"></div></div>' +
    '</div>' +
    '<div class="game-board-col">' +
    '<div class="gplayer" id="topPlayer"></div>' +
    '<div class="board-wrap game-board" id="gBoard"></div>' +
    '<div class="gplayer" id="bottomPlayer"></div>' +
    '<div class="game-actions" id="gameActions"></div>' +
    '</div>' +
    '</div></section>';

  bindGameButtons();
  bindChats();
  updateGameUI(G);
}

function bindGameButtons() {
  const acts = $('#gameActions');
  if (!acts) return;
  acts.addEventListener('click', async function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'resignBtn') {
      if (!confirm('Точно сдаться?')) return;
      try { await api('/api/games/' + G.id + '/resign', { method: 'POST' }); } catch (ex) { toast(ex.message, 'err'); }
    } else if (btn.id === 'drawBtn') {
      try { await api('/api/games/' + G.id + '/draw', { method: 'POST', body: JSON.stringify({ action: 'offer' }) }); toast('Предложение ничьей отправлено'); }
      catch (ex) { toast(ex.message, 'err'); }
    } else if (btn.id === 'drawAccept') {
      try { await api('/api/games/' + G.id + '/draw', { method: 'POST', body: JSON.stringify({ action: 'accept' }) }); }
      catch (ex) { toast(ex.message, 'err'); }
    } else if (btn.id === 'drawDecline') {
      try { await api('/api/games/' + G.id + '/draw', { method: 'POST', body: JSON.stringify({ action: 'decline' }) }); }
      catch (ex) { toast(ex.message, 'err'); }
    } else if (btn.id === 'copyGameLink') {
      const url = location.origin + '/#/game/' + G.id;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Ссылка скопирована!'); });
      else toast(url);
    }
  });
}

function gplayerHTML(u, side, active) {
  if (!u) return '<div class="gplayer-inner"><div class="info"><b>Ожидание соперника…</b></div></div>';
  return '<div class="gplayer-inner">' + avatarHTML(u.name) +
    '<div class="info"><b>' + esc(u.name) + '</b><span>' + u.rating + '</span></div>' +
    '<div class="clock' + (active ? ' active' : '') + '" id="clock' + side + '">--:--</div></div>';
}

function updateGameUI(g) {
  G = g;
  G._syncAt = Date.now();
  const color = myColor();
  const flip = color === 'b';
  const me = color === 'w' ? g.white : color === 'b' ? g.black : null;

  const top = $('#topPlayer'), bottom = $('#bottomPlayer');
  if (top && bottom) {
    const turnActiveW = g.status === 'playing' && g.turn === 'w';
    const turnActiveB = g.status === 'playing' && g.turn === 'b';
    top.innerHTML = gplayerHTML(flip ? g.white : g.black, flip ? 'W' : 'B', flip ? turnActiveW : turnActiveB);
    bottom.innerHTML = gplayerHTML(flip ? g.black : g.white, flip ? 'B' : 'W', flip ? turnActiveB : turnActiveW);
    bottom.insertAdjacentHTML('beforeend', me ? '' : '<span class="spec-tag">зритель</span>');
  }

  const boardBox = $('#gBoard');
  if (boardBox) {
    const legal = (color && g.turn === color && g.status === 'playing') ? (g.legalMoves || []) : [];
    const targets = selSq ? legal.filter(function (m) { return m.from === selSq; }).map(function (m) { return m.to; }) : [];
    renderBoard(boardBox, g.fen, {
      lastMove: g.lastMove, sel: selSq, targets,
      flip: flip, checkSq: g.inCheck ? kingSquare(g.fen, g.turn) : null,
      onSquare: gameSquareClick
    });
  }

  const acts = $('#gameActions');
  if (acts) {
    let inner = '';
    if (g.status === 'waiting') {
      inner = '<span class="game-status">Ждём соперника. Пригласите друга:</span>' +
        '<button class="btn btn-ghost btn-sm" id="copyGameLink">🔗 Скопировать ссылку</button>';
    } else if (g.status === 'finished') {
      const res = g.result === 'white' ? 'Победа белых' : g.result === 'black' ? 'Победа чёрных' : 'Ничья';
      inner = '<span class="game-status finished">' + res + ' · ' + reasonText(g.reason) + '</span>' +
        '<a class="btn btn-primary btn-sm" href="#/lobby">В лобби</a>';
    } else if (color) {
      const turnText = g.turn === color ? (g.inCheck ? 'Ваш ход — шах!' : 'Ваш ход') : 'Ход соперника';
      inner = '<span class="game-status">' + turnText + '</span>';
      if (g.drawOffer) {
        inner += '<button class="btn btn-accent btn-sm" id="drawAccept">Принять ничью</button>' +
          '<button class="btn btn-ghost btn-sm" id="drawDecline">Отклонить</button>';
      } else if (g.iOffered) {
        inner += '<span class="sub">Ничья предложена — ждём ответ…</span>';
      } else {
        inner += '<button class="btn btn-ghost btn-sm" id="drawBtn">½ Предложить ничью</button>' +
          '<button class="btn btn-danger btn-sm" id="resignBtn">Сдаться</button>';
      }
    } else {
      inner = '<span class="game-status">Вы наблюдаете за партией</span>';
    }
    acts.innerHTML = inner;
  }

  const ml = $('#moveList');
  if (ml) {
    const moves = g.moves || [];
    let html = '';
    for (let i = 0; i < moves.length; i += 2) {
      html += '<div class="mv"><span class="mv-num">' + (i / 2 + 1) + '.</span>' +
        '<span>' + esc(moves[i] || '') + '</span>' +
        '<span>' + esc(moves[i + 1] || '') + '</span></div>';
    }
    ml.innerHTML = html || '<div class="empty-note">Партия ещё не начата</div>';
    ml.scrollTop = ml.scrollHeight;
  }
}

function gameSquareClick(key) {
  if (!G || G.status !== 'playing') return;
  const color = myColor();
  if (!color || G.turn !== color) return;
  const legal = G.legalMoves || [];
  if (selSq) {
    const cands = legal.filter(function (m) { return m.from === selSq && m.to === key; });
    if (cands.length) {
      const needsPromo = cands.some(function (m) { return m.promotion; });
      if (needsPromo) openPromo(function (p) { doMove(selSq, key, p); });
      else doMove(selSq, key);
      selSq = null;
      return;
    }
  }
  const p = pieceAt(G.fen, key);
  const isMine = p && ((color === 'w' && p === p.toUpperCase()) || (color === 'b' && p === p.toLowerCase()));
  selSq = isMine ? key : null;
  updateGameUI(G);
}

async function doMove(from, to, promotion) {
  try {
    await api('/api/games/' + G.id + '/move', {
      method: 'POST',
      body: JSON.stringify({ from, to, promotion: promotion || undefined })
    });
    refreshGame();
  } catch (e) { toast(e.message, 'err'); selSq = null; }
}
async function refreshGame() {
  try { const g = await api('/api/games/' + G.id); updateGameUI(g); } catch (e) {}
}

function openPromo(cb) {
  promoCallback = cb;
  const overlay = $('#promoOverlay');
  const box = $('#promoChoices');
  box.innerHTML = '';
  ['q','r','b','n'].forEach(function (k) {
    const key = (myColor() === 'w' ? 'w' : 'b') + k.toUpperCase();
    const b = document.createElement('button');
    b.className = 'promo-piece';
    b.innerHTML = '<img src="' + PIECE_URL[key] + '" alt="">';
    b.onclick = function () { overlay.classList.add('hidden'); if (promoCallback) promoCallback(k); };
    box.appendChild(b);
  });
  overlay.classList.remove('hidden');
}

setInterval(function () {
  if (!G || G.status !== 'playing') return;
  const elapsed = Date.now() - (G._syncAt || Date.now());
  const cw = $('#clockW'), cb = $('#clockB');
  if (!cw || !cb) return;
  const wv = G.turn === 'w' ? Math.max(0, G.wMs - elapsed) : G.wMs;
  const bv = G.turn === 'b' ? Math.max(0, G.bMs - elapsed) : G.bMs;
  cw.textContent = fmtClock(wv);
  cb.textContent = fmtClock(bv);
  cw.classList.toggle('low', wv < 30000);
  cb.classList.toggle('low', bv < 30000);
}, 300);

/* ============================================================
   РЕЙТИНГИ И ПРОФИЛИ
   ============================================================ */
async function rankingsView(view) {
  view.innerHTML =
    '<section class="block">' +
    '<div class="page-head"><div><h1>Рейтинги</h1><p>Эло, K=24. Топ-3 получают кубок в профиле</p></div></div>' +
    '<div class="panel"><div id="rankTable"><div class="empty-note">Загрузка…</div></div></div>' +
    '</section>';
  try {
    const players = await api('/api/players?limit=500');
    $('#rankTable').innerHTML = players.length ? '<table class="table"><thead><tr><th>#</th><th>Игрок</th><th>Рейтинг</th><th>Победы</th><th>Поражения</th><th>Ничьи</th><th>Кубки турниров</th></tr></thead><tbody>' +
      players.map(function (p, i) {
        return '<tr class="' + (i < 3 ? 'top-row' : '') + '">' +
          '<td>' + (i < 3 ? MEDALS[i] : i + 1) + '</td>' +
          '<td><a class="link" href="#/profile/' + p.id + '">' + esc(p.name) + '</a></td>' +
          '<td><b class="rank-rating">' + p.rating + '</b></td>' +
          '<td>' + p.wins + '</td><td>' + p.losses + '</td><td>' + p.draws + '</td>' +
          '<td>' + (p.tournamentsWon ? '🏆 ×' + p.tournamentsWon : '—') + '</td></tr>';
      }).join('') + '</tbody></table>'
      : '<div class="empty-note">Пока нет зарегистрированных игроков.</div>';
  } catch (e) {
    $('#rankTable').innerHTML = '<div class="empty-note">' + esc(e.message) + '</div>';
  }
}

async function profileView(view, id) {
  let u, games, all;
  try {
    u = await api('/api/users/' + id);
    games = await api('/api/history/' + id);
    all = await api('/api/players?limit=500');
  } catch (e) {
    view.innerHTML = '<section class="block"><div class="panel page-error"><h2>Профиль не найден</h2><p>' + esc(e.message) + '</p></div></section>';
    return;
  }
  const rank = all.findIndex(function (p) { return p.id === id; });
  const cup = rank >= 0 && rank < 3 ? '<span class="medal-big">' + MEDALS[rank] + '</span>' : '';
  const total = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
  view.innerHTML =
    '<section class="block">' +
    '<div class="profile-head panel">' +
    avatarHTML(u.name, 'xl') +
    '<div class="profile-title"><h1>' + esc(u.name) + ' ' + cup + '</h1>' +
    '<p class="sub">На ChessHub с ' + fmtDate(u.createdAt) + '</p></div>' +
    '<div class="profile-rating"><b>' + u.rating + '</b><span>рейтинг Эло</span></div>' +
    '</div>' +
    '<div class="stat-grid">' +
    '<div class="panel stat-card"><b>' + (u.wins || 0) + '</b><span>побед</span></div>' +
    '<div class="panel stat-card"><b>' + (u.draws || 0) + '</b><span>ничьих</span></div>' +
    '<div class="panel stat-card"><b>' + (u.losses || 0) + '</b><span>поражений</span></div>' +
    '<div class="panel stat-card"><b>' + (total ? Math.round(100 * u.wins / total) : 0) + '%</b><span>винрейт</span></div>' +
    '<div class="panel stat-card trophy"><b>🏆 ' + (u.tournamentsWon || 0) + '</b><span>побед в турнирах</span></div>' +
    '</div>' +
    '<div class="panel"><h2>Последние партии</h2>' +
    (games.length ? games.map(function (h) {
      const mine = h.white && h.white.id === id;
      const res = h.result === 'draw' ? 'draw' : (h.result === 'white') === mine ? 'win' : 'loss';
      const opp = mine ? h.black : h.white;
      return '<a class="row-item" href="#/game/' + esc(h.id) + '">' +
        '<span class="res-dot ' + res + '"></span>' +
        '<div class="info"><b>' + esc(opp ? opp.name : '?') + '</b><span>' + TC_LABELS[h.tcKey] + ' · ' + fmtDate(h.endedAt) + ' · ' + reasonText(h.reason) + '</span></div>' +
        resultBadge(h.result) + '</a>';
    }).join('') : '<div class="empty-note">Партий пока нет</div>') +
    '</div></section>';
}

/* ============================================================
   ЗАДАЧИ
   ============================================================ */
const PUZZLES = [
  { title: 'Мат в 1: ферзь', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', solution: [{ from: 'f3', to: 'f7' }], hint: 'Классический «учебный мат».' },
  { title: 'Мат в 1: ладья на последней горизонтали', fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', solution: [{ from: 'a1', to: 'a8' }], hint: 'Король заперт своими пешками.' },
  { title: 'Мат в 1: ладья по краю', fen: '7k/6pp/8/8/8/8/6PP/R5K1 w - - 0 1', solution: [{ from: 'a1', to: 'a8' }], hint: 'Поставьте ладью на 8-ю.' },
  { title: 'Мат в 1: две ладьи', fen: '7k/R7/8/8/8/8/8/1R5K w - - 0 1', solution: [{ from: 'b1', to: 'b8' }], hint: 'Одна уже держит 7-ю.' },
  { title: 'Мат в 1: с далёкой вертикали', fen: '6k1/6pp/8/8/8/8/8/K2R4 w - - 0 1', solution: [{ from: 'd1', to: 'd8' }], hint: 'Ладья входит на 8-ю.' }
];

function tasksView(view) {
  view.innerHTML =
    '<section class="block">' +
    '<div class="page-head"><div><h1>Задачи</h1><p>Найдите мат в один ход.</p></div></div>' +
    '<div class="puzzle-wrap" id="puzzleWrap"></div></section>';
  renderPuzzle(0);
}

function renderPuzzle(idx) {
  const wrap = $('#puzzleWrap');
  if (!wrap) return;
  if (idx >= PUZZLES.length) {
    wrap.innerHTML = '<div class="panel success-panel"><h2>🎉 Все задачи решены!</h2><p class="sub">Загляните в лобби.</p><a class="btn btn-primary" href="#/lobby">Играть</a></div>';
    return;
  }
  const pz = PUZZLES[idx];
  wrap.innerHTML =
    '<div class="panel puzzle-panel">' +
    '<div class="puzzle-head"><h2>Задача ' + (idx + 1) + ' из ' + PUZZLES.length + ': ' + esc(pz.title) + '</h2>' +
    '<span class="sub">белые ставят мат в 1 ход</span></div>' +
    '<div class="puzzle-body">' +
    '<div class="board-wrap puzzle-board" id="pzBoard"></div>' +
    '<div class="puzzle-side">' +
    '<div class="puzzle-msg" id="pzMsg">Ход белых. Найдите мат!</div>' +
    '<button class="btn btn-ghost" id="pzHint">💡 Подсказка</button>' +
    '<button class="btn btn-ghost btn-sm" id="pzReset">↺ Заново</button>' +
    '</div></div></div>';

  let sel = null, solved = false;
  function draw() {
    renderBoard($('#pzBoard'), pz.fen, { sel, onSquare });
  }
  function onSquare(key) {
    if (solved) return;
    if (sel) {
      const ok = pz.solution.some(function (m) { return m.from === sel && m.to === key; });
      if (ok) {
        solved = true;
        $('#pzMsg').innerHTML = '<b class="ok">✅ Верно!</b>';
        $('#pzMsg').insertAdjacentHTML('beforeend', '<div class="pz-next"><button class="btn btn-primary" id="pzNext">Следующая →</button></div>');
        $('#pzNext').onclick = function () { renderPuzzle(idx + 1); };
        sel = null; draw();
        return;
      }
      $('#pzMsg').innerHTML = '<b class="bad">❌ Не мат. Попробуйте ещё!</b>';
    }
    const p = pieceAt(pz.fen, key);
    sel = (p && p === p.toUpperCase()) ? key : null;
    draw();
  }
  $('#pzHint').onclick = function () { $('#pzMsg').textContent = pz.hint; };
  $('#pzReset').onclick = function () { renderPuzzle(idx); };
  draw();
}

/* ============================================================
   ОБУЧЕНИЕ
   ============================================================ */
function learnView(view) {
  view.innerHTML =
    '<section class="block">' +
    '<div class="page-head"><div><h1>Обучение</h1><p>Короткие уроки.</p></div></div>' +
    '<div class="cards">' +
    '<div class="card static"><div class="icon">♟️</div><h3>Ценность фигур</h3><p>Пешка — 1, конь и слон — 3, ладья — 5, ферзь — 9.</p></div>' +
    '<div class="card static"><div class="icon">🎯</div><h3>Тактика: вилка</h3><p>Конь на d5 часто атакует короля и ферзя одновременно.</p></div>' +
    '<div class="card static"><div class="icon">🛡️</div><h3>Безопасность короля</h3><p>Рокировка в первые 10 ходов — лучший щит.</p></div>' +
    '<div class="card static"><div class="icon">👣</div><h3>Развитие</h3><p>В дебюте выводите коней и слонов, занимайте центр.</p></div>' +
    '<div class="card static"><div class="icon">👑</div><h3>Эндшпиль</h3><p>Король — боевая фигура: в эндшпиле ведите его в центр.</p></div>' +
    '<div class="card static"><div class="icon">⏱️</div><h3>Время</h3><p>Не тратьте минуты на простые ходы.</p></div>' +
    '</div></section>';
}

/* ============================================================
   СТАРТ
   ============================================================ */
(function () {
  const burger = $('#burger'), mm = $('#mobileMenu');
  if (burger && mm) {
    burger.onclick = function () {
      mm.classList.toggle('open');
      burger.textContent = mm.classList.contains('open') ? '✕' : '☰';
    };
    mm.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { mm.classList.remove('open'); burger.textContent = '☰'; }
    });
  }
})();

window.addEventListener('hashchange', render);

async function boot() {
  renderAuthArea();
  if (state.token) {
    try {
      const me = await api('/api/me');
      state.user = me.user;
      if (!me.user) { state.token = null; localStorage.removeItem('ch_token'); }
    } catch (e) {}
  }
  renderAuthArea();
  initSocket();
  render();
}

boot();
