# Seguridad (sección 2.2)

Tres escenarios de calidad (autenticación, autorización y protección frente a
ataques), con las tácticas de *Software Architecture in Practice* (Bass,
Clements y Kazman) que los atienden y la validación ejecutable de cada uno.
Todas las pruebas se corren con `cd server && npm test` y en GitHub Actions.

> Pendiente del equipo: presentar estos escenarios al profesor para su
> aprobación, como pide la rúbrica.

## Escenario S1 — Autenticación y sesión (confidencialidad e integridad)

| Elemento | Descripción |
|---|---|
| Fuente | Un atacante con una cookie de sesión copiada, alterada o de una sesión ya cerrada |
| Estímulo | Usa esa cookie para llamar a la API o abrir el WebSocket del juego |
| Artefacto | Auth Service (`server/src/auth/authService.js`) y Connection Gateway |
| Entorno | Operación normal, en producción (HTTPS) |
| Respuesta | El servidor rechaza la cookie: `/api/auth/me` responde 401 y el WebSocket se cierra con 4401. Al cerrar sesión, la sesión queda revocada en el servidor y las pestañas abiertas con ella se desconectan. |
| Medida | 100 % de cookies alteradas, vencidas o revocadas rechazadas; la revocación aplica de inmediato (0 s) |

Tácticas (Bass): **autenticar actores** (Google Identity Services: el
servidor verifica firma, audiencia y vencimiento del ID token),
**verificar la integridad del mensaje** (cookie firmada con HMAC-SHA256 y
comparación en tiempo constante), **revocar acceso** (lista de sesiones
revocadas por `sid`), **limitar la exposición** (cookie `HttpOnly`,
`SameSite=Lax` y `Secure` detrás de HTTPS; vence a las 12 h).

Sobre JWT: el ID token de Google es un JWT y se valida con la librería
oficial (`google-auth-library`); para la sesión propia se usa un token
firmado con HMAC (mismo principio que un JWT HS256) guardado en cookie
`HttpOnly`, así nunca queda accesible a JavaScript del navegador.

Validación ejecutable (`server/test/auth.test.js`):
- "cookie manipulada no es aceptada"
- "WebSocket sin sesión se cierra con código 4401"
- "después del logout la cookie anterior ya no sirve"
- "una cookie renovada antes del logout también queda invalidada"
- "el logout desconecta las pestañas abiertas con esa sesión"
- "login con correo no verificado se rechaza", "login válido crea cookie HttpOnly…"

## Escenario S2 — Autorización (quién puede hacer qué)

| Elemento | Descripción |
|---|---|
| Fuente | Un usuario autenticado sin permiso: no entró a la sala, no es el anfitrión, o usa una segunda pestaña con la misma cuenta |
| Estímulo | Envía mensajes para cambiar la pista, la dificultad o los bots, reiniciar la carrera o crear un segundo kart |
| Artefacto | Gateway y RaceRoom (`server/src/gateway/gateway.js`, `server/src/raceRoom.js`) |
| Entorno | Lobby o carrera en curso |
| Respuesta | El servidor ignora la acción no autorizada y el estado de la sala no cambia; el cliente deshabilita esos controles y dice quién puede usarlos |
| Medida | 0 cambios de estado provocados por actores sin permiso |

Tácticas (Bass): **autorizar actores** (solo el anfitrión configura la sala;
solo quien entró a la sala la controla; una cuenta = un kart),
**separar entidades** (el servidor es autoritativo: el cliente solo envía
intención y el servidor decide), **limitar el acceso** (el WebSocket exige el
mismo origen y sesión válida; la foto del jugador sale de la sesión de Google,
nunca del mensaje del cliente).

Validación ejecutable:
- `auth.test.js`: "una conexión que no entró a la sala no puede controlarla",
  "login desde otro origen se rechaza", "la foto de Google llega a la sala
  desde la sesión, no desde el cliente"
- `room.test.js`: "solo el anfitrión (el primero en entrar) cambia la
  configuración", "una misma cuenta no puede tener dos karts"
- `client-lobby.test.js`: "quien no es anfitrión ve los controles bloqueados y quién elige"

## Escenario S3 — Protección frente a ataques (resistir y detectar)

| Elemento | Descripción |
|---|---|
| Fuente | Un cliente malicioso o defectuoso |
| Estímulo | Inunda el WebSocket con mensajes (cientos por segundo) o envía datos mal formados (JSON inválido, input con claves arbitrarias, URLs mal codificadas) |
| Artefacto | Connection Gateway y Game Engine |
| Entorno | Carrera en curso con otros jugadores |
| Respuesta | El exceso se descarta (30 mensajes/s por conexión, ráfagas de 60); quien insiste se desconecta (1008); los datos mal formados se ignoran sin tumbar el proceso; Prometheus registra los descartes y alerta |
| Medida | El servidor sigue atendiendo a los demás jugadores; el atacante se desconecta tras 300 mensajes descartados; la alerta `MensajesDescartadosPorLimite` se activa con más de 100 descartes en 5 min |

Tácticas (Bass): **limitar la exposición / limitar el acceso** (token bucket
por conexión, tamaño máximo del cuerpo HTTP de 16 KB, `/metrics` protegido
con token en el despliegue público), **validar la entrada** (el input del
jugador se reduce a 4 booleanos; mensajes no objeto se ignoran),
**detectar ataques** (métricas `karswcol_ws_messages_received_total{type="rate_limited"}`,
`karswcol_ws_connections_total{result="rejected"}` y
`karswcol_auth_logins_total{result="failure"}` con alertas en
`observability/prometheus/alerts.yml`), **mantener auditoría** (logs JSON
estructurados de inicio/cierre de sesión y rechazos, consultables en Loki).

Validación ejecutable:
- `auth.test.js`: "los mensajes por encima del límite se descartan", "quien
  insiste muy por encima del límite es desconectado", "los inicios de sesión
  exitosos y fallidos quedan en /metrics (trazabilidad)"
- `input.test.js`: "setInput descarta claves desconocidas", "setInput
  convierte valores no booleanos a false", "setInput ignora un input que no es objeto"
- `metrics-auth.test.js`: "/metrics sin token responde 401"
- `promtool check rules observability/prometheus/alerts.yml` valida las alertas

## Buenas prácticas adicionales

- Sin secretos en el repositorio: `.env` y `tools/` están en `.gitignore`;
  en Render las variables se configuran en el panel (`SESSION_SECRET` y
  `METRICS_TOKEN` generados por Render).
- El contenedor corre sin privilegios de root (`USER node`).
- El endpoint de pruebas de carga (`/api/auth/loadtest`) solo existe si se
  define `LOAD_TEST_TOKEN`; en producción no está definido.
- Cifrado en tránsito: Render termina TLS (HTTPS/WSS); el cliente usa `wss://`
  automáticamente cuando la página carga por HTTPS.
