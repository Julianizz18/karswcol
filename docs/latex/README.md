# Documento de arquitectura (LaTeX)

`main.tex` sigue la tabla de contenido exigida para el Release 2.

Compilar en Overleaf: New Project → Upload Project con esta carpeta (o
pegar `main.tex`), compilador **pdfLaTeX**. Localmente: `latexmk -pdf main.tex`.

Los recuadros amarillos **PENDIENTE DEL EQUIPO** marcan datos que solo el
equipo tiene (planificación, burndown, ceremonias, aprobación de los
escenarios de seguridad, capturas de Grafana): completarlos antes de entregar.

Las cifras del documento salen de `docs/` (cobertura, disponibilidad) y de
`docs/rendimiento.md` (k6). Si se vuelven a correr las pruebas, actualizar
las tablas con `node load-tests/resumen.mjs`.
