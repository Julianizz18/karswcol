# Observabilidad y pruebas de carga

KARSWCOL tiene los tres pilares de observabilidad (**métricas, logs y
alertas**) y una batería de **pruebas de carga con k6**. Todo arranca con
Docker Compose y queda conectado entre sí:

```
                 ┌────────────── remote-write ──────────────┐
                 │                                          ▼
  k6 (carga) ──WS/HTTP──▶ gateway :3000 ──/metrics──▶ Prometheus :9090 ──▶ Grafana :3001
                              │ logs JSON (stdout)          │ alerts.yml        ▲
                              ▼                             ▼                   │
                         Promtail ─────────────────────▶ Loki :3100 ────────────┘
```

| Herramienta | Para qué | URL |
|---|---|---|
| **prom-client** | Instrumenta el servidor Node y expone `GET /metrics` | http://localhost:3000/metrics |
| **Prometheus** | Recolecta las métricas cada 5 s, evalúa alertas, recibe las métricas de k6 | http://localhost:9090 |
| **Grafana** | Dashboards de servidor y de pruebas de carga, explorador de logs | http://localhost:3001 (admin / admin) |
| **Loki + Promtail** | Promtail lee los logs de Docker y los envía a Loki | (dentro de Grafana → Explore → Loki) |
| **k6** | Pruebas de humo, carga, estrés, pico y resistencia | panel en vivo: http://localhost:5665 |
| `GET /health` | Estado del proceso para Docker (`healthcheck`) y balanceadores | http://localhost:3000/health |

---

## 1. Arrancar todo

```bash
# .env en la raíz del repo (junto a docker-compose.yml)
GOOGLE_CLIENT_ID=...                  # para jugar con login real
LOAD_TEST_TOKEN=un-valor-largo-y-aleatorio   # habilita el login sintético de k6
```

```bash
docker compose up --build -d
```

Abrir Grafana en http://localhost:3001. El dashboard de inicio es
**KARSWCOL — Servidor**; desde el enlace de arriba se pasa a **KARSWCOL —
Pruebas de carga (k6)**. Los dashboards, fuentes de datos y alertas se
crean solos al arrancar (carpeta `observability/`), no hay que configurar
nada a mano.

> `LOAD_TEST_TOKEN` habilita `POST /api/auth/loadtest`, que entrega sesiones
> de pilotos sintéticos sin pasar por Google. Si la variable está vacía el
> endpoint **no existe** (responde 404). No se debe definir en producción.

---

## 2. Métricas del servidor

Definidas en `server/src/observability/metrics.js`. Todas llevan el prefijo
`karswcol_` y la etiqueta `app="karswcol"`.

### Game loop (lo más importante)

El servidor es autoritativo y simula la carrera a **20 Hz: un tick cada 50 ms**.

| Métrica | Tipo | Qué indica |
|---|---|---|
| `karswcol_tick_duration_seconds` | histograma | CPU que consume cada tick (física, bots, objetos, broadcast). Debe quedar muy por debajo de 50 ms |
| `karswcol_tick_interval_seconds` | histograma | Tiempo **real** entre ticks. Ideal 50 ms; si sube, el event loop está saturado y los jugadores ven saltos |
| `karswcol_ticks_total` | contador | Ticks ejecutados (≈ 20/s en carrera) |
| `karswcol_nodejs_eventloop_lag_*` | gauge | Lag del event loop de Node (métrica por defecto) |

### Sala y juego

| Métrica | Tipo | Etiquetas |
|---|---|---|
| `karswcol_room_state` | gauge (1 en el estado activo) | `state` = lobby, countdown, racing, results |
| `karswcol_room_players` | gauge | `kind` = human, bot |
| `karswcol_room_paused` | gauge | — |
| `karswcol_races_started_total` | contador | `track` |
| `karswcol_races_finished_total` | contador | `track`, `reason` = all_finished, grace, time_limit |
| `karswcol_race_duration_seconds` | histograma | — |
| `karswcol_laps_completed_total` | contador | `kind` |
| `karswcol_game_events_total` | contador | `kind` (objetos recogidos, lluvia, …) |
| `karswcol_weather_refresh_total` | contador | `result` = ok, error (API externa Open-Meteo) |

### Red

| Métrica | Tipo | Etiquetas |
|---|---|---|
| `karswcol_ws_connections` | gauge | conexiones WebSocket autenticadas |
| `karswcol_ws_connections_total` | contador | `result` = accepted, rejected |
| `karswcol_ws_messages_received_total` | contador | `type` (join, input, ready, …, invalid, unknown) |
| `karswcol_ws_messages_sent_total` | contador | `type` (state, lobby_update, …); un broadcast a N clientes suma N |
| `karswcol_ws_bytes_sent_total` | contador | ancho de banda de salida |
| `karswcol_ws_broadcast_duration_seconds` | histograma | serializar + enviar a todos |
| `karswcol_join_rejections_total` | contador | `reason` = room_full, race_in_progress |
| `karswcol_http_requests_total` | contador | `method`, `route`, `status` |
| `karswcol_http_request_duration_seconds` | histograma | `method`, `route` |

