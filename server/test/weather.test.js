import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherService, conditionFromWmo, TRACK_LOCATIONS } from '../src/weather/weatherService.js';

// Clima real por pista: se simula la respuesta de Open-Meteo (sin red).

function fakeFetch(currents, { ok = true } = {}) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return { ok, status: ok ? 200 : 503, json: async () => currents.map(current => ({ current })) };
  };
  return { fetchImpl, calls };
}

const ids = Object.keys(TRACK_LOCATIONS);

test('los códigos WMO se traducen a condiciones del juego', () => {
  assert.equal(conditionFromWmo(0), 'despejado');
  assert.equal(conditionFromWmo(2), 'parcial');
  assert.equal(conditionFromWmo(3), 'nublado');
  assert.equal(conditionFromWmo(45), 'niebla');
  assert.equal(conditionFromWmo(53), 'llovizna');
  assert.equal(conditionFromWmo(63), 'lluvia');
  assert.equal(conditionFromWmo(81), 'lluvia');
  assert.equal(conditionFromWmo(95), 'tormenta');
});

test('sin datos reales cada pista tiene su clima típico', () => {
  const service = new WeatherService({ fetchImpl: async () => { throw new Error('sin red'); } });
  assert.equal(service.getForTrack('caribe').condition, 'despejado');
  assert.equal(service.getForTrack('andes').condition, 'nublado');
  assert.equal(service.getForTrack('caribe').source, 'tipico');
});

test('una sola consulta trae el clima actual de las 5 ciudades', async () => {
  const currents = ids.map((_, i) => ({ weather_code: [0, 3, 63, 2, 95][i], temperature_2m: 20 + i + 0.4, is_day: i % 2 ? 0 : 1, cloud_cover: 10, wind_speed_10m: 5, time: '2026-10-16T12:00' }));
  const { fetchImpl, calls } = fakeFetch(currents);
  let updates = 0;
  const service = new WeatherService({ fetchImpl, onUpdate: () => updates++ });
  assert.equal(await service.refresh(), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /latitude=10\.391%2C4\.711/);
  assert.deepEqual(
    ids.map(id => service.getForTrack(id).condition),
    ['despejado', 'nublado', 'lluvia', 'parcial', 'tormenta']
  );
  const bogota = service.getForTrack('andes');
  assert.equal(bogota.isDay, false);
  assert.equal(bogota.tempC, 21);
  assert.equal(bogota.source, 'real');
  assert.equal(bogota.city, 'Bogotá');
  assert.equal(updates, 1);
});

test('si Open-Meteo falla se conserva el último clima conocido', async () => {
  const good = fakeFetch(ids.map(() => ({ weather_code: 61, temperature_2m: 18, is_day: 1 })));
  const service = new WeatherService({ fetchImpl: good.fetchImpl });
  await service.refresh();
  service.fetchImpl = fakeFetch([], { ok: false }).fetchImpl;
  assert.equal(await service.refresh(), false);
  assert.equal(service.getForTrack('caribe').condition, 'lluvia');
});

test('si falla al arrancar, reintenta pronto en vez de esperar el ciclo completo', async () => {
  let calls = 0;
  const currents = ids.map(() => ({ weather_code: 0, temperature_2m: 30, is_day: 1 }));
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) throw new Error('timeout');
    return { ok: true, json: async () => currents.map(current => ({ current })) };
  };
  const service = new WeatherService({ fetchImpl, retryMs: 20, refreshMs: 60_000 });
  service.start();
  await new Promise(resolve => setTimeout(resolve, 120));
  service.stop();
  assert.equal(calls, 2);
  assert.equal(service.getForTrack('andes').source, 'real');
});

test('un fallo inesperado del refresco en segundo plano no deja una promesa rechazada', async () => {
  const service = new WeatherService({ fetchImpl: fakeFetch([]).fetchImpl });
  service.refresh = async () => { throw new Error('fallo inesperado'); };
  const unhandled = [];
  const onUnhandled = err => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    service.refreshInBackground();
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});
