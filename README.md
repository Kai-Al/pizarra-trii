# 📈 La pizarra de trii

Juego de bolsa en vivo para la presentación interna. Cada área de trii es una acción, todos arrancan con **$1.000** y gana quien termine con la mayor rentabilidad.

| URL | Quién la usa |
| --- | --- |
| `/` | Jugadores, desde el celular (entran por QR) |
| `/pantalla` | El proyector |
| `/admin` | Quien presenta (laptop o celular), con PIN |

## Correrlo en tu computador

```bash
npm install
npm start
```

Abre `http://localhost:3000/pantalla`. El QR apunta a la IP de tu red local, así que los celulares conectados al mismo WiFi pueden entrar. El PIN por defecto es `trii`.

### Ensayar con jugadores falsos

```bash
npm run bots -- 35
```

Conecta 35 bots que compran y venden al azar cuando el mercado está abierto. Para ensayar contra el servidor publicado: `npm run bots -- 35 https://tu-app.onrender.com`. Al terminar, usa **Reiniciar juego** en el admin; los bots se desconectan solos.

## Publicarlo gratis en Render

1. Sube esta carpeta a un repo de GitHub (puede ser privado).
2. En [render.com](https://render.com), entra con GitHub y elige **New → Blueprint**. Selecciona el repo; Render lee `render.yaml`.
3. Cuando te lo pida, define `ADMIN_PIN` con un PIN que solo sepa quien presenta. **Es obligatorio:** como el repo es público, en Render el admin queda bloqueado si no lo defines.
4. Espera el deploy (2-3 minutos). Te queda una URL como `https://pizarra-trii.onrender.com`.

Si Blueprint no aparece, usa **New → Web Service** con el repo, Build `npm install`, Start `npm start`, instancia **Free**, y agrega `ADMIN_PIN` en *Environment*.

**Cosas a saber del plan gratis:**

- Si pasan 15 minutos sin tráfico, el servidor se duerme y despertarlo tarda alrededor de 1 minuto. **Abre `/pantalla` 5 minutos antes de empezar.** Mientras la pantalla y el admin estén abiertos, se mantiene despierto.
- Todo vive en memoria. Si Render reinicia o redespliega el servicio, el juego vuelve a cero. **No hagas deploy durante la presentación.**

## Guion para quien presenta

**Antes de empezar**

1. Abre `/pantalla` en el computador del proyector, pantalla completa (F11 o ⌃⌘F), y haz clic en **🔊 Activar sonido**.
2. Abre `/admin` en tu celular o laptop.
3. Mientras no abras el mercado, la pantalla muestra el QR solita. Deja ese QR visible mientras la gente llega.

**Durante la presentación** (cada bloque de la agenda ya tiene noticias listas en el admin)

| Bloque | Qué hacer |
| --- | --- |
| Apertura | 📣 *Suena la campana* → **Abrir 2 min**. Todos hacen sus primeras compras. |
| Cumpleaños | Mientras presentan: 🤫 rumor. Al terminar: 📣 noticia → **Abrir 60s**. |
| Aniversarios | 📣 noticia → **Abrir 60s**. |
| Nuevos trilers | 🤫 rumor → 📣 noticia → **Abrir 60s**. |
| Métricas CX | 🤫 rumor de CSAT mientras presentan → 📣 noticias de CX → **Abrir 90s**. |
| Espacio de producto | 🤫 rumor mientras presentan → 📣 noticias → **Abrir 90s**. 🎲 Buen momento para una ruleta. |
| Próximos hosts | 📣 noticia → **Abrir 60s**. |
| Actividad · cierre | 📣 2-3 noticias de cierre → **Abrir 90s** → **🔔 Campanazo final** → **Revelar siguiente** ×5. |

Toca el nombre de cada bloque en el admin para marcarlo como actual (el título de la pantalla cambia). Los botones de **Pantalla grande** cambian entre Pizarra, Ranking y QR cuando quieras.

**Premiación** (cada clic en *Revelar siguiente*): precios finales → puestos 10 al 4 → 3º → 2º → 1º con confeti 🎉 → premios especiales. Cuando sale el 1º, cada jugador ve en su celular en qué puesto quedó.

## 🎲 Eventos sorpresa (ruleta)

Desde el admin, **🎲 Ruleta** muestra en el proyector una ruleta que gira unos 4 segundos entre titulares y frena en uno. Cuando cae, los precios se mueven. Cada evento en el admin también tiene:

- **🎯 Ruleta**: gira, pero cae en ese evento ("ruleta arreglada").
- **📣 Directo**: lo lanza sin ruleta.

Se definen en `surprises` dentro de [`config.js`](config.js). En los titulares, `{t}` y `{area}` se reemplazan por una acción al azar, y `{t2}` / `{area2}` por otra distinta. En los efectos, `RANDOM` y `RANDOM2` son esas mismas acciones:

```js
{ id: 'back-la-rompe', headline: '🚀 Backend la rompe', effects: { BKND: 2 } },        // +200%
{ id: 'host-manipulo', headline: '🕵️ El host manipuló el mercado', effects: { ALL: -0.5 } }, // todo -50%
{ id: 'squeeze', headline: '💸 Short squeeze en {t}', effects: { RANDOM: 1.5 } },     // una al azar +150%
```

Límites: una acción puede subir hasta **+500%** y caer hasta **−90%**. Un −500% no existe: con −100% la acción ya vale cero.

## Cómo se mueven los precios

- **Noticias:** el efecto se aplica en unos 10 segundos, así que se ve como un rally y no como un salto.
- **Oferta y demanda:** cada compra sube el precio y cada venta lo baja (1.000 USD mueven cerca de 2,5%). Comprar y vender de inmediato devuelve lo mismo, así que nadie gana con su propio impacto.
- **Ruido:** pequeñas variaciones mientras el mercado está abierto, para que el gráfico nunca esté quieto.
- **Ventas:** se hacen al precio de mercado de ese momento.

## Editar acciones, noticias y rumores

Todo está en [`config.js`](config.js): las 9 acciones, la agenda, los titulares, sus efectos (`0.12` = +12%) y los rumores. Cambia los titulares de ejemplo por lo que realmente se va a presentar, y escríbelos con los líderes de cada área. También puedes lanzar noticias personalizadas desde el admin.

**Recomendación:** mantén las noticias negativas chiquitas y graciosas, y procura que todas las áreas terminen por encima de 100. La competencia es entre jugadores, no entre equipos.
