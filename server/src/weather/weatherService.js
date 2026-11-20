// Weather Service: clima real y actual de la región de cada pista.
// Consulta Open-Meteo (gratuito, sin clave) con las coordenadas de una
// ciudad representativa de cada región y lo traduce a un estado simple que
// los clientes usan para ambientar la pista (sol, nubes, niebla, lluvia,
// noche). Si la consulta falla o no hay internet, cada pista conserva su
// clima típico, así el juego nunca depende de un servicio externo.
import { logger } from '../observability/logger.js';
import { weatherRefreshes } from '../observability/metrics.js';

const API_URL = 'https://api.open-meteo.com/v1/forecast';
const REFRESH_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const RETRY_MS = 30 * 1000; // tras un fallo no se espera al próximo ciclo de 10 min

// Ciudad de referencia y clima típico (respaldo) por pista.
export const TRACK_LOCATIONS = {
  caribe: { city: 'Cartagena', lat: 10.391, lon: -75.479, typical: { condition: 'despejado', tempC: 31, isDay: true } },
  andes: { city: 'Bogotá', lat: 4.711, lon: -74.072, typical: { condition: 'nublado', tempC: 14, isDay: true } },
  cafetero: { city: 'Manizales', lat: 5.07, lon: -75.517, typical: { condition: 'parcial', tempC: 20, isDay: true } },
  llanos: { city: 'Villavicencio', lat: 4.142, lon: -73.626, typical: { condition: 'despejado', tempC: 30, isDay: true } },
  amazonia: { city: 'Leticia', lat: -4.215, lon: -69.94, typical: { condition: 'llovizna', tempC: 27, isDay: true } }
};

/** Traduce el código WMO de Open-Meteo a una condición del juego. */
export function conditionFromWmo(code) {
  if (code === 0 || code === 1) return 'despejado';
  if (code === 2) return 'parcial';
  if (code === 3) return 'nublado';
  if (code === 45 || code === 48) return 'niebla';
  if (code >= 51 && code <= 57) return 'llovizna';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'lluvia';
  if (code >= 95) return 'tormenta';
  // Nieve u otros códigos: en estas regiones de Colombia se ve como nublado.
  return 'nublado';
}

export class WeatherService {
  constructor({ fetchImpl = globalThis.fetch, refreshMs = REFRESH_MS, retryMs = RETRY_MS, onUpdate = () => {} } = {}) {
    this.fetchImpl = fetchImpl;
    this.refreshMs = refreshMs;
    this.retryMs = retryMs;
    this.retryTimer = null;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.current = {};
    for (const [trackId, loc] of Object.entries(TRACK_LOCATIONS)) {
      this.current[trackId] = { ...loc.typical, city: loc.city, source: 'tipico' };
    }
  }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.refreshMs);
    // No mantiene vivo el proceso por sí solo (pruebas, apagado limpio).
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
  }

  /** Una sola petición para todas las ciudades (Open-Meteo acepta varias coordenadas). */
  async refresh() {
    const ids = Object.keys(TRACK_LOCATIONS);
    const params = new URLSearchParams({
      latitude: ids.map(id => TRACK_LOCATIONS[id].lat).join(','),
      longitude: ids.map(id => TRACK_LOCATIONS[id].lon).join(','),
      current: 'temperature_2m,weather_code,cloud_cover,is_day,wind_speed_10m',
      timezone: 'America/Bogota'
    });
    try {
      const res = await this.fetchImpl(`${API_URL}?${params}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [data];
      ids.forEach((id, i) => {
        const now = list[i] && list[i].current;
        if (!now || typeof now.weather_code !== 'number') return;
        this.current[id] = {
          condition: conditionFromWmo(now.weather_code),
          tempC: Math.round(now.temperature_2m),
          isDay: now.is_day !== 0,
          cloudCover: now.cloud_cover,
          windKmh: Math.round(now.wind_speed_10m),
          city: TRACK_LOCATIONS[id].city,
          source: 'real',
          updatedAt: now.time
        };
      });
      weatherRefreshes.inc({ result: 'ok' });
      this.onUpdate();
      return true;
    } catch (err) {
      weatherRefreshes.inc({ result: 'error' });
      logger.warn('weather.refresh_failed', { err: err.message, retryInSeconds: this.retryMs / 1000 });
      if (this.timer && !this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.refresh();
        }, this.retryMs);
        if (this.retryTimer.unref) this.retryTimer.unref();
      }
      return false;
    }
  }

  getForTrack(trackId) {
    return this.current[trackId] || { condition: 'despejado', tempC: 25, isDay: true, source: 'tipico' };
  }
}
