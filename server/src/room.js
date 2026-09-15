import { TRACK } from './track.js';

const TICK_MS = 50; // ciclo de actualización fijo del servidor (sección 5.1 de la propuesta)
const TURN_SPEED = 0.06;
const ACCEL = 0.18;
const FRICTION = 0.965;
const MAX_SPEED = 5.2;
const MIN_PLAYERS_TO_START = 1; // relajado para pruebas locales; el diseño objetivo es 4-8

export class Room {
  constructor(broadcastFn) {
    this.players = new Map(); // id -> player state
    this.state = 'lobby'; // lobby | countdown | racing | results
    this.countdownValue = 0;
    this.broadcast = broadcastFn;
    this.tickHandle = null;
    this.raceStartedAt = null;
    this.pickups = [];
    this.pickupTimers = [];
    this.rainActive = false;
    this.rainEndsAt = null;
    this.rainTriggered = false;
  }

  addPlayer(id, name, color) {
    const slot = this.players.size % TRACK.startPositions.length;
    const start = TRACK.startPositions[slot];
    this.players.set(id, {
      id,
      name,
      color,
      ready: false,
      x: start.x,
      y: start.y,
      angle: start.angle,
      speed: 0,
      input: { left: false, right: false, up: false, down: false },
      nextCheckpoint: 0,
      lap: 0,
      finished: false,
      finishTime: null,
      boostUntil: 0
    });
    this.sendLobbyUpdate();
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.players.size === 0) {
      this.resetToLobby();
    } else {
      this.sendLobbyUpdate();
    }
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || this.state !== 'racing') return;
    p.input = { ...p.input, ...input };
  }

  setReady(id) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby') return;
    p.ready = true;
    this.sendLobbyUpdate();
    this.maybeStartCountdown();
  }

  sendLobbyUpdate() {
    this.broadcast({
      type: 'lobby_update',
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready })),
      minToStart: MIN_PLAYERS_TO_START
    });
  }

  maybeStartCountdown() {
    const players = [...this.players.values()];
    if (players.length < MIN_PLAYERS_TO_START) return;
    if (!players.every(p => p.ready)) return;
    this.startCountdown();
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
    this.pickups = TRACK.pickups.map(p => ({ ...p, available: true }));
    this.rainActive = false;
    this.rainEndsAt = null;
    this.rainTriggered = false;
    this.broadcast({ type: 'race_start', totalLaps: TRACK.totalLaps, track: TRACK });
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    const now = Date.now();

    for (const p of this.players.values()) {
      if (p.finished) continue;
      this.applyPhysics(p, now);
      this.checkCheckpoints(p, now);
      // El Map conserva el orden de llegada al servidor (orden de 'join'), así que
      // esta iteración resuelve reclamos simultáneos de un mismo objeto de forma
      // determinista: el primero en el orden de la cola se lo lleva dentro del mismo
      // tick; los demás lo ven ya tomado (ver sección 5.1: resolución por orden de llegada).
      this.checkPickups(p, now);
    }

    if (this.rainActive && now >= this.rainEndsAt) {
      this.rainActive = false;
      this.broadcast({ type: 'event', kind: 'rain_end' });
    }

    this.broadcast({
      type: 'state',
      t: now - this.raceStartedAt,
      rainActive: this.rainActive,
      players: [...this.players.values()].map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        angle: p.angle,
        speed: p.speed,
        lap: p.lap,
        finished: p.finished,
        boosted: p.boostUntil > now
      })),
      pickups: this.pickups.map(pu => ({ id: pu.id, x: pu.x, y: pu.y, available: pu.available }))
    });

    if ([...this.players.values()].every(p => p.finished)) {
      this.finishRace();
    }
  }

  applyPhysics(p, now) {
    if (p.input.left) p.angle -= TURN_SPEED;
    if (p.input.right) p.angle += TURN_SPEED;
    if (p.input.up) p.speed += ACCEL;
    if (p.input.down) p.speed -= ACCEL;
    p.speed *= FRICTION;

    let effectiveMax = MAX_SPEED;
    if (p.boostUntil > now) effectiveMax *= TRACK.boostMultiplier;
    if (this.rainActive) effectiveMax *= TRACK.rainSpeedFactor;

    p.speed = Math.max(-effectiveMax / 2, Math.min(effectiveMax, p.speed));

    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed;

    p.x = Math.max(20, Math.min(TRACK.width - 20, p.x));
    p.y = Math.max(20, Math.min(TRACK.height - 20, p.y));
  }

  checkCheckpoints(p, now) {
    const cp = TRACK.checkpoints[p.nextCheckpoint];
    const dx = p.x - cp.x;
    const dy = p.y - cp.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= TRACK.checkpointRadius) {
      const wasLastCheckpoint = p.nextCheckpoint === TRACK.checkpoints.length - 1;
      p.nextCheckpoint = (p.nextCheckpoint + 1) % TRACK.checkpoints.length;
      if (wasLastCheckpoint) {
        // volvió a la línea de meta habiendo pasado por todos los checkpoints en orden
        p.lap += 1;
        if (!this.rainTriggered && p.lap >= 1) {
          this.rainTriggered = true;
          this.rainActive = true;
          this.rainEndsAt = now + TRACK.rainDurationMs;
          this.broadcast({ type: 'event', kind: 'rain_start', durationMs: TRACK.rainDurationMs });
        }
        if (p.lap >= TRACK.totalLaps) {
          p.finished = true;
          p.finishTime = now - this.raceStartedAt;
        }
      }
    }
  }

  checkPickups(p, now) {
    for (const pu of this.pickups) {
      if (!pu.available) continue;
      const dx = p.x - pu.x;
      const dy = p.y - pu.y;
      if (Math.sqrt(dx * dx + dy * dy) <= TRACK.pickupRadius) {
        pu.available = false; // sección crítica corta: se marca tomado de inmediato
        p.boostUntil = now + TRACK.boostDurationMs;
        this.broadcast({ type: 'event', kind: 'pickup_claimed', pickupId: pu.id, by: p.name });
        const timer = setTimeout(() => {
          pu.available = true;
        }, TRACK.pickupRespawnMs);
        this.pickupTimers.push(timer);
      }
    }
  }

  finishRace() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.state = 'results';
    const ranking = [...this.players.values()]
      .sort((a, b) => (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity))
      .map((p, idx) => ({
        position: idx + 1,
        id: p.id,
        name: p.name,
        finishTimeMs: p.finishTime
      }));
    this.broadcast({ type: 'results', ranking });
  }

  resetToLobby() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.pickupTimers.forEach(clearTimeout);
    this.pickupTimers = [];
    this.state = 'lobby';
    this.countdownValue = 0;
    this.raceStartedAt = null;
    this.rainActive = false;
    this.rainEndsAt = null;
    this.rainTriggered = false;
    for (const p of this.players.values()) {
      p.ready = false;
      p.lap = 0;
      p.nextCheckpoint = 0;
      p.finished = false;
      p.finishTime = null;
      p.speed = 0;
      p.boostUntil = 0;
    }
    this.sendLobbyUpdate();
  }
}
