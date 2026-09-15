// Dibuja el estado que llega del servidor cada tick. No calcula física propia.
const KART_COLORS = ['#FCD116', '#CE1126', '#00A99D', '#8E44AD', '#E67E22', '#2ECC71', '#3498DB', '#EC407A'];

const Race = (() => {
  const canvas = document.getElementById('race-canvas');
  const ctx = canvas.getContext('2d');
  let track = null;

  function setTrack(t) {
    track = t;
  }

  function render(players, selfId, pickups = [], rainActive = false) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTrack();
    pickups.forEach(drawPickup);
    players.forEach((p, idx) => drawKart(p, p.color || KART_COLORS[idx % KART_COLORS.length], p.id === selfId));
    if (rainActive) drawRain();
  }

  function drawPickup(pu) {
    if (!pu.available) return;
    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.fillStyle = '#FCD116';
    ctx.strokeStyle = '#003893';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#003893';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 0, 1);
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

  function drawTrack() {
    ctx.fillStyle = '#1b6b3a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 90;
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height / 2, 340, 220, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (track) {
      track.checkpoints.forEach((cp, i) => {
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, track.checkpointRadius, 0, Math.PI * 2);
        ctx.strokeStyle = i === 0 ? 'rgba(252,209,22,0.7)' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 3;
        ctx.stroke();
      });
    }
  }

  function drawKart(p, color, isSelf) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    if (p.boosted) {
      ctx.shadowColor = '#FCD116';
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelf ? '#fff' : 'transparent';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, 7);
    ctx.lineTo(-8, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - 16);
  }

  return { render, setTrack };
})();
