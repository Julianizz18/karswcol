# KARSWCOL

Carreras 2D multijugador en tiempo real con identidad colombiana. Servidor
autoritativo en Node.js + WebSocket, cliente web navegable (menú → lobby →
carrera → resultados).

## Ejecutar

```
cd server
npm install
npm start
```

Abre `http://localhost:3000` en dos o más pestañas/navegadores para probar
la sincronización multijugador.

## Estado actual (avance de sprint 1-2)

Implementado:
- Menú de navegación (Jugar / Cómo jugar / Créditos).
- Ingreso de nombre y lobby con estado "listo" en vivo (HU01).
- Carrera con movimiento server-authoritative a tick fijo de 50ms: el
  servidor calcula posición y ángulo de cada kart, el cliente solo
  renderiza lo que el servidor confirma (HU02, sección 5.1/5.2 de la
  propuesta).
- Conteo de vueltas por puntos de control en orden y pantalla de
  resultados (HU05, versión simplificada).
- Objetos recogibles con resolución de concurrencia (HU03): el estado del
  objeto se marca "tomado" dentro del mismo tick en que se detecta el
  reclamo; si dos jugadores llegan al mismo objeto en el mismo ciclo, el
  orden de iteración del servidor (orden de llegada al `join`, ver sección
  5.1) decide de forma determinista quién se lo lleva — probado con dos
  clientes reclamando el mismo objeto a la vez.
- Evento dinámico de lluvia (HU04): se dispara la primera vez que algún
  jugador completa la vuelta 1, reduce la velocidad máxima de todos los
  karts por 10s y se ve como overlay de lluvia en el cliente.
- Selección de color de kart en el ingreso, velocímetro en el HUD e
  identidad visual colombiana en menú y lobby.

Pendiente (siguiente sprint, según release plan):
- Persistencia de ranking en PostgreSQL y estado en Redis (HU05, HU06).
- Reconexión con token de sesión (HU06).
- Matchmaking real por salas (hoy hay una sola sala compartida).

## Estructura

```
server/   Backend Node.js (WebSocket + game loop autoritativo)
client/   Cliente web estático (HTML/CSS/JS, sin build step)
```
