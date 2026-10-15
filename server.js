const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const config = require('./config');

const PORT = Number(process.env.PORT) || 3000;
// En Render el repo es público, así que sin ADMIN_PIN el admin queda bloqueado en vez de usar el PIN por defecto.
const ADMIN_PIN = process.env.ADMIN_PIN || (process.env.RENDER ? null : 'trii');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const TICK_MS = 1000;
const HISTORY_CAP = 900;
const REVEAL_MAX = 5; // 0 tablero final, 1 puestos 10-4, 2 tercero, 3 segundo, 4 primero, 5 premios
const TRADE_COOLDOWN_MS = 300;
const MAX_UP = 5; // +500%
const MAX_DOWN = -0.9; // -90%: una acción no puede valer menos que cero
const ROULETTE_SPIN_MS = 4200;
const ROULETTE_HOLD_MS = 1600;

if (!ADMIN_PIN) {
  console.warn('⚠️  ADMIN_PIN no está definido: el admin está bloqueado. Defínelo en Render → Environment.');
} else if (!process.env.ADMIN_PIN) {
  console.warn('⚠️  ADMIN_PIN no está definido: el PIN del admin es "trii" (solo en local).');
}

const TICKERS = config.stocks.map((s) => s.ticker);
const AREAS = [...config.stocks.map((s) => s.name), ...config.otherAreas];
const EVENTS = new Map();
for (const block of config.blocks) for (const ev of block.events) EVENTS.set(ev.id, ev);
const SURPRISES = config.surprises || [];
let rouletteBusy = false;

// Avisa si alguna noticia apunta a una acción que no existe (pasa al cambiar las áreas en config.js).
for (const ev of [...EVENTS.values(), ...SURPRISES]) {
  for (const key of Object.keys(ev.effects || {})) {
    if (!['ALL', 'RANDOM', 'RANDOM2'].includes(key) && !TICKERS.includes(key)) {
      console.warn(`⚠️  La noticia "${ev.id}" mueve $${key}, pero esa acción no existe en config.js`);
    }
  }
}

// ---------- Estado ----------

function freshState() {
  const stocks = {};
  for (const s of config.stocks) {
    stocks[s.ticker] = {
      ticker: s.ticker,
      fair: config.ipoPrice,
      noise: 0,
      pending: 0,
      price: config.ipoPrice,
      history: [config.ipoPrice],
      volume: 0,
      windowVolume: 0,
    };
  }
  return {
    phase: 'lobby', // lobby | open | closed | finished
    windowEndsAt: null,
    currentBlock: config.blocks[0].id,
    view: 'auto', // auto | board | ranking | qr
    reveal: 0,
    stocks,
    players: {},
    news: [],
    fired: {},
    rumors: {},
    final: null,
  };
}

let state = loadState() || freshState();
let dirty = false;

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const sameStocks = TICKERS.every((t) => saved.stocks && saved.stocks[t]);
    if (!sameStocks) return null;
    console.log(`Estado recuperado de ${DATA_FILE} (${Object.keys(saved.players).length} jugadores)`);
    return saved;
  } catch {
    return null;
  }
}

function saveState() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(state));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  } catch (e) {
    console.error('No se pudo guardar el estado:', e.message);
  }
}
setInterval(saveState, 3000);

// ---------- Helpers ----------

const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function prices() {
  return TICKERS.map((t) => round2(state.stocks[t].price));
}

function valueOf(p) {
  let v = p.cash;
  for (const [t, shares] of Object.entries(p.holdings)) v += shares * state.stocks[t].price;
  return v;
}

function ranking() {
  return Object.values(state.players)
    .map((p) => {
      const value = valueOf(p);
      return {
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        area: p.area,
        value: round2(value),
        ret: value / config.startingCash - 1,
        cash: round2(p.cash),
        trades: p.trades,
        joinedAt: p.joinedAt,
      };
    })
    .sort((a, b) => b.value - a.value || a.joinedAt - b.joinedAt);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    area: p.area,
    cash: round2(p.cash),
    holdings: p.holdings,
    cost: p.cost,
    trades: p.trades,
  };
}

