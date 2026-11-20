# KARSWCOL

Carreras 2D multijugador en tiempo real con identidad colombiana. Backend
autoritativo en Node.js organizado por componentes (ver `ARCHITECTURE.md`),
cliente web navegable (menú → lobby → carrera → resultados).

## Ejecutar

### Local (sin Docker)

```
cd server
npm install
npm start
```

Abre `http://localhost:3000` en dos o más pestañas/navegadores para probar
la sincronización multijugador.

### Login con Google

El juego exige iniciar sesión con Google antes de entrar al menú. Para
habilitarlo:

1. En https://console.cloud.google.com/apis/credentials crea un
   **ID de cliente de OAuth** de tipo **Aplicación web**.
2. En **Orígenes de JavaScript autorizados** agrega `http://localhost:3000`
   (y la URL pública si se despliega).
3. Copia `server/.env.example` a `server/.env` y pon el Client ID en
   `GOOGLE_CLIENT_ID`.
4. `npm start` (lee `server/.env` automáticamente).

El servidor valida el ID token de Google y emite una cookie de sesión
HttpOnly firmada; el WebSocket rechaza (código 4401) a quien no tenga
sesión. Pruebas: `cd server && npm test`.

### Con Docker Compose

```
docker compose up --build
```

Levanta el gateway (puerto 3000), Redis, PostgreSQL y el stack de
observabilidad: Prometheus (9090), Grafana (3001, admin/admin), Loki y
Promtail. Ver `ARCHITECTURE.md` para el estado actual de la integración con
Redis y PostgreSQL.

### Observabilidad y pruebas de carga

- Métricas Prometheus en `GET /metrics`, estado en `GET /health`. Si se define
  `METRICS_TOKEN`, `/metrics` exige `Authorization: Bearer <token>` (en Render
  se genera solo; en Docker Compose local queda abierto para Prometheus).
- Logs JSON estructurados, consultables en Grafana vía Loki.
- Dashboards "KARSWCOL — Servidor" y "KARSWCOL — Pruebas de carga (k6)" y
  reglas de alerta, todo aprovisionado automáticamente.
- Pruebas de carga con k6 (humo, carga, estrés, pico y resistencia):

```
# con LOAD_TEST_TOKEN=... en .env
docker compose --profile loadtest run --rm --service-ports k6 run /scripts/load.js
```

Guía completa, métricas, umbrales y resultados: [`OBSERVABILITY.md`](OBSERVABILITY.md).

## Calidad de código (SonarQube)

SonarQube corre en Docker con el perfil `quality` (no arranca con `docker compose up`):

```bash
# 1. Levantar SonarQube -> http://localhost:9000 (admin/admin la primera vez)
docker compose --profile quality up -d sonarqube

# 2. Generar la cobertura de las pruebas del servidor (server/coverage/lcov.info)
cd server && npm run coverage && cd ..

# 3. Crear un token en SonarQube (My Account > Security > Global Analysis Token),
#    ponerlo como SONAR_TOKEN en .env y lanzar el análisis
docker compose --profile quality run --rm sonar-scanner
```

La configuración del análisis está en `sonar-project.properties`.

## Estado actual (avance de sprint 1-2)

Implementado:
- Menú de navegación (Jugar / Cómo jugar / Créditos), lobby con estado
  "listo" en vivo y selección de color de kart (HU01).
- Carrera con movimiento server-authoritative a tick fijo de 50ms: el
  servidor calcula posición y ángulo de cada kart, el cliente solo
  renderiza lo que el servidor confirma (HU02, sección 5.1/5.2 de la
  propuesta).
- Conteo de vueltas por puntos de control en orden y pantalla de
  resultados (HU05, versión simplificada).
- Objetos recogibles con resolución de concurrencia (HU03): el estado del
  objeto se marca "tomado" dentro del mismo tick en que se detecta el
  reclamo; el orden de iteración del servidor (orden de llegada al `join`,
  sección 5.1) decide de forma determinista quién se lo lleva cuando dos
  jugadores compiten por el mismo objeto.
- Evento dinámico de lluvia (HU04): cada carrera sortea si llueve (75 %),
  en qué vuelta (de la 1 a la penúltima, cuando la completa el primer
  jugador) y cuánto dura (25 s ± 30 %). Mientras llueve baja la velocidad
  máxima y el agarre de todos los karts y se forman charcos.
- Backend reestructurado en componentes independientes que reflejan la
  vista de aplicación de la propuesta (Connection Gateway, Matchmaking
  Service, Game Engine, Concurrency Resolver, Event Manager, Ranking and
  Persistence Service) — ver `ARCHITECTURE.md`.
