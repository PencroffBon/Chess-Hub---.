'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const { query, initDb } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/* ================= Утилиты ================= */
const uid = () => crypto.randomBytes(8).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString('hex');

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, rating: u.rating,
    wins: u.wins || 0, losses: u.losses || 0, draws: u.draws || 0,
    tournamentsWon: u.tournaments_won || 0, createdAt: u.created_at,
  };
}

/* ================= Кэш пользователей ================= */
const userCache = new Map();
async function findUser(id) {
  if (!id) return null;
  if (userCache.has(id)) return userCache.get(id);
  const r = await query('SELECT * FROM users WHERE id=$1', [id]);
  const u = r.rows[0] || null;
  if (u) userCache.set(id, u);
  return u;
}
function dropUserCache(id) { userCache.delete(id); }

/* ================= Авторизация ================= */
app.use(async (req, _res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (t) {
    const s = await query('SELECT user_id FROM sessions WHERE token=$1', [t]);
    if (s.rows[0]) req.user = await findUser(s.rows[0].user_id);
  }
  req.token = t;
  next();
});
function authRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  next();
}

/* ================= Контроль времени ================= */
const TIME_CONTROLS = {
  '1+0':   { base: 60,   inc: 0,  label: 'Пуля · 1+0' },
  '3+0':   { base: 180,  inc: 0,  label: 'Блиц · 3+0' },
  '3+2':   { base: 180,  inc: 2,  label: 'Блиц · 3+2' },
  '5+0':   { base: 300,  inc: 0,  label: 'Блиц · 5+0' },
  '10+5':  { base: 600,  inc: 5,  label: 'Рапид · 10+5' },
  '15+10': { base: 900,  inc: 10, label: 'Рапид · 15+10' },
  '30+0':  { base: 1800, inc: 0,  label: 'Классика · 30+0' },
};

/* ================= Партии ================= */
const games = new Map();
let gameSeq = 1;

function createGame({ whiteId, blackId, tcKey, tourId = null }) {
  const tc = TIME_CONTROLS[tcKey] || TIME_CONTROLS['10+5'];
  const g = {
    id: 'g' + (gameSeq++) + '_' + uid().slice(0, 4),
    tcKey, base: tc.base, inc: tc.inc, tourId,
    whiteId: whiteId || null, blackId: blackId || null,
    chess: new Chess(),
    status: 'playing', result: null, reason: null, endedAt: null,
    wMs: tc.base * 1000, bMs: tc.base * 1000, lastMoveAt: Date.now(),
    drawOffer: null, createdAt: Date.now(),
  };
  games.set(g.id, g);
  return g;
}

function tick(g) {
  if (g.status !== 'playing') return;
  const side = g.chess.turn();
  const remain = (side === 'w' ? g.wMs : g.bMs) - (Date.now() - g.lastMoveAt);
  if (remain <= 0) finishGameSync(g, side === 'w' ? 'black' : 'white', 'timeout');
}

function lastMoveOf(g) {
  const h = g.chess.history({ verbose: true });
  const m = h[h.length - 1];
  return m ? { from: m.from, to: m.to } : null;
}

function gameView(g, viewerId) {
  const turn = g.chess.turn();
  const owner = turn === 'w' ? g.whiteId : g.blackId;
  const elapsed = g.status === 'playing' ? Date.now() - g.lastMoveAt : 0;
  const isPlayer = viewerId && (g.whiteId === viewerId || g.blackId === viewerId);
  return {
    id: g.id, status: g.status, tcKey: g.tcKey, tourId: g.tourId,
    white: publicUser(g.whiteSnap), black: publicUser(g.blackSnap),
    fen: g.chess.fen(), turn,
    moves: g.chess.history(),
    inCheck: g.status === 'playing' && g.chess.inCheck(),
    lastMove: lastMoveOf(g),
    wMs: g.status === 'playing' ? (turn === 'w' ? Math.max(0, g.wMs - elapsed) : g.wMs) : g.wMs,
    bMs: g.status === 'playing' ? (turn === 'b' ? Math.max(0, g.bMs - elapsed) : g.bMs) : g.bMs,
    result: g.result, reason: g.reason,
    drawOffer: (g.drawOffer && isPlayer && g.drawOffer !== viewerId) ? g.drawOffer : null,
    iOffered: !!(g.drawOffer && viewerId && g.drawOffer === viewerId),
    legalMoves: (g.status === 'playing' && viewerId && owner === viewerId)
      ? g.chess.moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, promotion: m.promotion || null }))
      : [],
  };
}

