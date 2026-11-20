// Contador de FPS en la esquina superior izquierda de la carrera. Cuenta los
// frames que el navegador alcanza a dibujar (requestAnimationFrame) y los
// muestra cada medio segundo, con color según qué tan fluido va el juego.
// Solo corre mientras la pantalla de carrera está visible.
const FpsCounter = (() => {
  const UPDATE_MS = 500;
  const screen = document.getElementById('screen-race');
  const el = document.createElement('div');
  el.className = 'fps-counter';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = '-- FPS';
  document.querySelector('.race-stage').appendChild(el);

  let rafHandle = null;
  let frames = 0;
  let windowStart = 0;
  let current = 0;

  function tick(now) {
    rafHandle = requestAnimationFrame(tick);
    if (!windowStart) windowStart = now;
    frames++;
    const elapsed = now - windowStart;
    if (elapsed < UPDATE_MS) return;
    current = Math.round((frames * 1000) / elapsed);
    frames = 0;
    windowStart = now;
    el.textContent = `${current} FPS`;
    el.dataset.level = current >= 55 ? 'good' : current >= 30 ? 'ok' : 'bad';
  }

  function start() {
    if (rafHandle !== null) return;
    frames = 0;
    windowStart = 0;
    rafHandle = requestAnimationFrame(tick);
  }

  function stop() {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  function sync() {
    if (screen.classList.contains('active')) start();
    else stop();
  }

  new MutationObserver(sync).observe(screen, { attributes: true, attributeFilter: ['class'] });
  sync();

  return { get fps() { return current; } };
})();
