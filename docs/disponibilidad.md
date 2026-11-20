# Disponibilidad y escalabilidad (sección 2.1)

## Contexto y restricción del equipo

KARSWCOL está desplegado en **Render, plan gratuito**, con una sola instancia
del servicio `karswcol` (gateway + motor de juego + cliente estático). El
equipo decidió no pagar infraestructura, y el plan gratuito **no permite más de
una instancia** ni balanceo entre instancias propias. Por eso la arquitectura
**desplegada** es de un solo nodo, mientras que la arquitectura **objetivo**
(documentada aquí y en `ARCHITECTURE.md`) escala horizontalmente con un
balanceador y estado compartido en Redis.

Este documento separa con claridad lo que está implementado y medido de lo que
es diseño objetivo, como pide la rúbrica ("reconociendo las limitaciones del
entorno de prueba").

## Escenario de calidad

| Elemento | Descripción |
|---|---|
| Fuente | Jugadores conectados por Internet |
| Estímulo | La instancia del servidor se cae o se reinicia (despliegue, fallo del proveedor, inactividad del plan gratuito) |
| Artefacto | Servicio `karswcol` (gateway WebSocket + game loop) |
| Entorno | Operación normal, carrera en curso |
| Respuesta | El cliente detecta la caída, muestra un aviso propio y reintenta con espera creciente (1, 2, 4, 8 s, ~1,5 min). Al volver, entra de nuevo a la sala; si la carrera sigue viva en el servidor, recupera su kart durante 30 s de gracia. Prometheus dispara `KarswcolCaido` (`up == 0` por 30 s). |
| Medida | Reconexión automática en ≤ 15 s una vez el servidor responde; 0 intervenciones manuales del jugador; detección de la caída en ≤ 30 s. |

Validación ejecutable: `server/test/client-connection.test.js`
(reconexión, reintento con espera, sesión inválida) y
`server/test/room.test.js` (recuperar el kart dentro de los 30 s).

## Componentes y SLA publicados

| Componente | Rol | SLA publicado | Valor usado en el cálculo |
|---|---|---|---|
| Render Web Service (plan gratuito) | Ejecuta el servidor y sirve el cliente | **No publica SLA para planes no Enterprise** | 0,995 (supuesto conservador del equipo) |
| Google Identity Services (Sign in with Google) | Login | El servicio gratuito no tiene SLA propio; como referencia, Google Identity Platform publica 99,95 % y Cloud Identity 99,9 % | 0,999 (referencia de Cloud Identity) |
| Open-Meteo | Clima real | Sin SLA (servicio gratuito) | **No entra al cálculo**: si falla, cada pista usa su clima típico (táctica de degradación controlada) |
| Navegador del jugador | Cliente | — | Fuera del alcance |

> El valor de Render es un supuesto, no un dato del proveedor. Debe
> contrastarse con la disponibilidad observada (ver "Contraste con lo
> observado").

## Componentes en serie y en paralelo

**Despliegue actual (serie):** para jugar hace falta el servidor en Render
**y** el login de Google (al entrar; una sesión ya iniciada dura 12 h y no
vuelve a depender de Google).

```
Jugador ─▶ Render (1 instancia: gateway + game loop) ─▶ Google Identity (solo al iniciar sesión)
                         └─▶ Open-Meteo (opcional, con respaldo: no es punto único de falla)
```

Puntos únicos de falla:
1. **La instancia única de Render.** Si cae, se cae todo. Además, el plan
   gratuito la apaga tras 15 min sin tráfico (arranque en frío de 30–60 s).
2. **El estado en memoria.** Salas, carreras y sesiones revocadas viven en el
   proceso: un reinicio las pierde (las sesiones firmadas sí sobreviven porque
   `SESSION_SECRET` es fijo).
3. **Google Identity** para nuevos inicios de sesión.

**Arquitectura objetivo (paralelo):** 2 instancias detrás de un balanceador
con afinidad de sesión (sticky) para el WebSocket, y Redis para el estado
compartido y Pub/Sub entre instancias.

## Cálculo de disponibilidad

Fórmulas: serie `A = ∏ Aᵢ`; paralelo `A = 1 − ∏(1 − Aᵢ)`;
downtime mensual `(1 − A) × 30 días`; anual `(1 − A) × 365 días`.

### Despliegue actual (serie)

A = 0,995 × 0,999 = **0,994005 → 99,40 %**

| | Cálculo | Resultado |
|---|---|---|
| Indisponibilidad | 1 − 0,994005 | 0,005995 |
| Downtime mensual | 0,005995 × 30 días | 0,180 días ≈ **4 h 19 min** |
| Downtime anual | 0,005995 × 365 días | 2,19 días ≈ **52 h 31 min** |

Interpretación: **"dos nueves"** (99,4 %). Aceptable para un prototipo
académico y un juego casual; insuficiente para un servicio comercial.

### Arquitectura objetivo (2 instancias en paralelo + login en serie)

- Instancias en paralelo: 1 − (1 − 0,995)² = 1 − 0,000025 = 0,999975
- Con el balanceador administrado (supuesto 0,9999) y el login en serie:
  A = 0,9999 × 0,999975 × 0,999 = **0,998875 → 99,89 %**

| | Resultado |
|---|---|
| Downtime mensual | 0,001125 × 30 días ≈ **48,6 min** |
| Downtime anual | 0,001125 × 365 días ≈ **9 h 51 min** |

Interpretación: casi **tres nueves**. El límite pasa a ser el login de Google
(99,9 %) y no el servidor: redundar el servidor más allá de 2 instancias casi
no mejora el total.

## Escalabilidad horizontal (diseño objetivo)

El código ya separa responsabilidades para escalar (ver `ARCHITECTURE.md`):

- **Balanceador** (Render con plan pago, Nginx o un ALB) con afinidad de
  sesión para que el WebSocket de un jugador llegue siempre a la misma
  instancia mientras dure la conexión.
- **Una sala = una instancia**: el game loop es autoritativo y de baja
  latencia, así que cada sala corre completa en un proceso. Escalar es
  agregar instancias que alojen más salas.
- **Redis** (ya orquestado en `docker-compose.yml`) para el directorio de
  salas, la lista de sesiones revocadas y Pub/Sub de eventos entre instancias.
- **PostgreSQL** (ya orquestado) para el historial y el ranking
  (`RankingService.persistRace` es el punto de extensión).

Lo que **no** está implementado por la restricción de costo: el balanceador
entre instancias propias, la segunda instancia y el uso real de Redis y
PostgreSQL desde el código.

## Contraste con lo observado

- **Prometheus/Grafana** (`observability/`): la regla `KarswcolCaido` mide
  `up{job="karswcol"}` cada 5 s; el panel de disponibilidad del dashboard
  "KARSWCOL — Servidor" muestra el porcentaje observado durante las pruebas.
- **k6** (`docs/rendimiento.md`): la tasa de error HTTP y de sesiones
  WebSocket bajo carga, estrés y picos da la disponibilidad *percibida* bajo
  presión.
- **Producción (Render)**: se recomienda un monitor externo gratuito
  (p. ej. UptimeRobot contra `https://karswcol.onrender.com/health` cada
  5 min). Además de medir la disponibilidad real, evita el apagado por
  inactividad del plan gratuito.

Limitaciones: las pruebas locales corren servidor y generador de carga en el
mismo equipo, y Render gratuito no expone métricas internas ni permite
balanceo; por eso la disponibilidad del despliegue se reporta como supuesto
más medición externa, no como dato del proveedor.

## Fuentes

- Render no ofrece SLA contractual fuera de Enterprise: https://kuberns.com/blogs/is-render-good-for-production/ y página de estado https://status.render.com
- Google Identity Platform SLA (99,95 %): https://cloud.google.com/identity-platform/sla
- Cloud Identity SLA (99,9 %): https://cloud.google.com/terms/identity/sla
