(() => {
  let selfId = null;
  let connected = false;
  const FEMININE_ITEMS = new Set(['Arepa', 'Aguapanela', 'Lechona']);
  let lastJoinRequest = null; // último { name, color } enviado en "join"
  let pendingJoin = null;     // join en espera de que termine la carrera en curso
  let totalLaps = 3;          // vueltas de la carrera en curso (las elige el anfitrión)
  let selectedColor = KART_COLORS[0];
  let vehicleIndex = 0;

  // Ficha de cada vehículo en el garaje. Es solo ambientación: todos corren
  // con la misma física en el servidor.
  const VEHICLE_SHEETS = {
    '#CE1126': { plate: 'TMB 001', city: 'Bogotá D.C.', type: 'Bus articulado', tagline: 'Rojo, articulado y con carril exclusivo.' },
    '#FCD116': { plate: 'TAX 002', city: 'Bogotá D.C.', type: 'Sedán de servicio', tagline: 'Se sabe todos los atajos de la ciudad.' },
    '#95A5A6': { plate: 'BUR 003', city: 'Boyacá', type: 'Semoviente', tagline: 'El todoterreno original de las montañas.' },
    '#ECF0F1': { plate: 'HK 2026', city: 'El Dorado', type: 'Aeronave', tagline: 'Aterrizó en la pista equivocada y se quedó.' },
    '#2ECC71': { plate: 'MED 005', city: 'Medellín', type: 'Tren urbano', tagline: 'Puntual, impecable y orgullo paisa.' }
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const garage = document.getElementById('vehicle-showcase');
  const vehicleImage = document.getElementById('vehicle-image');
  const vehicleInfo = document.querySelector('.ficha-info');
  const vehiclePlate = vehicleInfo.querySelector('.plate');
  const roadLines = garage.querySelector('.road-lines');
  const vehicleDots = document.getElementById('vehicle-dots');
  let vehicleSwap = 0; // descarta animaciones viejas si el jugador cambia rápido
  let roadOffset = 0;

  function renderVehicleText() {
    selectedColor = KART_COLORS[vehicleIndex];
    const name = KART_VEHICLE_NAMES[selectedColor] || '';
    const sheet = VEHICLE_SHEETS[selectedColor] || {};
    vehicleImage.alt = name;
    document.getElementById('vehicle-name').textContent = name;
    document.getElementById('vehicle-tagline').textContent = sheet.tagline || '';
    document.getElementById('vehicle-plate-code').textContent = sheet.plate || '';
    document.getElementById('vehicle-plate-city').textContent = sheet.city || '';
    document.getElementById('vehicle-type').textContent = sheet.type || '';
    document.getElementById('vehicle-origin').textContent = sheet.city || '';
    document.getElementById('vehicle-count').textContent =
      `${String(vehicleIndex + 1).padStart(2, '0')} / ${String(KART_COLORS.length).padStart(2, '0')}`;
    garage.style.setProperty('--tint', selectedColor);
    vehicleDots.querySelectorAll('button').forEach((dot, i) => {
      dot.setAttribute('aria-checked', String(i === vehicleIndex));
      dot.tabIndex = i === vehicleIndex ? 0 : -1;
    });
  }

  // Las líneas del eje corren hacia atrás mientras cambia el vehículo, como
  // si la cámara lo siguiera por la vía.
  function driveRoad(dir) {
    const from = roadOffset;
    roadOffset -= dir * 64 * 9; // múltiplo del patrón para no dar saltos
    roadLines.animate(
      [{ backgroundPosition: `${from}px 0` }, { backgroundPosition: `${roadOffset}px 0` }],
      { duration: 1000, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' }
    );
  }

  // Los sprites miran hacia la derecha: al avanzar, el vehículo actual sale
  // manejando por la derecha y el siguiente entra por la izquierda.
  async function selectVehicle(index, dir) {
    if (index === vehicleIndex) return;
    vehicleIndex = (index + KART_COLORS.length) % KART_COLORS.length;
    const token = ++vehicleSwap;
    const src = KART_VEHICLE_IMAGES[KART_COLORS[vehicleIndex]] || '';

    if (reduceMotion.matches || !vehicleImage.animate) {
      vehicleImage.src = src;
      renderVehicleText();
      return;
    }

    vehicleImage.getAnimations().forEach(a => a.cancel());
    driveRoad(dir);
    // Sale del todo por el borde de la vía (el garaje recorta lo que sobra).
    const distance = garage.clientWidth * dir;
    const exit = vehicleImage.animate(
      [
        { transform: 'translateX(0)', filter: 'blur(0)' },
        { transform: `translateX(${distance}px)`, filter: 'blur(4px)' }
      ],
      { duration: 380, easing: 'cubic-bezier(0.55, 0, 0.8, 0.25)', fill: 'forwards' }
    );
    vehicleInfo.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }],
      { duration: 200, easing: 'ease-in', fill: 'forwards' }
    );

    await exit.finished.catch(() => {});
    if (token !== vehicleSwap) return;
    vehicleImage.src = src;
    await vehicleImage.decode().catch(() => {});
    if (token !== vehicleSwap) return;
    renderVehicleText();

    vehicleImage.getAnimations().forEach(a => a.cancel());
    vehicleImage.animate(
      [
        { transform: `translateX(${-distance}px)`, filter: 'blur(4px)' },
        { transform: 'translateX(0)', filter: 'blur(0)' }
      ],
      { duration: 760, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    );
    vehicleInfo.getAnimations().forEach(a => a.cancel());
    vehicleInfo.animate(
      [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 600, delay: 120, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' }
    );
    // La placa "cae" en su sitio, como cuando la atornillan.
    vehiclePlate.animate(
      [{ transform: 'perspective(400px) rotateX(-80deg)', transformOrigin: 'top' }, { transform: 'perspective(400px) rotateX(0)', transformOrigin: 'top' }],
      { duration: 700, delay: 80, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'backwards' }
    );
  }

  function stepVehicle(dir) {
    selectVehicle(vehicleIndex + dir, dir);
  }

  KART_COLORS.forEach((c, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'swatch-btn';
    dot.setAttribute('role', 'radio');
    dot.setAttribute('aria-label', KART_VEHICLE_NAMES[c] || '');
    dot.title = KART_VEHICLE_NAMES[c] || '';
    dot.style.setProperty('--c', c);
    dot.addEventListener('click', () => selectVehicle(i, i > vehicleIndex ? 1 : -1));
    vehicleDots.appendChild(dot);
  });

  document.getElementById('vehicle-prev').addEventListener('click', () => stepVehicle(-1));
  document.getElementById('vehicle-next').addEventListener('click', () => stepVehicle(1));

  // Deslizar con el dedo (o arrastrar con el mouse) sobre el vehículo.
  const garageStage = garage.querySelector('.garage-stage');
  let dragStartX = null;
  garageStage.addEventListener('pointerdown', e => { dragStartX = e.clientX; });
  garageStage.addEventListener('pointerup', e => {
    if (dragStartX === null) return;
    const dx = e.clientX - dragStartX;
    dragStartX = null;
    if (Math.abs(dx) > 40) stepVehicle(dx < 0 ? 1 : -1);
  });
  garageStage.addEventListener('pointercancel', () => { dragStartX = null; });

  function isScreenActive(name) {
    return document.getElementById(`screen-${name}`).classList.contains('active');
  }

  window.addEventListener('keydown', e => {
    if (!isScreenActive('join') || e.target instanceof HTMLInputElement) return;
    if (e.code === 'ArrowLeft') stepVehicle(-1);
    else if (e.code === 'ArrowRight') stepVehicle(1);
  });

  vehicleImage.src = KART_VEHICLE_IMAGES[KART_COLORS[vehicleIndex]] || '';
  renderVehicleText();

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
  let shownTrackId = null;

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
      if (selected.id !== shownTrackId) {
        // Solo se anima cuando cambia la pista, no en cada actualización del lobby.
        if (shownTrackId && trackImage.animate && !reduceMotion.matches) {
          trackImage.animate(
            [{ opacity: 0, transform: 'scale(1.06)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
            { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
          );
          document.querySelector('.track-meta').animate(
            [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
            { duration: 550, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
          );
        }
        shownTrackId = selected.id;
      }
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

  /**
   * Control segmentado (dificultad, hora del día): el anfitrión elige y
   * aplica a la sala. El indicador se desliza por CSS según --index/--count.
   */
  // Solo el anfitrión configura la sala: a los demás se les deshabilitan los
  // controles (el servidor igual ignora sus cambios) y se les dice quién elige.
  const HOST_CONTROLS = '#track-picker button, #track-prev, #track-next, #difficulty-picker button, #time-picker button, #laps-picker button, #btn-toggle-bots';
  let lastHost = { id: null, player: null }; // del último lobby_update
  let lastLobbyUpdate = null;
  let renderLobby = () => {}; // se define en wireServerEvents

  function applyHostControls() {
    setHostControls(!lastHost.id || lastHost.id === selfId, lastHost.player);
  }

  function setHostControls(isHost, host) {
    document.querySelectorAll(HOST_CONTROLS).forEach(el => { el.disabled = !isHost; });
    const note = document.getElementById('host-note');
    note.hidden = isHost;
    note.textContent = isHost ? '' : `${host ? host.name : 'El anfitrión'} elige la pista, la hora, la dificultad y los bots.`;
  }

  function renderPillPicker(containerId, options, selected, onPick) {
    const container = document.getElementById(containerId);
    const buttons = [...container.querySelectorAll('button')];
    const alreadyBuilt = buttons.length === options.length &&
      buttons.every((btn, i) => btn.dataset.id === options[i].id);

    if (!alreadyBuilt) {
      container.innerHTML = '<span class="segmented-thumb" aria-hidden="true"></span>';
      container.style.setProperty('--count', options.length);
      options.forEach(o => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.id = o.id;
        btn.textContent = o.label;
        btn.addEventListener('click', () => onPick(o.id));
        container.appendChild(btn);
      });
    }

    const selectedIndex = options.findIndex(o => o.id === selected);
    container.style.setProperty('--index', Math.max(0, selectedIndex));
    container.classList.toggle('has-selection', selectedIndex >= 0);
    container.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.id === selected);
      btn.setAttribute('aria-pressed', String(btn.dataset.id === selected));
    });
  }

  // Calidad gráfica de la vista 3D: preferencia de cada jugador, no de la
  // sala (no la bloquea el anfitrión). "Auto" ajusta sola para sostener 60 FPS.
  const QUALITY_OPTIONS = [
    { id: 'auto', label: 'Auto' },
    { id: 'alta', label: 'Alta' },
    { id: 'media', label: 'Media' },
    { id: 'baja', label: 'Baja' }
  ];
  function renderQualityPicker() {
    const race3d = window.Race3D;
    if (!race3d || !race3d.supported) return;
    document.getElementById('quality-setting').hidden = false;
    renderPillPicker('quality-picker', QUALITY_OPTIONS, race3d.qualityMode, id => {
      race3d.setQualityMode(id);
      renderQualityPicker();
    });
  }
  if (window.Race3D) renderQualityPicker();
  else window.addEventListener('race3d-ready', renderQualityPicker, { once: true });

  let fillWithBots = false;

  function updateBotsButton() {
    document.getElementById('btn-toggle-bots').setAttribute('aria-checked', String(fillWithBots));
  }

  /** El cóndor solo existe en la vista 3D; en 2D quedan los avisos. */
  function callCondor(mode, data) {
    const race3d = window.Race3D;
    if (race3d && race3d.supported && typeof race3d.condor === 'function') race3d.condor(mode, data);
  }

  /** 83456 ms -> "1:23.46" */
  function formatLapTime(ms) {
    // En centésimas enteras: redondear antes de separar minutos evita "0:60.00".
    const cs = Math.round(ms / 10);
    const minutes = Math.floor(cs / 6000);
    const rest = cs - minutes * 6000;
    const seconds = String(Math.floor(rest / 100)).padStart(2, '0');
    return `${minutes}:${seconds}.${String(rest % 100).padStart(2, '0')}`;
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
      // El servidor manda el lobby_update antes que "joined": en ese momento
      // aún no se sabía quién era uno (sin etiqueta "Tú" y con los controles
      // del anfitrión bloqueados). Se vuelve a dibujar con el id ya conocido.
      if (lastLobbyUpdate) renderLobby(lastLobbyUpdate);
      Router.show('lobby');
    });

    Net.on('join_rejected', msg => {
      const errorEl = document.getElementById('join-error');
      if (msg.waitMs != null) {
        // Carrera en curso: se entra solo cuando la sala vuelva al lobby.
        pendingJoin = lastJoinRequest;
        const minutes = Math.max(1, Math.ceil(msg.waitMs / 60000));
        errorEl.textContent = `Hay una carrera en curso (termina en ${minutes} min como máximo). Te quedas en espera y entrarás automáticamente cuando termine.`;
      } else {
        pendingJoin = null;
        errorEl.textContent = msg.reason;
      }
    });

    // Con nombre propio: "joined" la vuelve a llamar con el último mensaje.
    renderLobby = msg => {
      lastLobbyUpdate = msg;
      const list = document.getElementById('lobby-players');
      // Solo se anima la entrada de pilotos nuevos, no cada actualización.
      const previousIds = new Set([...list.children].map(li => li.dataset.id));
      list.innerHTML = '';
      msg.players.forEach((p, i) => {
        const li = document.createElement('li');
        li.dataset.id = p.id;
        const gridSlot = document.createElement('span');
        gridSlot.className = 'player-grid';
        gridSlot.textContent = `P${i + 1}`;
        if (previousIds.has(p.id)) li.style.animation = 'none';
        li.style.setProperty('--c', p.color || '#FCD116');
        // El nombre lo escribe el jugador: se inserta como texto, nunca como HTML.
        let badge;
        if (p.avatar) {
          badge = document.createElement('img');
          badge.className = 'player-avatar';
          badge.src = p.avatar;
          badge.alt = '';
          badge.referrerPolicy = 'no-referrer';
        } else {
          badge = document.createElement('span');
          badge.className = 'player-initial';
          badge.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
        }
        const nameCell = document.createElement('span');
        nameCell.className = 'player-name';
        nameCell.textContent = p.name;
        if (p.id === selfId) {
          const you = document.createElement('span');
          you.className = 'you-tag';
          you.textContent = 'Tú';
          nameCell.append(you);
        }
        if (p.id === msg.hostId) {
          const host = document.createElement('span');
          host.className = 'host-tag';
          host.textContent = 'Anfitrión';
          host.title = 'Elige pista, hora, dificultad y bots';
          nameCell.append(host);
        }
        const status = document.createElement('span');
        status.className = p.ready ? 'player-status ready-tag' : 'player-status';
        status.textContent = p.ready ? 'Listo' : 'Esperando';
        li.append(gridSlot, badge, nameCell, status);
        list.appendChild(li);
      });
      const readyCount = msg.players.filter(p => p.ready).length;
      document.getElementById('lobby-count').textContent = `${readyCount} de ${msg.players.length} listos`;
      const host = msg.players.find(p => p.id === msg.hostId);

      if (msg.tracks) renderTrackPicker(msg.tracks, msg.selectedTrackId);
      if (msg.difficulties) {
        renderPillPicker('difficulty-picker', msg.difficulties, msg.selectedDifficulty, id => Net.send('select_difficulty', { difficulty: id }));
      }
      if (msg.lapOptions) {
        const options = msg.lapOptions.map(n => ({ id: String(n), label: String(n) }));
        renderPillPicker('laps-picker', options, String(msg.totalLaps), id => Net.send('select_laps', { laps: Number(id) }));
      }
      if (msg.timesOfDay) {
        renderPillPicker('time-picker', msg.timesOfDay, msg.selectedTimeOfDay, id => Net.send('select_time', { timeOfDay: id }));
      }
      if (typeof msg.fillWithBots === 'boolean') {
        fillWithBots = msg.fillWithBots;
        updateBotsButton();
      }
      // Después de pintar los selectores, para alcanzar también los botones recién creados.
      lastHost = { id: msg.hostId, player: host };
      applyHostControls();
    };
    Net.on('lobby_update', renderLobby);

    Net.on('countdown', msg => {
      // Semáforo de salida: se enciende una luz roja por segundo (3, 2, 1) y
      // en cero todas pasan a verde.
      const el = document.getElementById('countdown');
      let lights = el.querySelector('.semaforo');
      let value = el.querySelector('.countdown-value');
      if (!lights) {
        lights = document.createElement('div');
        lights.className = 'semaforo';
        lights.append(...[0, 1, 2].map(() => document.createElement('i')));
        value = document.createElement('span');
        value.className = 'countdown-value';
        el.replaceChildren(lights, value);
      }
      const lit = msg.seconds > 0 ? Math.max(0, 4 - msg.seconds) : 3;
      lights.querySelectorAll('i').forEach((lamp, i) => lamp.classList.toggle('on', i < lit));
      lights.classList.toggle('go', msg.seconds <= 0);
      value.textContent = msg.seconds > 0 ? msg.seconds : '¡Ya!';
      if (value.animate && !reduceMotion.matches) {
        value.animate(
          [{ opacity: 0, transform: 'translateY(30px)' }, { opacity: 1, transform: 'none' }],
          { duration: 500, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        );
      }
    });

    Net.on('pause', msg => {
      setPauseOverlay(msg.paused, msg.byId === selfId ? null : msg.by);
      if (!msg.paused) showToast(msg.byId === selfId || !msg.by ? '▶ Carrera reanudada' : `▶ ${msg.by} reanudó la carrera`);
    });

    Net.on('race_start', msg => {
      totalLaps = msg.totalLaps || 3;
      Hud.reset();
      document.getElementById('countdown').replaceChildren();
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
      // El cóndor da la salida (no al volver a mitad de carrera).
      if (!msg.rejoined) {
        // El semáforo del cóndor se pone en verde cuando el servidor suelta los karts.
        const greenInMs = msg.greenInMs ?? 0;
        callCondor('start', { greenInMs });
        if (greenInMs > 0) {
          showToast('🔴 Atentos al semáforo del cóndor…');
          setTimeout(() => { if (isRaceActive()) showToast('🟢 ¡Ya!'); }, greenInMs);
        }
      }
    });

    Net.on('state', msg => {
      Race.render(msg.players, selfId, msg.pickups, msg.rainActive, msg.puddles);
      const me = msg.players.find(p => p.id === selfId);
      if (me) {
        document.getElementById('hud-lap').textContent = `Vuelta ${Math.min(me.lap, totalLaps)}/${totalLaps}`;
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
        // Sin el emoji del objeto (🫓 y 🫔 no existen en Windows 10) y con el
        // artículo correcto: "una arepa", no "un Arepa".
        const item = msg.itemName ? `${FEMININE_ITEMS.has(msg.itemName) ? 'una' : 'un'} ${msg.itemName.toLowerCase()}` : 'un objeto';
        showToast(`⚡ ${msg.by} tomó ${item}`);
      } else if (msg.kind === 'rain_start') {
        showToast('🌧️ ¡Aguacero! Se forman charcos: esquívalos o frena antes');
      } else if (msg.kind === 'rain_end') {
        showToast('☀️ Paró de llover: la pista se va secando');
      } else if (msg.kind === 'pause_denied' && msg.byId === selfId) {
        showToast(`⏸ Ya usaste tus ${msg.max} pausas de esta carrera`);
      } else if (msg.kind === 'pause_count' && msg.byId === selfId) {
        document.getElementById('pause-by').textContent =
          `Pausaste la carrera · te ${msg.remaining === 1 ? 'queda 1 pausa' : `quedan ${msg.remaining} pausas`}`;
      } else if (msg.kind === 'lobby_votes') {
        if (backLobbyBtn.disabled) backLobbyBtn.textContent = `Esperando a los demás (${msg.votes}/${msg.total})…`;
      } else if (msg.kind === 'player_disconnected') {
        showToast(`📡 ${msg.name} se desconectó: tiene ${Math.round(msg.graceMs / 1000)} s para volver`);
      } else if (msg.kind === 'condor_rescue') {
        callCondor('rescue', { x: msg.x, y: msg.y });
        showToast(msg.playerId === selfId ? '🦅 El cóndor te devolvió a la pista' : `🦅 El cóndor rescató a ${msg.name}`);
      } else if (msg.kind === 'lap_completed' && msg.playerId === selfId) {
        const lapTime = msg.lapTimeMs != null ? ` · ${formatLapTime(msg.lapTimeMs)}` : '';
        showToast(msg.lap >= totalLaps ? `¡Última vuelta completada!${lapTime} 🏁` : `¡Vuelta ${msg.lap}/${totalLaps} completada!${lapTime}`);
        // Empieza la última vuelta: el cóndor pasa con la pancarta.
        if (totalLaps > 1 && msg.lap === totalLaps - 1) callCondor('lastLap');
      }
    });

    Net.on('results', msg => {
      setPauseOverlay(false);
      const list = document.getElementById('results-list');
      list.innerHTML = '';
      msg.ranking.forEach((r, i) => {
        const li = document.createElement('li');
        if (r.finishTimeMs == null) li.classList.add('dnf');
        const pos = document.createElement('span');
        pos.className = 'result-pos';
        pos.textContent = String(r.position || i + 1).padStart(2, '0');
        const name = document.createElement('span');
        name.className = 'result-name';
        name.textContent = r.name;
        if (r.id === selfId) {
          const you = document.createElement('span');
          you.className = 'you-tag';
          you.textContent = 'Tú';
          name.append(you);
        }
        const time = document.createElement('span');
        time.className = 'result-time';
        time.textContent = r.finishTimeMs != null
          ? `${(r.finishTimeMs / 1000).toFixed(2)} s`
          : `No terminó · ${r.lap || 0} ${r.lap === 1 ? 'vuelta' : 'vueltas'}`;
        if (r.bestLapMs != null) {
          const best = document.createElement('span');
          best.className = 'result-best-lap';
          best.textContent = `Mejor vuelta ${formatLapTime(r.bestLapMs)}`;
          name.append(best);
        }
        li.append(pos, name, time);
        list.appendChild(li);
      });
      const mine = msg.ranking.find(r => r.id === selfId);
      document.getElementById('results-title').textContent =
        !mine || mine.finishTimeMs == null ? 'Resultados'
          : mine.position === 1 ? 'Ganaste'
            : `Llegaste ${mine.position}.º`;
      if (msg.returnInMs) startResultsCountdown(msg.returnInMs);
      Router.show('results');
    });

    Net.on('room_reset', onRoomReset);

    Net.on('disconnected', evt => {
      connected = false;
      if (reconnecting) return; // el ciclo de reconexión maneja sus propios intentos
      if (evt && evt.code === 4401) {
        // Sesión vencida, cerrada u otra pestaña cerró sesión: volver al login.
        location.reload();
        return;
      }
      if (evt && evt.code === 1008) {
        showConnBanner('El servidor cerró la conexión por exceso de mensajes.', { retry: true });
        return;
      }
      reconnect();
    });
  }

  // ---------- Reconexión ----------
  // Si se cae la conexión (wifi, servidor reiniciándose) se reintenta con
  // espera creciente y, al volver, se vuelve a entrar a la sala: en plena
  // carrera el servidor conserva el kart 30 s. Antes salía un alert() y el
  // jugador quedaba colgado hasta recargar.
  const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000];
  const RECONNECT_MAX_ATTEMPTS = 14; // ~1.5 min en total
  let reconnecting = false;
  const connBanner = document.getElementById('conn-banner');

  function showConnBanner(text, { retry = false } = {}) {
    connBanner.replaceChildren(document.createTextNode(text));
    if (retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Recargar';
      btn.addEventListener('click', () => location.reload());
      connBanner.append(btn);
    }
    connBanner.hidden = false;
  }

  function hideConnBanner() {
    connBanner.hidden = true;
  }

  async function reconnect() {
    reconnecting = true;
    const wasInRoom = !!selfId || !!pendingJoin;
    for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt++) {
      showConnBanner(`Se perdió la conexión. Reconectando… (intento ${attempt})`);
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)];
      await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await Net.connect();
        connected = true;
        reconnecting = false;
        hideConnBanner();
        showToast('📶 Conexión recuperada');
        if (wasInRoom && lastJoinRequest) {
          selfId = null;
          Net.send('join', lastJoinRequest);
        }
        return;
      } catch {
        // Sigue intentando.
      }
    }
    reconnecting = false;
    showConnBanner('No se pudo reconectar con el servidor.', { retry: true });
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
      lastJoinRequest = { name, color: selectedColor };
      Net.send('join', lastJoinRequest);
    } catch {
      errorEl.textContent = 'No se pudo conectar al servidor.';
    }
  });

  document.getElementById('btn-toggle-bots').addEventListener('click', () => {
    Net.send('toggle_bots', { enabled: !fillWithBots });
  });

  const readyBtn = document.getElementById('btn-ready');
  readyBtn.addEventListener('click', () => {
    Net.send('ready');
    readyBtn.disabled = true;
    readyBtn.textContent = 'Esperando al resto…';
  });

  // Volver al lobby es un voto: la sala vuelve cuando votan todos o pasa el
  // tiempo. El cambio de pantalla lo dispara el servidor con "room_reset".
  const backLobbyBtn = document.getElementById('btn-back-lobby');
  const BACK_LOBBY_HTML = backLobbyBtn.innerHTML;
  backLobbyBtn.addEventListener('click', () => {
    Net.send('restart');
    backLobbyBtn.disabled = true;
    backLobbyBtn.textContent = 'Esperando a los demás…';
  });

  let resultsCountdown = null;
  function startResultsCountdown(ms) {
    clearInterval(resultsCountdown);
    const note = document.getElementById('results-return');
    const endsAt = Date.now() + ms;
    const paint = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      note.textContent = `Volviendo al lobby en ${left} s`;
      if (left === 0) clearInterval(resultsCountdown);
    };
    paint();
    resultsCountdown = setInterval(paint, 250);
  }

  function onRoomReset() {
    // Quien esperaba a que terminara la carrera entra ahora.
    if (pendingJoin && !selfId) {
      document.getElementById('join-error').textContent = 'La carrera terminó: entrando a la sala…';
      Net.send('join', pendingJoin);
      pendingJoin = null;
    }
    clearInterval(resultsCountdown);
    document.getElementById('results-return').textContent = '';
    backLobbyBtn.disabled = false;
    backLobbyBtn.innerHTML = BACK_LOBBY_HTML;
    readyBtn.disabled = false;
    readyBtn.textContent = 'Estoy listo';
    document.getElementById('countdown').replaceChildren();
    setPauseOverlay(false);
    if (connected && selfId) Router.show('lobby');
  }

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
  // Abandonar avisa al servidor (sale de la sala sin período de gracia) y
  // recarga cuando lo confirma; si no responde en 1 s, recarga igual.
  document.getElementById('btn-quit-confirm').addEventListener('click', () => {
    const reload = () => location.reload();
    Net.on('left', reload);
    setTimeout(reload, 1000);
    Net.send('leave');
  });

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

  // Si la ventana pierde el foco (Alt+Tab, cambio de pestaña) con una tecla
  // presionada, el navegador nunca envía su keyup y el kart seguía
  // acelerando o girando solo. Se sueltan todas las teclas.
  function releaseAllKeys() {
    if (!Object.values(currentInput).some(Boolean)) return;
    Object.keys(currentInput).forEach(k => { currentInput[k] = false; });
    Net.send('input', { input: currentInput });
  }
  window.addEventListener('blur', releaseAllKeys);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAllKeys();
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
