import { MATERIALS } from './inventory.js';

const name = block => MATERIALS.find(item => item.id === block)?.name || 'Empty';

export class StorageView {
  constructor(inventory, icons, request, close) {
    this.inventory = inventory; this.icons = icons; this.request = request;
    this.dialog = document.querySelector('#storage-dialog');
    this.status = this.dialog.querySelector('#storage-status');
    this.dialog.querySelector('#storage-close').addEventListener('click', () => close(true));
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); close(true, { fromEscape: true }); });
    for (const source of ['player', 'storage']) {
      const grid = this.dialog.querySelector(`[data-storage-grid="${source}"]`);
      grid.addEventListener('click', event => { const button = event.target.closest('[data-index]'); if (button) void this.transfer(source, Number(button.dataset.index), false); });
      grid.addEventListener('contextmenu', event => { event.preventDefault(); const button = event.target.closest('[data-index]'); if (button) void this.transfer(source, Number(button.dataset.index), true); });
    }
  }
  open(storage) { this.epoch = (this.epoch || 0) + 1; this.pending = false; this.storage = storage; this.render(); this.dialog.showModal(); }
  close() { this.epoch = (this.epoch || 0) + 1; this.storage = null; this.dialog.close(); }
  sync(storage) {
    if (!this.storage || storage.id !== this.storage.id || storage.revision < this.storage.revision) return;
    this.storage = storage; this.render();
  }
  render() {
    if (!this.storage) return;
    this.dialog.setAttribute('aria-busy', String(!!this.pending));
    for (const source of ['player', 'storage']) {
      const stacks = source === 'player' ? this.inventory.stacks : this.storage.stacks;
      this.dialog.querySelector(`[data-storage-grid="${source}"]`).replaceChildren(...stacks.map((stack, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-slot'; button.dataset.index = i;
        button.disabled = this.pending || !stack;
        button.title = stack ? `${stack.count} ${name(stack.block)} · ${source === 'player' ? 'Store' : 'Take'}` : 'Empty';
        button.setAttribute('aria-label', `${source === 'player' ? 'Your' : 'Shared'} slot ${i + 1}: ${button.title}`);
        if (source === 'player' && i < 9) { const key = document.createElement('kbd'); key.textContent = i + 1; button.append(key); }
        if (stack) { const count = document.createElement('b'); count.className = 'inventory-quantity'; count.textContent = stack.count; button.append(this.icons.icon(stack.block), count); }
        return button;
      }));
    }
    this.status.textContent = this.pending ? 'Moving supplies…' : 'Click a stack to transfer it. Right-click to transfer one. Everyone shares this chest. The world keeps running.';
  }
  async transfer(source, index, one) {
    if (this.pending || !this.storage) return;
    const stack = (source === 'player' ? this.inventory.stacks : this.storage.stacks)[index];
    if (!stack) return;
    const c = this.storage, epoch = this.epoch;
    this.pending = true; this.render();
    try {
      const result = await this.request({ x: c.x, y: c.y, z: c.z, containerId: c.id, revision: c.revision, source, index, amount: one ? 1 : stack.count, expectedSource: { ...stack } });
      if (this.epoch !== epoch) return;
      if (result.storage) this.sync(result.storage);
      this.pending = false; this.render();
      if (!result.ok) this.status.textContent = { changed: 'These supplies changed. The chest has refreshed; try again.', inventory_full: 'The destination is full. Make room first.', reach: 'Move closer to this chest.', storage: 'Could not save this transfer. Retry saving from the menu.', disconnected: 'Waiting for the host to reconnect…' }[result.reason] || 'Could not move these supplies. Try again.';
    } catch {
      if (this.epoch === epoch) { this.pending = false; this.render(); this.status.textContent = 'Could not move supplies. Check the connection.'; }
    }
  }
}
