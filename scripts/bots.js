// Simula jugadores para ensayar: node scripts/bots.js [cantidad] [url]
// Ejemplo: npm run bots -- 35 https://tu-app.onrender.com
const { io } = require('socket.io-client');

const N = Number(process.argv[2]) || 30;
const URL = process.argv[3] || 'http://localhost:3000';
const NAMES = ['Ana', 'Luis', 'Sofi', 'Juanpa', 'Vale', 'Andrés', 'Cami', 'Mateo', 'Dani', 'Lu', 'Sebas', 'Majo', 'Nico', 'Pau', 'Santi', 'Isa', 'Tomás', 'Caro', 'Felipe', 'Mari', 'Diego', 'Juli', 'Simón', 'Gabi', 'Leo', 'Manu', 'Emi', 'Sara', 'Pipe', 'Lau'];
const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐵', '🦄', '🐙', '🐳', '🦖', '🐝', '🦉', '🐧', '🐨', '🦩', '🌵'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

for (let i = 0; i < N; i++) {
  setTimeout(() => bot(i), i * 120);
}

function bot(i) {
  const socket = io(URL, { transports: ['websocket'] });
  let me = null;
  let cfg = null;
  let phase = 'lobby';
  const style = pick(['holder', 'trader', 'trader', 'random']);

  socket.on('connect', () => {
    socket.emit('hello', { role: 'player' }, (res) => {
      cfg = res.config;
      phase = res.meta.phase;
      const name = `${NAMES[i % NAMES.length]} ${i + 1}`;
      socket.emit('join', { name, area: pick(cfg.areas), emoji: pick(EMOJIS) }, (r) => {
        if (r.ok) me = r.me;
        else console.log('join falló', name, r.error);
      });
    });
  });
  socket.on('meta', (m) => (phase = m.phase));
  socket.on('reset', () => process.exit(0));

  setInterval(() => {
    if (!me || phase !== 'open') return;
    const wait = style === 'holder' ? 0.15 : 0.45;
    if (Math.random() > wait) return;
    const owned = Object.keys(me.holdings);
    const sell = owned.length && (style === 'trader' ? Math.random() < 0.45 : Math.random() < 0.15);
    const msg = sell
      ? { side: 'sell', ticker: pick(owned), pct: pick([0.25, 0.5, 1]) }
      : { side: 'buy', ticker: pick(cfg.stocks).ticker, usd: Math.min(me.cash, pick([50, 100, 150, 250, 300])) };
    if (msg.side === 'buy' && msg.usd < 1) return;
    socket.emit('trade', msg, (r) => {
      if (r.ok) me = r.me;
    });
  }, 1500 + Math.random() * 1500);
}

console.log(`🤖 ${N} bots conectándose a ${URL} (Ctrl+C para salir)`);
