// Prueba de carga: node scripts/loadtest.js [jugadores] [url] [minutos]
// Conecta N jugadores falsos, mide latencias y retrasos, y al final se salen solos del juego.
// Las compras solo pasan con el mercado abierto: ábrelo desde /admin mientras corre la prueba.
// La prueba termina sola unos segundos después de que el mercado vuelve a cerrar (o al cumplir los minutos).
const { io } = require('socket.io-client');

const N = Number(process.argv[2]) || 50;
const URL = (process.argv[3] || 'http://localhost:3000').replace(/\/$/, '');
const MINUTES = Number(process.argv[4]) || 10;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐵', '🦄', '🐙', '🐳', '🦖', '🐝', '🦉', '🐧', '🐨', '🦩', '🌵'];

const stats = {
  start: Date.now(),
  connectMs: [],
  joinMs: [],
  joined: 0,
  joinErrors: [],
  connected: 0,
  disconnects: 0,
  reconnects: 0,
  probeMs: [], // latencia con el mercado cerrado
  tradeMs: [], // latencia de compras/ventas con el mercado abierto
  tradeOk: 0,
  tradeErrors: {},
  ticks: 0,
  slowTicks: 0, // ticks que llegaron más de 1,5 s después del anterior
  maxTickGap: 0,
  openSeenAt: null,
  closedAfterOpenAt: null,
  phase: '?',
};

const bots = [];
const RUN = Math.random().toString(36).slice(2, 4); // evita choques de nombre entre corridas

