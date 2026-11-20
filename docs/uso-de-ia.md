# Uso de inteligencia artificial (sección 2.8)

> Borrador para revisión del equipo antes de la entrega.

## Herramienta

Asistente de programación con IA ejecutado en la terminal del equipo
(Claude Code, de Anthropic), con acceso al repositorio local. No se le
entregaron credenciales ni secretos: las variables sensibles viven en `.env`
y en el panel de Render, fuera del repositorio, y los inicios de sesión
(GitHub, Google, Render) los hizo el equipo en su navegador.

## Para qué se usó

| Objetivo | Artefactos producidos | Validación humana | Mejora obtenida |
|---|---|---|---|
| Revisión de errores de código | Lista de bugs y corrección de los confirmados (input sin validar, join repetido, lobby trabado, controles sin entrar a la sala, objetos que reaparecían en pausa, teclas pegadas, controles del anfitrión bloqueados, etiqueta "Tú") | El equipo reprodujo los bugs en el juego, revisó cada cambio y lo probó en local y en Render | Cada corrección tiene su prueba automática de regresión |
| Generación y refactorización de código | Funcionalidades del Release 2: reconexión, volver a la carrera tras recargar, anfitrión, votación de lobby, límite de pausas, tiempos por vuelta, calidad gráfica adaptativa, modelos 3D, elementos por región | Revisión de los diffs, pruebas manuales con varios navegadores y cuentas | Funcionalidad en tiempo real más robusta |
| Casos de prueba | Pruebas del backend y entorno de pruebas del frontend en jsdom (`server/test/`) | El equipo ejecutó la suite y verificó que las pruebas nuevas fallan sin el arreglo correspondiente | Cobertura de 95 % en backend y frontend |
| CI/CD | Workflows reutilizables de GitHub Actions, integración con SonarCloud, `render.yaml`, Dockerfile en Node 22 | Ejecución real del pipeline en GitHub y del despliegue en Render | Pruebas y Quality Gate en cada push |
| Seguridad y observabilidad | Revocación de sesiones, límite de mensajes, métricas y alertas de seguridad, paneles de Grafana | Pruebas automáticas, `promtool` y revisión de los dashboards | Tres escenarios de seguridad con validación ejecutable |
| Documentación | Escenarios de calidad en `docs/`, cálculo de disponibilidad, informe de rendimiento | El equipo verificó cifras y referencias contra las ejecuciones reales | Documentación consistente con el código |
| Apoyo de ideas, ortografía y bibliografía | Propuestas de diseño, corrección de textos, búsqueda de SLA publicados | Decisión final del equipo; las fuentes se citan en cada documento | — |

## Cómo se controló

- Cada cambio quedó en un commit pequeño con un mensaje que explica el
  problema y la solución.
- Ningún cambio se subió sin pasar la suite de pruebas.
- Los resultados reportados (cobertura, k6, disponibilidad observada)
  provienen de ejecuciones reales cuyos archivos están en el repositorio.
- Cada integrante debe poder explicar y defender los cambios de su área en la
  sustentación.
