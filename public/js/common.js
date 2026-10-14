// Utilidades compartidas por las tres pantallas.

const NUM = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM1 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const fmt = {
  num: (n) => NUM.format(n),
  money: (n) => (n < 0 ? '-$' : '$') + NUM.format(Math.abs(n)),
  pct: (r) => (r >= 0 ? '+' : '') + NUM1.format(r * 100) + '%',
  arrow: (r) => (r >= 0 ? '▲' : '▼'),
  shares: (n) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: n < 10 ? 3 : 2 }).format(n),
  clock: (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  },
  time: (ts) => new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

// Mercado local: precios e historial que se van alimentando con los ticks del servidor.
const market = {
  cfg: null,
  history: {},
  prices: {},
  hot: null,
  meta: null,
  offset: 0, // reloj del servidor - reloj local
  load(payload) {
    this.cfg = payload.config;
    this.history = payload.history;
    this.hot = payload.hot;
    for (const s of this.cfg.stocks) {
      const h = this.history[s.ticker];
      this.prices[s.ticker] = h[h.length - 1];
    }
    this.setMeta(payload.meta);
  },
  setMeta(m) {
    this.meta = m;
    this.offset = m.now - Date.now();
  },
  applyTick(t) {
    this.cfg.stocks.forEach((s, i) => {
      const h = this.history[s.ticker];
      h.push(t.prices[i]);
      if (h.length > this.cfg.historyCap) h.shift();
      this.prices[s.ticker] = t.prices[i];
    });
    this.hot = t.hot;
    if (t.now) this.offset = t.now - Date.now();
  },
  change(ticker) {
    return this.prices[ticker] / this.cfg.ipoPrice - 1;
  },
  remaining() {
    if (!this.meta || !this.meta.windowEndsAt) return null;
    return this.meta.windowEndsAt - (Date.now() + this.offset);
  },
  valueOf(me) {
    let v = me.cash;
    for (const [t, sh] of Object.entries(me.holdings || {})) v += sh * (this.prices[t] || 0);
    return v;
  },
  blockTitle() {
    const b = this.cfg.blocks.find((x) => x.id === this.meta.currentBlock);
    return b ? b.title : '';
  },
};

// Sparkline en SVG: línea + relleno degradado. Verde si está sobre el precio de apertura.
let sparkId = 0;
function sparkline(svg, data, base, opts = {}) {
  const w = opts.w || 200;
  const h = opts.h || 60;
  const pad = opts.pad ?? 4;
  const pts = data.length > 1 ? data : [data[0], data[0]];
  const step = Math.max(1, Math.floor(pts.length / (opts.maxPoints || 120)));
  const sample = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  let min = Math.min(...sample);
  let max = Math.max(...sample);
  if (max - min < base * 0.01) {
    const mid = (max + min) / 2;
    min = mid - base * 0.005;
    max = mid + base * 0.005;
  }
  const x = (i) => (i / (sample.length - 1)) * w;
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
  const line = sample.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const up = data[data.length - 1] >= base;
  const color = up ? 'var(--up)' : 'var(--down)';
  if (!svg.dataset.gid) svg.dataset.gid = 'g' + ++sparkId;
  const gid = svg.dataset.gid;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML =
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
    (opts.fill === false ? '' : `<path d="${line}L${w},${h}L0,${h}Z" fill="url(#${gid})"/>`) +
    `<path d="${line}" fill="none" stroke="${color}" stroke-width="${opts.stroke || 2.5}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
}

function badge(r) {
  return `<span class="badge ${r >= 0 ? 'up' : 'down'}">${fmt.arrow(r)} ${fmt.pct(r)}</span>`;
}

function effectChips(effects) {
  return Object.entries(effects || {})
    .map(([t, v]) => `<span class="chip ${v >= 0 ? 'up' : 'down'}">${t === 'ALL' ? 'Todo el mercado' : '$' + esc(t)} ${fmt.arrow(v)} ${fmt.pct(v)}</span>`)
    .join('');
}

function storage(kind) {
  try {
    const s = window[kind];
    const k = '__t';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    const mem = {};
    return { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
  }
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'Sin conexión, intenta de nuevo' } : res));
  });
}
