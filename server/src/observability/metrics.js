import client from 'prom-client';

// Observabilidad — métricas Prometheus. Un único registro por proceso: el
// Connection Gateway lo expone en GET /metrics y Prometheus lo raspa cada
// pocos segundos (ver observability/prometheus/prometheus.yml).
//
// Convenciones: prefijo "karswcol_", unidades en el nombre (_seconds,
// _bytes, _total) y etiquetas de baja cardinalidad (nunca ids de jugador).

export const register = new client.Registry();
register.setDefaultLabels({ app: 'karswcol' });

// CPU, memoria, heap, GC, lag del event loop, handles abiertos... de Node.
client.collectDefaultMetrics({ register, prefix: 'karswcol_' });

// --- Connection Gateway: HTTP ---
export const httpRequestsTotal = new client.Counter({
  name: 'karswcol_http_requests_total',
  help: 'Peticiones HTTP atendidas, por método, ruta y código de estado.',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
});

export const httpRequestDuration = new client.Histogram({
  name: 'karswcol_http_request_duration_seconds',
  help: 'Latencia de las peticiones HTTP.',
  labelNames: ['method', 'route'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register]
});

// --- Connection Gateway: WebSocket ---
export const wsConnections = new client.Gauge({
  name: 'karswcol_ws_connections',
  help: 'Conexiones WebSocket abiertas y autenticadas en este momento.',
  registers: [register]
});

export const wsConnectionsTotal = new client.Counter({
  name: 'karswcol_ws_connections_total',
  help: 'Intentos de conexión WebSocket, por resultado (accepted | rejected).',
  labelNames: ['result'],
  registers: [register]
});

export const wsMessagesReceived = new client.Counter({
  name: 'karswcol_ws_messages_received_total',
  help: 'Mensajes recibidos de los clientes, por tipo.',
  labelNames: ['type'],
  registers: [register]
});

export const wsMessagesSent = new client.Counter({
  name: 'karswcol_ws_messages_sent_total',
  help: 'Mensajes enviados a los clientes (un broadcast a N clientes cuenta N), por tipo.',
  labelNames: ['type'],
  registers: [register]
});

export const wsBytesSent = new client.Counter({
  name: 'karswcol_ws_bytes_sent_total',
  help: 'Bytes enviados por WebSocket a los clientes.',
  registers: [register]
});

export const wsBroadcastDuration = new client.Histogram({
  name: 'karswcol_ws_broadcast_duration_seconds',
  help: 'Tiempo en serializar y enviar un broadcast a todos los clientes.',
  buckets: [0.0001, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05],
  registers: [register]
});

// Seguridad: intentos de inicio de sesión. Un pico de "failure" puede ser un
// ataque de fuerza bruta o tokens robados/vencidos (alerta LoginsFallidos).
export const authLogins = new client.Counter({
  name: 'karswcol_auth_logins_total',
  help: 'Inicios y cierres de sesión, por proveedor (google | loadtest | logout) y resultado (success | failure).',
  labelNames: ['provider', 'result'],
  registers: [register]
});

export const joinRejections = new client.Counter({
  name: 'karswcol_join_rejections_total',
  help: 'Jugadores que no pudieron entrar a la sala, por motivo.',
  labelNames: ['reason'],
  registers: [register]
});

// --- Sala y Game Engine ---
export const roomPlayers = new client.Gauge({
  name: 'karswcol_room_players',
  help: 'Participantes en la sala, por tipo (human | bot).',
  labelNames: ['kind'],
  registers: [register]
});

export const ROOM_STATES = ['lobby', 'countdown', 'racing', 'results'];
export const roomState = new client.Gauge({
  name: 'karswcol_room_state',
  help: 'Estado actual de la sala (1 en el estado activo, 0 en los demás).',
  labelNames: ['state'],
  registers: [register]
});

export const roomPaused = new client.Gauge({
  name: 'karswcol_room_paused',
  help: '1 si la carrera está en pausa.',
  registers: [register]
});

export const tickDuration = new client.Histogram({
  name: 'karswcol_tick_duration_seconds',
  help: 'Tiempo de CPU de cada tick del game loop (presupuesto: 50 ms).',
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.035, 0.05, 0.1],
  registers: [register]
});

export const tickInterval = new client.Histogram({
  name: 'karswcol_tick_interval_seconds',
  help: 'Tiempo real entre ticks consecutivos (ideal: 0.05 s). Si crece, el servidor no da abasto.',
  buckets: [0.04, 0.045, 0.05, 0.055, 0.06, 0.075, 0.1, 0.2, 0.5],
  registers: [register]
});

export const ticksTotal = new client.Counter({
  name: 'karswcol_ticks_total',
  help: 'Ticks del game loop ejecutados.',
  registers: [register]
});

export const racesStarted = new client.Counter({
  name: 'karswcol_races_started_total',
  help: 'Carreras iniciadas, por pista.',
  labelNames: ['track'],
  registers: [register]
});

export const racesFinished = new client.Counter({
  name: 'karswcol_races_finished_total',
  help: 'Carreras terminadas, por pista y motivo (all_finished | grace | time_limit).',
  labelNames: ['track', 'reason'],
  registers: [register]
});

export const raceDuration = new client.Histogram({
  name: 'karswcol_race_duration_seconds',
  help: 'Duración de las carreras (reloj de carrera, sin pausas).',
  buckets: [30, 60, 90, 120, 180, 240, 300, 420, 600],
  registers: [register]
});

export const lapsCompleted = new client.Counter({
  name: 'karswcol_laps_completed_total',
  help: 'Vueltas completadas, por tipo de piloto.',
  labelNames: ['kind'],
  registers: [register]
});

export const gameEvents = new client.Counter({
  name: 'karswcol_game_events_total',
  help: 'Eventos de juego (objetos recogidos, lluvia, ...), por tipo.',
  labelNames: ['kind'],
  registers: [register]
});

export const weatherRefreshes = new client.Counter({
  name: 'karswcol_weather_refresh_total',
  help: 'Consultas al servicio de clima externo (Open-Meteo), por resultado.',
  labelNames: ['result'],
  registers: [register]
});

for (const s of ROOM_STATES) roomState.set({ state: s }, s === 'lobby' ? 1 : 0);
roomPlayers.set({ kind: 'human' }, 0);
roomPlayers.set({ kind: 'bot' }, 0);
roomPaused.set(0);
wsConnections.set(0);

export function setRoomState(state) {
  for (const s of ROOM_STATES) roomState.set({ state: s }, s === state ? 1 : 0);
}
