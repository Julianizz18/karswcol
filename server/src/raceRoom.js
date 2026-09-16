import { TRACKS, getTrackById } from './game-engine/trackCatalog.js';
import { TOTAL_LAPS } from './game-engine/gameplayConfig.js';
import { GameEngine, TICK_MS } from './game-engine/gameEngine.js';
import { MatchmakingService } from './matchmaking/matchmakingService.js';
import { ConcurrencyResolver } from './concurrency-resolver/concurrencyResolver.js';
import { EventManager } from './event-manager/eventManager.js';
import { RankingService } from './ranking-persistence/rankingService.js';

// RaceRoom orquesta los componentes de la vista de aplicación (sección 4.1):
// no implementa reglas de juego por sí misma, solo conecta Matchmaking,
// Game Engine, Concurrency Resolver, Event Manager y Ranking Service, y
// mantiene el estado de sala (lobby | countdown | racing | results).
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
    this.tickHandle = null;
    this.raceStartedAt = null;
    this.playerStates = new Map(); // id -> estado físico (Game Engine)
    this.trackId = TRACKS[0].id;
  }

  get track() {
    return getTrackById(this.trackId);
  }

  addPlayer(id, name, color) {
    if (!this.matchmaking.hasCapacity()) return false;
    this.matchmaking.join(id, name, color);
    const slot = this.matchmaking.list().length - 1;
    this.playerStates.set(id, this.gameEngine.createPlayerState(id, name, color, slot, this.track));
    this.sendLobbyUpdate();
    return true;
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
    if (p) this.gameEngine.setInput(p, input);
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
      selectedTrackId: this.trackId
    });
  }

  startCountdown() {
    this.state = 'countdown';
    this.countdownValue = 3;
    this.broadcast({ type: 'countdown', seconds: this.countdownValue });
    const interval = setInterval(() => {
      this.countdownValue -= 1;
      if (this.countdownValue <= 0) {
        clearInterval(interval);
        this.startRace();
      } else {
        this.broadcast({ type: 'countdown', seconds: this.countdownValue });
      }
    }, 1000);
  }

  startRace() {
    this.state = 'racing';
    this.raceStartedAt = Date.now();
    this.concurrencyResolver.reset(this.track);
    this.eventManager.reset();
    this.broadcast({ type: 'race_start', totalLaps: TOTAL_LAPS, track: this.track });
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    const now = Date.now();
    const speedFactor = this.eventManager.speedFactor();
    const track = this.track;

    for (const p of this.playerStates.values()) {
      const lapEvent = this.gameEngine.step(p, now, this.raceStartedAt, speedFactor, track);
      if (lapEvent) {
        this.broadcast({ type: 'event', kind: 'lap_completed', playerId: lapEvent.playerId, name: lapEvent.name, lap: lapEvent.lap });
        const rainEvent = this.eventManager.onLapCompleted(lapEvent.lap, now);
        if (rainEvent) this.broadcast({ type: 'event', kind: rainEvent.type, durationMs: rainEvent.durationMs });
      }
      // Mismo orden de iteración en cada tick: la resolución de conflictos
      // sobre objetos compartidos queda determinada por el orden de llegada.
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
      players: [...this.playerStates.values()].map(p => this.gameEngine.serializePlayer(p, now)),
      pickups: this.concurrencyResolver.serialize()
    });

    if ([...this.playerStates.values()].every(p => p.finished)) this.finishRace();
  }

  finishRace() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.state = 'results';
    const ranking = this.rankingService.buildRanking([...this.playerStates.values()]);
    this.rankingService.persistRace(ranking);
    this.broadcast({ type: 'results', ranking });
  }

  resetToLobby() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.concurrencyResolver.clear();
    this.eventManager.reset();
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
