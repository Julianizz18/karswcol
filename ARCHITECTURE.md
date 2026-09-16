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
| Orquestador de sala              | `server/src/raceRoom.js`                    | Conecta los componentes anteriores; no contiene reglas de juego propias. |

Cada componente es un módulo independiente con una sola responsabilidad y
sin conocer los detalles internos de los demás — se comunican a través de
métodos explícitos (`tryClaim`, `onLapCompleted`, `buildRanking`, etc.), no
compartiendo estado mutable directamente.

## Vista de infraestructura y despliegue

`docker-compose.yml` (raíz del repo) define tres contenedores:

- **gateway**: construido desde `server/Dockerfile`, expone el puerto 3000.
- **redis**: coordinación/estado en memoria si el backend escala a varios procesos.
- **postgres**: historial de partidas y ranking.

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
- **Colisión con el borde de pista** (`GameEngine.confineToRoad`): cada
  pista es un anillo elíptico; el motor proyecta la posición del kart de
  vuelta al anillo cuando se sale, y le quita velocidad al golpear el
  borde. Esto es lo que garantiza que un jugador no pueda cortar por fuera
  del trazado y saltarse puntos de control — la causa real de que antes
  una vuelta pudiera no detectarse.

## Pendiente para el siguiente sprint

- Conectar `RankingService.persistRace` a PostgreSQL.
- Usar Redis como lock distribuido si `RaceRoom` llega a correr en más de
  un proceso (hoy es un único proceso, una sola sala).
- Matchmaking real con múltiples salas concurrentes (`MatchmakingService`
  ya está separado del resto para que esto no implique tocar el Game Engine).
- Reconexión con token de sesión (HU06).
