# Arquitectura de KARSWCOL

Este documento traza la vista de aplicación y de infraestructura de la
propuesta (`KARSWCOL_Consolidacion.docx`, secciones 4.1 y 4.2) hacia la
implementación real en este repositorio.

## Vista de aplicación y componentes

| Componente (propuesta)        | Código                                     | Responsabilidad única |
|--------------------------------|---------------------------------------------|------------------------|
| Game Client                    | `client/`                                   | Renderiza el estado recibido y captura input. No decide reglas de juego. |
| Connection Gateway              | `server/src/gateway/gateway.js`             | Único punto de entrada de red: sirve el cliente y enruta mensajes WebSocket. |
| Matchmaking Service             | `server/src/matchmaking/matchmakingService.js` | Agrupa jugadores en una sala y decide cuándo están listos para iniciar. |
| Game Engine                     | `server/src/game-engine/gameEngine.js` + `gameplayConfig.js` | Única fuente de verdad de posición, colisiones con el borde y vueltas. |
| Catálogo de pistas               | `server/src/game-engine/trackCatalog.js`    | Geometría e identidad visual de las 5 pistas (una por región); el Game Engine recibe la pista activa como parámetro, no la conoce de antemano. |
| Concurrency Resolver            | `server/src/concurrency-resolver/concurrencyResolver.js` | Resuelve reclamos simultáneos sobre objetos recogibles. |
| Event Manager                   | `server/src/event-manager/eventManager.js`  | Genera y expira eventos dinámicos (lluvia). |
| Ranking and Persistence Service | `server/src/ranking-persistence/rankingService.js` | Calcula el ranking final y expone el punto de extensión hacia PostgreSQL. |
| Bot Driver                      | `server/src/bots/botDriver.js`              | Genera input (left/right/up/down) para completar la sala cuando faltan jugadores reales; el Game Engine lo aplica exactamente igual que un input humano. |
| Orquestador de sala              | `server/src/raceRoom.js`                    | Conecta los componentes anteriores; no contiene reglas de juego propias. |

Cada componente es un módulo independiente con una sola responsabilidad y
sin conocer los detalles internos de los demás — se comunican a través de
métodos explícitos (`tryClaim`, `onLapCompleted`, `buildRanking`, etc.), no
compartiendo estado mutable directamente.

## Vista de infraestructura y despliegue

`docker-compose.yml` (raíz del repo) define estos contenedores:

- **gateway**: construido desde `server/Dockerfile`, expone el puerto 3000.
- **redis**: coordinación/estado en memoria si el backend escala a varios procesos.
- **postgres**: historial de partidas y ranking.
- **prometheus**, **grafana**, **loki**, **promtail**: observabilidad (métricas,
  dashboards, alertas y logs). El gateway expone `/metrics` y `/health`.
- **k6** (perfil `loadtest`, se lanza a demanda): pruebas de carga que envían
  sus métricas a Prometheus por remote-write.

Detalle en [`OBSERVABILITY.md`](OBSERVABILITY.md).

Estado actual: los contenedores de Redis y PostgreSQL ya están orquestados,
pero el Game Engine y el Ranking Service todavía guardan todo en memoria de
proceso (ver el `TODO` en `rankingService.js`). Conectar ambos es el trabajo
del siguiente sprint — se documenta así en vez de simular una integración
que no existe.

## Concurrencia y tiempo real (sección 5 de la propuesta)

- **Tick fijo de 50ms** (`TICK_MS` en `gameEngine.js`): todo el estado se
  recalcula y difunde en el mismo ciclo para todos los jugadores.
- **Resolución de conflictos determinista**: `RaceRoom.tick()` itera los
  jugadores siempre en el mismo orden (orden de llegada al `join`); dentro
  de ese tick, `ConcurrencyResolver.tryClaim` marca un objeto como no
  disponible con una única asignación síncrona antes de evaluar al
  siguiente jugador, así que dos reclamos "simultáneos" del lado del
  cliente quedan resueltos sin condición de carrera real en el proceso.
- **Difusión por WebSocket cada tick**, no por solicitud del cliente, para
  que ningún jugador tome decisiones sobre un estado desactualizado.
- **Pistas tipo Fórmula 1** (`game-engine/trackBuilder.js` y
  `trackCatalog.js`): cada circuito se describe como una secuencia de
  rectas y curvas (radio y ángulo), inspirada en un trazado real (Monza,
  Mónaco, Suzuka, Silverstone, Interlagos). El constructor cierra el
  circuito de forma exacta y genera la línea central muestreada cada 4
  unidades; de ella salen los puntos de control, los objetos, la parrilla
  y la velocidad recomendada en cada punto. Los clientes reciben una línea
  central liviana y dibujan exactamente la misma pista en 2D y 3D.