function pct(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

function line() {
  const t = Math.round((Date.now() - stats.start) / 1000);
  const tr = stats.tradeMs.length ? `ops ${stats.tradeOk} ok (p50 ${pct(stats.tradeMs, 50)} ms · p95 ${pct(stats.tradeMs, 95)} ms)` : 'ops 0';
  const pr = stats.probeMs.length ? `ping p50 ${pct(stats.probeMs, 50)} ms` : 'ping -';
  return `t=${t}s | conectados ${stats.connected}/${N} | en juego ${stats.joined} | mercado ${stats.phase} | ${tr} | ${pr} | ticks lentos ${stats.slowTicks}/${stats.ticks} | desconexiones ${stats.disconnects}`;
}

function bot(i) {
  const b = { i, me: null, cfg: null, phase: 'lobby', lastTick: null, everConnected: false };
  bots.push(b);
  const t0 = Date.now();
  const socket = io(URL, { transports: ['websocket'], reconnectionDelay: 500 });
  b.socket = socket;

  socket.on('connect', () => {
    stats.connected++;
    if (b.everConnected) stats.reconnects++;
    else stats.connectMs.push(Date.now() - t0);
    b.everConnected = true;
    socket.emit('hello', { role: 'player', playerId: b.me && b.me.id }, (res) => {
      if (!res || !res.ok) return;
      b.cfg = res.config;
      b.phase = res.meta.phase;
      stats.phase = b.phase;
      if (res.me) return;
      const j0 = Date.now();
      const name = `Bot ${String(i + 1).padStart(2, '0')} ${RUN}`;
      socket.emit('join', { name, area: pick(b.cfg.areas), emoji: pick(EMOJIS) }, (r) => {
        if (r && r.ok) {
          b.me = r.me;
          stats.joined++;
          stats.joinMs.push(Date.now() - j0);
        } else {
          stats.joinErrors.push(r ? r.error : 'sin respuesta');
        }
      });
    });
  });
  socket.on('disconnect', () => {
    if (done) return;
    stats.connected--;
    stats.disconnects++;
  });
  socket.on('meta', (m) => {
    if (b.phase !== 'open' && m.phase === 'open' && !stats.openSeenAt) stats.openSeenAt = Date.now();
    if (b.phase === 'open' && m.phase !== 'open' && stats.openSeenAt && !stats.closedAfterOpenAt) stats.closedAfterOpenAt = Date.now();
    b.phase = m.phase;
    stats.phase = m.phase;
  });
  socket.on('tick', () => {
    const now = Date.now();
    if (b.phase === 'open' && b.lastTick) {
      const gap = now - b.lastTick;
      stats.ticks++;
      if (gap > 1500) stats.slowTicks++;
      stats.maxTickGap = Math.max(stats.maxTickGap, gap);
    }
    b.lastTick = now;
  });
  socket.on('meta', (m) => {
    if (m.phase !== 'open') b.lastTick = null;
  });
  socket.on('reset', () => finish('El admin reinició el juego'));

  // Cada bot opera en promedio cada ~4 s con el mercado abierto (más que una persona real).
  b.timer = setInterval(() => {
    if (!b.me || !socket.connected) return;
    if (b.phase !== 'open') {
      if (Math.random() < 0.2) {
        const p0 = Date.now();
        socket.emit('trade', { side: 'buy', ticker: b.cfg.stocks[0].ticker, usd: 1 }, () => stats.probeMs.push(Date.now() - p0));
      }
      return;
    }
    if (Math.random() > 0.5) return;
    const owned = Object.keys(b.me.holdings);
    const sell = owned.length && Math.random() < 0.35;
    const msg = sell
      ? { side: 'sell', ticker: pick(owned), pct: pick([0.25, 0.5, 1]) }
      : { side: 'buy', ticker: pick(b.cfg.stocks).ticker, usd: Math.min(b.me.cash, pick([50, 100, 150, 250])) };
    if (msg.side === 'buy' && msg.usd < 1) return;
    const t1 = Date.now();
    socket.emit('trade', msg, (r) => {
      stats.tradeMs.push(Date.now() - t1);
      if (r && r.ok) {
        stats.tradeOk++;
        b.me = r.me;
      } else {
        const e = (r && r.error) || 'sin respuesta';
        stats.tradeErrors[e] = (stats.tradeErrors[e] || 0) + 1;
      }
    });
  }, 1500 + Math.random() * 1000);
}

let done = false;
async function finish(reason) {
  if (done) return;
  done = true;
  clearInterval(progress);
  console.log(`\n⏹  ${reason}. Sacando a los bots del juego…`);
  await Promise.all(
    bots.map(
      (b) =>
        new Promise((resolve) => {
          clearInterval(b.timer);
          if (!b.socket.connected || !b.me) {
            b.socket.close();
            return resolve();
          }
          b.socket.timeout(5000).emit('leave', {}, () => {
            b.socket.close();
            resolve();
          });
        }),
    ),
  );

  const errs = Object.entries(stats.tradeErrors).map(([e, n]) => `${e} (${n})`).join(', ') || 'ninguno';
  console.log(`
===== Resultado =====
Servidor:            ${URL}
Jugadores:           ${stats.joined}/${N} entraron${stats.joinErrors.length ? ` · errores: ${[...new Set(stats.joinErrors)].join(', ')}` : ''}
Conexión:            p50 ${pct(stats.connectMs, 50)} ms · p95 ${pct(stats.connectMs, 95)} ms · máx ${pct(stats.connectMs, 100)} ms
Entrar al juego:     p50 ${pct(stats.joinMs, 50)} ms · p95 ${pct(stats.joinMs, 95)} ms
Ping (cerrado):      p50 ${pct(stats.probeMs, 50) ?? '-'} ms · p95 ${pct(stats.probeMs, 95) ?? '-'} ms
Mercado abierto:     ${stats.openSeenAt ? `sí (${Math.round(((stats.closedAfterOpenAt || Date.now()) - stats.openSeenAt) / 1000)} s)` : 'no se abrió durante la prueba'}
Compras/ventas:      ${stats.tradeOk} ok · ${stats.tradeMs.length ? `p50 ${pct(stats.tradeMs, 50)} ms · p95 ${pct(stats.tradeMs, 95)} ms · máx ${pct(stats.tradeMs, 100)} ms` : '-'}
Rechazadas:          ${errs}
Ticks de precio:     ${stats.ticks} recibidos · ${stats.slowTicks} con más de 1,5 s de retraso · peor brecha ${stats.maxTickGap} ms
Desconexiones:       ${stats.disconnects} · reconexiones ${stats.reconnects}
`);
  setTimeout(() => process.exit(0), 300);
}

console.log(`🤖 Conectando ${N} jugadores a ${URL} (máx ${MINUTES} min)…`);
for (let i = 0; i < N; i++) setTimeout(() => bot(i), i * 60);

const progress = setInterval(() => {
  console.log(line());
  if (stats.closedAfterOpenAt && Date.now() - stats.closedAfterOpenAt > 8000) finish('El mercado abrió y volvió a cerrar');
}, 5000);
setTimeout(() => finish(`Se cumplieron ${MINUTES} minutos`), MINUTES * 60 * 1000);
process.on('SIGINT', () => finish('Interrumpido'));
