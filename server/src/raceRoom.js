import { TRACKS, getTrackById } from './game-engine/trackCatalog.js';
import {
  TOTAL_LAPS, LAP_OPTIONS, START_HOLD_MS, BOT_FILL_TARGET, BOT_COLORS, FINISH_GRACE_MS, RACE_TIME_LIMIT_MS, WET_CONDITIONS
} from './game-engine/gameplayConfig.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from './game-engine/difficulty.js';
import { GameEngine, TICK_MS } from './game-engine/gameEngine.js';
import { MatchmakingService } from './matchmaking/matchmakingService.js';
import { ConcurrencyResolver } from './concurrency-resolver/concurrencyResolver.js';
import { EventManager } from './event-manager/eventManager.js';
import { PuddleField } from './game-engine/puddles.js';
import { RankingService } from './ranking-persistence/rankingService.js';
import { computeBotInput, BOT_NAMES } from './bots/botDriver.js';
import { logger } from './observability/logger.js';
import * as metrics from './observability/metrics.js';

// Hora del día de la carrera: la elige el anfitrión en el lobby.
// "real" usa si en la región es de día o de noche ahora mismo.
export const TIMES_OF_DAY = [
  { id: 'dia', label: 'Día' },
  { id: 'noche', label: 'Noche' },
  { id: 'real', label: 'Hora real' }
];
const DEFAULT_TIME_OF_DAY = 'dia';

// Si un jugador se desconecta en plena carrera (recargó la página, se le
// cayó el internet), su kart se conserva este tiempo para que pueda volver.
export const RECONNECT_GRACE_MS = 30000;

// Pausas por jugador y por carrera: sin límite, alguien podía pausar una y
// otra vez y arruinar la carrera a los demás. Reanudar no cuenta.
export const MAX_PAUSES_PER_PLAYER = 3;

// Tras los resultados la sala vuelve sola al lobby pasado este tiempo, aunque
// no todos hayan pulsado "Volver al lobby".
export const RESULTS_RETURN_MS = 20000;

// RaceRoom orquesta los componentes de la vista de aplicación (sección 4.1):
// no implementa reglas de juego por sí misma, solo conecta Matchmaking,
// Game Engine, Concurrency Resolver, Event Manager, Ranking Service y el
// Bot Driver, y mantiene el estado de sala (lobby | countdown | racing | results).
export class RaceRoom {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.matchmaking = new MatchmakingService();
    this.gameEngine = new GameEngine();
    this.concurrencyResolver = new ConcurrencyResolver();
    this.eventManager = new EventManager();
    this.rankingService = new RankingService();