- `docker-compose.yml` con Redis y PostgreSQL orquestados (aún no
  consumidos por el Ranking Service, ver pendientes).
- Identidad visual: tipografía propia (Bungee/Rubik), imagen de portada en
  el menú, pista con asfalto, sardas, meta a cuadros y silueta de relieve,
  karts con detalle de llantas y casco, velocímetro y selector de color.
  5 colores de la flota usan un sprite propio en vez del dibujo vectorial,
  como prueba de vehículos personalizados: rojo → bus de TransMilenio
  (`client/img/kart-transmilenio.png`), verde azulado → burro
  (`client/img/kart-burro.png`), morado → taxi
  (`client/img/kart-taxi.png`), naranja → metro de Medellín
  (`client/img/kart-metro-medellin.png`) y verde → avión de Avianca
  (`client/img/kart-avion-avianca.png`). Al ser fotos/ilustraciones y no
  todas una vista cenital pura, algunos se ven un poco extraños al girar
  cerrado (queda como pendiente conseguir vistas desde arriba si se quiere
  ver perfecto en curva).
- 5 pistas jugables, cada una inspirada en una región de Colombia, elegibles
  desde el lobby (`server/src/game-engine/trackCatalog.js`): Costa de
  Cartagena (Caribe), Altiplano de Bogotá (Andina), Eje Cafetero (Andina —
  zona cafetera), Llanos Orientales (Orinoquía) y Selva Amazónica
  (Amazonía). Cada una es un circuito tipo Fórmula 1 inspirado en un
  trazado real (Monza, Mónaco, Suzuka, Silverstone e Interlagos), con
  rectas, chicanas, horquillas y curvas rápidas, su propio ancho de
  carretera y su propia paleta de colores.
- Colisión real del kart contra el borde de la carretera (antes el único
  límite físico era el canvas completo, así que un kart podía cortar por el
  césped y nunca volver a pasar por los puntos de control — por eso a veces
  "no se detectaba" la vuelta). Ahora el motor confina al kart dentro de
  la carretera y le quita velocidad al rozar el borde.
- Objetos recogibles con identidad colombiana: tinto, arepa, aguapanela,
  lechona, tamal y buñuelo, cada uno con su propio ícono.
- Aviso inmediato (toast) cada vez que el servidor confirma que un jugador
  cruzó la meta y completó una vuelta, además del contador en el HUD.
- Bots que completan la sala (`🤖 Completar con bots` en el lobby) hasta
  llegar a 6 participantes, sin quitar jugadores reales de más. La
  dificultad (Fácil/Medio/Difícil) la elige cualquier jugador y aplica por
  igual a todos los bots de esa carrera (`server/src/bots/botDriver.js`,
  `server/src/game-engine/difficulty.js`).
- Soporte de control físico (PS4, Xbox y compatibles) vía la Gamepad API
  del navegador (`client/js/gamepad.js`): stick izquierdo para girar,
  R2/Cross para acelerar, L2/Square para frenar. No requiere cambios en el
  servidor porque el input llega en el mismo formato que el del teclado.

Pendiente (siguiente sprint, según release plan):
- Conectar `RankingService` a PostgreSQL y usar Redis como lock distribuido
  si el backend escala a varios procesos (HU05, HU06).
- Reconexión con token de sesión (HU06).
- Matchmaking real por salas (hoy hay una sola sala compartida, con una
  pista seleccionable por todos antes de iniciar).

## Estructura

```
server/
  src/
    gateway/                 Connection Gateway (WebSocket + estático)
    matchmaking/              Matchmaking Service
    game-engine/               Game Engine + configuración de pista
    concurrency-resolver/     Concurrency Resolver
    event-manager/             Event Manager
    ranking-persistence/      Ranking and Persistence Service
    bots/                       Bot Driver
    observability/            Métricas (prom-client) y logger JSON
    raceRoom.js                 Orquestador de sala
  Dockerfile
client/                        Cliente web estático (HTML/CSS/JS, sin build step)
docker-compose.yml              Vista de infraestructura (gateway + redis + postgres + observabilidad + k6)
observability/                  Prometheus, alertas, Promtail y dashboards de Grafana
load-tests/                     Pruebas de carga con k6
OBSERVABILITY.md                Guía de observabilidad y pruebas de carga
ARCHITECTURE.md                  Mapeo componente ↔ código ↔ sección de la propuesta
```
