// Router mínimo entre pantallas (menú, ayuda, créditos, lobby, carrera, resultados).
const Router = (() => {
  function show(name) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`screen-${name}`);
    if (target) target.classList.add('active');
  }

  document.addEventListener('click', e => {
    const nav = e.target.getAttribute('data-nav');
    if (nav) show(nav);
  });

  return { show };
})();