function meta() {
  return {
    phase: state.phase,
    windowEndsAt: state.windowEndsAt,
    currentBlock: state.currentBlock,
    view: state.view,
    reveal: state.reveal,
    playerCount: Object.keys(state.players).length,
    now: Date.now(),
  };
}

function hotTicker() {
  let best = null;
  for (const t of TICKERS) {
    const v = state.stocks[t].windowVolume;
    if (v > 50 && (!best || v > state.stocks[best].windowVolume)) best = t;
  }
  return best;
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
}

// ---------- Motor de precios ----------

function setPrice(s) {
  s.fair = Math.max(1, s.fair);
  s.price = Math.max(1, s.fair * (1 + s.noise));
}

function tick() {
  if (state.phase === 'finished') return;
  const open = state.phase === 'open';
  let changed = false;

  for (const t of TICKERS) {
    const s = state.stocks[t];
    if (Math.abs(s.pending) > 1e-6) {
      // Las noticias se aplican de forma gradual para que se vea como un rally, no un salto.
      const step = Math.abs(s.pending) < 0.003 ? s.pending : s.pending * 0.3;
      s.fair *= Math.exp(step);
      s.pending -= step;
      changed = true;
    }
    if (open) {
      s.noise = s.noise * 0.9 + gauss() * config.noise;
      changed = true;
    }
    if (s.tradedSinceTick) {
      s.tradedSinceTick = false;
      changed = true;
    }
    setPrice(s);
  }

  if (changed) {
    const p = prices();
    TICKERS.forEach((t, i) => {
      const h = state.stocks[t].history;
      h.push(p[i]);
      if (h.length > HISTORY_CAP) h.shift();
    });
    io.emit('tick', { prices: p, hot: hotTicker(), now: Date.now() });
    dirty = true;
  }

  if (open && state.windowEndsAt && Date.now() >= state.windowEndsAt) {
    closeMarket();
  }
}

function closeMarket() {
  state.phase = 'closed';
  state.windowEndsAt = null;
  broadcastMeta();
  io.emit('bell', { kind: 'close' });
}

function applyNews({ headline, effects }) {
  const item = { id: crypto.randomUUID(), ts: Date.now(), headline, effects };
  for (const [key, raw] of Object.entries(effects)) {
    const pct = clamp(Number(raw) || 0, MAX_DOWN, MAX_UP);
    const targets = key === 'ALL' ? TICKERS : [key];
    for (const t of targets) {
      if (state.stocks[t]) state.stocks[t].pending += Math.log(1 + pct);
    }
  }
  state.news.push(item);
  if (state.news.length > 50) state.news.shift();
  io.emit('news', item);
  dirty = true;
  return item;
}

// ---------- Eventos sorpresa ----------

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function resolveSurprise(tpl) {
  const [t1, t2] = shuffled(TICKERS);
  const name = (t) => config.stocks.find((s) => s.ticker === t).name;
  const headline = tpl.headline
    .replaceAll('{t2}', '$' + t2)
    .replaceAll('{area2}', name(t2))
    .replaceAll('{t}', '$' + t1)
    .replaceAll('{area}', name(t1));
  const effects = {};
  for (const [k, v] of Object.entries(tpl.effects || {})) {
    const key = k === 'RANDOM' ? t1 : k === 'RANDOM2' ? t2 : k;
    effects[key] = clamp(Number(v) || 0, MAX_DOWN, MAX_UP);
  }
  return { headline, effects };
}

function randomSurprise() {
  return SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
}

// ---------- Trading ----------
// Cada USD comprado sube el precio de forma continua (curva exponencial), y la venta lo baja con la
// misma curva. Así comprar y vender de inmediato devuelve exactamente lo mismo: nadie gana "gratis"
// con su propio impacto.