Además, `prom-client` publica las métricas estándar de Node: CPU, memoria
residente, heap, garbage collector, handles abiertos, etc.

**Cardinalidad acotada:** las etiquetas nunca llevan ids de jugador ni URLs
arbitrarias. Una ruta HTTP desconocida se agrupa como `static`, `not_found`
o `/api/other`, así nadie puede llenar Prometheus de series pidiendo URLs
inventadas (hay una prueba que lo verifica).

---

## 3. Logs estructurados

`server/src/observability/logger.js` escribe **una línea JSON por evento**:

```json
{"ts":"2026-11-06T23:43:48.242Z","level":"info","app":"karswcol","event":"race.started","track":"caribe","difficulty":"normal","humans":3,"bots":3,"wetStart":false}
```

Eventos principales: `server.started`, `auth.login`, `auth.login_failed`,
`ws.rejected`, `room.joined`, `room.join_rejected`, `race.started`,
`race.paused`, `race.resumed`, `race.finished`, `weather.refresh_failed`,
`http.unhandled_error`, `process.uncaught_exception`.

- `LOG_LEVEL` = `debug` | `info` (por defecto) | `warn` | `error`.
  En `debug` también se registra cada conexión y desconexión WebSocket.
- `LOG_FORMAT=pretty` los imprime legibles para desarrollo local.

Promtail solo lee los contenedores con la etiqueta `logging: promtail` y
convierte `level` en etiqueta de Loki. Consultas útiles en Grafana → Explore → Loki:

```logql
{app="karswcol", service="gateway"}                              # todo
{app="karswcol", level="error"}                                  # solo errores
{app="karswcol"} | json | event="race.finished"                  # carreras terminadas
{app="karswcol"} | json | event="race.finished" | reason="time_limit"
sum by (event) (count_over_time({app="karswcol"} | json [5m]))   # eventos por tipo
```

---

## 4. Alertas

`observability/prometheus/alerts.yml`. Se ven en http://localhost:9090/alerts
y en Grafana → Alerting.

| Alerta | Condición | Severidad |
|---|---|---|
| `KarswcolCaido` | Prometheus no puede leer `/metrics` por 30 s | critical |
| `TickFueraDePresupuesto` | p95 del tick > 35 ms (70 % del presupuesto) por 1 min | warning |
| `TicksAtrasados` | p95 del intervalo entre ticks > 75 ms por 1 min | critical |
| `EventLoopBloqueado` | lag p99 del event loop > 100 ms por 1 min | warning |
| `MemoriaAlta` | memoria residente > 400 MB por 2 min | warning |
| `ErroresHttp5xx` | cualquier respuesta 5xx sostenida | warning |
| `ClimaExternoFallando` | más de 2 fallos de Open-Meteo en 30 min | info |

---

## 5. Pruebas de carga con k6

Scripts en `load-tests/`. La lógica común está en `load-tests/lib/karswcol.js`.
Cada usuario virtual (VU) hace lo mismo que un navegador:

1. Carga el cliente estático (`/`, CSS, JS, imágenes) y consulta `/api/auth/config` y `/api/auth/me`.
2. Inicia sesión con `POST /api/auth/loadtest` (en vez de Google).
3. Abre el WebSocket, envía `join` y `ready`, y activa los bots.
4. Durante la carrera envía `input` (acelerar y girar) cada 100 ms.
5. Al ver los resultados pide `restart` y vuelve a correr.

La sala admite **8 pilotos** y, como en el juego real, quien llega con la
carrera en curso recibe `join_rejected` y **se queda como espectador**,
recibiendo los 20 estados por segundo igual que los pilotos. Así la prueba
mide lo que de verdad cuesta en el servidor: el broadcast crece con el
número de conexiones.

### Escenarios

| Script | Tipo | Perfil por defecto | Variables |
|---|---|---|---|
| `smoke.js` | Humo | 1 piloto + 1 visitante, 30 s | — |
| `load.js` | Carga | sube a 40 WS en 1 min, mantiene 5 min, baja; visitantes a 5 req/s | `VUS`, `HOLD`, `RPS` |
| `stress.js` | Estrés | escalones de 100 → 400 WS (2 min cada uno) | `MAX_VUS` |
| `spike.js` | Pico | de 5 a 200 WS en 10 s, 1 min arriba, baja | `PEAK_VUS` |
| `soak.js` | Resistencia | 20 WS durante 30 min | `VUS`, `DURATION` |

Variables comunes: `BASE_URL`, `LOAD_TEST_TOKEN` (obligatoria),
`INPUT_INTERVAL_MS` (100), `BOTS` (`true`).

### Umbrales de aceptación (SLO)

Definidos en `THRESHOLDS` (`lib/karswcol.js`). Si alguno falla, k6 termina
con código distinto de 0 (útil para CI).

