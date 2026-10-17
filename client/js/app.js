(() => {
  let selfId = null;
  let connected = false;
  let selectedColor = KART_COLORS[0];
  let vehicleIndex = 0;

  const vehicleImage = document.getElementById('vehicle-image');
  const vehicleName = document.getElementById('vehicle-name');
  const vehicleDots = document.getElementById('vehicle-dots');

  function renderVehicleShowcase() {
    selectedColor = KART_COLORS[vehicleIndex];
    vehicleImage.src = KART_VEHICLE_IMAGES[selectedColor] || '';
    vehicleImage.alt = KART_VEHICLE_NAMES[selectedColor] || '';
    vehicleName.textContent = KART_VEHICLE_NAMES[selectedColor] || '';
    vehicleDots.querySelectorAll('button').forEach((dot, i) => {
      dot.classList.toggle('selected', i === vehicleIndex);
    });
  }

  KART_COLORS.forEach((c, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.title = KART_VEHICLE_NAMES[c] || '';
    dot.addEventListener('click', () => { vehicleIndex = i; renderVehicleShowcase(); });
    vehicleDots.appendChild(dot);
  });

  document.getElementById('vehicle-prev').addEventListener('click', () => {
    vehicleIndex = (vehicleIndex - 1 + KART_COLORS.length) % KART_COLORS.length;
    renderVehicleShowcase();
  });
  document.getElementById('vehicle-next').addEventListener('click', () => {
    vehicleIndex = (vehicleIndex + 1) % KART_COLORS.length;
    renderVehicleShowcase();
  });

  renderVehicleShowcase();

  const TRACK_IMAGES = {
    caribe: 'img/track-caribe.png',
    andes: 'img/track-andes.png',
    cafetero: 'img/track-cafetero.png',
    llanos: 'img/track-llanos.png',
    amazonia: 'img/track-amazonia.png'
  };

  const trackImage = document.getElementById('track-image');
  const trackName = document.getElementById('track-name');
  const trackRegion = document.getElementById('track-region');
  let knownTracks = [];

  function renderTrackPicker(tracks, selectedTrackId) {
    knownTracks = tracks;
    const container = document.getElementById('track-picker');
    const alreadyBuilt = container.children.length === tracks.length &&
      [...container.children].every((thumb, i) => thumb.dataset.trackId === tracks[i].id);

    if (!alreadyBuilt) {
      container.innerHTML = '';
      tracks.forEach(t => {
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'track-thumb';
        thumb.dataset.trackId = t.id;
        thumb.style.setProperty('--accent-color', t.accent || '#FCD116');
        thumb.title = t.name;
        const image = TRACK_IMAGES[t.id];
        thumb.innerHTML = image ? `<img src="${image}" alt="${t.name}" />` : '';
        thumb.addEventListener('click', () => Net.send('select_track', { trackId: t.id }));
        container.appendChild(thumb);
      });
    }

    container.querySelectorAll('.track-thumb').forEach(thumb => {
      thumb.classList.toggle('selected', thumb.dataset.trackId === selectedTrackId);
    });

    const selected = tracks.find(t => t.id === selectedTrackId) || tracks[0];
    if (selected) {
      const image = TRACK_IMAGES[selected.id];
      trackImage.src = image || '';
      trackImage.alt = selected.name;
      trackName.textContent = selected.name;
      const km = selected.length ? ` · ${(selected.length / 1000).toFixed(1)} km` : '';
      trackRegion.textContent = selected.inspiration
        ? `${selected.region} · Inspirada en ${selected.inspiration}${km}`
        : selected.region;
      document.getElementById('track-description').textContent = selected.description || '';
      document.getElementById('track-weather').textContent = weatherLabel(selected.weather);
      drawTrackLayout(selected);
    }
  }

  // Dibuja el trazado de la pista (silueta normalizada que manda el servidor).
  function drawTrackLayout(t) {
    const canvas = document.getElementById('track-layout');
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!t.outline || !t.outline.length) {
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    const margin = 18;
    let maxX = 0;
    let maxY = 0;
    t.outline.forEach(([x, y]) => {
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    const scale = Math.min((canvas.width - margin * 2) / maxX, (canvas.height - margin * 2) / maxY);
    const ox = (canvas.width - maxX * scale) / 2;
    const oy = (canvas.height - maxY * scale) / 2;
    const trace = () => {
      g.beginPath();
      t.outline.forEach(([x, y], i) => (i ? g.lineTo(ox + x * scale, oy + y * scale) : g.moveTo(ox + x * scale, oy + y * scale)));
      g.closePath();
    };
    g.lineJoin = 'round';
    trace();
    g.strokeStyle = t.accent || '#FCD116';
    g.lineWidth = 9;
    g.stroke();
    trace();
    g.strokeStyle = '#1b2230';
    g.lineWidth = 4;
    g.stroke();
    // Meta: el primer punto de la silueta es la línea de salida.
    const [sx, sy] = t.outline[0];
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(ox + sx * scale, oy + sy * scale, 5, 0, Math.PI * 2);
    g.fill();
  }

  function stepTrack(delta) {
    if (!knownTracks.length) return;
    const currentId = document.querySelector('.track-thumb.selected')?.dataset.trackId;
    const idx = Math.max(0, knownTracks.findIndex(t => t.id === currentId));
    const next = knownTracks[(idx + delta + knownTracks.length) % knownTracks.length];
    Net.send('select_track', { trackId: next.id });
  }

  document.getElementById('track-prev').addEventListener('click', () => stepTrack(-1));
  document.getElementById('track-next').addEventListener('click', () => stepTrack(1));

  /** Botones de opción (dificultad, hora del día): cualquier jugador elige y aplica a la sala. */
  function renderPillPicker(containerId, options, selected, onPick) {
    const container = document.getElementById(containerId);
    const alreadyBuilt = container.children.length === options.length &&
      [...container.children].every((btn, i) => btn.dataset.id === options[i].id);

    if (!alreadyBuilt) {
      container.innerHTML = '';
      options.forEach(o => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.id = o.id;
        btn.textContent = o.label;
        btn.addEventListener('click', () => onPick(o.id));
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

  let eventsWired = false;
  let lastCrashed = false; // para avisar solo al momento del golpe, no en cada tick
  let raceWeatherText = '';
  let warnedAquaplaning = false; // el aviso de charcos sale una vez por carrera

  const WEATHER_NAMES = {
    despejado: 'Despejado', parcial: 'Parcialmente nublado', nublado: 'Nublado', niebla: 'Niebla',
    llovizna: 'Llovizna', lluvia: 'Lluvia', tormenta: 'Tormenta'
  };
  const WEATHER_EMOJI = {
    despejado: ['☀️', '🌙'], parcial: ['⛅', '☁️'], nublado: ['☁️', '☁️'], niebla: ['🌫️', '🌫️'],
    llovizna: ['🌦️', '🌧️'], lluvia: ['🌧️', '🌧️'], tormenta: ['⛈️', '⛈️']
  };

  /** "☀️ Despejado · 31 °C en Cartagena, ahora" (o el clima típico si no hay datos reales). */
  function weatherLabel(w, long = true) {
    if (!w) return '';
    const icon = (WEATHER_EMOJI[w.condition] || ['', ''])[w.isDay === false ? 1 : 0];
    const name = WEATHER_NAMES[w.condition] || w.condition;
    if (!long) return `${icon} ${w.tempC} °C`;
    const when = w.source === 'real' ? `en ${w.city}, ahora${w.isDay === false ? ' (de noche)' : ''}` : `clima típico de ${w.city}`;
    return `${icon} ${name} · ${w.tempC} °C ${when}`;
  }

  async function ensureConnected() {
    if (connected) return;
    await Net.connect();
    connected = true;
    if (!eventsWired) {
      wireServerEvents();
      eventsWired = true;
    }
  }

  function wireServerEvents() {
    Net.on('joined', msg => {
      selfId = msg.id;
      Router.show('lobby');
    });

    Net.on('join_rejected', msg => {
      document.getElementById('join-error').textContent = msg.reason;
    });

    Net.on('lobby_update', msg => {
      const list = document.getElementById('lobby-players');
      list.innerHTML = '';
      msg.players.forEach(p => {
        const li = document.createElement('li');
        // El nombre lo escribe el jugador: se inserta como texto, nunca como HTML.
        const nameCell = document.createElement('span');
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = p.color || '#FCD116';
        nameCell.append(swatch);
        if (p.avatar) {
          const avatar = document.createElement('img');
          avatar.className = 'player-avatar';
          avatar.src = p.avatar;
          avatar.alt = '';
          avatar.referrerPolicy = 'no-referrer';
          nameCell.append(avatar);
        }
        nameCell.append(`${p.name}${p.id === selfId ? ' (tú)' : ''}`);
        const status = document.createElement('span');
        if (p.ready) status.className = 'ready-tag';
        status.textContent = p.ready ? 'Listo' : 'Esperando...';
        li.append(nameCell, status);
        list.appendChild(li);
      });

      if (msg.tracks) renderTrackPicker(msg.tracks, msg.selectedTrackId);
      if (msg.difficulties) {
        renderPillPicker('difficulty-picker', msg.difficulties, msg.selectedDifficulty, id => Net.send('select_difficulty', { difficulty: id }));
      }
      if (msg.timesOfDay) {
        renderPillPicker('time-picker', msg.timesOfDay, msg.selectedTimeOfDay, id => Net.send('select_time', { timeOfDay: id }));
      }
      if (typeof msg.fillWithBots === 'boolean') {
        fillWithBots = msg.fillWithBots;
        updateBotsButton();
      }
    });

    Net.on('countdown', msg => {
      document.getElementById('countdown').textContent = msg.seconds > 0 ? msg.seconds : '¡Ya!';
    });

    Net.on('pause', msg => {
      setPauseOverlay(msg.paused, msg.byId === selfId ? null : msg.by);
      if (!msg.paused) showToast(msg.byId === selfId || !msg.by ? '▶ Carrera reanudada' : `▶ ${msg.by} reanudó la carrera`);
    });

    Net.on('race_start', msg => {
      Hud.reset();
      lastCrashed = false;
      setPauseOverlay(false);
      Race.setTrack(msg.track, msg.weather);
      raceWeatherText = weatherLabel(msg.weather, false);
      warnedAquaplaning = false;
      if (msg.wetStart) {
        setTimeout(() => showToast(`🌧️ Está lloviendo en ${msg.weather.city}: pista mojada y con charcos`), 600);
      }
      document.getElementById('hud-track').textContent = `${msg.track.name}`;
      Router.show('race');
    });

    Net.on('state', msg => {
      Race.render(msg.players, selfId, msg.pickups, msg.rainActive, msg.puddles);
      const me = msg.players.find(p => p.id === selfId);
      if (me) {
        document.getElementById('hud-lap').textContent = `Vuelta ${Math.min(me.lap, 3)}/3`;
        document.getElementById('hud-weather').textContent = msg.rainActive ? '🌧️ ¡Aguacero!' : raceWeatherText;
        Hud.update(me, msg.rainActive);
        if (me.crashed && !lastCrashed) showToast('💥 ¡Al muro! Frena antes de la curva');
        else if (me.aquaplaning && !warnedAquaplaning) {
          showToast('💧 ¡Aquaplaning! Sobre los charcos casi no hay agarre');
          warnedAquaplaning = true;
        }
        lastCrashed = !!me.crashed;
      }
    });

    Net.on('event', msg => {
      if (msg.kind === 'pickup_claimed') {
        showToast(`${msg.by} tomó ${msg.itemName ? 'un ' + msg.itemName : 'un objeto'} ${msg.emoji || '⚡'}`);
      } else if (msg.kind === 'rain_start') {
        showToast('🌧️ ¡Aguacero! Se forman charcos: esquívalos o frena antes');
      } else if (msg.kind === 'rain_end') {
        showToast('☀️ Paró de llover: la pista se va secando');
      } else if (msg.kind === 'lap_completed' && msg.playerId === selfId) {
        showToast(msg.lap >= 3 ? '¡Última vuelta completada! 🏁' : `¡Vuelta ${msg.lap}/3 completada!`);
      }
    });

    Net.on('results', msg => {
      setPauseOverlay(false);
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

    Net.on('disconnected', evt => {
      connected = false;
      if (evt && evt.code === 4401) {
        // Sesión vencida o inexistente: volver al login.
        location.reload();
        return;
      }
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

  // WASD como control principal; las flechas siguen funcionando. Se usa
  // `e.code` (tecla física) para que funcione igual con Bloq Mayús activo.
  const keyMap = {
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
  };
  const currentInput = { up: false, down: false, left: false, right: false };

  function isRaceActive() {
    return document.getElementById('screen-race').classList.contains('active');
  }

  function isTyping(e) {
    return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  }

  // ---------- Pausa ----------
  // La pausa la decide el servidor y aplica a toda la sala: el cliente solo
  // la pide y muestra el menú cuando el servidor la confirma.
  const pauseOverlay = document.getElementById('pause-overlay');
  const pauseActions = document.getElementById('pause-actions');
  const pauseConfirm = document.getElementById('pause-confirm');

  function isPaused() {
    return !pauseOverlay.hidden;
  }

  function setPauseOverlay(paused, byName = null) {
    pauseOverlay.hidden = !paused;
    pauseActions.hidden = false;
    pauseConfirm.hidden = true;
    document.getElementById('pause-by').textContent = byName ? `${byName} pausó la carrera` : 'Pausaste la carrera';
    // Soltar todo: al reanudar nadie debe salir acelerando con una tecla "pegada".
    Object.keys(currentInput).forEach(k => { currentInput[k] = false; });
    if (paused) document.getElementById('btn-resume').focus();
  }

  function requestTogglePause() {
    if (isRaceActive()) Net.send('toggle_pause');
  }

  document.getElementById('btn-pause').addEventListener('click', requestTogglePause);
  document.getElementById('btn-resume').addEventListener('click', requestTogglePause);
  document.getElementById('btn-quit-race').addEventListener('click', () => {
    pauseActions.hidden = true;
    pauseConfirm.hidden = false;
    document.getElementById('btn-quit-cancel').focus();
  });
  document.getElementById('btn-quit-cancel').addEventListener('click', () => {
    pauseConfirm.hidden = true;
    pauseActions.hidden = false;
  });
  // Recargar cierra el WebSocket: el servidor saca al jugador de la carrera
  // (y la reanuda para los demás si era quien la pausó). La sesión de Google
  // se mantiene, así que vuelve directo al menú.
  document.getElementById('btn-quit-confirm').addEventListener('click', () => location.reload());

  window.addEventListener('keydown', e => {
    if (isTyping(e)) return;
    if (e.code === 'Escape' && isRaceActive()) {
      e.preventDefault();
      if (!pauseConfirm.hidden) {
        // Esc dentro de "¿Seguro?" solo cancela el abandono.
        pauseConfirm.hidden = true;
        pauseActions.hidden = false;
      } else {
        requestTogglePause();
      }
      return;
    }
    if (isPaused()) return;
    if (e.code === 'KeyC' && isRaceActive()) {
      showToast(Race.toggleView() ? '🎥 Cámara trasera' : '🗺️ Vista desde arriba');
      return;
    }
    const key = keyMap[e.code];
    if (!key) return;
    if (isRaceActive()) e.preventDefault(); // evita que las flechas desplacen la página
    if (currentInput[key]) return;
    currentInput[key] = true;
    Net.send('input', { input: currentInput });
  });

  window.addEventListener('keyup', e => {
    const key = keyMap[e.code];
    if (!key) return;
    currentInput[key] = false;
    Net.send('input', { input: currentInput });
  });

  // ---------- Controles táctiles ----------
  // En celulares y tablets no hay teclado: botones en pantalla que alimentan
  // el mismo input que W/A/S/D. Se muestran si la pantalla es táctil (puntero
  // "grueso") o desde el primer toque; aceptan varios dedos a la vez.
  const touchControls = document.getElementById('touch-controls');
  function enableTouchControls() {
    touchControls.hidden = false;
    document.querySelector('.race-stage').classList.add('touch');
  }
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) enableTouchControls();
  window.addEventListener('touchstart', enableTouchControls, { once: true, passive: true });

  function setControl(key, down) {
    if (currentInput[key] === down) return;
    currentInput[key] = down;
    if (isRaceActive() && !isPaused()) Net.send('input', { input: currentInput });
  }

  touchControls.querySelectorAll('[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    const release = () => {
      btn.classList.remove('pressed');
      setControl(key, false);
    };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
      setControl(key, true);
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
  });
  // Mantener presionado no debe abrir el menú contextual del celular.
  touchControls.addEventListener('contextmenu', e => e.preventDefault());

  Gamepad.start(
    input => {
      Object.assign(currentInput, input);
      if (isRaceActive() && !isPaused()) Net.send('input', { input: currentInput });
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
    },
    requestTogglePause
  );
})();