    this.state = 'lobby'; // lobby | countdown | racing | results
    this.countdownValue = 0;
    this.countdownHandle = null;
    this.tickHandle = null;
    this.raceStartedAt = null;
    this.greenAt = 0; // momento del semáforo en verde (reloj de carrera)
    this.firstFinishAt = null;
    // Pausa: el reloj de carrera descuenta el tiempo pausado, así los
    // tiempos de vuelta, boosts, lluvia y el límite de carrera se congelan.
    this.paused = false;
    this.pausedBy = null;
    this.pauseStartedAt = null;
    this.pausedTotalMs = 0;
    this.playerStates = new Map(); // id -> estado físico (Game Engine), incluye bots
    this.trackId = TRACKS[0].id;
    this.difficulty = DEFAULT_DIFFICULTY;
    this.totalLaps = TOTAL_LAPS;
    this.fillWithBots = false;
    this.botIds = new Set();
    this.weather = null; // WeatherService opcional (clima real por pista)
    this.timeOfDay = DEFAULT_TIME_OF_DAY;
    this.puddles = null;
    // Cuenta de Google -> jugador: una cuenta = un kart, y permite volver tras recargar.
    this.playerByUser = new Map();
    this.userOfPlayer = new Map();
    this.disconnected = new Map(); // id -> timer de gracia
    this.pausesUsed = new Map(); // id -> pausas usadas en esta carrera
    this.random = Math.random; // inyectable en pruebas
    this.gridOrder = [];
    this.lobbyVotes = new Set(); // quienes ya pidieron volver al lobby desde resultados
    this.resultsTimer = null;
  }

  /** Clima de la pista con la hora del día elegida en el lobby (día, noche o la real). */
  weatherFor(trackId) {
    const real = this.weather ? this.weather.getForTrack(trackId) : null;
    if (!real) return null;
    const isDay = this.timeOfDay === 'dia' ? true : this.timeOfDay === 'noche' ? false : real.isDay;
    return { ...real, isDay, timeOfDay: this.timeOfDay };
  }

  /** Anfitrión: el jugador que lleva más tiempo en la sala. */
  get hostId() {
    const first = this.matchmaking.list()[0];
    return first ? first.id : null;
  }

  /**
   * Solo el anfitrión cambia la configuración de la sala. `by` es quien lo
   * pide; si no se indica (llamadas internas), se permite.
   */
  canConfigure(by) {
    return by === undefined || by === this.hostId;
  }

  selectTimeOfDay(id, by) {
    if (this.state !== 'lobby' || !this.canConfigure(by)) return;
    if (!TIMES_OF_DAY.some(t => t.id === id)) return;
    this.timeOfDay = id;
    this.sendLobbyUpdate();
  }

  /** Publica en Prometheus cuántos humanos y bots hay en la sala. */
  updatePlayerMetrics() {
    metrics.roomPlayers.set({ kind: 'bot' }, this.botIds.size);
    metrics.roomPlayers.set({ kind: 'human' }, this.playerStates.size - this.botIds.size);
  }

  setState(state) {
    this.state = state;
    metrics.setRoomState(state);
  }

  get track() {
    return getTrackById(this.trackId);
  }

  /**
   * Entrada desde el gateway. Devuelve { playerId, rejoined } o { rejection }.
   * Con userKey (la cuenta de Google): una misma cuenta no puede tener dos
   * karts, y si su kart quedó desconectado en plena carrera lo recupera.
   */
  join(connId, { name, color, avatar = '', userKey = null }) {
    const existing = userKey ? this.playerByUser.get(userKey) : null;
    if (existing) {
      if (this.disconnected.has(existing)) {
        clearTimeout(this.disconnected.get(existing));
        this.disconnected.delete(existing);
        logger.info('room.rejoined', { state: this.state });
        return { playerId: existing, rejoined: true };
      }
      return { rejection: 'Ya estás en la sala desde otra pestaña o dispositivo.' };
    }
    const rejection = this.addPlayer(connId, name, color, avatar);
    if (rejection) {
      // Carrera en curso: se dice cuánto falta como máximo y el cliente entra
      // solo cuando la sala vuelva al lobby (room_reset).
      return this.state === 'lobby' ? { rejection } : { rejection, waitMs: this.estimatedWaitMs() };
    }
    if (userKey) {
      this.playerByUser.set(userKey, connId);
      this.userOfPlayer.set(connId, userKey);
    }
    return { playerId: connId, rejoined: false };
  }

  /**
   * La conexión de un jugador se cerró. En plena carrera (o cuenta
   * regresiva) su kart se conserva RECONNECT_GRACE_MS por si vuelve; en el
   * lobby o en resultados sale de inmediato.
   */
  handleDisconnect(id) {
    const p = this.playerStates.get(id);
    const inRace = this.state === 'countdown' || this.state === 'racing';
    if (!p || !inRace || !this.userOfPlayer.has(id)) {
      this.removePlayer(id);
      return;
    }
    if (this.paused && this.pausedBy === id) this.resume(null);
    this.gameEngine.setInput(p, { up: false, down: false, left: false, right: false });
    const timer = setTimeout(() => {
      this.disconnected.delete(id);
      this.removePlayer(id);
    }, RECONNECT_GRACE_MS);
    if (timer.unref) timer.unref();
    this.disconnected.set(id, timer);
    this.broadcast({ type: 'event', kind: 'player_disconnected', name: p.name, graceMs: RECONNECT_GRACE_MS });
  }

  /** Tiempo máximo hasta que la sala vuelva al lobby (para quien espera entrar). */
  estimatedWaitMs() {
    if (this.state === 'countdown') return this.countdownValue * 1000 + this.raceTimeLimitMs + RESULTS_RETURN_MS;
    if (this.state === 'results') return RESULTS_RETURN_MS;
    if (this.state !== 'racing' || this.raceStartedAt === null) return 0;
    const now = this.raceNow();
    let raceLeft = this.raceTimeLimitMs - (now - this.raceStartedAt);
    if (this.firstFinishAt !== null) raceLeft = Math.min(raceLeft, FINISH_GRACE_MS - (now - this.firstFinishAt));
    return Math.max(0, raceLeft) + RESULTS_RETURN_MS;
  }

  /** Mensajes para poner al día a quien vuelve a mitad de carrera. */
  resyncMessages() {
    if (this.state !== 'racing' && this.state !== 'countdown') return [];
    const messages = [];
    if (this.state === 'racing') {
      const weather = this.weatherFor(this.trackId);
      messages.push({ type: 'race_start', greenInMs: Math.max(0, this.greenAt - this.raceNow()), totalLaps: this.totalLaps, track: this.track, weather, wetStart: false, difficulty: this.difficulty, rejoined: true });
      if (this.paused) {
        const by = this.playerStates.get(this.pausedBy);
        messages.push({ type: 'pause', paused: true, by: by ? by.name : null, byId: this.pausedBy });
      }
    } else {
      messages.push({ type: 'countdown', seconds: this.countdownValue });
    }
    return messages;
  }

  /** Devuelve null si el jugador entró, o el motivo del rechazo. */
  addPlayer(id, name, color, avatar = '') {
    // Solo se entra desde el lobby: un jugador que llega a mitad de carrera
    // aparecería en la parrilla y bloquearía el cierre de la carrera.
    if (this.state !== 'lobby') return 'Hay una carrera en curso, intenta de nuevo cuando termine.';
    // Un segundo "join" de la misma conexión lo recreaba en otra casilla de
    // la parrilla, encima de otro jugador.
    if (this.playerStates.has(id)) return 'Ya estás en la sala.';
    if (!this.matchmaking.hasCapacity()) return 'La sala está llena.';
    this.matchmaking.join(id, name, color, avatar);
    const slot = this.matchmaking.list().length - 1;
    this.playerStates.set(id, this.gameEngine.createPlayerState(id, name, color, slot, this.track));
    this.updatePlayerMetrics();
    this.sendLobbyUpdate();
    return null;
  }

  removePlayer(id) {
    // Si se va quien pausó, la carrera no se queda congelada para los demás.
    if (this.paused && this.pausedBy === id) this.resume(null);
    this.matchmaking.leave(id);
    this.playerStates.delete(id);
    if (this.disconnected.has(id)) {
      clearTimeout(this.disconnected.get(id));
      this.disconnected.delete(id);
    }
    const userKey = this.userOfPlayer.get(id);
    if (userKey) {
      this.playerByUser.delete(userKey);
      this.userOfPlayer.delete(id);
    }
    this.updatePlayerMetrics();
    if (this.matchmaking.isEmpty()) {
      this.resetToLobby();
      return;
    }
    this.sendLobbyUpdate();
    // Si el que se fue era el único que faltaba por estar listo, arranca la
    // cuenta regresiva para los que quedan (antes se quedaban esperando).
    if (this.state === 'lobby' && this.matchmaking.allReadyToStart()) this.startCountdown();
    // Igual en resultados: si se fue el único que no había votado volver al
    // lobby, no hay que esperar los 20 s completos.
    if (this.state === 'results' && this.lobbyVotes.size > 0) {
      this.lobbyVotes.delete(id);
      this.checkLobbyVotes();
    }
  }

  /** Reloj de carrera: hora actual menos todo el tiempo que estuvo en pausa. */
  raceNow() {
    return Date.now() - this.pausedTotalMs;
  }

  /** Cualquier jugador humano puede pausar o reanudar; la pausa aplica a toda la sala. */
  togglePause(id) {
    if (this.state !== 'racing') return;
    const p = this.playerStates.get(id);
    if (!p || p.isBot) return;
    if (this.paused) {
      this.resume(p.name);
      return;
    }
    const used = this.pausesUsed.get(id) || 0;
    if (used >= MAX_PAUSES_PER_PLAYER) {
      this.broadcast({ type: 'event', kind: 'pause_denied', byId: id, max: MAX_PAUSES_PER_PLAYER });
      return;
    }
    this.pausesUsed.set(id, used + 1);
    this.pause(id, p.name);
    this.broadcast({ type: 'event', kind: 'pause_count', byId: id, remaining: MAX_PAUSES_PER_PLAYER - used - 1 });
  }

  pause(id, name) {
    if (this.paused || this.state !== 'racing') return;
    this.paused = true;
    this.pausedBy = id;
    this.pauseStartedAt = Date.now();
    metrics.roomPaused.set(1);
    logger.info('race.paused', { track: this.trackId });
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    // Al reanudar nadie debe salir acelerando con una tecla "pegada".
    for (const p of this.playerStates.values()) {
      if (!p.isBot) this.gameEngine.setInput(p, { up: false, down: false, left: false, right: false });
    }
    this.broadcast({ type: 'pause', paused: true, by: name, byId: id });
  }

  resume(name) {
    if (!this.paused) return;
    this.pausedTotalMs += Date.now() - this.pauseStartedAt;
    this.clearPause();
    this.lastTickAt = null;
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    logger.info('race.resumed', { track: this.trackId });
    this.broadcast({ type: 'pause', paused: false, by: name });
  }

  clearPause() {
    this.paused = false;
    this.pausedBy = null;
    this.pauseStartedAt = null;
    metrics.roomPaused.set(0);
  }

  setInput(id, input) {
    if (this.state !== 'racing' || this.paused) return;
    const p = this.playerStates.get(id);
    if (p && !p.isBot) this.gameEngine.setInput(p, input);
  }

  selectTrack(trackId, by) {
    if (this.state !== 'lobby' || !this.canConfigure(by)) return;
    if (!TRACKS.some(t => t.id === trackId)) return;
    this.trackId = trackId;
    let slot = 0;
    for (const p of this.playerStates.values()) {
      this.gameEngine.placeOnGrid(p, slot, this.track);
      slot += 1;
    }
    this.sendLobbyUpdate();
  }

  /** Número de vueltas de la carrera: lo elige el anfitrión (LAP_OPTIONS). */
  selectLaps(laps, by) {
    if (this.state !== 'lobby' || !this.canConfigure(by)) return;
    if (!LAP_OPTIONS.includes(laps)) return;
    this.totalLaps = laps;
    this.sendLobbyUpdate();
  }

  /** Tiempo límite proporcional a las vueltas (7 min para 3 vueltas). */
  get raceTimeLimitMs() {
    return (RACE_TIME_LIMIT_MS / TOTAL_LAPS) * this.totalLaps;
  }

  selectDifficulty(difficultyId, by) {
    if (this.state !== 'lobby' || !this.canConfigure(by)) return;
    if (!DIFFICULTIES[difficultyId]) return;
    this.difficulty = difficultyId;
    this.sendLobbyUpdate();
  }

  toggleBots(enabled, by) {
    if (this.state !== 'lobby' || !this.canConfigure(by)) return;
    this.fillWithBots = !!enabled;
    this.sendLobbyUpdate();
  }

  setReady(id) {
    if (this.state !== 'lobby') return;
    this.matchmaking.setReady(id);
    this.sendLobbyUpdate();
    if (this.matchmaking.allReadyToStart()) this.startCountdown();
  }

  sendLobbyUpdate() {
    this.broadcast({
      type: 'lobby_update',
      players: this.matchmaking.list().map(p => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, ready: p.ready })),
      tracks: TRACKS.map(t => ({
        id: t.id,
        name: t.name,
        region: t.region,
        description: t.description,
        inspiration: t.inspiration,
        length: t.length,
        accent: t.palette.accent,
        outline: t.outline,
        weather: this.weatherFor(t.id)
      })),
      hostId: this.hostId,
      selectedTrackId: this.trackId,
      difficulties: Object.entries(DIFFICULTIES).map(([id, d]) => ({ id, label: d.label })),
      selectedDifficulty: this.difficulty,
      lapOptions: LAP_OPTIONS,
      totalLaps: this.totalLaps,
      timesOfDay: TIMES_OF_DAY,
      selectedTimeOfDay: this.timeOfDay,
      fillWithBots: this.fillWithBots,
      botFillTarget: BOT_FILL_TARGET
    });
  }

  startCountdown() {
    this.setState('countdown');
    this.countdownValue = 3;
    this.broadcast({ type: 'countdown', seconds: this.countdownValue });
    this.countdownHandle = setInterval(() => {
      this.countdownValue -= 1;
      if (this.countdownValue <= 0) {
        clearInterval(this.countdownHandle);
        this.countdownHandle = null;
        this.startRace();
      } else {
        this.broadcast({ type: 'countdown', seconds: this.countdownValue });
      }
    }, 1000);
  }

  /**
   * Sortea las casillas de salida de los humanos al arrancar cada carrera.
   * Antes dependían del orden de llegada al lobby: el primero en entrar
   * siempre salía adelante. Los bots se ubican detrás de los humanos.
   */
  shuffleGrid() {
    const humans = [...this.playerStates.values()].filter(p => !p.isBot);
    for (let i = humans.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [humans[i], humans[j]] = [humans[j], humans[i]];
    }
    humans.forEach((p, slot) => this.gameEngine.placeOnGrid(p, slot, this.track));
    this.gridOrder = humans.map(p => p.id);
  }

  spawnBots() {
    const humanCount = this.playerStates.size;
    const needed = Math.max(0, BOT_FILL_TARGET - humanCount);
    for (let i = 0; i < needed; i++) {
      const id = `bot-${i + 1}`;
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const color = BOT_COLORS[i % BOT_COLORS.length];
      const p = this.gameEngine.createPlayerState(id, name, color, humanCount + i, this.track);
      p.isBot = true;
      p.totalLaps = this.totalLaps;
      p.botLane = ((i % 3) - 1) * this.track.roadWidth * 0.18; // izquierda, centro o derecha
      this.playerStates.set(id, p);
      this.botIds.add(id);
    }
    this.updatePlayerMetrics();
  }

  removeBots() {
    for (const id of this.botIds) this.playerStates.delete(id);
    this.botIds.clear();
    this.updatePlayerMetrics();
  }

  startRace() {
    this.setState('racing');
    this.pausesUsed.clear();
    this.lastTickAt = null;
    this.clearPause();
    this.pausedTotalMs = 0;
    // El cronómetro (y la carrera) arrancan cuando el semáforo se pone en verde.
    this.greenAt = this.raceNow() + START_HOLD_MS;
    this.raceStartedAt = this.greenAt;
    this.firstFinishAt = null;
    this.concurrencyResolver.reset(this.track);
    // Si en la región llueve de verdad, se arranca con la pista mojada y charcos llenos.
    const weather = this.weatherFor(this.trackId);
    const wetStart = !!weather && WET_CONDITIONS.includes(weather.condition);
    this.eventManager.reset(wetStart, this.totalLaps);
    this.puddles = new PuddleField(this.track);
    if (wetStart) this.puddles.update(Infinity, true);
    for (const p of this.playerStates.values()) p.totalLaps = this.totalLaps;
    this.shuffleGrid();
    if (this.fillWithBots) this.spawnBots();
    metrics.racesStarted.inc({ track: this.trackId });
    logger.info('race.started', {
      track: this.trackId,
      difficulty: this.difficulty,
      humans: this.playerStates.size - this.botIds.size,
      bots: this.botIds.size,
      wetStart
    });
    this.broadcast({
      type: 'race_start',
      totalLaps: this.totalLaps,
      track: this.track,
      weather,
      wetStart,
      difficulty: this.difficulty,
      greenInMs: START_HOLD_MS
    });
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    const endTimer = metrics.tickDuration.startTimer();
    const wallNow = performance.now();
    if (this.lastTickAt !== null && this.lastTickAt !== undefined) {
      metrics.tickInterval.observe((wallNow - this.lastTickAt) / 1000);
    }
    this.lastTickAt = wallNow;
    metrics.ticksTotal.inc();
    try {
      this.runTick();
    } finally {
      endTimer();
    }
  }

  runTick() {
    const now = this.raceNow();
    const speedFactor = this.eventManager.speedFactor();
    const gripFactor = this.eventManager.gripFactor();
    this.puddles.update(TICK_MS, this.eventManager.rainActive);
    const track = this.track;

    // Salida: hasta que el semáforo se pone en verde nadie se mueve, aunque
    // tenga el acelerador presionado (al verde arranca con él).
    if (now < this.greenAt) {
      this.broadcastState(now);
      return;
    }

    for (const p of this.playerStates.values()) {
      if (p.isBot && !p.finished) {
        this.gameEngine.setInput(p, computeBotInput(p, track, this.difficulty, gripFactor));
      }

      const puddle = this.puddles.puddleAt(p.x, p.y);
      const lapEvent = this.gameEngine.step(p, now, this.raceStartedAt, speedFactor, track, gripFactor, puddle);
      // El cóndor rescata al kart trabado contra el muro o en contravía.
      if (this.gameEngine.needsRescue(p, track)) {
        const rescue = this.gameEngine.rescue(p, track);
        metrics.gameEvents.inc({ kind: rescue.type });
        this.broadcast({ type: 'event', kind: rescue.type, playerId: rescue.playerId, name: rescue.name, x: rescue.x, y: rescue.y });
      }
      if (lapEvent) {
        if (lapEvent.finished && this.firstFinishAt === null) this.firstFinishAt = now;
        metrics.lapsCompleted.inc({ kind: p.isBot ? 'bot' : 'human' });
        this.broadcast({ type: 'event', kind: 'lap_completed', playerId: lapEvent.playerId, name: lapEvent.name, lap: lapEvent.lap, lapTimeMs: lapEvent.lapTimeMs });
        const rainEvent = this.eventManager.onLapCompleted(lapEvent.lap, now);
        if (rainEvent) metrics.gameEvents.inc({ kind: rainEvent.type });
        if (rainEvent) this.broadcast({ type: 'event', kind: rainEvent.type, durationMs: rainEvent.durationMs });
      }
      // Mismo orden de iteración en cada tick: la resolución de conflictos
      // sobre objetos compartidos queda determinada por el orden de llegada
      // (incluye a los bots, que compiten por objetos igual que cualquiera).
      const claimEvent = this.concurrencyResolver.tryClaim(p, this.gameEngine, now);
      if (claimEvent) {
        metrics.gameEvents.inc({ kind: claimEvent.type });
        this.broadcast({
          type: 'event',
          kind: claimEvent.type,
          pickupId: claimEvent.pickupId,
          by: claimEvent.by,
          itemName: claimEvent.itemName,
          emoji: claimEvent.emoji
        });
      }
    }

    // Los karts ya no se atraviesan: choques resueltos después de mover a todos.
    const bumps = this.gameEngine.resolveCollisions([...this.playerStates.values()], track);
    if (bumps) metrics.gameEvents.inc({ kind: 'kart_bump' }, bumps);

    const expiredEvent = this.eventManager.tick(now);
    if (expiredEvent) metrics.gameEvents.inc({ kind: expiredEvent.type });
    if (expiredEvent) this.broadcast({ type: 'event', kind: expiredEvent.type });

    this.broadcastState(now);

    // Fin de carrera (HU05): todos llegaron, o expiró el tiempo límite. Sin
    // esto, un jugador quieto o desconectado dejaba la carrera colgada.
    const allFinished = [...this.playerStates.values()].every(p => p.finished);
    const graceExpired = this.firstFinishAt !== null && now - this.firstFinishAt >= FINISH_GRACE_MS;
    const timeLimitExpired = now - this.raceStartedAt >= this.raceTimeLimitMs;
    if (allFinished || graceExpired || timeLimitExpired) {
      this.finishRace(allFinished ? 'all_finished' : graceExpired ? 'grace' : 'time_limit');
    }
  }

  broadcastState(now) {
    this.broadcast({
      type: 'state',
      t: now - this.raceStartedAt,
      rainActive: this.eventManager.rainActive,
      puddles: this.puddles.anyWater ? this.puddles.serialize() : [],
      players: [...this.playerStates.values()].map(p => ({ ...this.gameEngine.serializePlayer(p, now), isBot: !!p.isBot })),
      pickups: this.concurrencyResolver.serialize(now)
    });
  }

  finishRace(reason = 'all_finished') {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.clearPause();
    this.setState('results');
    const durationSeconds = this.raceStartedAt === null ? 0 : (this.raceNow() - this.raceStartedAt) / 1000;
    metrics.racesFinished.inc({ track: this.trackId, reason });
    metrics.raceDuration.observe(durationSeconds);
    logger.info('race.finished', { track: this.trackId, reason, durationSeconds: Math.round(durationSeconds) });
    const ranking = this.rankingService.buildRanking([...this.playerStates.values()]);
    this.rankingService.persistRace(ranking);
    this.lobbyVotes.clear();
    this.resultsTimer = setTimeout(() => this.resetToLobby(), RESULTS_RETURN_MS);
    if (this.resultsTimer.unref) this.resultsTimer.unref();
    this.broadcast({ type: 'results', ranking, returnInMs: RESULTS_RETURN_MS });
  }

  /**
   * Volver al lobby desde resultados. Antes el primero que pulsaba el botón
   * mandaba a toda la sala al lobby mientras los demás leían sus resultados.
   * Ahora cada humano vota: cuando votan todos (o pasan RESULTS_RETURN_MS)
   * se vuelve. Sin `by` (llamada interna) se vuelve de inmediato.
   */
  requestRestart(by) {
    if (this.state !== 'results') return;
    if (by === undefined) {
      this.resetToLobby();
      return;
    }
    const p = this.playerStates.get(by);
    if (!p || p.isBot) return;
    this.lobbyVotes.add(by);
    this.checkLobbyVotes();
  }

  /** Vuelve al lobby si ya votaron todos los humanos que siguen en la sala. */
  checkLobbyVotes() {
    if (this.state !== 'results') return;
    const humans = [...this.playerStates.values()].filter(h => !h.isBot && !this.disconnected.has(h.id));
    const votes = humans.filter(h => this.lobbyVotes.has(h.id)).length;
    if (votes >= humans.length) {
      this.resetToLobby();
      return;
    }
    this.broadcast({ type: 'event', kind: 'lobby_votes', votes, total: humans.length });
  }

  resetToLobby() {
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
    this.resultsTimer = null;
    this.lobbyVotes.clear();
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    // Si se vuelve al lobby durante la cuenta regresiva, la carrera no debe arrancar igual.
    if (this.countdownHandle) clearInterval(this.countdownHandle);
    this.countdownHandle = null;
    this.firstFinishAt = null;
    this.clearPause();
    this.pausedTotalMs = 0;
    this.concurrencyResolver.clear();
    this.eventManager.reset();
    this.removeBots();
    // Quien seguía desconectado al terminar la carrera no vuelve al lobby como fantasma.
    for (const [id, timer] of this.disconnected) {
      clearTimeout(timer);
      this.matchmaking.leave(id);
      this.playerStates.delete(id);
      this.playerByUser.delete(this.userOfPlayer.get(id));
      this.userOfPlayer.delete(id);
    }
    this.disconnected.clear();
    this.updatePlayerMetrics();
    this.setState('lobby');
    this.countdownValue = 0;
    this.raceStartedAt = null;
    this.matchmaking.resetReadiness();
    // Los clientes que siguen en resultados (o en la carrera) pasan al lobby.
    this.broadcast({ type: 'room_reset' });
    let slot = 0;
    for (const p of this.playerStates.values()) {
      this.gameEngine.resetPlayerState(p);
      this.gameEngine.placeOnGrid(p, slot, this.track);
      slot += 1;
    }
    this.sendLobbyUpdate();
  }
}
