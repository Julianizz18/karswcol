# Portabilidad (sección 2.4)

## Escenario de calidad: migración Cloud → On-Premise

| Elemento | Descripción |
|---|---|
| Fuente | La universidad (o un cliente) decide operar el juego en sus propios servidores |
| Estímulo | Migrar KARSWCOL desde Render (cloud) a una máquina propia con Docker |
| Artefacto | Imagen del servidor, configuración y servicios complementarios |
| Entorno | Servidor Linux o Windows con Docker Engine y Docker Compose, sin acceso a Render |
| Respuesta | El sistema se levanta con un solo comando (`docker compose up --build`), con la misma imagen que corre en la nube y con la capa de observabilidad incluida; solo cambian variables de entorno |
| Medida | ≤ 30 min de un operador con Docker instalado; 0 cambios de código; las mismas pruebas de humo pasan (`/health` responde y el cliente se sirve) |

## Por qué la migración no requiere cambios de código

- **Una sola imagen** (`server/Dockerfile`, `node:22-alpine`, sin root, con
  `HEALTHCHECK`) empaqueta backend y frontend: el gateway sirve el cliente
  estático. Es la misma imagen que Render construye a partir de `render.yaml`
  y la que CI construye y prueba en cada push (`reusable-docker.yml`).
- **Configuración por variables de entorno** (12-factor), no por archivos
  dentro de la imagen.
- **Sin estado persistente obligatorio**: salas y carreras viven en memoria;
  no hay datos que migrar. Redis y PostgreSQL ya están en el Compose para la
  evolución planeada (ranking persistente, varias instancias).
- **Dependencias externas mínimas y degradables**: Google Identity (login) y
  Open-Meteo (clima, opcional con respaldo al clima típico de cada pista).

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `PORT` | No (3000) | Puerto HTTP/WebSocket |
| `GOOGLE_CLIENT_ID` | Sí | Client ID de OAuth de Google |
| `SESSION_SECRET` | Sí en producción | Firma de las cookies de sesión (si falta se genera uno al arrancar y las sesiones no sobreviven reinicios) |
| `METRICS_TOKEN` | Recomendada si `/metrics` es público | Exige `Authorization: Bearer` en `/metrics` |
| `LOAD_TEST_TOKEN` | No (vacía en producción) | Habilita el login sintético de k6 |
| `LOG_LEVEL` | No (`info`) | Nivel de logs JSON |
| `REDIS_URL`, `DATABASE_URL` | No (reservadas) | Servicios complementarios del Compose |

## Pasos de la migración (reproducibles)

1. Instalar Docker Engine y Docker Compose en el servidor propio.
2. Clonar el repositorio y crear `.env` a partir de `.env.example`:
   `GOOGLE_CLIENT_ID`, `SESSION_SECRET` (aleatorio) y, si se van a correr
   pruebas de carga, `LOAD_TEST_TOKEN`.
3. En Google Cloud Console, agregar el origen nuevo (p. ej.
   `https://juego.miuniversidad.edu.co`) a **Orígenes de JavaScript autorizados**.
4. Levantar todo: `docker compose up --build -d`
   - gateway (juego) en el puerto 3000
   - Redis y PostgreSQL
   - Prometheus (9090), Grafana (3001) con dashboards y alertas
     aprovisionados, Loki y Promtail para los logs
5. Verificar: `curl http://localhost:3000/health` y abrir
   `http://localhost:3001` (dashboard "KARSWCOL — Servidor").
6. Exponerlo con HTTPS mediante el proxy inverso de la institución (Nginx,
   Traefik) apuntando al puerto 3000, con soporte de WebSocket
   (`Upgrade`/`Connection`) y la cabecera `X-Forwarded-Proto` para que la
   cookie salga con `Secure`.

Alternativa sin Docker (Windows): `observability/local/start.ps1` descarga y
arranca Prometheus, Grafana, Loki y Promtail como procesos locales junto al
servidor (ver `OBSERVABILITY.md`).

> Nota: Docker Compose en un solo host sirve para reproducir el entorno de
> prueba; no reemplaza la justificación de despliegue distribuido
> (ver `docs/disponibilidad.md`).