function executeTrade(player, msg) {
  if (state.phase !== 'open') return { ok: false, error: 'El mercado está cerrado' };
  const s = state.stocks[msg && msg.ticker];
  if (!s) return { ok: false, error: 'Esa acción no existe' };

  const now = Date.now();
  if (now - (player.lastTradeAt || 0) < TRADE_COOLDOWN_MS) return { ok: false, error: 'Más despacio 🙂' };

  const k = config.impactPerUsd;
  const P = s.price;
  let result;

  if (msg.side === 'buy') {
    let usd = round2(Number(msg.usd));
    if (!Number.isFinite(usd) || usd <= 0) return { ok: false, error: 'Monto inválido' };
    if (usd > player.cash + 0.005) return { ok: false, error: 'No te alcanza el efectivo' };
    usd = Math.min(usd, round2(player.cash));
    if (usd < 1) return { ok: false, error: 'El mínimo es 1 USD' };

    const shares = (1 - Math.exp(-k * usd)) / (k * P);
    player.cash = round2(player.cash - usd);
    player.holdings[s.ticker] = (player.holdings[s.ticker] || 0) + shares;
    player.cost[s.ticker] = (player.cost[s.ticker] || 0) + usd;
    player.buys++;
    s.fair *= Math.exp(k * usd);
    s.volume += usd;
    s.windowVolume += usd;
    result = { side: 'buy', ticker: s.ticker, shares, usd, avg: usd / shares };
  } else if (msg.side === 'sell') {
    const held = player.holdings[s.ticker] || 0;
    if (held <= 1e-9) return { ok: false, error: `No tienes acciones de $${s.ticker}` };

    let shares;
    if (msg.pct != null) {
      shares = held * clamp(Number(msg.pct), 0, 1);
    } else {
      const usd = Number(msg.usd);
      if (!Number.isFinite(usd) || usd <= 0) return { ok: false, error: 'Monto inválido' };
      shares = (Math.exp(k * usd) - 1) / (k * P);
    }
    if (!(shares > 0)) return { ok: false, error: 'Monto inválido' };
    if (shares >= held * 0.9999) shares = held;

    const proceeds = Math.log(1 + k * P * shares) / k;
    const costShare = (player.cost[s.ticker] || 0) * (shares / held);
    player.cash = round2(player.cash + proceeds);
    const left = held - shares;
    if (left <= 1e-9) {
      delete player.holdings[s.ticker];
      delete player.cost[s.ticker];
    } else {
      player.holdings[s.ticker] = left;
      player.cost[s.ticker] = (player.cost[s.ticker] || 0) - costShare;
    }
    player.sells++;
    s.fair *= Math.exp(-k * proceeds);
    s.volume += proceeds;
    s.windowVolume -= proceeds;
    result = { side: 'sell', ticker: s.ticker, shares, usd: proceeds, avg: proceeds / shares };
  } else {
    return { ok: false, error: 'Operación inválida' };
  }

  player.trades++;
  player.lastTradeAt = now;
  setPrice(s);
  s.tradedSinceTick = true;
  dirty = true;
  return { ok: true, result, me: publicPlayer(player) };
}

// ---------- Cierre y premios ----------

