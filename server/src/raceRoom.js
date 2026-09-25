import { TRACKS, getTrackById } from './game-engine/trackCatalog.js';
import {
  TOTAL_LAPS, BOT_FILL_TARGET, BOT_COLORS, FINISH_GRACE_MS, RACE_TIME_LIMIT_MS
} from './game-engine/gameplayConfig.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from './game-engine/difficulty.js';
import { GameEngine, TICK_MS } from './game-engine/gameEngine.js';
import { MatchmakingService } from './matchmaking/matchmakingService.js';
import { ConcurrencyResolver } from './concurrency-resolver/concurrencyResolver.js';
import { EventManager } from './event-manager/eventManager.js';
import { RankingService } from './ranking-persistence/rankingService.js';
import { computeBotInput, BOT_NAMES } from './bots/botDriver.js';

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
    this.firstFinishAt = null;
    this.playerStates = new Map(); // id -> estado físico (Game Engine), incluye bots
    this.trackId = TRACKS[0].id;
    this.difficulty = DEFAULT_DIFFICULTY;
    this.fillWithBots = false;
    this.botIds = new Set();
  }

  get track() {
    return getTrackById(this.trackId);
  }

  /** Devuelve null si el jugador entró, o el motivo del rechazo. */
  addPlayer(id, name, color) {
    // Solo se entra desde el lobby: un jugador que llega a mitad de carrera
    // aparecería en la parrilla y bloquearía el cierre de la carrera.
    if (this.state !== 'lobby') return 'Hay una carrera en curso, intenta de nuevo cuando termine.';
    if (!this.matchmaking.hasCapacity()) return 'La sala está llena.';
    this.matchmaking.join(id, name, color);
    const slot = this.matchmaking.list().length - 1;
    this.playerStates.set(id, this.gameEngine.createPlayerState(id, name, color, slot, this.track));
    this.sendLobbyUpdate();
    return null;
  }

  removePlayer(id) {
    this.matchmaking.leave(id);
    this.playerStates.delete(id);
    if (this.matchmaking.isEmpty()) {
      this.resetToLobby();
    } else {
      this.sendLobbyUpdate();
    }
  }

  setInput(id, input) {
    if (this.state !== 'racing') return;
    const p = this.playerStates.get(id);
    if (p && !p.isBot) this.gameEngine.setInput(p, input);
  }

  selectTrack(trackId) {
    if (this.state !== 'lobby') return;
    if (!TRACKS.some(t => t.id === trackId)) return;
    this.trackId = trackId;
    let slot = 0;
    for (const p of this.playerStates.values()) {
      this.gameEngine.placeOnGrid(p, slot, this.track);
      slot += 1;
    }
    this.sendLobbyUpdate();
  }

  selectDifficulty(difficultyId) {
    if (this.state !== 'lobby') return;
    if (!DIFFICULTIES[difficultyId]) return;
    this.difficulty = difficultyId;
    this.sendLobbyUpdate();
  }

  toggleBots(enabled) {
    if (this.state !== 'lobby') return;
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
      players: this.matchmaking.list().map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready })),
      tracks: TRACKS.map(t => ({ id: t.id, name: t.name, region: t.region, description: t.description, accent: t.palette.accent })),
      selectedTrackId: this.trackId,
      difficulties: Object.entries(DIFFICULTIES).map(([id, d]) => ({ id, label: d.label })),
      selectedDifficulty: this.difficulty,
      fillWithBots: this.fillWithBots,
      botFillTarget: BOT_FILL_TARGET
    });
  }

  startCountdown() {
    this.state = 'countdown';
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

  spawnBots() {
    const humanCount = this.playerStates.size;
    const needed = Math.max(0, BOT_FILL_TARGET - humanCount);
    for (let i = 0; i < needed; i++) {
      const id = `bot-${i + 1}`;
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const color = BOT_COLORS[i % BOT_COLORS.length];
      const p = this.gameEngine.createPlayerState(id, name, color, humanCount + i, this.track);
      p.isBot = true;
      this.playerStates.set(id, p);
      this.botIds.add(id);
    }
  }

  removeBots() {
    for (const id of this.botIds) this.playerStates.delete(id);
    this.botIds.clear();
  }

  startRace() {
    this.state = 'racing';
    this.raceStartedAt = Date.now();
    this.firstFinishAt = null;
    this.concurrencyResolver.reset(this.track);
    this.eventManager.reset();
    if (this.fillWithBots) this.spawnBots();
    this.broadcast({
      type: 'race_start',
      totalLaps: TOTAL_LAPS,
      track: this.track,
      difficulty: this.difficulty
    });
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    const now = Date.now();
    const speedFactor = this.eventManager.speedFactor();
    const track = this.track;

    for (const p of this.playerStates.values()) {
      if (p.isBot && !p.finished) {
        this.gameEngine.setInput(p, computeBotInput(p, track, this.difficulty));
      }

      const lapEvent = this.gameEngine.step(p, now, this.raceStartedAt, speedFactor, track);
      if (lapEvent) {
        if (lapEvent.finished && this.firstFinishAt === null) this.firstFinishAt = now;
        this.broadcast({ type: 'event', kind: 'lap_completed', playerId: lapEvent.playerId, name: lapEvent.name, lap: lapEvent.lap });
        const rainEvent = this.eventManager.onLapCompleted(lapEvent.lap, now);
        if (rainEvent) this.broadcast({ type: 'event', kind: rainEvent.type, durationMs: rainEvent.durationMs });
      }
      // Mismo orden de iteración en cada tick: la resolución de conflictos
      // sobre objetos compartidos queda determinada por el orden de llegada
      // (incluye a los bots, que compiten por objetos igual que cualquiera).
      const claimEvent = this.concurrencyResolver.tryClaim(p, this.gameEngine, now);
      if (claimEvent) {
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

    const expiredEvent = this.eventManager.tick(now);
    if (expiredEvent) this.broadcast({ type: 'event', kind: expiredEvent.type });

    this.broadcast({
      type: 'state',
      t: now - this.raceStartedAt,
      rainActive: this.eventManager.rainActive,
      players: [...this.playerStates.values()].map(p => ({ ...this.gameEngine.serializePlayer(p, now), isBot: !!p.isBot })),
      pickups: this.concurrencyResolver.serialize()
    });

    // Fin de carrera (HU05): todos llegaron, o expiró el tiempo límite. Sin
    // esto, un jugador quieto o desconectado dejaba la carrera colgada.
    const allFinished = [...this.playerStates.values()].every(p => p.finished);
    const graceExpired = this.firstFinishAt !== null && now - this.firstFinishAt >= FINISH_GRACE_MS;
    const timeLimitExpired = now - this.raceStartedAt >= RACE_TIME_LIMIT_MS;
    if (allFinished || graceExpired || timeLimitExpired) this.finishRace();
  }

  finishRace() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.state = 'results';
    const ranking = this.rankingService.buildRanking([...this.playerStates.values()]);
    this.rankingService.persistRace(ranking);
    this.broadcast({ type: 'results', ranking });
  }

  /** Volver al lobby a pedido de un jugador: solo desde la pantalla de resultados. */
  requestRestart() {
    if (this.state !== 'results') return;
    this.resetToLobby();
  }

  resetToLobby() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    // Si se vuelve al lobby durante la cuenta regresiva, la carrera no debe arrancar igual.
    if (this.countdownHandle) clearInterval(this.countdownHandle);
    this.countdownHandle = null;
    this.firstFinishAt = null;
    this.concurrencyResolver.clear();
    this.eventManager.reset();
    this.removeBots();
    this.state = 'lobby';
    this.countdownValue = 0;
    this.raceStartedAt = null;
    this.matchmaking.resetReadiness();
    let slot = 0;
    for (const p of this.playerStates.values()) {
      this.gameEngine.resetPlayerState(p);
      this.gameEngine.placeOnGrid(p, slot, this.track);
      slot += 1;
    }
    this.sendLobbyUpdate();
  }
}
