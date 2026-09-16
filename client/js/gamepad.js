// Soporte de control (PS4/Xbox y compatibles) vía la Gamepad API estándar
// del navegador. No depende del servidor: solo traduce el estado del mando
// al mismo formato {left,right,up,down} que ya usan las flechas, así que
// para el resto del cliente (y para el servidor) es indistinguible de un
// teclado. Requiere HTTPS o localhost y que el navegador soporte
// navigator.getGamepads (Chrome, Edge y Firefox lo soportan).
const Gamepad = (() => {
  const STICK_DEADZONE = 0.25;
  const TRIGGER_THRESHOLD = 0.4;

  let inputHandler = null;
  let statusHandler = null;
  let connectedId = null;
  let lastSent = null;
  let rafHandle = null;

  function pressed(btn) {
    if (!btn) return false;
    return typeof btn === 'object' ? btn.pressed || btn.value > TRIGGER_THRESHOLD : btn > TRIGGER_THRESHOLD;
  }

  function readActiveGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (pad) return pad;
    }
    return null;
  }

  function loop() {
    const pad = readActiveGamepad();

    if (pad && pad.id !== connectedId) {
      connectedId = pad.id;
      if (statusHandler) statusHandler(connectedId);
    } else if (!pad && connectedId) {
      connectedId = null;
      lastSent = null;
      if (statusHandler) statusHandler(null);
    }

    if (pad) {
      const stickX = pad.axes[0] || 0;
      const input = {
        left: stickX < -STICK_DEADZONE,
        right: stickX > STICK_DEADZONE,
        up: pressed(pad.buttons[7]) || pressed(pad.buttons[0]), // R2 o Cross/A
        down: pressed(pad.buttons[6]) || pressed(pad.buttons[2]) // L2 o Square/X
      };
      const key = `${input.left}${input.right}${input.up}${input.down}`;
      if (key !== lastSent) {
        lastSent = key;
        if (inputHandler) inputHandler(input);
      }
    }

    rafHandle = requestAnimationFrame(loop);
  }

  function start(onInput, onStatus) {
    inputHandler = onInput;
    statusHandler = onStatus;
    if (!rafHandle) rafHandle = requestAnimationFrame(loop);
  }

  return { start };
})();