function computeFinal() {
  const rank = ranking();
  const players = Object.values(state.players);
  const active = players.filter((p) => p.trades > 0);
  const pool = active.length ? active : players;
  const byId = Object.fromEntries(rank.map((r, i) => [r.id, { ...r, pos: i + 1 }]));
  const pick = (list, score) => {
    let best = null;
    let bestScore = -Infinity;
    for (const p of list) {
      const sc = score(p);
      if (sc != null && sc > bestScore) {
        best = p;
        bestScore = sc;
      }
    }
    return best;
  };
  const tickerByArea = Object.fromEntries(config.stocks.map((s) => [s.name, s.ticker]));
  const awards = [];
  const add = (key, icon, title, desc, p, detail) => {
    if (p) awards.push({ key, icon, title, desc, player: { id: p.id, name: p.name, emoji: p.emoji }, detail });
  };

  const lobo = pick(active, (p) => p.trades);
  add('lobo', '🐺', 'Lobo de Wall Street', 'El que más operó', lobo, lobo && `${lobo.trades} operaciones`);

  const diamante = pick(
    active.filter((p) => p.sells === 0),
    (p) => byId[p.id].ret,
  );
  add('diamante', '💎', 'Manos de diamante', 'Nunca vendió y le fue mejor', diamante, diamante && fmtPct(byId[diamante.id].ret));

  const papel = pick(active, (p) => (p.sells > 0 ? p.sells : null));
  add('papel', '🧻', 'Manos de papel', 'El que más vendió', papel, papel && `${papel.sells} ventas`);

  const fiel = pick(pool, (p) => {
    const t = tickerByArea[p.area];
    if (!t || !p.holdings[t]) return null;
    return (p.holdings[t] * state.stocks[t].price) / valueOf(p);
  });
  add('fiel', '❤️', 'El fiel', 'Más plata en su propia área', fiel, fiel && `${Math.round(((fiel.holdings[tickerByArea[fiel.area]] * state.stocks[tickerByArea[fiel.area]].price) / valueOf(fiel)) * 100)}% en $${tickerByArea[fiel.area]}`);

  const tortuga = pick(pool, (p) => p.cash / valueOf(p));
  add('tortuga', '🐢', 'El conservador', 'Terminó con más efectivo', tortuga, tortuga && `${Math.round((tortuga.cash / valueOf(tortuga)) * 100)}% en efectivo`);

  return { ranking: rank.slice(0, 10), total: rank.length, positions: rank.map((r) => r.id), awards, byId };
}

function fmtPct(r) {
  const v = (r * 100).toFixed(1).replace('.', ',');
  return `${r >= 0 ? '+' : ''}${v}%`;
}

function finalForPlayer(id) {
  if (!state.final) return null;
  const r = state.final.byId[id];
  if (!r) return null;
  return {
    pos: r.pos,
    total: state.final.total,
    value: r.value,
    ret: r.ret,
    awards: state.final.awards.filter((a) => a.player.id === id).map((a) => `${a.icon} ${a.title}`),
  };
}

function finalForScreens() {
  if (!state.final) return null;
  const { ranking: top, total, awards } = state.final;
  return { ranking: top, total, awards };
}

// ---------- Rumores ----------

function sendRumor(text) {
  const ids = Object.keys(state.players);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const chosen = ids.slice(0, config.rumorRecipients);
  for (const id of chosen) io.to('p:' + id).emit('rumor', { text });
  return chosen.map((id) => state.players[id].name);
}

const FAKE_UP = [
  'Dicen que $T viene con una noticia enorme… 🤫',
  'Escuché en la cocina que a $T le va a ir muy bien hoy',
  'Fuentes confiables (el de la máquina de café) dicen: compra $T',
];
const FAKE_DOWN = [
  'Ojo con $T: dicen que se viene algo feo 😬',
  'Un pajarito me dijo que $T va a caer… ¿será?',
  'Rumor de pasillo: mejor sal de $T antes de que sea tarde',
];

// ---------- Servidor ----------

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 20000 });

const pub = path.join(__dirname, 'public');
const page = (file) => (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(pub, file));
};
app.get('/', page('jugar.html'));
app.get('/pantalla', page('pantalla.html'));
app.get('/admin', page('admin.html'));
app.get('/healthz', (req, res) =>
  res.json({
    ok: true,
    players: Object.keys(state.players).length,
    phase: state.phase,
    commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
  }),
);

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

function publicUrl(req) {
  const fixed = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (fixed) return fixed.endsWith('/') ? fixed : fixed + '/';
  const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  let host = req.headers['x-forwarded-host'] || req.get('host');
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
    const ip = lanIp();
    if (ip) host = host.replace(/^(localhost|127\.0\.0\.1)/, ip);
  }
  return `${proto}://${host}/`;
}