- **Clima real por pista** (`server/src/weather/weatherService.js`): cada
  pista se asocia a una ciudad de su región (Cartagena, Bogotá, Manizales,
  Villavicencio, Leticia). El servidor consulta el clima actual en
  Open-Meteo (gratuito, sin clave; solo se envían esas coordenadas) cada 10
  minutos, en una sola petición, y lo traduce a sol, nubes, niebla, llovizna,
  lluvia o tormenta, de día o de noche. Si la consulta falla reintenta a los
  30 s y, mientras tanto, cada pista usa su clima típico. El lobby muestra el
  clima y la vista 3D lo ambienta (sombras con sol, nubes, lluvia,
  relámpagos, noche con estrellas y postes de luz). Es solo visual: la
  lluvia que afecta el agarre sigue siendo el evento de carrera (HU04).
- **Lluvia, pista mojada y charcos** (`game-engine/puddles.js`): con
  lluvia (el aguacero de la carrera o porque llueve de verdad en la región,
  en cuyo caso la carrera arranca mojada) baja el agarre en toda la pista y
  se llenan 12 charcos con posiciones fijas por pista, sobre todo en zonas de
  frenado. Pisar uno a velocidad provoca aquaplaning (30% del agarre); al
  parar de llover se secan poco a poco. El servidor manda el nivel de cada
  charco en el estado de carrera y los clientes solo lo dibujan.
- **Hora del día**: en el lobby se elige Día, Noche u Hora real (la de la
  región); aplica a toda la sala, igual que la dificultad de los bots.
- **Agarre y frenado** (`GameEngine.step`, constantes en
  `gameplayConfig.js`): el volante gira el kart, pero su trayectoria solo
  cambia `GRIP / velocidad` por tick (límite de aceleración lateral). Entrar
  muy rápido a una curva hace que el kart apunte hacia adentro mientras se
  desliza hacia afuera (derrape) hasta el muro; un golpe fuerte lo deja casi
  detenido y sin acelerador por 0,6 s. Los frenos son mucho más fuertes que
  el acelerador y la aceleración es progresiva, así que frenar antes de cada
  curva lenta es obligatorio. Con lluvia baja el agarre. Una prueba
  automática verifica en cada pista que entrar a fondo a su curva más lenta
  termina en choque y que frenando no.
- **Colisión con el borde de pista** (`GameEngine.confineToRoad`): el
  motor ubica al kart sobre la línea central (buscando solo cerca de su
  última posición, para no confundirlo con un tramo paralelo) y, si su
  distancia lateral supera medio ancho de pista, lo devuelve al borde y le
  quita velocidad. Esto garantiza que nadie corte camino y se salte puntos
  de control.

## Bots y dificultad

Cuando la sala activa "completar con bots" en el lobby, `RaceRoom.spawnBots`
agrega jugadores artificiales hasta llegar a `BOT_FILL_TARGET` (6)
participantes, sin quitar nunca jugadores reales de más. En cada tick, si el
jugador es un bot, `computeBotInput` (Bot Driver) calcula hacia dónde girar
siguiendo la línea central de la pista activa: apunta a un punto más
adelante del trazado (más lejos cuanto más rápido va) y frena cuando supera
la velocidad recomendada para la curva que viene. La dificultad (`server/src/game-engine/difficulty.js`)
es una configuración de sala, no por bot — la elige el anfitrión de la sala en el
lobby y aplica a todos los bots de esa carrera por igual.

## Control físico (Gamepad API)

El cliente (`client/js/gamepad.js`) traduce el estado de un control
conectado (PS4, Xbox o cualquier mando compatible con el estándar W3C
Gamepad) al mismo formato `{left, right, up, down}` que ya usan las
flechas del teclado. Esto significa que ni el Connection Gateway ni el
Game Engine necesitan saber si el input vino de un teclado o de un mando:
para el backend es indistinguible. Requiere que el navegador soporte
`navigator.getGamepads` (Chrome/Edge/Firefox) y que el usuario presione
algún botón del control una vez para que el navegador lo detecte.

## Pendiente para el siguiente sprint

- Conectar `RankingService.persistRace` a PostgreSQL.
- Usar Redis como lock distribuido si `RaceRoom` llega a correr en más de
  un proceso (hoy es un único proceso, una sola sala).
- Matchmaking real con múltiples salas concurrentes (`MatchmakingService`
  ya está separado del resto para que esto no implique tocar el Game Engine).
- Reconexión con token de sesión (HU06).
