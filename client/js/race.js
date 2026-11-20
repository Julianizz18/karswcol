// Dibuja el estado que llega del servidor cada tick. No calcula física propia.
const KART_COLORS = ['#CE1126', '#FCD116', '#95A5A6', '#ECF0F1', '#2ECC71'];

// Cada color de la flota tiene su propio vehículo (sprite) en vez del kart
// dibujado en canvas, como prueba de identidad visual personalizada.
function loadSprite(src) {
  const img = new Image();
  let ready = false;
  img.onload = () => { ready = true; };
  img.src = src;
  return { img, isReady: () => ready };
}

const KART_VEHICLE_NAMES = {
  '#CE1126': 'Bus de TransMilenio',
  '#FCD116': 'Taxi',
  '#95A5A6': 'Burro',
  '#ECF0F1': 'Avión de Avianca',
  '#2ECC71': 'Metro de Medellín'
};

const KART_VEHICLE_IMAGES = {
  '#CE1126': 'img/kart-transmilenio.png',
  '#FCD116': 'img/kart-taxi.png',
  '#95A5A6': 'img/kart-burro.png',
  '#ECF0F1': 'img/kart-avion-avianca.png',
  '#2ECC71': 'img/kart-metro-medellin.png'
};

const SPECIAL_SPRITES = Object.fromEntries(
  Object.entries(KART_VEHICLE_IMAGES).map(([color, src]) => [color, loadSprite(src)])
);

// Vista trasera opcional por vehículo para la cámara 3D (race3d.js), como
// { src, crop: [x, y, ancho, alto] }. Los vehículos sin entrada aquí usan su
// modelo 3D (el avión, el bus, el taxi, el metro y el burro ya tienen uno).
const REAR_VEHICLE_IMAGES = {};


// Los bots usan colores propios que no tienen vehículo; se les asigna uno de
// la flota de forma estable (según su id) para no dibujar karts genéricos.
function vehicleColorFor(p, fallbackColor) {
  const color = (p.color || fallbackColor || '').toUpperCase();
  if (SPECIAL_SPRITES[color]) return color;
  const key = String(p.id || p.name || '');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return KART_COLORS[hash % KART_COLORS.length];
}

