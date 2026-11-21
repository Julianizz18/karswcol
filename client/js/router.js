// Router mínimo entre pantallas (menú, ayuda, créditos, lobby, carrera, resultados).
// Los cambios de pantalla pasan por un "barrido de carril": un tramo de vía
// cruza la ventana y la pantalla se cambia justo cuando la tapa del todo.
const Router = (() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wipe = document.getElementById('lane-wipe');
  let pending = null; // pantalla a mostrar cuando el barrido tape la actual
  let wiping = false;

  function swap(name) {
    const target = document.getElementById(`screen-${name}`);
    if (!target) return;
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    target.classList.add('active');
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
  }

  async function runWipe() {
    wiping = true;
    wipe.style.visibility = 'visible';
    await wipe.animate(
      [{ transform: 'translateX(-101%)' }, { transform: 'translateX(0)' }],
      { duration: 340, easing: 'cubic-bezier(0.55, 0, 0.8, 0.25)', fill: 'forwards' }
    ).finished.catch(() => {});
    swap(pending);
    pending = null;
    await wipe.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(101%)' }],
      { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
    ).finished.catch(() => {});
    wipe.getAnimations().forEach(a => a.cancel());
    wipe.style.visibility = 'hidden';
    wiping = false;
  }

  function show(name) {
    const target = document.getElementById(`screen-${name}`);
    if (!target) return;
    // Si ya hay un barrido en curso, solo se cambia el destino.
    if (wiping) { pending = name; return; }
    if (target.classList.contains('active')) return;
    // La carrera arranca al instante: el código del juego espera la pantalla ya activa.
    const first = !document.querySelector('.screen.active');
    if (name === 'race' || first || reduceMotion.matches || !wipe || !wipe.animate) return swap(name);
    pending = name;
    runWipe().catch(err => {
      // Si la animación falla, igual se llega a la pantalla pedida.
      console.error('Falló la transición de pantalla', err);
      wiping = false;
      if (pending) swap(pending);
      pending = null;
    });
  }

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) show(nav.dataset.nav);
  });

  return { show };
})();
