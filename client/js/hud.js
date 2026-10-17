// Velocímetro / tacómetro de carrera. Inspirado en el HUD de Gran Turismo
// (arco de revoluciones con zona roja, marcha grande al centro, velocidad
// en cifras inclinadas) y en las luces de cambio de un volante de F1.
//
// El servidor solo conoce la velocidad (unidades de mundo por tick); la caja
// de cambios y las revoluciones son una simulación visual a partir de esa
// velocidad, para que subir de marcha "se sienta" (las rpm caen al cambiar).
const Hud = (() => {
  const SPEED_TO_KMH = 45;   // ~290 km/h en recta, ~385 km/h con boost
  const RPM_MAX = 9000;
  const RPM_REDLINE = 8000;
  const RPM_IDLE = 1000;
  const RPM_SHIFT_UP = 8800;
  const RPM_AFTER_SHIFT = 5600;
  // Velocidad (km/h) a la que cada marcha llega a RPM_SHIFT_UP.
  const GEAR_TOPS = [0, 72, 118, 165, 212, 258, 330];
  const SWEEP_START = Math.PI * 0.8;   // el arco abre hacia abajo, 252° de recorrido
  const SWEEP = Math.PI * 1.4;
  const LEDS = 15;

  const canvas = document.getElementById('gauge-canvas');
  const ctx = canvas.getContext('2d');
  const W = 340;
  const H = 230;
  const CX = 170;
  const CY = 138;
  const R = 104;

  const state = { targetKmh: 0, kmh: 0, rpm: RPM_IDLE, gear: 0, reverse: false, boosted: false, skidding: false, rain: false, aquaplaning: false };
  let rafHandle = null;
  let lastTime = 0;

  function setupCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function gearFor(kmh) {
    if (kmh < 2) return 0;
    for (let g = 1; g < GEAR_TOPS.length; g++) if (kmh <= GEAR_TOPS[g]) return g;
    return GEAR_TOPS.length - 1;
  }

  function rpmFor(kmh, gear) {
    if (gear === 0) return RPM_IDLE;
    const lo = GEAR_TOPS[gear - 1];
    const hi = GEAR_TOPS[gear];
    const from = gear === 1 ? RPM_IDLE + 1200 : RPM_AFTER_SHIFT;
    return Math.min(RPM_MAX, from + ((kmh - lo) / (hi - lo)) * (RPM_SHIFT_UP - from));
  }

  const angleAt = rpm => SWEEP_START + (Math.min(rpm, RPM_MAX) / RPM_MAX) * SWEEP;

  function arc(radius, from, to, width, color) {
    ctx.beginPath();
    ctx.arc(CX, CY, radius, from, to);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function text(str, x, y, { size, weight = 700, italic = true, color = '#fff', align = 'center', shadow = true }) {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px "Titillium Web", "Rubik", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 1;
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  // Luces de cambio: 5 verdes, 5 rojas, 5 azules (convención de volante F1).
  function drawShiftLights(time) {
    const lit = Math.max(0, Math.min(1, (state.rpm - 6200) / (RPM_SHIFT_UP - 6200)));
    const count = Math.round(lit * LEDS);
    const flashing = state.rpm >= RPM_SHIFT_UP - 50 && state.gear < GEAR_TOPS.length - 1;
    const blinkOn = Math.floor(time / 70) % 2 === 0;
    const spacing = 15;
    const x0 = CX - ((LEDS - 1) * spacing) / 2;
    for (let i = 0; i < LEDS; i++) {
      const x = x0 + i * spacing;
      const y = 12 + Math.abs(i - (LEDS - 1) / 2) * 0.9; // leve curva como en el volante
      const color = i < 5 ? '#2fe36a' : i < 10 ? '#ff2b2b' : '#3d7bff';
      const on = flashing ? blinkOn : i < count;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = on ? (flashing ? '#3d7bff' : color) : 'rgba(255,255,255,0.12)';
      if (on) {
        ctx.shadowColor = flashing ? '#3d7bff' : color;
        ctx.shadowBlur = 10;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawTach() {
    const end = SWEEP_START + SWEEP;
    // Contraste sobre cualquier fondo: sombra suave detrás del arco (sin panel).
    const glow = ctx.createRadialGradient(CX, CY, R * 0.2, CX, CY, R * 1.35);
    glow.addColorStop(0, 'rgba(0,0,0,0.42)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    arc(R, SWEEP_START, end, 3, 'rgba(255,255,255,0.22)');
    arc(R + 5, angleAt(RPM_REDLINE), end, 6, '#e10600');

    // Marcas: cada 1000 rpm (con número) y cada 500.
    for (let rpm = 0; rpm <= RPM_MAX; rpm += 500) {
      const a = angleAt(rpm);
      const major = rpm % 1000 === 0;
      const r1 = R - (major ? 13 : 7);
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(a) * r1, CY + Math.sin(a) * r1);
      ctx.lineTo(CX + Math.cos(a) * (R - 1), CY + Math.sin(a) * (R - 1));
      ctx.lineWidth = major ? 2.5 : 1.5;
      ctx.strokeStyle = rpm >= RPM_REDLINE ? '#ff4d4d' : major ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)';
      ctx.stroke();
      if (major) {
        const rt = R - 25;
        text(String(rpm / 1000), CX + Math.cos(a) * rt, CY + Math.sin(a) * rt + 5, {
          size: 13, weight: 600, italic: false, color: rpm >= RPM_REDLINE ? '#ff4d4d' : 'rgba(255,255,255,0.75)', shadow: false
        });
      }
    }

    // Barra de revoluciones: blanca, roja al entrar en la zona roja.
    const current = angleAt(state.rpm);
    const inRed = state.rpm >= RPM_REDLINE;
    arc(R, SWEEP_START, current, 7, inRed ? '#ff2b2b' : '#ffffff');
    // Marcador brillante en la punta de la barra.
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(current) * (R - 16), CY + Math.sin(current) * (R - 16));
    ctx.lineTo(CX + Math.cos(current) * (R + 9), CY + Math.sin(current) * (R + 9));
    ctx.lineWidth = 3;
    ctx.strokeStyle = inRed ? '#ff2b2b' : '#ffd400';
    ctx.stroke();

  }

  function drawReadout() {
    const gear = state.reverse ? 'R' : state.gear === 0 ? 'N' : String(state.gear);
    text(gear, CX, CY + 20, { size: 66, weight: 900, color: state.rpm >= RPM_SHIFT_UP - 50 ? '#3d7bff' : '#ffffff' });

    // Velocidad: cifras grandes alineadas a la derecha para que no "bailen".
    const speedColor = state.boosted ? '#ffd400' : '#ffffff';
    text(String(Math.round(state.kmh)), CX + 34, H - 8, { size: 46, weight: 900, color: speedColor, align: 'right' });
    text('km/h', CX + 40, H - 10, { size: 15, weight: 600, color: 'rgba(255,255,255,0.8)', align: 'left' });
  }

  function chip(label, x, color, time) {
    ctx.font = 'italic 700 11px "Titillium Web", "Rubik", sans-serif';
    const w = ctx.measureText(label).width + 16;
    const y = CY + 30;
    const alpha = label === 'DERRAPE' || label === 'AQUAPLANING' ? 0.65 + 0.35 * Math.abs(Math.sin(time / 90)) : 1;
    ctx.globalAlpha = alpha;
    // Etiqueta con esquina cortada (estilo placa de carreras, no píldora redonda).
    ctx.beginPath();
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - 6, y + 17);
    ctx.lineTo(x, y + 17);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#0b0f17';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 8, y + 13);
    ctx.globalAlpha = 1;
    return w + 6;
  }

  function drawChips(time) {
    const chips = [];
    if (state.boosted) chips.push(['BOOST', '#ffd400']);
    if (state.skidding) chips.push(['DERRAPE', '#ff8a1f']);
    if (state.aquaplaning) chips.push(['AQUAPLANING', '#38b6ff']);
    else if (state.rain) chips.push(['PISTA MOJADA', '#7fb6ff']);
    ctx.font = 'italic 700 11px "Titillium Web", "Rubik", sans-serif';
    const widths = chips.map(([label]) => ctx.measureText(label).width + 22);
    let x = CX - widths.reduce((a, b) => a + b, 0) / 2;
    chips.forEach(([label, color]) => { x += chip(label, x, color, time); });
  }

  function frame(time) {
    rafHandle = null;
    if (canvas.offsetParent === null) return; // pantalla de carrera oculta: se detiene
    const dt = Math.min(0.1, lastTime ? (time - lastTime) / 1000 : 0.016);
    lastTime = time;

    // La velocidad llega 20 veces por segundo: se suaviza para el dibujo a 60 fps.
    state.kmh += (state.targetKmh - state.kmh) * (1 - Math.exp(-dt * 12));
    const gear = gearFor(state.kmh);
    if (gear !== state.gear) state.gear = gear;
    const targetRpm = rpmFor(state.kmh, state.gear);
    // Al subir de marcha las rpm caen rápido; al acelerar suben con algo de inercia.
    const rate = targetRpm < state.rpm ? 18 : 9;
    state.rpm += (targetRpm - state.rpm) * (1 - Math.exp(-dt * rate));
    // Limitador: en el tope de la última marcha la aguja vibra.
    if (state.gear === GEAR_TOPS.length - 1 && state.rpm > RPM_MAX - 300) state.rpm = RPM_MAX - 300 + Math.random() * 250;

    ctx.clearRect(0, 0, W, H);
    drawTach();
    drawShiftLights(time);
    drawReadout();
    drawChips(time);
    rafHandle = requestAnimationFrame(frame);
  }

  function ensureRunning() {
    if (!rafHandle) {
      lastTime = 0;
      rafHandle = requestAnimationFrame(frame);
    }
  }

  /** Recibe el estado del propio vehículo en cada mensaje del servidor. */
  function update(me, rainActive) {
    state.targetKmh = Math.abs(me.speed) * SPEED_TO_KMH;
    state.reverse = me.speed < -0.05;
    state.boosted = !!me.boosted;
    state.skidding = !!me.skidding;
    state.rain = !!rainActive;
    state.aquaplaning = !!me.aquaplaning;
    ensureRunning();
  }

  function reset() {
    Object.assign(state, { targetKmh: 0, kmh: 0, rpm: RPM_IDLE, gear: 0, reverse: false, boosted: false, skidding: false, rain: false, aquaplaning: false });
  }

  setupCanvas();
  // Si la fuente llega después del primer dibujo, el siguiente cuadro ya la usa.
  if (document.fonts && document.fonts.load) document.fonts.load('italic 900 20px "Titillium Web"').catch(() => {});

  return { update, reset, SPEED_TO_KMH };
})();