const Race = (() => {
  const canvas = document.getElementById('race-canvas');
  const ctx = canvas.getContext('2d');
  const canvas3d = document.getElementById('race-canvas-3d');
  const minimap = document.getElementById('minimap');
  // Cada pista tiene su propio tamaño (ver trackCatalog.js): la vista desde
  // arriba encuadra el trazado completo (track.bounds) dentro del canvas
  // sin tocar ninguna coordenada de física ni de red.
  const VIEW_MARGIN = 70;
  let track = null;
  let view = { scale: 1, x: 0, y: 0 };
  let pixelRatio = 1;
  let trackWeather = null; // clima real/típico de la pista (lo usa la vista 3D)
  // Cámara de carrera en 3D por defecto (race3d.js); C alterna con la vista 2D desde arriba.
  let chaseView = true;

  function race3d() {
    return window.Race3D && window.Race3D.supported ? window.Race3D : null;
  }

  function setTrack(t, weather = null) {
    track = t;
    trackWeather = weather;
    computeView();
    if (race3d()) race3d().setTrack(t, weather);
  }

  /** Encuadra la pista completa en el canvas, con su tamaño actual. */
  function computeView() {
    if (!track) return;
    const b = track.bounds;
    const margin = VIEW_MARGIN * pixelRatio;
    const scale = Math.min(
      (canvas.width - margin * 2) / (b.maxX - b.minX),
      (canvas.height - margin * 2) / (b.maxY - b.minY)
    );
    view = {
      scale,
      x: canvas.width / 2 - ((b.minX + b.maxX) / 2) * scale,
      y: canvas.height / 2 - ((b.minY + b.maxY) / 2) * scale
    };
  }

  /** La resolución del canvas sigue a su tamaño en pantalla (ventana, zoom, giro del celular). */
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h || (w === canvas.width && h === canvas.height)) return;
    canvas.width = w;
    canvas.height = h;
    pixelRatio = dpr;
    computeView();
  }

  function toggleView() {
    chaseView = !chaseView;
    return chaseView && !!race3d();
  }

  function render(players, selfId, pickups = [], rainActive = false, puddles = []) {
    const r3d = chaseView ? race3d() : null;
    canvas3d.hidden = !r3d;
    minimap.hidden = !r3d; // la vista desde arriba ya muestra la pista completa
    canvas.hidden = !!r3d;
    if (r3d) {
      // El módulo 3D carga en paralelo: si llegó tarde, construye la pista ahora.
      if (track && r3d.track !== track) r3d.setTrack(track, trackWeather);
      r3d.update(players, selfId, pickups, rainActive, puddles);
      return;
    }

    fitCanvas();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawTrack();
    puddles.forEach(drawPuddle);
    pickups.forEach(drawPickup);
    players.forEach((p, idx) => drawKart(p, p.color || KART_COLORS[idx % KART_COLORS.length], p.id === selfId));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (rainActive) drawRain();
  }

  function palette() {
    return (track && track.palette) || { sky: ['#0d3b66', '#1c6e5f', '#1b6b3a'], grass: '#155c30', road: '#3a3f47', accent: '#FCD116' };
  }

  // Fondo en coordenadas de pantalla (antes de encuadrar la pista).
  function drawBackground() {
    const pal = palette();
    ctx.fillStyle = pal.grass;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    for (let i = 0; i < 400; i++) {
      ctx.fillRect((i * 97) % canvas.width, (i * 53 + Math.floor(i / 7) * 31) % canvas.height, 2, 2);
    }
  }

  function tracePath() {
    ctx.beginPath();
    track.centerline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function drawTrack() {
    if (!track) return;
    const pal = palette();
    const roadWidth = track.roadWidth;
    const curb = (track.curbWidth || 7) * 2;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Sombra, bordillos rojo/blanco, asfalto y línea central.
    ctx.translate(0, 6);
    tracePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = roadWidth + curb;
    ctx.stroke();
    ctx.translate(0, -6);

    tracePath();
    ctx.strokeStyle = '#d7262e';
    ctx.lineWidth = roadWidth + curb;
    ctx.stroke();
    ctx.setLineDash([18, 18]);
    ctx.strokeStyle = '#f4f4f4';
    ctx.stroke();
    ctx.setLineDash([]);

    tracePath();
    ctx.strokeStyle = pal.road;
    ctx.lineWidth = roadWidth;
    ctx.stroke();

    tracePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 18]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    drawStartLine();
  }

  // Línea de meta a cuadros atravesando la carretera.
  function drawStartLine() {
    const { x, y, angle } = track.startLine;
    const w = track.roadWidth;
    const cell = w / 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 ? '#111' : '#fff';
        ctx.fillRect(-cell + row * cell, -w / 2 + col * cell, cell, cell);
      }
    }
    ctx.restore();
  }

  // Charco visto desde arriba: elipse azulada que crece con el nivel de agua.
  function drawPuddle(pd) {
    if (pd.level <= 0) return;
    ctx.save();
    ctx.translate(pd.x, pd.y);
    ctx.rotate(pd.angle);
    ctx.globalAlpha = 0.35 + pd.level * 0.4;
    ctx.fillStyle = '#5d7d9c';
    ctx.beginPath();
    ctx.ellipse(0, 0, pd.radius * pd.stretch * pd.level, pd.radius * pd.level, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5 * pd.level;
    ctx.strokeStyle = '#cfe3ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawPickup(pu) {
    if (!pu.available) return;
    ctx.save();
    ctx.translate(pu.x, pu.y);
    const pulse = 1 + Math.sin(Date.now() / 180 + pu.x) * 0.1;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(13,21,38,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PICKUP_RING[pu.kind] || '#FCD116';
    ctx.lineWidth = 2;
    ctx.stroke();
    drawPickupIcon(pu.kind);
    ctx.restore();
  }

  // Íconos dibujados a mano (mismos colores que los modelos 3D) en vez de
  // emojis: 🫓 y 🫔 son de 2021 y en Windows 10 y varios Linux salían como
  // un cuadrado vacío.
  const PICKUP_RING = {
    tinto: '#ffb347', arepa: '#ffe08a', aguapanela: '#ffc35c',
    lechona: '#ff8a65', tamal: '#8be07a', bunuelo: '#ffd25e'
  };

  function shape(fill, draw) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    draw();
    ctx.fill();
  }

  function drawPickupIcon(kind) {
    switch (kind) {
      case 'tinto': // pocillo con café
        shape('#f7f3ec', () => ctx.roundRect(-6, -5, 10, 11, 2));
        ctx.strokeStyle = '#f7f3ec';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(5, 0, 3, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        shape('#3b2010', () => ctx.ellipse(-1, -4, 4, 1.5, 0, 0, Math.PI * 2));
        break;
      case 'arepa': // arepa con marcas de parrilla
        shape('#e8c37a', () => ctx.arc(0, 0, 8, 0, Math.PI * 2));
        ctx.strokeStyle = '#8a5a22';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const y of [-3, 1, 5]) { ctx.moveTo(-5, y - 1); ctx.lineTo(5, y - 1); }
        ctx.stroke();
        break;
      case 'aguapanela': // vaso con aguapanela
        shape('rgba(230,244,255,0.5)', () => { ctx.moveTo(-6, -8); ctx.lineTo(6, -8); ctx.lineTo(4, 8); ctx.lineTo(-4, 8); ctx.closePath(); });
        shape('#c4782a', () => { ctx.moveTo(-5, -4); ctx.lineTo(5, -4); ctx.lineTo(4, 8); ctx.lineTo(-4, 8); ctx.closePath(); });
        break;
      case 'lechona': // lechoncito
        shape('#c9763d', () => ctx.ellipse(-1, 1, 8, 6, 0, 0, Math.PI * 2));
        shape('#e09a6b', () => ctx.ellipse(7, 1, 2.5, 2.5, 0, 0, Math.PI * 2));
        shape('#a65a2a', () => { ctx.moveTo(1, -4); ctx.lineTo(4, -8); ctx.lineTo(5, -3); ctx.closePath(); });
        break;
      case 'tamal': // tamal en hoja, amarrado
        shape('#3f7d2c', () => ctx.roundRect(-8, -6, 16, 12, 3));
        ctx.strokeStyle = '#e7d7a8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-3, -6); ctx.lineTo(-3, 6);
        ctx.moveTo(3, -6); ctx.lineTo(3, 6);
        ctx.moveTo(-8, 0); ctx.lineTo(8, 0);
        ctx.stroke();
        break;
      case 'bunuelo': // buñuelo dorado
        shape('#d99a3c', () => ctx.arc(0, 1, 7.5, 0, Math.PI * 2));
        shape('#f1c27a', () => ctx.arc(-2.5, -2, 2.5, 0, Math.PI * 2));
        break;
      default: { // estrella
        shape('#FCD116', () => {
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? 3.5 : 8;
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
        });
      }
    }
  }

  let rainDrops = null;
  function drawRain() {
    if (!rainDrops) {
      rainDrops = Array.from({ length: 90 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        len: 8 + Math.random() * 10,
        speed: 6 + Math.random() * 6
      }));
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(180,210,255,0.55)';
    ctx.lineWidth = 1.5;
    rainDrops.forEach(d => {
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 3, d.y + d.len);
      ctx.stroke();
      d.y += d.speed;
      d.x -= 1.2;
      if (d.y > canvas.height) {
        d.y = -10;
        d.x = Math.random() * canvas.width;
      }
    });
    ctx.fillStyle = 'rgba(20,60,90,0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawKart(p, color, isSelf) {
    const special = SPECIAL_SPRITES[vehicleColorFor(p, color)];

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    if (p.boosted) {
      ctx.shadowColor = '#FCD116';
      ctx.shadowBlur = 18;
    }

    if (special && special.isReady()) {
      const w = 56;
      const h = w * (special.img.naturalHeight / special.img.naturalWidth);
      if (isSelf) {
        ctx.save();
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 10;
        ctx.drawImage(special.img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      ctx.drawImage(special.img, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(-6, -9, 7, 4);
      ctx.fillRect(-6, 5, 7, 4);

      ctx.fillStyle = color;
      ctx.strokeStyle = isSelf ? '#fff' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = isSelf ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(2, -7);
      ctx.lineTo(-9, -6);
      ctx.lineTo(-9, 6);
      ctx.lineTo(2, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(-1, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '600 11px "Rubik", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    ctx.fillText(p.isBot ? `🤖 ${p.name}` : p.name, p.x, p.y - 16);
    ctx.shadowBlur = 0;
  }

  return { render, setTrack, toggleView };
})();
