# Rendimiento: carga, estrés y picos con k6 (sección 2.5)

Ejecución del 20 de noviembre de 2026. Resultados originales (resumen JSON y
reporte HTML de k6) en [`docs/evidencias/k6/`](evidencias/k6/); las tablas se
regeneran con `node load-tests/resumen.mjs`.

## Flujo objetivo (representativo del uso real)

Cada usuario virtual (VU) hace lo mismo que un navegador
(`load-tests/lib/karswcol.js`):

1. **Visitante**: carga el cliente (HTML, CSS, JS, imagen) y consulta
   `/api/auth/config` y `/api/auth/me`.
2. **Jugador**: inicia sesión por `/api/auth/loadtest` (sustituto del login
   de Google, solo existe con `LOAD_TEST_TOKEN`), abre el WebSocket, entra a
   la sala, se marca listo y durante la carrera manda controles (~10
   cambios/s, como un teclado). La sala admite 8 pilotos: los demás quedan
   conectados como espectadores y reciben igual los 20 estados por segundo,
   que es el costo real del servidor (el broadcast crece con las conexiones).

Endpoints: `GET /`, `/css/style.css`, `/js/*.js`, `/img/menu-bg.jpg`,
`GET /api/auth/config`, `GET /api/auth/me`, `POST /api/auth/loadtest`,
`WS /` (mensajes `join`, `ready`, `input`, `restart`).

**Entorno**: servidor (Node 22), k6 v0.54, Prometheus, Grafana, Loki y
Promtail **en el mismo PC** (8 núcleos lógicos, 7,7 GB de RAM, Windows 11),
con `observability/local/start.ps1` y `k6.ps1`. Las métricas de k6 se
enviaron a Prometheus (remote write) y se ven en el dashboard "KARSWCOL —
Pruebas de carga (k6)".

## Qué es una transacción

| Concepto | Definición | Métrica de k6 |
|---|---|---|
| Solicitud | Cada petición HTTP | `http_reqs` |
| **Transacción de negocio** | Una sesión de juego completa: iniciar sesión, conectar el WebSocket, entrar a la sala (o quedar de espectador) y jugar/observar 60 s | `ws_sessions` |
| Mensaje en tiempo real | Estado de carrera recibido por un cliente / control enviado | `karswcol_state_messages`, `ws_msgs_sent` |

`TPS = transacciones / segundos totales`; `TPM = transacciones / minutos totales`.

## Umbrales de aceptación (`THRESHOLDS` en `load-tests/lib/karswcol.js`)

| Indicador | Umbral |
|---|---|
| Checks correctos | > 99 % |
| Errores HTTP | < 1 % |
| HTTP estático p95 / API p95 | < 300 ms / < 200 ms |
| Conexión WebSocket p95 | < 500 ms |
| Inicio de sesión y sesiones WS correctas | > 99 % |
| Entrada a la sala p95 | < 250 ms |
| Gap entre estados p95 / p99 | < 100 ms / < 200 ms (ideal: 50 ms) |

## Resultados

| Prueba | Perfil | Duración | VUs máx | Solicitudes HTTP | TPS (HTTP) | TPM (HTTP) | Sesiones de juego | TPS (negocio) | TPM (negocio) |
|---|---|---|---|---|---|---|---|---|---|
| Carga | 40 jugadores sostenidos 5 min + 5 visitantes/s | 7,0 min | 40 | 15.648 | 37,26 | 2.235 | 253 | 0,602 | 36,1 |
| Estrés | Escalones 100 → 200 → 300 → 400 jugadores + visitantes crecientes | 22,3 min* | 201 | 27.392 | 20,50 | 1.230 | 704 | 0,527 | 31,6 |
| Pico | 5 → 200 jugadores en 10 s y vuelta a 5 | — | — | — | — | — | — | — | — |

| Prueba | HTTP p95 | Errores HTTP | WS conexión p95 | Entrada a sala p95 | Gap entre estados p95 | Estados recibidos/s | Sesiones WS OK | Umbrales incumplidos |
|---|---|---|---|---|---|---|---|---|
| Carga | 8,7 ms | 0,00 % | 6,6 ms | 15 ms | 67 ms | 584 | 100 % | ninguno |
| Estrés | 21,3 ms | 0,00 % | 22,1 ms | 15 ms | 72 ms | 451 | 100 % | ninguno |