app.get('/join-url', (req, res) => res.json({ url: publicUrl(req) }));
app.get('/qr.svg', async (req, res) => {
  const svg = await QRCode.toString(publicUrl(req), {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0b0d0c', light: '#f1ede2' },
  });
  res.type('image/svg+xml').send(svg);
});
app.use(express.static(pub, { maxAge: 0 }));

function initPayload(socket) {
  const role = socket.data.role;
  const history = {};
  for (const t of TICKERS) history[t] = state.stocks[t].history;
  return {
    config: {
      title: config.title,
      date: config.date,
      startingCash: config.startingCash,
      ipoPrice: config.ipoPrice,
      impactPerUsd: config.impactPerUsd,
      historyCap: HISTORY_CAP,
      stocks: config.stocks,
      areas: AREAS,
      blocks: config.blocks.map((b) => ({ id: b.id, title: b.title, events: role === 'admin' ? b.events : undefined })),
    },
    meta: meta(),
    history,
    hot: hotTicker(),
    news: state.news.slice(-10),
    fired: role === 'admin' ? state.fired : undefined,
    surprises: role === 'admin' ? SURPRISES : undefined,
    rumors: role === 'admin' ? state.rumors : undefined,
    final: role === 'screen' || role === 'admin' ? finalForScreens() : undefined,
  };
}

function broadcastMeta() {
  dirty = true;
  io.emit('meta', meta());
}

function emitBoards() {
  const rank = ranking();
  const top = rank.slice(0, 10).map(({ id, name, emoji, area, value, ret }) => ({ id, name, emoji, area, value, ret }));
  const recent = Object.values(state.players)
    .sort((a, b) => b.joinedAt - a.joinedAt)
    .slice(0, 40)
    .map((p) => ({ name: p.name, emoji: p.emoji }));
  io.to('screens').to('admins').emit('board', { top, count: rank.length, recent });
  io.to('admins').emit('players', rank);
  const hideRank = state.phase === 'finished';
  if (!hideRank) {
    rank.forEach((r, i) => io.to('p:' + r.id).emit('rank', { pos: i + 1, total: rank.length }));
  }
}
setInterval(emitBoards, 2000);

io.on('connection', (socket) => {
  const safe = (fn) => (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    try {
      fn(args[0] || {}, ack);
    } catch (e) {
      console.error(e);
      ack({ ok: false, error: 'Error del servidor' });
    }
  };

  socket.on(
    'hello',
    safe((msg, ack) => {
      const role = ['player', 'screen', 'admin'].includes(msg.role) ? msg.role : 'player';
      if (role === 'admin') {
        if (!ADMIN_PIN) return ack({ ok: false, error: 'Falta definir ADMIN_PIN en el servidor' });
        if (String(msg.pin || '') !== ADMIN_PIN) return ack({ ok: false, error: 'PIN incorrecto' });
        socket.join('admins');
      }
      if (role === 'screen') socket.join('screens');
      socket.data.role = role;

      const payload = initPayload(socket);
      if (role === 'player' && msg.playerId && state.players[msg.playerId]) {
        socket.data.playerId = msg.playerId;
        socket.join('p:' + msg.playerId);
        payload.me = publicPlayer(state.players[msg.playerId]);
        if (state.phase === 'finished' && state.reveal >= 4) payload.finalMe = finalForPlayer(msg.playerId);
      }
      ack({ ok: true, ...payload });
      emitBoards();
    }),
  );

  socket.on(
    'join',
    safe((msg, ack) => {
      if (state.phase === 'finished') return ack({ ok: false, error: 'El juego ya terminó' });
      const name = cleanName(msg.name);
      if (name.length < 2) return ack({ ok: false, error: 'Escribe tu nombre' });
      const taken = Object.values(state.players).some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (taken) return ack({ ok: false, error: 'Ese nombre ya está en juego. Prueba con tu apellido.' });
      const area = AREAS.includes(msg.area) ? msg.area : 'Otra área';
      const emoji = String(msg.emoji || '🙂').slice(0, 8);
      const id = crypto.randomUUID();
      state.players[id] = {
        id,
        name,
        area,
        emoji,
        cash: config.startingCash,
        holdings: {},
        cost: {},
        trades: 0,
        buys: 0,
        sells: 0,
        joinedAt: Date.now(),
      };
      socket.data.playerId = id;
      socket.join('p:' + id);
      dirty = true;
      ack({ ok: true, me: publicPlayer(state.players[id]) });
      broadcastMeta();
      emitBoards();
    }),
  );

  // Un jugador puede salirse del juego (lo usan los bots de prueba para limpiar al terminar).
  socket.on(
    'leave',
    safe((msg, ack) => {
      const id = socket.data.playerId;
      if (!id || !state.players[id]) return ack({ ok: false, error: 'No estás en el juego' });
      if (state.phase === 'finished') return ack({ ok: false, error: 'El juego ya terminó' });
      delete state.players[id];
      socket.data.playerId = null;
      socket.leave('p:' + id);
      ack({ ok: true });
      broadcastMeta();
    }),
  );

  socket.on(
    'trade',
    safe((msg, ack) => {
      const player = state.players[socket.data.playerId];
      if (!player) return ack({ ok: false, error: 'Vuelve a entrar al juego' });
      const res = executeTrade(player, msg);
      ack(res);
      if (res.ok) {
        // Otras pestañas del mismo jugador
        socket.to('p:' + player.id).emit('me', res.me);
      }
    }),
  );

  socket.on(
    'admin',
    safe((msg, ack) => {
      if (socket.data.role !== 'admin') return ack({ ok: false, error: 'No autorizado' });
      const out = adminAction(msg);
      ack(out || { ok: true });
    }),
  );
});

