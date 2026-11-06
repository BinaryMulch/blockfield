export const upkeepFailure = reason => ({
  supplies: 'Collect the required materials first.', tool: 'Craft a repair tool and keep it in your inventory.',
  undamaged: 'This structure is already at full strength.', replenishing: 'This supply point is replenishing. Come back later.',
  inventory_full: 'Make room in your inventory for a complete supply bundle.', fuel_full: 'The ward already has enough charge. A cartridge adds one game day.',
  reach: 'Move closer to use this.', changed: 'This object has changed.', storage: 'Could not save this action. Retry saving from the menu.',
  busy: 'Let the current action finish, then try again.', disconnected: 'Waiting for the host to reconnect…',
})[reason] || 'This action could not be completed.';
const minutes = seconds => `${Math.ceil(seconds / 60)} min`;

export class UpkeepView {
  constructor(request, close) {
    this.request = request; this.closeMenu = close;
    this.dialog = document.querySelector('#upkeep-dialog');
    this.title = this.dialog.querySelector('#upkeep-title'); this.detail = this.dialog.querySelector('#upkeep-detail');
    this.status = this.dialog.querySelector('#upkeep-status');
    this.fuel = this.dialog.querySelector('#ward-refuel'); this.power = this.dialog.querySelector('#ward-power'); this.gather = this.dialog.querySelector('#salvage-gather');
    this.fuel.addEventListener('click', () => void this.run('refuelWard'));
    this.power.addEventListener('click', () => void this.run('setWardPower', { enabled: !this.info.enabled }));
    this.gather.addEventListener('click', () => void this.run('gatherSalvage'));
    this.dialog.querySelector('#upkeep-close').addEventListener('click', () => close(true));
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); close(true, { fromEscape: true }); });
  }
  open(info) { this.epoch = (this.epoch || 0) + 1; this.info = info; this.pending = false; this.elapsed = 0; this.render(); this.dialog.showModal(); }
  close() { this.epoch = (this.epoch || 0) + 1; this.info = null; this.dialog.close(); }
  sync(info) { if (info && this.info && ['x', 'y', 'z'].every(k => info[k] === this.info[k])) { this.info = info; this.render(); } }
  render() {
    const p = this.info; if (!p) return;
    this.fuel.hidden = this.power.hidden = p.kind !== 'ward'; this.gather.hidden = p.kind !== 'salvage';
    this.dialog.setAttribute('aria-busy', String(this.pending));
    for (const b of [this.fuel, this.power, this.gather]) b.disabled = this.pending;
    if (p.kind === 'ward') {
      this.title.textContent = 'Ward emitter';
      this.detail.textContent = `${p.enabled ? 'Power on' : 'Power off'} · ${Math.floor(p.fraction * 100)}% charge · ${minutes(p.remainingSeconds)} of simulation time remaining.${p.low ? ' Low charge: prepare fuel.' : ''}`;
      this.power.textContent = p.enabled ? 'Switch off' : 'Switch on';
      this.status.textContent = 'One biomass cartridge adds one game day. Capacity: three days. Switched-off wards preserve charge and provide no protection.';
    } else if (p.kind === 'salvage') {
      this.title.textContent = p.name;
      this.detail.textContent = `${p.stock[0]} scrap · ${p.stock[1]} stone · ${p.stock[2]} sand available. Next replenishment in ${minutes(p.remainingSeconds)}.`;
      this.status.textContent = 'Each bundle contains 2 scrap, 4 stone, and 2 sand. Shared supplies replenish once per game day, up to four bundles.';
    } else {
      this.title.textContent = `Sapling · Stage ${p.stage + 1} of 3`;
      this.detail.textContent = p.blocked ? `Waiting for ${p.blocked === 'unloaded' ? 'nearby terrain to load' : p.blocked === 'player' ? 'players to move clear' : p.blocked === 'height' ? 'more build height' : 'clear space'}.` : `Next growth stage in ${minutes(p.remainingSeconds)}.`;
      this.status.textContent = 'Plant on grass or dirt. A mature tree needs a clear 3×3 area and five blocks of height. Leaves can be crafted into new saplings.';
    }
  }
  async run(method, args = {}) {
    if (!this.info || this.pending) return;
    const epoch = this.epoch, { x, y, z } = this.info;
    this.pending = true; this.render();
    try {
      const result = await this.request(method, { x, y, z, ...args });
      if (epoch !== this.epoch) return;
      this.pending = false;
      if (result.info) this.sync(result.info); else this.render();
      if (!result.ok) this.status.textContent = upkeepFailure(result.reason);
      if (result.reason === 'changed' || result.reason === 'disconnected') this.closeMenu(false);
    } catch { if (epoch === this.epoch) { this.pending = false; this.render(); this.status.textContent = 'Could not reach the world. Try again.'; } }
  }
  update(seconds) {
    if (!this.info || this.pending) return;
    this.elapsed += seconds;
    if (this.elapsed >= 2) { this.elapsed = 0; void this.run('inspectUpkeep'); }
  }
}