Métricas del servidor en Prometheus durante el estrés (máximos de la
ventana): 200 conexiones WebSocket simultáneas, tick p95 de **20 ms**
(presupuesto: 50 ms), intervalo entre ticks p95 de 74 ms, memoria residente
de **108 MB**.

\* Ver "Punto de degradación".

## Punto de degradación

En el escalón de ~200 jugadores **el equipo de pruebas se quedó sin
memoria**: k6 con 200 sesiones WebSocket, el servidor y la pila de
observabilidad compartían 7,7 GB. El sistema operativo congeló los procesos
durante ~17 minutos: el lag del event loop del servidor marcó 1.034 s y k6
registró un gap máximo entre estados de 1.033.642 ms (el mismo congelamiento
visto desde el cliente). Por eso la prueba duró 22 min en vez de 14, no pasó
de 201 VUs y la prueba de pico no alcanzó a ejecutarse.

Interpretación:

- **Hasta 200 conexiones simultáneas el servidor cumple todos los umbrales**:
  0 % de errores, p95 de HTTP en 21 ms, gap entre estados p95 de 72 ms, tick
  p95 de 20 ms y apenas 108 MB de memoria. El servidor no fue el cuello de
  botella.
- **El cuello de botella observado fue el host de pruebas** (generador de
  carga y servidor en la misma máquina). La capacidad máxima del servidor
  queda acotada por debajo: **≥ 200 conexiones con todos los umbrales en
  verde**.
- **TPS máximo sostenible medido**: 37,3 solicitudes HTTP/s (2.235 TPM) en la
  carga, con 584 mensajes de estado por segundo entregados en tiempo real; en
  negocio, 0,60 sesiones de juego/s (36 TPM). En el estrés el TPS HTTP es
  menor (20,5) porque el congelamiento de 17 min queda dentro del tiempo total
  de la prueba.

Señales para reconocer la degradación en Grafana y Prometheus (alertas en
`observability/prometheus/alerts.yml`): `TickFueraDePresupuesto` (tick p95
> 35 ms), `TicksAtrasados` (intervalo p95 > 75 ms), `EventLoopBloqueado`
(lag p99 > 100 ms) y `MemoriaAlta`. En este congelamiento la métrica que
superó su umbral fue el lag del event loop (1.034 s frente a 100 ms).

## Cuellos de botella y acciones de mejora

1. **Separar el generador de carga del servidor** (otro PC o una VM): es
   requisito para medir el límite real del servidor y para correr la prueba
   de pico.
2. Repetir el estrés **sin Grafana/Loki** en el mismo equipo (k6 sigue
   enviando a Prometheus) o con `MAX_VUS=250` para quedarse por debajo del
   límite de memoria.
3. En el servidor, el costo crece con el broadcast de 20 estados/s a cada
   conexión: enviar estados delta o reducir la frecuencia para espectadores
   bajaría CPU y red cuando haya cientos de conexiones.
4. En producción (Render gratuito: 0,1 CPU y 512 MB) la capacidad será menor
   que en este PC: conviene una prueba de humo contra Render
   (`k6 run -e BASE_URL=https://karswcol.onrender.com smoke.js`, con
   `LOAD_TEST_TOKEN` configurado temporalmente) antes de cualquier evento con
   muchos jugadores.

## Correlación con Prometheus y Grafana

Cada ejecución lleva la etiqueta `testid` (por ejemplo
`stress-20261120-171627`) y el dashboard "KARSWCOL — Pruebas de carga (k6)"
la usa para mostrar, en la misma línea de tiempo, los VUs y peticiones de k6
junto con las conexiones, el tick y la memoria del servidor: antes (reposo),
durante (escalones) y después (bajada). Para capturar las imágenes del
informe: `observability/local/start.ps1`, abrir Grafana en
`http://localhost:3001` y elegir el rango 17:09–17:40 del 20/11/2026 (los
datos quedaron en el almacenamiento local de Prometheus).

## Pendiente

- Ejecutar la **prueba de pico** (`spike.js`) con memoria suficiente (ver
  acción 1 o 2) y agregar su fila con `node load-tests/resumen.mjs`.
