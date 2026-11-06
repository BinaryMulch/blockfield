export function joystickAxes(dx, dy, radius = 44) {
  const distance = Math.hypot(dx, dy);
  if (distance < radius * 0.12) return { strafe: 0, forward: 0, x: 0, y: 0 };
  const scale = Math.min(distance, radius) / distance;
  return { strafe: dx * scale / radius, forward: -dy * scale / radius, x: dx * scale, y: dy * scale };
}

export function touchRotation(yaw, pitch, dx, dy) {
  return { yaw: yaw - dx * 0.004, pitch: Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch - dy * 0.004)) };
}

export class TouchControls {
  active = false;
  strafe = 0;
  forward = 0;
  up = new Set();
  down = new Set();
  sprint = false;

  constructor(canvas, camera, callbacks) {
    this.canvas = canvas; this.camera = camera; this.callbacks = callbacks;
    this.root = document.querySelector('#touch-controls');
    this.mode = document.querySelector('#control-mode');
    this.stick = document.querySelector('#touch-stick');
    this.thumb = this.stick.querySelector('span');
    this.jump = this.root.querySelector('[data-touch="jump"]');
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.setMode(coarse || typeof canvas.requestPointerLock !== 'function' ? 'touch' : 'mouse');
    this.mode.addEventListener('change', () => { this.setMode(this.mode.value); this.onModeChange?.(); });
    this.stick.addEventListener('pointerdown', event => {
      if (!this.active || this.movePointer != null) return;
      event.preventDefault(); this.movePointer = event.pointerId;
      this.stick.setPointerCapture(event.pointerId); this.move(event);
    });
    this.stick.addEventListener('pointermove', event => { if (event.pointerId === this.movePointer) { event.preventDefault(); this.move(event); } });
    const endMove = event => {
      if (event.pointerId !== this.movePointer) return;
      this.movePointer = null; this.strafe = this.forward = 0; this.thumb.style.transform = '';
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.stick.addEventListener(type, endMove);

    canvas.addEventListener('pointerdown', event => {
      if (!this.active || this.lookPointer != null) return;
      event.preventDefault(); this.lookPointer = event.pointerId;
      this.lookX = event.clientX; this.lookY = event.clientY; canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.active || event.pointerId !== this.lookPointer) return;
      event.preventDefault();
      const rotation = touchRotation(camera.rotation.y, camera.rotation.x, event.clientX - this.lookX, event.clientY - this.lookY);
      camera.rotation.set(rotation.pitch, rotation.yaw, 0, 'YXZ');
      this.lookX = event.clientX; this.lookY = event.clientY;
    });
    const endLook = event => { if (event.pointerId === this.lookPointer) this.lookPointer = null; };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, endLook);

    for (const button of this.root.querySelectorAll('[data-touch]')) {
      const action = button.dataset.touch;
      if (action === 'jump' || action === 'down') {
        const held = action === 'jump' ? this.up : this.down;
        button.addEventListener('pointerdown', event => {
          if (!this.active) return;
          event.preventDefault(); held.add(event.pointerId); button.setPointerCapture(event.pointerId);
          button.classList.add('held'); if (action === 'jump') callbacks.jump();
        });
        const end = event => { held.delete(event.pointerId); if (!held.size) button.classList.remove('held'); };
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, end);
      } else button.addEventListener('click', () => {
        if (!this.active) return;
        if (action === 'pause') callbacks.pause();
        else if (action === 'sprint') { this.sprint = !this.sprint; button.setAttribute('aria-pressed', String(this.sprint)); }
        else callbacks.action(action);
      });
    }
  }

  get enabled() { return this.mode.value === 'touch'; }
  get rise() { return Number(this.up.size > 0) - Number(this.down.size > 0); }
  setMode(mode) {
    this.mode.value = mode; this.reset();
    document.body.classList.toggle('touch-mode', this.enabled);
    this.setActive(false);
  }
  setActive(active) { this.active = active && this.enabled; this.root.hidden = !this.active; if (!this.active) this.reset(); }
  move(event) {
    const bounds = this.stick.getBoundingClientRect(), axes = joystickAxes(event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2, bounds.width * 0.36);
    this.strafe = axes.strafe; this.forward = axes.forward;
    this.thumb.style.transform = `translate(${axes.x}px, ${axes.y}px)`;
  }
  reset() {
    const move = this.movePointer, look = this.lookPointer;
    this.movePointer = this.lookPointer = null;
    this.strafe = this.forward = 0; this.up.clear(); this.down.clear(); this.sprint = false;
    this.thumb.style.transform = '';
    for (const [element, id] of [[this.stick, move], [this.canvas, look]]) {
      if (id != null && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
    this.root.querySelector('[data-touch="sprint"]').setAttribute('aria-pressed', 'false');
    for (const button of this.root.querySelectorAll('.held')) button.classList.remove('held');
  }
}
