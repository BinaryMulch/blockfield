export function disableUIFocus(root) {
  const editing = target => target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  root.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  root.addEventListener('pointerdown', event => {
    if (!editing(event.target) && event.target?.closest?.('button, a[href], [tabindex]')) event.preventDefault();
  }, true);
  // Also catch native dialog autofocus and focus restored by the browser.
  root.addEventListener('focusin', event => {
    if (!editing(event.target)) event.target?.blur?.();
  }, true);
}

export const INVENTORY_KEY = 'KeyE';
export const INTERACT_KEY = 'KeyE';
export const DROP_KEY = 'KeyQ';

export function hotbarArrowDirection(code) {
  if (code === 'ArrowLeft' || code === 'ArrowUp') return -1;
  if (code === 'ArrowRight' || code === 'ArrowDown') return 1;
  return 0;
}

// Wheels step once per notch; small trackpad deltas accumulate into a step.
export class HotbarScroll {
  delta = 0;
  lastTime = -Infinity;

  reset() { this.delta = 0; this.lastTime = -Infinity; }

  update(event, now) {
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!Number.isFinite(raw) || raw === 0) return 0;
    const delta = raw * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 120 : 1);
    if (now - this.lastTime > 180 || Math.sign(delta) !== Math.sign(this.delta)) this.delta = 0;
    this.lastTime = now;
    this.delta += delta;
    if (Math.abs(this.delta) < 40) return 0;
    this.delta = 0;
    return Math.sign(delta);
  }
}
