// Dibuja el estado que llega del servidor cada tick. No calcula física propia.
const KART_COLORS = ['#FCD116', '#CE1126', '#00A99D', '#8E44AD', '#E67E22', '#2ECC71', '#3498DB', '#EC407A'];

// El color rojo de la flota usa un sprite propio (bus de TransMilenio) en
// vez del kart dibujado en canvas, como prueba de vehículo personalizado.
const SPECIAL_SPRITES = {
  '#CE1126': (() => {
    const img = new Image();
    let ready = false;
    img.onload = () => { ready = true; };
    img.src = 'img/kart-transmilenio.png';
    return { img, isReady: () => ready };
  })()
};

const Race = (() => {
  const canvas = document.getElementById('race-canvas');
  const ctx = canvas.getContext('2d');
  let track = null;

  function setTrack(t) {
    track = t;
  }

  function render(players, selfId, pickups = [], rainActive = false) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawTrack();
    pickups.forEach(drawPickup);
    players.forEach((p, idx) => drawKart(p, p.color || KART_COLORS[idx % KART_COLORS.length], p.id === selfId));
    if (rainActive) drawRain();
  }

  function palette() {
    return (track && track.palette) || { sky: ['#0d3b66', '#1c6e5f', '#1b6b3a'], grass: '#155c30', road: '#3a3f47', accent: '#FCD116' };
  }

  function drawBackground() {
    const pal = palette();
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(0.38, pal.sky[1]);
    sky.addColorStop(0.42, pal.sky[2] || pal.grass);
    sky.addColorStop(1, pal.grass);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Silueta de relieve en la franja superior (montañas, selva o costa según la pista).
    ctx.fillStyle = 'rgba(6, 20, 40, 0.4)';
    ctx.beginPath();
    ctx.moveTo(0, 90);
    ctx.lineTo(0, 40);
    for (let x = 0; x <= canvas.width; x += 60) {
      const y = 20 + Math.abs(Math.sin(x * 0.008)) * 40 + Math.cos(x * 0.02) * 10;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, 90);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 140; i++) {
      const gx = (i * 97) % canvas.width;
      const gy = 90 + ((i * 53) % (canvas.height - 100));
      ctx.fillRect(gx, gy, 2, 2);
    }
  }

  function drawTrack() {
    if (!track) return;
    const pal = palette();
    const { x: cx, y: cy } = track.center;
    const rx = track.rx;
    const ry = track.ry;
    const roadWidth = track.roadWidth;

    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = roadWidth + 14;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = roadWidth + 14;
    ctx.setLineDash([22, 22]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = pal.road;
    ctx.lineWidth = roadWidth;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 18]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    drawStartBanner(track.checkpoints[0]);
    track.checkpoints.forEach((cp, i) => {
      if (i === 0) return;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, track.checkpointRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`CP${i}`, cp.x, cp.y + 4);
    });
  }

  function drawStartBanner(cp) {
    if (!cp) return;
    const pal = palette();
    const w = 96;
    const h = 14;
    ctx.save();
    ctx.translate(cp.x, cp.y - 50);
    ctx.fillStyle = '#0d1526';
    ctx.fillRect(-w / 2 - 4, -4, w + 8, h + 8);
    const cols = 8;
    const cw = w / cols;
    for (let i = 0; i < cols; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(-w / 2 + i * cw, 0, cw, h);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cp.x, cp.y, track.checkpointRadius, 0, Math.PI * 2);
    ctx.strokeStyle = pal.accent + 'b3';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('META', cp.x, cp.y + 4);
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
    ctx.strokeStyle = '#FCD116';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pu.emoji || '⭐', 0, 1);
    ctx.restore();
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
    const special = SPECIAL_SPRITES[(color || '').toUpperCase()];

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
      ctx.drawImage(special.img, -w / 2, -h / 2, w, h);
      if (isSelf) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      }
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

  return { render, setTrack };
})();