function emitGameUpdate(g) {
  for (const [, s] of io.of('/').sockets) {
    if (s.data.gameId === g.id) s.emit('game:update', gameView(g, s.data.userId || null));
  }
}

/* Заполняем снимки игроков при создании партии */
async function hydrateGamePlayers(g) {
  const w = g.whiteId ? await findUser(g.whiteId) : null;
  const b = g.blackId ? await findUser(g.blackId) : null;
  g.whiteSnap = w;
  g.blackSnap = b;
}

/* ================= Завершение партии (Elo + БД) ================= */
function finishGameSync(g, winner, reason) {
  if (g.status === 'finished') return;
  g.status = 'finished';
  g.result = winner;
  g.reason = reason;
  g.endedAt = Date.now();
  g.drawOffer = null;
  finishGameAsync(g).catch(e => console.error('finishGameAsync:', e));
}

async function finishGameAsync(g) {
  const w = g.whiteSnap;
  const b = g.blackSnap;
  if (w && b) {
    const scoreW = g.result === 'white' ? 1 : g.result === 'black' ? 0 : 0.5;
    const K = 24;
    const ea = 1 / (1 + Math.pow(10, (b.rating - w.rating) / 400));
    const dW = Math.round(K * (scoreW - ea));
    const dB = Math.round(K * ((1 - scoreW) - (1 - ea)));

    const resW = g.result === 'white' ? 'win' : g.result === 'black' ? 'loss' : 'draw';
    const resB = g.result === 'black' ? 'win' : g.result === 'white' ? 'loss' : 'draw';
    const fieldW = resW === 'win' ? 'wins' : resW === 'loss' ? 'losses' : 'draws';
    const fieldB = resB === 'win' ? 'wins' : resB === 'loss' ? 'losses' : 'draws';

    await query(`UPDATE users SET rating = rating + $1, ${fieldW} = ${fieldW} + 1 WHERE id=$2`, [dW, w.id]);
    await query(`UPDATE users SET rating = rating + $1, ${fieldB} = ${fieldB} + 1 WHERE id=$2`, [dB, b.id]);
    dropUserCache(w.id); dropUserCache(b.id);
  }

  await query(
    `INSERT INTO games (id, tc_key, result, reason, ended_at, moves, fen, white_id, white_name, white_rating, black_id, black_name, black_rating)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [g.id, g.tcKey, g.result, g.reason, g.endedAt,
     JSON.stringify(g.chess.history()), g.chess.fen(),
     g.whiteId, w ? w.name : null, w ? w.rating : 1200,
     g.blackId, b ? b.name : null, b ? b.rating : 1200]
  );

  if (g.tourId) await onTourGameEnd(g);
  emitGameUpdate(g);
  emitLobby();
}

/* ================= Лобби и арена ================= */
let arenaQueue = [];

function lobbyView() {
  const open = [...games.values()].filter(g => g.status === 'waiting').map(g => {
    const hostId = g.whiteId || g.blackId;
    const host = hostId === g.whiteId ? g.whiteSnap : g.blackSnap;
    return { id: g.id, tcKey: g.tcKey, createdAt: g.createdAt, side: g.whiteId ? 'w' : 'b', host: publicUser(host) };
  }).sort((a, b) => b.createdAt - a.createdAt);
  const live = [...games.values()].filter(g => g.status === 'playing').map(g => ({
    id: g.id, tcKey: g.tcKey,
    white: publicUser(g.whiteSnap), black: publicUser(g.blackSnap),
    ply: g.chess.history().length,
  }));
  return { open, live, arenaQueue: arenaQueue.length };
}
function emitLobby() { io.to('lobby').emit('lobby:update', lobbyView()); }

/* ================= Турниры ================= */
async function tourById(id) {
  const r = await query('SELECT * FROM tournaments WHERE id=$1', [id]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id, name: row.name, tc_key: row.tc_key, status: row.status,
    created_by: row.created_by, created_at: Number(row.created_at),
    started_at: row.started_at ? Number(row.started_at) : null,
    finished_at: row.finished_at ? Number(row.finished_at) : null,
    total_rounds: row.total_rounds || 0, round: row.round || 0,
    rounds: row.rounds || [], players: row.players || [],
  };
}

async function saveTour(t) {
  await query(
    `UPDATE tournaments SET status=$1, round=$2, total_rounds=$3, started_at=$4, finished_at=$5, rounds=$6, players=$7 WHERE id=$8`,
    [t.status, t.round, t.total_rounds, t.started_at, t.finished_at,
     JSON.stringify(t.rounds), JSON.stringify(t.players), t.id]
  );
}

/* Синхронный расчёт по уже загруженному объекту */
async function tourScore(t) {
  const m = new Map();
  t.players.forEach(id => m.set(id, { id, score: 0, wins: 0, draws: 0, losses: 0, played: 0, opps: [] }));
  for (const round of (t.rounds || [])) {
    for (const r of round) {
      if (r.bye) { const p = m.get(r.playerId); if (p) p.score += 1; continue; }
      const w = m.get(r.whiteId), b = m.get(r.blackId);
      if (!w || !b) continue;
      if (r.result === 'white') { w.score += 1; w.wins++; b.losses++; }
      else if (r.result === 'black') { b.score += 1; b.wins++; w.losses++; }
      else if (r.result === 'draw') { w.score += 0.5; b.score += 0.5; w.draws++; b.draws++; }
      if (r.result) { w.played++; b.played++; w.opps.push(r.blackId); b.opps.push(r.whiteId); }
    }
  }
  return m;
}

async function tourStandings(t) {
  const m = await tourScore(t);
  const list = [...m.values()];
  for (const p of list) {
    p.buchholz = p.opps.reduce((s, id) => s + ((m.get(id) || {}).score || 0), 0);
  }
  const usersMap = new Map();
  for (const p of list) usersMap.set(p.id, await findUser(p.id));
  list.sort((a, b) =>
    b.score - a.score ||
    b.buchholz - a.buchholz ||
    (b.wins * 2 + b.draws) - (a.wins * 2 + a.draws) ||
    ((usersMap.get(b.id) || {}).rating || 0) - ((usersMap.get(a.id) || {}).rating || 0));
  return { list, usersMap };
}

async function pairRound(t) {
  const { list } = await tourStandings(t);
  const order = list.map(p => p.id);
  const played = new Set();
  for (const round of (t.rounds || [])) for (const r of round) {
    if (!r.bye) { played.add(r.whiteId + '|' + r.blackId); played.add(r.blackId + '|' + r.whiteId); }
  }
  const round = [];
  const pool = [...order];
  while (pool.length > 1) {
    const a = pool.shift();
    let idx = pool.findIndex(b => !played.has(a + '|' + b));
    if (idx === -1) idx = 0;
    const b = pool.splice(idx, 1)[0];
    const whiteId = Math.random() < 0.5 ? a : b;
    const blackId = whiteId === a ? b : a;
    const g = createGame({ whiteId, blackId, tcKey: t.tc_key, tourId: t.id });
    await hydrateGamePlayers(g);
    round.push({ id: g.id, whiteId, blackId, result: null });
  }
  if (pool.length === 1) round.push({ bye: true, playerId: pool[0], result: 'bye' });
  t.rounds.push(round);
  t.round = t.rounds.length;
}

async function finishTournament(t) {
  t.status = 'finished';
  t.finished_at = Date.now();
  const { list } = await tourStandings(t);
  if (list[0]) {
    await query('UPDATE users SET tournaments_won = tournaments_won + 1 WHERE id=$1', [list[0].id]);
    dropUserCache(list[0].id);
  }
}

async function maybeAdvanceRound(t) {
  if (t.status !== 'running') return;
  const cur = (t.rounds || [])[t.round - 1];
  if (!cur || !cur.every(r => r.result)) return;
  if (t.round < t.total_rounds) await pairRound(t);
  else await finishTournament(t);
}

async function onTourGameEnd(g) {
  const t = await tourById(g.tourId);
  if (!t) return;
  for (const round of (t.rounds || [])) {
    const r = round.find(x => x.id === g.id);
    if (r && !r.result) { r.result = g.result; break; }
  }
  await maybeAdvanceRound(t);
  await saveTour(t);
  emitTournaments();
  emitTournamentView(t);
}

async function sweepTournaments() {
  const r = await query("SELECT * FROM tournaments WHERE status='running'");
  for (const row of r.rows) {
    const t = await tourById(row.id);
    const cur = (t.rounds || [])[t.round - 1];
    if (!cur) continue;
    let changed = false;
    for (const rec of cur) {
      if (!rec.result && rec.id && !games.has(rec.id)) { rec.result = 'draw'; changed = true; }
    }
    if (changed) { await maybeAdvanceRound(t); await saveTour(t); }
  }
}

async function tournamentsListView(viewerId) {
  const r = await query('SELECT * FROM tournaments ORDER BY created_at DESC');
  return {
    userId: viewerId || null,
    items: r.rows.map(row => ({
      id: row.id, name: row.name, tcKey: row.tc_key, status: row.status,
      createdAt: Number(row.created_at),
      startedAt: row.started_at ? Number(row.started_at) : null,
      finishedAt: row.finished_at ? Number(row.finished_at) : null,
      playersCount: (row.players || []).length,
      totalRounds: row.total_rounds || 0, round: row.round || 0,
      createdBy: row.created_by,
      joined: !!(viewerId && (row.players || []).includes(viewerId)),
      isCreator: !!(viewerId && row.created_by === viewerId),
    })),
  };
}

async function recView(r) {
  if (r.bye) {
    const u = await findUser(r.playerId);
    return { bye: true, playerId: r.playerId, name: u ? u.name : '?' };
  }
  const w = await findUser(r.whiteId);
  const b = await findUser(r.blackId);
  const g = games.get(r.id);
  let status = 'finished', reason = null;
  if (g) { status = g.status; reason = g.reason; }
  return {
    id: r.id,
    white: { id: r.whiteId, name: w ? w.name : '?', rating: w ? w.rating : 1200 },
    black: { id: r.blackId, name: b ? b.name : '?', rating: b ? b.rating : 1200 },
    result: r.result, status, reason,
  };
}

async function tourView(t, viewerId) {
  const { list, usersMap } = await tourStandings(t);
  const standings = list.map((p, i) => {
    const u = usersMap.get(p.id) || {};
    return { id: p.id, name: u.name || '?', rating: u.rating || 1200, score: p.score, buchholz: p.buchholz, wins: p.wins, draws: p.draws, losses: p.losses, place: i + 1 };
  });
  const podium = standings.slice(0, 3).map((p, i) => {
    const total = (list[i] && list[i].played) || 0;
    const perf = total ? Math.round(p.rating + 400 * ((list[i].wins || 0) - (list[i].losses || 0)) / total) : p.rating;
    const winPct = total ? Math.round(100 * ((list[i].wins || 0) + 0.5 * (list[i].draws || 0)) / total) : 0;
    return Object.assign({}, p, { cup: ['gold', 'silver', 'bronze'][i], perf, winPct, points: p.score });
  });
  const rounds = [];
  for (const round of (t.rounds || [])) {
    const arr = [];
    for (const rec of round) arr.push(await recView(rec));
    rounds.push(arr);
  }
  const creator = await findUser(t.created_by);
  return {
    id: t.id, name: t.name, tcKey: t.tc_key, status: t.status,
    createdBy: t.created_by, creatorName: creator ? creator.name : '?',
    createdAt: t.created_at, startedAt: t.started_at, finishedAt: t.finished_at,
    totalRounds: t.total_rounds || 0, round: t.round || 0,
    playersCount: t.players.length,
    joined: !!(viewerId && t.players.includes(viewerId)),
    isCreator: !!(viewerId && t.created_by === viewerId),
    standings, podium, rounds,
  };
}

async function emitTournaments() {
  const view = await tournamentsListView(null);
  io.emit('tournaments:update', view);
}
async function emitTournamentView(t) {
  for (const [, s] of io.of('/').sockets) {
    if (s.data.rooms && s.data.rooms.has('t:' + t.id)) {
      s.emit('tournament:view', await tourView(t, s.data.userId || null));
    }
  }
}

/* ================= API: аккаунты ================= */
app.post('/api/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!/^[\wа-яё\-]{3,20}$/i.test(name)) return res.status(400).json({ error: 'Ник: 3–20 символов (буквы, цифры, _ и -)' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Введите корректный email' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
    const exists = await query('SELECT 1 FROM users WHERE LOWER(name)=LOWER($1) OR email=$2', [name, email]);
    if (exists.rows.length) return res.status(400).json({ error: 'Ник или email уже занят' });

    const salt = crypto.randomBytes(16).toString('hex');
    const id = uid();
    await query(
      'INSERT INTO users (id,name,email,salt,hash,rating,created_at) VALUES ($1,$2,$3,$4,$5,1200,$6)',
      [id, name, email, salt, hashPass(password, salt), Date.now()]
    );
    const token = newToken();
    await query('INSERT INTO sessions (token,user_id,created_at) VALUES ($1,$2,$3)', [token, id, Date.now()]);
    res.json({ token, user: publicUser(await findUser(id)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const r = await query('SELECT * FROM users WHERE LOWER(name)=$1 OR email=$1', [name]);
    const u = r.rows[0];
    if (!u || u.hash !== hashPass(password, u.salt)) return res.status(401).json({ error: 'Неверный ник или пароль' });
    const token = newToken();
    await query('INSERT INTO sessions (token,user_id,created_at) VALUES ($1,$2,$3)', [token, u.id, Date.now()]);
    res.json({ token, user: publicUser(u) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));
app.post('/api/logout', authRequired, async (req, res) => {
  await query('DELETE FROM sessions WHERE token=$1', [req.token]);
  res.json({ ok: true });
});

/* ================= API: статистика, игроки, история ================= */
app.get('/api/stats', async (_req, res) => {
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const total = await query('SELECT COUNT(*) c FROM users');
  const gamesToday = await query('SELECT COUNT(*) c FROM games WHERE ended_at >= $1', [dayStart]);
  res.json({
    online: io.engine.clientsCount,
    gamesToday: parseInt(gamesToday.rows[0].c),
    totalPlayers: parseInt(total.rows[0].c),
    rating: 0,
  });
});

app.get('/api/players', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 500);
  const r = await query('SELECT * FROM users ORDER BY rating DESC LIMIT $1', [limit]);
  res.json(r.rows.map(publicUser));
});

app.get('/api/users/:id', async (req, res) => {
  const u = await findUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(publicUser(u));
});

app.get('/api/history/:id', async (req, res) => {
  const r = await query(
    'SELECT * FROM games WHERE white_id=$1 OR black_id=$1 ORDER BY ended_at DESC LIMIT 30',
    [req.params.id]
  );
  res.json(r.rows.map(row => ({
    id: row.id, tcKey: row.tc_key, result: row.result, reason: row.reason,
    endedAt: Number(row.ended_at),
    moves: row.moves || [], fen: row.fen,
    white: { id: row.white_id, name: row.white_name, rating: row.white_rating },
    black: { id: row.black_id, name: row.black_name, rating: row.black_rating },
  })));
});

/* ================= API: чат ================= */
app.get('/api/chat', async (req, res) => {
  const room = String(req.query.room || 'global');
  const r = await query('SELECT * FROM chat_messages WHERE room=$1 ORDER BY ts ASC LIMIT 50', [room]);
  res.json(r.rows.map(row => ({ room: row.room, userId: row.user_id, name: row.name, text: row.text, ts: Number(row.ts) })));
});

/* ================= API: вызовы и партии ================= */
app.post('/api/challenges', authRequired, async (req, res) => {
  try {
    const tcKey = TIME_CONTROLS[req.body.tc] ? req.body.tc : '10+5';
    let color = req.body.color;
    if (color !== 'white' && color !== 'black') color = Math.random() < 0.5 ? 'white' : 'black';
    const g = createGame({
      tcKey,
      whiteId: color === 'white' ? req.user.id : null,
      blackId: color === 'black' ? req.user.id : null,
    });
    await hydrateGamePlayers(g);
    g.status = 'waiting';
    emitLobby();
    res.json({ id: g.id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/lobby', (_req, res) => res.json(lobbyView()));

app.post('/api/games/:id/join', authRequired, async (req, res) => {
  const g = games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Партия не найдена' });
  if (g.status !== 'waiting') return res.status(400).json({ error: 'К партии уже нельзя присоединиться' });
  if (g.whiteId === req.user.id || g.blackId === req.user.id) return res.status(400).json({ error: 'Это ваш собственный вызов' });
  if (!g.whiteId) g.whiteId = req.user.id; else g.blackId = req.user.id;
  await hydrateGamePlayers(g);
  g.status = 'playing';
  g.lastMoveAt = Date.now();
  emitLobby();
  emitGameUpdate(g);
  res.json({ id: g.id });
});

app.post('/api/games/:id/abort', authRequired, (req, res) => {
  const g = games.get(req.params.id);
  if (!g || g.status !== 'waiting') return res.status(400).json({ error: 'Нельзя отменить' });
  if (g.whiteId !== req.user.id && g.blackId !== req.user.id) return res.status(403).json({ error: 'Это не ваш вызов' });
  games.delete(g.id);
  emitLobby();
  res.json({ ok: true });
});

app.get('/api/games/:id', async (req, res) => {
  const g = games.get(req.params.id);
  if (g) {
    if (!g.whiteSnap && g.whiteId) await hydrateGamePlayers(g);
    return res.json(gameView(g, req.user ? req.user.id : null));
  }
  const r = await query('SELECT * FROM games WHERE id=$1', [req.params.id]);
  const h = r.rows[0];
  if (h) {
    return res.json({
      id: h.id, status: 'finished', tcKey: h.tc_key,
      white: { id: h.white_id, name: h.white_name, rating: h.white_rating },
      black: { id: h.black_id, name: h.black_name, rating: h.black_rating },
      fen: h.fen, turn: 'w', moves: h.moves || [], inCheck: false, lastMove: null,
      wMs: 0, bMs: 0, result: h.result, reason: h.reason, drawOffer: null, iOffered: false, legalMoves: [],
    });
  }
  res.status(404).json({ error: 'Партия не найдена' });
});

app.post('/api/games/:id/move', authRequired, (req, res) => {
  const g = games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Партия не найдена' });
  if (g.status !== 'playing') return res.status(400).json({ error: 'Партия не идёт' });
  tick(g);
  if (g.status !== 'playing') return res.status(400).json({ error: 'Партия завершена' });

  const side = g.chess.turn();
  const owner = side === 'w' ? g.whiteId : g.blackId;
  if (owner !== req.user.id) return res.status(403).json({ error: 'Сейчас не ваш ход' });

  const { from, to, promotion } = req.body;
  let mv;
  try { mv = g.chess.move({ from, to, promotion: promotion || undefined }); }
  catch { return res.status(400).json({ error: 'Недопустимый ход' }); }
  if (!mv) return res.status(400).json({ error: 'Недопустимый ход' });

  const spent = Date.now() - g.lastMoveAt;
  if (side === 'w') g.wMs = Math.max(0, g.wMs - spent) + g.inc * 1000;
  else g.bMs = Math.max(0, g.bMs - spent) + g.inc * 1000;
  g.lastMoveAt = Date.now();
  g.drawOffer = null;

  if (g.chess.isCheckmate()) finishGameSync(g, side === 'w' ? 'black' : 'white', 'checkmate');
  else if (g.chess.isDraw()) finishGameSync(g, 'draw',
    g.chess.isStalemate() ? 'stalemate'
      : g.chess.isThreefoldRepetition() ? 'repetition'
      : g.chess.isInsufficientMaterial() ? 'material' : '50-move');
  else emitGameUpdate(g);
  res.json({ ok: true });
});

app.post('/api/games/:id/resign', authRequired, (req, res) => {
  const g = games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Партия не найдена' });
  if (g.status !== 'playing') return res.status(400).json({ error: 'Партия не идёт' });
  if (g.whiteId !== req.user.id && g.blackId !== req.user.id) return res.status(403).json({ error: 'Вы не участник партии' });
  finishGameSync(g, g.whiteId === req.user.id ? 'black' : 'white', 'resign');
  res.json({ ok: true });
});

app.post('/api/games/:id/draw', authRequired, (req, res) => {
  const g = games.get(req.params.id);
  if (!g || g.status !== 'playing') return res.status(400).json({ error: 'Партия не идёт' });
  if (g.whiteId !== req.user.id && g.blackId !== req.user.id) return res.status(403).json({ error: 'Вы не участник партии' });
  const action = req.body.action || 'offer';
  if (action === 'offer') { g.drawOffer = req.user.id; emitGameUpdate(g); }
  else if (action === 'accept') {
    if (g.drawOffer && g.drawOffer !== req.user.id) finishGameSync(g, 'draw', 'agreement');
    else return res.status(400).json({ error: 'Нет активного предложения ничьей' });
  } else { g.drawOffer = null; emitGameUpdate(g); }
  res.json({ ok: true });
});

/* ================= API: арена ================= */
app.post('/api/arena/join', authRequired, async (req, res) => {
  const tcKey = TIME_CONTROLS[req.body.tc] ? req.body.tc : '3+2';
  arenaQueue = arenaQueue.filter(id => id !== req.user.id);
  const other = arenaQueue[0];
  if (other) {
    arenaQueue = arenaQueue.filter(id => id !== other);
    const whiteId = Math.random() < 0.5 ? req.user.id : other;
    const blackId = whiteId === req.user.id ? other : req.user.id;
    const g = createGame({ whiteId, blackId, tcKey });
    await hydrateGamePlayers(g);
    emitLobby();
    io.to('user:' + whiteId).emit('arena:matched', { gameId: g.id });
    io.to('user:' + blackId).emit('arena:matched', { gameId: g.id });
    return res.json({ matched: true, gameId: g.id });
  }
  arenaQueue.push(req.user.id);
  emitLobby();
  res.json({ matched: false });
});

app.post('/api/arena/leave', authRequired, (req, res) => {
  arenaQueue = arenaQueue.filter(id => id !== req.user.id);
  emitLobby();
  res.json({ ok: true });
});

/* ================= API: турниры ================= */
app.get('/api/tournaments', async (req, res) => {
  res.json(await tournamentsListView(req.user ? req.user.id : null));
});

app.get('/api/tournaments/:id', async (req, res) => {
  const t = await tourById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  res.json(await tourView(t, req.user ? req.user.id : null));
});

app.post('/api/tournaments', authRequired, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40) || ('Турнир ' + new Date().toLocaleDateString('ru-RU'));
    const tcKey = TIME_CONTROLS[req.body.tc] ? req.body.tc : '5+0';
    const id = uid();
    await query(
      `INSERT INTO tournaments (id, name, tc_key, status, created_by, created_at, total_rounds, round, rounds, players)
       VALUES ($1,$2,$3,'open',$4,$5,0,0,'[]'::jsonb,$6)`,
      [id, name, tcKey, req.user.id, Date.now(), JSON.stringify([req.user.id])]
    );
    await emitTournaments();
    res.json({ id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/tournaments/:id/join', authRequired, async (req, res) => {
  const t = await tourById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Регистрация закрыта' });
  if (t.players.includes(req.user.id)) return res.status(400).json({ error: 'Вы уже участник' });
  t.players.push(req.user.id);
  await saveTour(t);
  await emitTournaments();
  await emitTournamentView(t);
  res.json({ ok: true });
});

app.post('/api/tournaments/:id/leave', authRequired, async (req, res) => {
  const t = await tourById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Регистрация закрыта' });
  if (req.user.id === t.created_by) return res.status(400).json({ error: 'Создатель не может покинуть' });
  t.players = t.players.filter(x => x !== req.user.id);
  await saveTour(t);
  await emitTournaments();
  await emitTournamentView(t);
  res.json({ ok: true });
});

app.post('/api/tournaments/:id/start', authRequired, async (req, res) => {
  const t = await tourById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  if (t.created_by !== req.user.id) return res.status(403).json({ error: 'Только создатель' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Уже идёт или завершён' });
  if (t.players.length < 2) return res.status(400).json({ error: 'Нужно минимум 2 участника' });
  t.status = 'running';
  t.started_at = Date.now();
  t.total_rounds = Math.max(3, Math.min(7, Math.ceil(Math.log2(t.players.length)) + 1));
  t.rounds = [];
  await pairRound(t);
  await saveTour(t);
  await emitTournaments();
  await emitTournamentView(t);
  io.emit('tournament:started', { id: t.id });
  res.json({ ok: true });
});

/* ================= Socket.io ================= */
io.on('connection', (socket) => {
  socket.data.userId = null;
  socket.data.gameId = null;
  socket.data.rooms = new Set();

  socket.on('auth', async (t) => {
    const s = await query('SELECT user_id FROM sessions WHERE token=$1', [t]);
    if (s.rows[0]) {
      socket.data.userId = s.rows[0].user_id;
      socket.join('user:' + socket.data.userId);
    }
  });
  socket.on('room-join', (r) => {
    if (typeof r === 'string' && r.length > 0 && r.length < 64) {
      socket.data.rooms.add(r);
      socket.join(r);
    }
  });
  socket.on('room-leave', (r) => {
    socket.data.rooms.delete(r);
    socket.leave(r);
  });
  socket.on('watch-game', async (id) => {
    if (typeof id !== 'string') return;
    socket.data.gameId = id;
    socket.join('game:' + id);
    const g = games.get(id);
    if (g) {
      if (!g.whiteSnap && g.whiteId) await hydrateGamePlayers(g);
      socket.emit('game:update', gameView(g, socket.data.userId || null));
    }
  });
  socket.on('unwatch-game', () => { socket.data.gameId = null; });

  socket.on('chat', async ({ room, text } = {}) => {
    if (!socket.data.userId) return socket.emit('chat:error', { message: 'Войдите, чтобы писать в чат' });
    room = String(room || 'global').slice(0, 64);
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    const u = await findUser(socket.data.userId);
    if (!u) return;
    const ts = Date.now();
    await query(
      'INSERT INTO chat_messages (room,user_id,name,text,ts) VALUES ($1,$2,$3,$4,$5)',
      [room, u.id, u.name, text, ts]
    );
    io.to(room).emit('chat:msg', { room, userId: u.id, name: u.name, text, ts });
  });
});

/* ================= Старт ================= */
async function start() {
  await initDb();
  console.log('✅ БД готова');
  await sweepTournaments();

  setInterval(() => { for (const g of games.values()) tick(g); }, 1000);
  setInterval(() => {
    let changed = false;
    for (const [id, g] of games) {
      if (g.status === 'waiting' && Date.now() - g.createdAt > 10 * 60 * 1000) { games.delete(id); changed = true; }
    }
    if (changed) emitLobby();
  }, 10 * 60 * 1000);

  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  server.listen(PORT, () => console.log('♞ ChessHub: http://localhost:' + PORT));
}
start();