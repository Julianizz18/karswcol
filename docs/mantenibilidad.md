# Mantenibilidad (sección 2.3)

## Escenario de calidad: inspección continua

| Elemento | Descripción |
|---|---|
| Fuente | Un integrante del equipo |
| Estímulo | Hace push a `master` o abre un pull request con un cambio en el servidor o el cliente |
| Artefacto | Código fuente (`server/src`, `client/js`) y sus pruebas |
| Entorno | Integración continua en GitHub Actions |
| Respuesta | Se ejecutan las pruebas con cobertura de backend y frontend, SonarCloud analiza el código con esa cobertura y espera el Quality Gate; además se construye y prueba la imagen Docker |
| Medida | Cobertura ≥ 80 % en backend y en frontend; Quality Gate en verde (calificación A); si algo falla, el workflow queda en rojo y Render puede configurarse para no desplegar ("Auto-Deploy: After CI Checks Pass") |

## Pipeline (GitHub Actions con reusable workflows)

`.github/workflows/ci.yml` compone tres workflows reutilizables (`workflow_call`):

| Workflow | Qué hace |
|---|---|
| `reusable-node-tests.yml` | `npm ci`, `npm run coverage` (pruebas de servidor y cliente) y revisión de sintaxis del cliente; publica `lcov.info` como artefacto |
| `reusable-sonarcloud.yml` | Descarga la cobertura, ejecuta el análisis de SonarCloud y espera el Quality Gate (`sonar.qualitygate.wait=true`) |
| `reusable-docker.yml` | Construye la imagen de producción, la arranca y verifica `/health` y que sirva el cliente |

Configuración de SonarCloud en el repositorio de GitHub
(Settings → Secrets and variables → Actions):

- secreto `SONAR_TOKEN` (SonarCloud → My Account → Security)
- variables `SONAR_ORGANIZATION` y `SONAR_PROJECT_KEY`

SonarCloud es gratuito para repositorios **públicos**; para uno privado
requiere plan pago. Sin `SONAR_TOKEN` el paso se omite con un aviso, así el
resto del pipeline sigue funcionando.

## Cobertura (medida con el runner de Node)

| Capa | Archivos | Líneas | Ramas | Meta |
|---|---|---|---|---|
| Backend | `server/src/**` | 95,1 % | 82,9 % | ≥ 80 % ✅ |
| Frontend | `client/js/**` | 95,1 % | 84,9 % | ≥ 80 % ✅ |

Cómo se mide el frontend: `server/test/client/harness.js` carga el
`index.html` real en jsdom y ejecuta los scripts del cliente en el orden del
navegador, con dobles de WebSocket, `fetch`, canvas, gamepad y login de
Google. La vista 3D (`race3d.js`) se ejecuta con Three.js real y un renderer
falso, porque jsdom no tiene WebGL. La cobertura se atribuye a cada archivo
de `client/js` y el script `server/scripts/coverage.mjs` deja el `lcov.info`
con rutas relativas a la raíz, que es lo que lee Sonar.

Reproducir:

```bash
cd server
npm ci
npm test            # 186+ pruebas, ~10 s
npm run coverage    # deja server/coverage/lcov.info
```

Exclusiones de cobertura (`sonar-project.properties`): solo `load-tests/**`
(los scripts de k6 se ejecutan con k6 contra el sistema, no con pruebas
unitarias) y `client/vendor/**` (Three.js, código de terceros).

## Controles de calidad aplicados

- Pruebas automáticas en cada push y pull request (backend y frontend).
- Quality Gate de SonarCloud como condición del pipeline.
- Imagen Docker construida y probada en cada push.
- `.gitattributes` normaliza los finales de línea (sin diffs falsos).
- Estructura por componentes que siguen la vista de arquitectura (Gateway,
  Matchmaking, Game Engine, Concurrency Resolver, Event Manager, Ranking,
  Weather, Observability): cada uno con su archivo y sus pruebas.