function adminAction(msg) {
  switch (msg.action) {
    case 'open': {
      if (state.phase === 'finished') return { ok: false, error: 'El juego ya cerró' };
      const secs = msg.seconds == null ? null : clamp(Number(msg.seconds) || config.windowSeconds, 5, 3600);
      if (state.phase !== 'open') for (const t of TICKERS) state.stocks[t].windowVolume = 0;
      state.phase = 'open';
      state.windowEndsAt = secs ? Date.now() + secs * 1000 : null;
      broadcastMeta();
      io.emit('bell', { kind: 'open' });
      return;
    }
    case 'close':
      if (state.phase === 'open') closeMarket();
      return;
    case 'extend':
      if (state.phase === 'open' && state.windowEndsAt) {
        state.windowEndsAt += clamp(Number(msg.seconds) || 30, 5, 600) * 1000;
        broadcastMeta();
      }
      return;
    case 'block':
      if (config.blocks.some((b) => b.id === msg.id)) {
        state.currentBlock = msg.id;
        broadcastMeta();
      }
      return;
    case 'news': {
      if (state.phase === 'finished') return { ok: false, error: 'El juego ya cerró' };
      let ev;
      if (msg.eventId) {
        ev = EVENTS.get(msg.eventId);
        if (!ev) return { ok: false, error: 'Noticia no encontrada' };
        state.fired[ev.id] = Date.now();
      } else {
        const headline = String(msg.headline || '').trim().slice(0, 140);
        if (!headline) return { ok: false, error: 'Escribe el titular' };
        const effects = {};
        for (const [t, v] of Object.entries(msg.effects || {})) {
          const pct = Number(v);
          if ((t === 'ALL' || TICKERS.includes(t)) && Number.isFinite(pct) && pct !== 0) effects[t] = clamp(pct, MAX_DOWN, MAX_UP);
        }
        ev = { headline, effects };
      }
      applyNews(ev);
      return { ok: true, fired: state.fired };
    }
    case 'surprise': {
      // Sin id: evento al azar. Con id: cae en ese (la ruleta "arreglada"). direct: sin ruleta.
      if (state.phase === 'finished') return { ok: false, error: 'El juego ya cerró' };
      if (!SURPRISES.length) return { ok: false, error: 'No hay eventos sorpresa en config.js' };
      if (rouletteBusy) return { ok: false, error: 'La ruleta ya está girando' };
      const tpl = msg.id ? SURPRISES.find((x) => x.id === msg.id) : randomSurprise();
      if (!tpl) return { ok: false, error: 'Evento no encontrado' };
      const ev = resolveSurprise(tpl);
      if (msg.direct) {
        applyNews(ev);
        return { ok: true, headline: ev.headline };
      }
      const sequence = Array.from({ length: 16 }, () => resolveSurprise(randomSurprise()).headline);
      sequence.push(ev.headline);
      rouletteBusy = true;
      const game = state;
      io.emit('roulette', { sequence, spinMs: ROULETTE_SPIN_MS, holdMs: ROULETTE_HOLD_MS });
      setTimeout(() => {
        rouletteBusy = false;
        if (state === game && state.phase !== 'finished') applyNews(ev);
      }, ROULETTE_SPIN_MS + ROULETTE_HOLD_MS);
      return { ok: true, headline: ev.headline };
    }
    case 'rumor': {
      const ev = EVENTS.get(msg.eventId);
      if (!ev || !ev.rumor) return { ok: false, error: 'Esa noticia no tiene rumor' };
      const to = sendRumor(ev.rumor);
      state.rumors[ev.id] = Date.now();
      dirty = true;
      return { ok: true, to, rumors: state.rumors };
    }
    case 'fakeRumor': {
      const t = TICKERS[Math.floor(Math.random() * TICKERS.length)];
      const list = Math.random() < 0.5 ? FAKE_UP : FAKE_DOWN;
      const text = list[Math.floor(Math.random() * list.length)].replace('$T', '$' + t);
      return { ok: true, to: sendRumor(text), text };
    }
    case 'view':
      if (['auto', 'board', 'ranking', 'qr'].includes(msg.view)) {
        state.view = msg.view;
        broadcastMeta();
      }
      return;
    case 'finish': {
      // Aplica cualquier noticia pendiente para que los precios finales queden quietos.
      for (const t of TICKERS) {
        const s = state.stocks[t];
        s.fair *= Math.exp(s.pending);
        s.pending = 0;
        setPrice(s);
      }
      io.emit('tick', { prices: prices(), hot: null, now: Date.now() });
      state.phase = 'finished';
      state.windowEndsAt = null;
      state.reveal = 0;
      state.final = computeFinal();
      broadcastMeta();
      io.to('screens').to('admins').emit('final', finalForScreens());
      io.emit('bell', { kind: 'final' });
      return;
    }
    case 'unfinish':
      if (state.phase === 'finished') {
        state.phase = 'closed';
        state.final = null;
        state.reveal = 0;
        broadcastMeta();
      }
      return;
    case 'reveal': {
      if (state.phase !== 'finished') return { ok: false, error: 'Primero cierra el mercado (campanazo)' };
      const prev = state.reveal;
      state.reveal = clamp(state.reveal + (Number(msg.delta) || 1), 0, REVEAL_MAX);
      broadcastMeta();
      if (prev < 4 && state.reveal >= 4) {
        for (const id of Object.keys(state.players)) io.to('p:' + id).emit('final-me', finalForPlayer(id));
      }
      return;
    }
    case 'kick': {
      const p = state.players[msg.playerId];
      if (!p) return { ok: false, error: 'Jugador no encontrado' };
      delete state.players[msg.playerId];
      io.to('p:' + msg.playerId).emit('kicked');
      broadcastMeta();
      emitBoards();
      return;
    }
    case 'reset':
      if (msg.confirm !== 'REINICIAR') return { ok: false, error: 'Escribe REINICIAR para confirmar' };
      state = freshState();
      dirty = true;
      io.emit('reset');
      return;
    default:
      return { ok: false, error: 'Acción desconocida' };
  }
}

setInterval(tick, TICK_MS);

process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('SIGTERM', () => {
  dirty = true;
  saveState();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`📈 La pizarra de trii en http://localhost:${PORT}`);
  console.log(`   Jugadores: /   ·   Pantalla: /pantalla   ·   Admin: /admin`);
});
