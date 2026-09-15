(() => {
  let selfId = null;
  let connected = false;
  let selectedColor = KART_COLORS[0];

  const picker = document.getElementById('color-picker');
  KART_COLORS.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch-btn' + (i === 0 ? ' selected' : '');
    btn.style.background = c;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      selectedColor = c;
      picker.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    picker.appendChild(btn);
  });

  function showToast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function ensureConnected() {
    if (connected) return;
    await Net.connect();
    connected = true;
    wireServerEvents();
  }

  function wireServerEvents() {
    Net.on('joined', msg => {
      selfId = msg.id;
      Router.show('lobby');
    });

    Net.on('lobby_update', msg => {
      const list = document.getElementById('lobby-players');
      list.innerHTML = '';
      msg.players.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span><span class="swatch" style="background:${p.color || '#FCD116'}"></span>${p.name}${p.id === selfId ? ' (tú)' : ''}</span>` +
          `<span class="${p.ready ? 'ready-tag' : ''}">${p.ready ? 'Listo' : 'Esperando...'}</span>`;
        list.appendChild(li);
      });
    });

    Net.on('countdown', msg => {
      document.getElementById('countdown').textContent = msg.seconds > 0 ? msg.seconds : '¡Ya!';
    });

    Net.on('race_start', msg => {
      Race.setTrack(msg.track);
      Router.show('race');
    });

    Net.on('state', msg => {
      Race.render(msg.players, selfId, msg.pickups, msg.rainActive);
      const me = msg.players.find(p => p.id === selfId);
      if (me) {
        document.getElementById('hud-lap').textContent = `Vuelta ${Math.min(me.lap, 3)}/3`;
        document.getElementById('hud-weather').textContent = msg.rainActive ? '🌧️ Lluvia' : '';
        const maxSpeed = me.boosted ? 8.9 : 5.2;
        const pct = Math.max(0, Math.min(100, (Math.abs(me.speed) / maxSpeed) * 100));
        document.getElementById('speed-fill').style.width = `${pct}%`;
      }
    });

    Net.on('event', msg => {
      if (msg.kind === 'pickup_claimed') {
        showToast(`${msg.by} tomó un objeto ⚡`);
      } else if (msg.kind === 'rain_start') {
        showToast('¡Empieza a llover! Pista resbalosa 🌧️');
      } else if (msg.kind === 'rain_end') {
        showToast('Para de llover ☀️');
      }
    });

    Net.on('results', msg => {
      const list = document.getElementById('results-list');
      list.innerHTML = '';
      msg.ranking.forEach(r => {
        const li = document.createElement('li');
        const time = r.finishTimeMs != null ? `${(r.finishTimeMs / 1000).toFixed(2)}s` : 'No terminó';
        li.textContent = `${r.name} — ${time}`;
        list.appendChild(li);
      });
      Router.show('results');
    });

    Net.on('disconnected', () => {
      alert('Se perdió la conexión con el servidor.');
    });
  }

  document.getElementById('btn-enter-lobby').addEventListener('click', async () => {
    const nameInput = document.getElementById('name-input');
    const name = nameInput.value.trim();
    const errorEl = document.getElementById('join-error');
    if (!name) {
      errorEl.textContent = 'Escribe un nombre para continuar.';
      return;
    }
    errorEl.textContent = '';
    try {
      await ensureConnected();
      Net.send('join', { name, color: selectedColor });
    } catch {
      errorEl.textContent = 'No se pudo conectar al servidor.';
    }
  });

  document.getElementById('btn-ready').addEventListener('click', () => {
    Net.send('ready');
    document.getElementById('btn-ready').disabled = true;
  });

  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    Net.send('restart');
    document.getElementById('btn-ready').disabled = false;
    Router.show('lobby');
  });

  const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const currentInput = { up: false, down: false, left: false, right: false };

  window.addEventListener('keydown', e => {
    const key = keyMap[e.key];
    if (!key || currentInput[key]) return;
    currentInput[key] = true;
    Net.send('input', { input: currentInput });
  });

  window.addEventListener('keyup', e => {
    const key = keyMap[e.key];
    if (!key) return;
    currentInput[key] = false;
    Net.send('input', { input: currentInput });
  });
})();
