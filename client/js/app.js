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

  function renderTrackPicker(tracks, selectedTrackId) {
    const container = document.getElementById('track-picker');
    const alreadyBuilt = container.children.length === tracks.length &&
      [...container.children].every((card, i) => card.dataset.trackId === tracks[i].id);

    if (!alreadyBuilt) {
      container.innerHTML = '';
      tracks.forEach(t => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'track-card';
        card.dataset.trackId = t.id;
        card.style.setProperty('--accent-color', t.accent || '#FCD116');
        card.innerHTML = `<span class="track-swatch" style="background:${t.accent || '#FCD116'}"></span>` +
          `<span class="track-name">${t.name}</span><span class="track-region">${t.region}</span>`;
        card.title = t.description || '';
        card.addEventListener('click', () => Net.send('select_track', { trackId: t.id }));
        container.appendChild(card);
      });
    }

    container.querySelectorAll('.track-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.trackId === selectedTrackId);
    });
  }

  function renderDifficultyPicker(difficulties, selected) {
    const container = document.getElementById('difficulty-picker');
    const alreadyBuilt = container.children.length === difficulties.length &&
      [...container.children].every((btn, i) => btn.dataset.id === difficulties[i].id);

    if (!alreadyBuilt) {
      container.innerHTML = '';
      difficulties.forEach(d => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.id = d.id;
        btn.textContent = d.label;
        btn.addEventListener('click', () => Net.send('select_difficulty', { difficulty: d.id }));
        container.appendChild(btn);
      });
    }

    container.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.id === selected);
    });
  }

  let fillWithBots = false;

  function updateBotsButton() {
    const btn = document.getElementById('btn-toggle-bots');
    btn.classList.toggle('active', fillWithBots);
    btn.textContent = fillWithBots ? '🤖 Bots activados' : '🤖 Completar con bots';
  }

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

      if (msg.tracks) renderTrackPicker(msg.tracks, msg.selectedTrackId);
      if (msg.difficulties) renderDifficultyPicker(msg.difficulties, msg.selectedDifficulty);
      if (typeof msg.fillWithBots === 'boolean') {
        fillWithBots = msg.fillWithBots;
        updateBotsButton();
      }
    });

    Net.on('countdown', msg => {
      document.getElementById('countdown').textContent = msg.seconds > 0 ? msg.seconds : '¡Ya!';
    });

    Net.on('race_start', msg => {
      Race.setTrack(msg.track);
      document.getElementById('hud-track').textContent = `${msg.track.name}`;
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
        showToast(`${msg.by} tomó ${msg.itemName ? 'un ' + msg.itemName : 'un objeto'} ${msg.emoji || '⚡'}`);
      } else if (msg.kind === 'rain_start') {
        showToast('¡Empieza a llover! Pista resbalosa 🌧️');
      } else if (msg.kind === 'rain_end') {
        showToast('Para de llover ☀️');
      } else if (msg.kind === 'lap_completed' && msg.playerId === selfId) {
        showToast(msg.lap >= 3 ? '¡Última vuelta completada! 🏁' : `¡Vuelta ${msg.lap}/3 completada!`);
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

  document.getElementById('btn-toggle-bots').addEventListener('click', () => {
    Net.send('toggle_bots', { enabled: !fillWithBots });
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

  function isRaceActive() {
    return document.getElementById('screen-race').classList.contains('active');
  }

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

  Gamepad.start(
    input => {
      Object.assign(currentInput, input);
      if (isRaceActive()) Net.send('input', { input: currentInput });
    },
    id => {
      const lobbyStatus = document.getElementById('gamepad-status');
      const hudStatus = document.getElementById('hud-gamepad');
      if (id) {
        lobbyStatus.textContent = `🎮 Control conectado: ${id}`;
        lobbyStatus.classList.add('connected');
        hudStatus.textContent = '🎮';
      } else {
        lobbyStatus.textContent = '';
        lobbyStatus.classList.remove('connected');
        hudStatus.textContent = '';
      }
    }
  );
})();