| Métrica | Umbral | Por qué |
|---|---|---|
| `checks` | > 99 % | respuestas correctas |
| `http_req_failed` | < 1 % | |
| `http_req_duration{kind:static}` | p95 < 300 ms | carga del cliente |
| `http_req_duration{kind:api}` | p95 < 200 ms | API de sesión |
| `ws_connecting` | p95 < 500 ms | handshake WebSocket |
| `karswcol_join_latency` | p95 < 250 ms | de `join` a `joined`/`join_rejected` |
| `karswcol_state_gap` | p95 < 100 ms, p99 < 200 ms | tiempo entre estados que ve el cliente (ideal 50 ms) |
| `karswcol_login_ok`, `karswcol_ws_session_ok` | > 99 % | |

### Ejecutar con Docker (recomendado)

Las métricas de k6 se envían a Prometheus y aparecen en el dashboard
**KARSWCOL — Pruebas de carga (k6)** junto a las del servidor. Al terminar
queda un reporte HTML en `load-tests/results/reporte.html`.

```bash
docker compose up -d                       # con LOAD_TEST_TOKEN en .env
docker compose --profile loadtest run --rm --service-ports k6 run /scripts/smoke.js
docker compose --profile loadtest run --rm --service-ports k6 run /scripts/load.js
docker compose --profile loadtest run --rm --service-ports k6 run -e VUS=80 -e HOLD=10m /scripts/load.js
docker compose --profile loadtest run --rm --service-ports k6 run /scripts/stress.js
docker compose --profile loadtest run --rm --service-ports k6 run /scripts/spike.js
docker compose --profile loadtest run --rm --service-ports k6 run /scripts/soak.js
```

Para distinguir varias corridas en Grafana se les pone un nombre:
`... k6 run --tag testid=carga-1 /scripts/load.js` y se elige en el
selector **Prueba** del dashboard.

### Ejecutar sin Docker

Con k6 instalado (`winget install k6`, `choco install k6` o `brew install k6`):

```bash
# terminal 1
cd server
LOAD_TEST_TOKEN=secreto npm start        # PowerShell: $env:LOAD_TEST_TOKEN="secreto"; npm start

# terminal 2
cd load-tests
k6 run -e LOAD_TEST_TOKEN=secreto smoke.js
k6 run -e LOAD_TEST_TOKEN=secreto -e VUS=60 -e HOLD=2m load.js
```

### Resultados de referencia

Corrida local (un solo proceso Node, portátil con Windows 11), `load.js`
con `VUS=60`, `HOLD=60s`, `RPS=20`:

| Indicador | Resultado | Umbral |
|---|---|---|
| Checks | 100 % (24 247 / 24 247) | > 99 % |
| Peticiones HTTP | 24 068, 0 % fallidas, ~134 req/s | < 1 % |
| HTTP estático p95 | 13.7 ms | < 300 ms |
| HTTP API p95 | 2.1 ms | < 200 ms |
| Handshake WS p95 | 39 ms | < 500 ms |
| Gap entre estados p95 | 64 ms (mediana 50 ms) | < 100 ms |
| Entrada a la sala p95 | 17 ms | < 250 ms |
| Mensajes WS recibidos por k6 | ~888/s | |
| Duración media del tick (servidor) | ~3.2 ms de 50 ms | p95 < 35 ms |

Conclusión: con 60 conexiones el game loop usa ~6 % de su presupuesto, así
que el cuello de botella no es la simulación sino el broadcast (crece con
jugadores × conexiones). `stress.js` sirve para encontrar el punto donde
`karswcol_tick_interval_seconds` deja de estar en 50 ms.

### Cómo leer una prueba en Grafana

1. Dashboard **Pruebas de carga (k6)**, panel *Usuarios virtuales vs.
   conexiones*: las dos curvas deben coincidir. Si las conexiones quedan
   por debajo, el servidor rechaza o se cae.
2. Panel *Tick del servidor bajo carga*: el intervalo p95 debe quedar
   pegado a 50 ms. El momento en que sube marca la capacidad máxima.
3. Panel *Gap entre mensajes de estado*: es lo que **siente el jugador**.
4. En el dashboard **Servidor**, *Memoria* durante `soak.js` debe quedar
   plana; si sube en rampa hay una fuga.
5. *Logs del servidor* y la búsqueda por texto muestran qué pasó en ese
   instante (rechazos, errores).

---

## 6. Archivos

```
server/src/observability/
  metrics.js          Registro de métricas (prom-client)
  logger.js           Logger JSON
server/src/gateway/gateway.js     /metrics, /health, /api/auth/loadtest, métricas HTTP y WS
server/src/raceRoom.js            Métricas del game loop, sala y carreras
server/test/observability.test.js Pruebas de /health, /metrics y login de carga
observability/
  prometheus/prometheus.yml       Scrape del gateway cada 5 s
  prometheus/alerts.yml           Reglas de alerta
  promtail/promtail-config.yml    Logs de Docker → Loki
  grafana/provisioning/           Fuentes de datos y carga de dashboards
  grafana/dashboards/             karswcol-servidor.json, karswcol-k6.json
load-tests/
  lib/karswcol.js     Lógica común, métricas propias y umbrales
  smoke.js load.js stress.js spike.js soak.js
  results/            Reportes HTML generados (no se versionan)
```
