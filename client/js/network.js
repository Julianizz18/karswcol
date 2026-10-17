// Cliente WebSocket: solo envía intención (nombre, listo, input) y renderiza
// lo que el servidor autoritativo confirma. Nunca decide reglas de juego.
const Net = (() => {
  let ws = null;
  const handlers = {};

  function connect() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${location.host}`);
      ws.onopen = () => resolve();
      ws.onerror = err => reject(err);
      ws.onmessage = evt => {
        const msg = JSON.parse(evt.data);
        (handlers[msg.type] || []).forEach(fn => fn(msg));
      };
      ws.onclose = evt => (handlers['disconnected'] || []).forEach(fn => fn(evt));
    });
  }

  function on(type, fn) {
    handlers[type] = handlers[type] || [];
    handlers[type].push(fn);
  }

  function send(type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }));
    }
  }

  return { connect, on, send };
})();
