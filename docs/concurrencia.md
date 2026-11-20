# Robustez en concurrencia y tiempo real (sección 2.7)

## Modelo de concurrencia

KARSWCOL usa un **servidor autoritativo** en Node.js: un único hilo de
eventos procesa los mensajes de todos los jugadores y un **game loop a tick
fijo** (20 Hz, un tick cada 50 ms) avanza la simulación y publica el estado.
Los clientes solo envían **intención** (teclas presionadas, listo, pausa); el
servidor decide posiciones, vueltas, objetos y resultados.

Consecuencias de diseño:

- **Sin condiciones de carrera de memoria**: los handlers de mensajes y el
  tick se ejecutan uno a la vez en el event loop; ninguna operación sobre el
  estado de la sala queda a medias por otra.
- **Orden total de eventos por tick**: dentro de un tick los jugadores se
  procesan siempre en el mismo orden (orden de llegada a la sala). Eso hace
  determinista la resolución de conflictos.
- **El cliente nunca es fuente de verdad**: un cliente modificado no puede
  moverse más rápido, tomar objetos ajenos ni cambiar la configuración.

## Mecanismos de consistencia

| Riesgo | Mecanismo | Dónde |
|---|---|---|
| Dos jugadores toman el mismo objeto en el mismo tick | Sección crítica de una sola asignación síncrona (`respawnAt`); el primero en el orden del tick se lo lleva | `concurrency-resolver/concurrencyResolver.js` |
| Reaparición de objetos durante la pausa | Reloj de carrera que descuenta la pausa (`raceNow`) en vez de `setTimeout` | `raceRoom.js`, `concurrencyResolver.js` |
| Varios "listo" simultáneos arrancan dos carreras | La cuenta regresiva solo arranca desde el estado `lobby`; el estado cambia a `countdown` en la misma operación | `raceRoom.js` (`setReady`, `startCountdown`) |
| `join` repetido o desde dos pestañas | Una conexión = un join; una cuenta de Google = un kart | `gateway.js`, `raceRoom.join` |
| Entradas por encima de la capacidad | `hasCapacity()` dentro de la misma operación que agrega al jugador | `matchmaking/matchmakingService.js` |
| Desconexión en plena carrera | El kart se conserva 30 s; al volver se reasigna a la nueva conexión | `raceRoom.handleDisconnect`, `raceRoom.join` |
| Mensajes fuera de orden | Un solo canal WebSocket (TCP, ordenado) por cliente; cada estado lleva `t` (reloj de carrera) creciente | `raceRoom.runTick` |
| Inundación de mensajes | Token bucket por conexión (30/s, ráfaga 60) | `gateway.js` |

## Pruebas reproducibles con clientes simultáneos

`server/test/concurrency.test.js` (se corre con `cd server && npm test`):

1. **10 clientes WebSocket reales a la vez** contra el gateway y la sala
   reales (capacidad 8), cada uno con su propia cuenta:
   - entran exactamente 8, con ids únicos y **ningún `joined` duplicado**;
     los otros 2 reciben "sala llena" (**sin pérdida**: todos reciben respuesta);
   - todos ven **la misma parrilla final** (vista consistente);
   - se marcan "listo" en el mismo instante y hay **una sola cuenta
     regresiva** (3, 2, 1) y **una sola carrera** para cada cliente;
   - durante la carrera los estados llegan **en orden** (`t` estrictamente
     creciente) en todos los clientes.
2. **8 jugadores sobre el mismo objeto en el mismo tick**: un solo dueño (el
   primero en el orden de llegada) y un solo turbo aplicado.
3. **La misma contienda repetida 200 veces con orden aleatorio**: nunca hay
   dos dueños del mismo objeto.

Complementan: `room.test.js` (recuperar el kart tras desconectarse, votación
para volver al lobby, parrilla sorteada), `pickups.test.js` (reaparición con
el reloj de carrera) y `pause.test.js` (la pausa congela la carrera para todos).

Bajo carga, las pruebas de k6 (`docs/rendimiento.md`) miden el comportamiento
en tiempo real con decenas a cientos de conexiones: la métrica
`karswcol_state_gap` (tiempo entre dos estados consecutivos en el cliente)
muestra si el tick de 50 ms se sostiene.
