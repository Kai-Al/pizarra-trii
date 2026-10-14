// Todo lo editable del juego vive aquí: acciones, agenda y noticias.
// Los efectos son porcentajes: 0.12 = +12%, -0.04 = -4%. "ALL" mueve todo el mercado.

module.exports = {
  title: 'La pizarra de trii',
  date: '15 OCT 2026',

  startingCash: 1000,
  ipoPrice: 100,

  // Cuánto mueve el precio cada USD comprado o vendido (0.000025 => 1.000 USD mueven ~2,5%)
  impactPerUsd: 0.000025,
  // Ruido cuando el mercado está abierto (mean-reverting, ~0,7% de desviación)
  noise: 0.0025,
  // Duración por defecto de una ventana de mercado, en segundos
  windowSeconds: 90,
  // Cuántos jugadores reciben cada rumor
  rumorRecipients: 5,

  stocks: [
    { ticker: 'FRNT', name: 'Frontend' },
    { ticker: 'BKND', name: 'Backend' },
    { ticker: 'UXD', name: 'Diseño' },
    { ticker: 'CXX', name: 'Customer experience' },
    { ticker: 'PROD', name: 'Producto' },
    { ticker: 'LGL', name: 'Legal' },
    { ticker: 'FIN', name: 'Finanzas' },
    { ticker: 'GRWT', name: 'Growth' },
    { ticker: 'MKTG', name: 'Marketing' },
  ],

  // Áreas que no cotizan pero que la gente puede elegir al entrar
  otherAreas: ['Liderazgo', 'People', 'Operaciones', 'Otra área'],

  // Eventos sorpresa para la ruleta 🎲. Se pueden lanzar en cualquier momento desde el admin.
  // En los titulares, {t} y {area} se reemplazan por una acción al azar ($BKND / Backend),
  // y {t2} / {area2} por otra distinta. En los efectos, RANDOM y RANDOM2 son esas mismas acciones.
  // Límites: una acción puede subir hasta +500% (5) y caer hasta -90% (-0.9); no puede valer menos que cero.
  surprises: [
    { id: 'back-la-rompe', headline: '🚀 Backend la rompe', effects: { BKND: 2 } },
    { id: 'host-manipulo', headline: '🕵️ El host manipuló el mercado', effects: { ALL: -0.5 } },
    { id: 'unicornio', headline: '🦄 {area} se volvió unicornio', effects: { RANDOM: 1 } },
    { id: 'bug', headline: '🐛 Bug en producción: {t} se desploma', effects: { RANDOM: -0.4 } },
    { id: 'squeeze', headline: '💸 Short squeeze en {t}', effects: { RANDOM: 1.5 } },
    { id: 'robin-hood', headline: '🏹 Robin Hood: le quita a {t} y le da a {t2}', effects: { RANDOM: -0.3, RANDOM2: 0.6 } },
    { id: 'fusion', headline: '🤝 Fusión sorpresa entre {area} y {area2}', effects: { RANDOM: 0.5, RANDOM2: 0.5 } },
    { id: 'pizza', headline: '🍕 Llegó pizza: todo el mercado sube', effects: { ALL: 0.15 } },
    { id: 'cafe', headline: '☕ Se acabó el café: pánico general', effects: { ALL: -0.2 } },
  ],

  // La agenda de la presentación, en orden. Cada bloque trae noticias listas para lanzar.
  // ✏️ Ajusta titulares y tickers con lo que realmente se va a presentar.
  blocks: [
    {
      id: 'apertura',
      title: 'Apertura',
      events: [
        {
          id: 'ipo',
          headline: '🔔 Suena la campana: la pizarra de trii abre al público',
          effects: {},
        },
      ],
    },
    {
      id: 'cumples',
      title: 'Cumpleaños',
      events: [
        {
          id: 'torta',
          headline: '🎂 Hay torta en la oficina: todo el mercado sube',
          effects: { ALL: 0.03 },
          rumor: 'Dicen que hoy hay torta… y que eso le hace bien a todo el mercado 🍰',
        },
        {
          id: 'cumple-area',
          headline: '🥳 Doble cumpleaños en Growth: invitan las empanadas',
          effects: { GRWT: 0.07 },
          rumor: 'Alguien vio bolsas de empanadas entrando por el lado de Growth 👀',
        },
      ],
    },
    {
      id: 'aniversarios',
      title: 'Aniversarios',
      events: [
        {
          id: 'veteranos',
          headline: '🏅 Aniversarios: la experiencia cotiza al alza',
          effects: { BKND: 0.05, FIN: 0.04, LGL: 0.04 },
          rumor: 'Los veteranos de Backend, Finanzas y Legal están de aniversario…',
        },
      ],
    },
    {
      id: 'nuevos',
      title: 'Nuevos trilers',
      events: [
        {
          id: 'talento',
          headline: '👋 Llega talento nuevo: Frontend y Diseño se refuerzan',
          effects: { FRNT: 0.06, UXD: 0.06 },
          rumor: 'Hay caras nuevas sentadas cerca de Frontend y Diseño 🤫',
        },
        {
          id: 'deploy-dia-1',
          headline: '🚀 Un nuevo triler hizo deploy el primer día',
          effects: { BKND: 0.08 },
          rumor: 'Dicen que un nuevo de Backend ya está tocando producción…',
        },
      ],
    },
    {
      id: 'cx',
      title: 'Métricas CX',
      events: [
        {
          id: 'csat',
          headline: '📈 CSAT récord este mes: los usuarios aman a CX',
          effects: { CXX: 0.12 },
          rumor: 'Me contaron que las métricas de CX vienen muy, muy bien 📈',
        },
        {
          id: 'tiempo-respuesta',
          headline: '⚡ Tiempo de respuesta en mínimo histórico',
          effects: { CXX: 0.08 },
          rumor: 'CX está respondiendo más rápido que nunca, dicen…',
        },
        {
          id: 'tickets',
          headline: '😅 Llegaron 2.000 tickets en una semana',
          effects: { CXX: -0.04 },
          rumor: 'Ojo con CX: dicen que la bandeja de tickets está llena 😬',
        },
      ],
    },
    {
      id: 'producto',
      title: 'Espacio de producto',
      events: [
        {
          id: 'feature',
          headline: '🚀 Nuevo feature en producción sin un solo incidente',
          effects: { PROD: 0.1, FRNT: 0.06, BKND: 0.06 },
          rumor: 'Producto viene con un anuncio grande… y Front y Back están metidos 🚀',
        },
        {
          id: 'rediseno',
          headline: '🎨 El rediseño enamoró a los usuarios',
          effects: { UXD: 0.09 },
          rumor: 'Dicen que los usuarios están felices con lo nuevo de Diseño 🎨',
        },
        {
          id: 'boton',
          headline: '🔁 Front cambió el color del botón por 7ª vez',
          effects: { FRNT: -0.03 },
          rumor: 'Front está otra vez discutiendo el color de un botón…',
        },
      ],
    },
    {
      id: 'hosts',
      title: 'Próximos hosts',
      events: [
        {
          id: 'hosts-mktg',
          headline: '🎤 Marketing será host: se viene show',
          effects: { MKTG: 0.08 },
          rumor: 'Se rumora que los próximos hosts salen de Marketing 🎤',
        },
        {
          id: 'legal-ok',
          headline: '⚖️ Legal aprobó un contrato en tiempo récord',
          effects: { LGL: 0.1 },
          rumor: 'Legal anda aprobando todo a la velocidad de la luz ⚖️',
        },
      ],
    },
    {
      id: 'actividad',
      title: 'Actividad · cierre',
      events: [
        {
          id: 'presupuesto',
          headline: '💰 Finanzas cuadró el presupuesto al centavo',
          effects: { FIN: 0.08 },
          rumor: 'Finanzas está sonriendo mucho hoy… 💰',
        },
        {
          id: 'viral',
          headline: '📣 La campaña de Marketing se volvió viral',
          effects: { MKTG: 0.1 },
          rumor: 'Marketing tiene algo que se está moviendo mucho en redes 📣',
        },
        {
          id: 'meta-growth',
          headline: '📊 Growth rompió la meta de usuarios',
          effects: { GRWT: 0.09 },
          rumor: 'Growth está a punto de anunciar algo grande 📊',
        },
        {
          id: 'rally',
          headline: '🏁 Rally de cierre: todo el mercado sube',
          effects: { ALL: 0.05 },
          rumor: 'Dicen que el cierre viene con fiesta para todo el mercado 🏁',
        },
      ],
    },
  ],
};
