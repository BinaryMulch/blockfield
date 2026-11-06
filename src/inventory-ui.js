import { CREATIVE_ITEMS, RECIPES, STACK_LIMIT } from './inventory.js';
import { isFlower } from './world.js';
import { faceTile, tilePreview, flowerPreview } from './textures.js';
const itemName = block => CREATIVE_ITEMS.find(item => item.id === block)?.name || 'Empty';

export class InventoryView {
  constructor(model, atlas, callbacks) {
    this.model = model; this.callbacks = callbacks;
    this.dialog = document.querySelector('#inventory-dialog');
    this.slots = this.dialog.querySelector('#inventory-hotbar'); this.storage = this.dialog.querySelector('#inventory-storage');
    this.grid = this.dialog.querySelector('#inventory-grid'); this.search = this.dialog.querySelector('#inventory-search');
    this.status = this.dialog.querySelector('#inventory-status'); this.back = this.dialog.querySelector('#inventory-back');
    this.cursor = this.dialog.querySelector('#inventory-cursor'); this.icons = new Map(); this.recipeBlock = RECIPES[0].block;
    this.pointer = { x: 0, y: 0 }; this.held = null; this.pending = false; this.hovered = null;
    for (const item of CREATIVE_ITEMS) {
      const icon = document.createElement('span'); icon.className = `block-icon ${item.style}`; icon.setAttribute('aria-hidden', 'true');
      icon.style.backgroundImage = isFlower(item.id) ? flowerPreview(item.id) : tilePreview(atlas, faceTile(item.id, 0));
      if (!isFlower(item.id)) icon.style.setProperty('--top-texture', tilePreview(atlas, faceTile(item.id, 1)));
      this.icons.set(item.id, icon);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-item'; button.dataset.item = item.id;
      const name = document.createElement('span'); name.textContent = item.name;
      const supply = document.createElement('small'); supply.textContent = '∞'; supply.setAttribute('aria-hidden', 'true');
      button.append(this.icon(item.id), name, supply); button.addEventListener('click', () => callbacks.assign(item.id)); this.grid.append(button);
    }
    for (const recipe of RECIPES) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.recipe = recipe.block;
      button.setAttribute('aria-label', `Recipe: ${itemName(recipe.block)}`); button.title = itemName(recipe.block);
      button.append(this.icon(recipe.block)); button.addEventListener('click', () => { this.recipeBlock = recipe.block; this.render(); });
      this.dialog.querySelector('#inventory-recipes').append(button);
    }
    this.search.addEventListener('input', () => this.filter());
    for (const container of [this.slots, this.storage]) {
      container.addEventListener('click', event => {
        if (event.ctrlKey) return;
        const slot = event.target.closest('[data-inventory-slot]'); if (!slot) return;
        const index = Number(slot.dataset.inventorySlot);
        if (this.model.mode === 'creative') callbacks.select(index);
        else void this.clickSlot(index, event.ctrlKey, event.shiftKey);
      });
      container.addEventListener('contextmenu', event => {
        event.preventDefault(); const slot = event.target.closest('[data-inventory-slot]');
        if (slot && this.model.mode === 'gather') void this.clickSlot(Number(slot.dataset.inventorySlot), true, event.shiftKey);
      });
      container.addEventListener('pointerover', event => { const slot = event.target.closest('[data-inventory-slot]'); this.hovered = slot ? Number(slot.dataset.inventorySlot) : null; });
      container.addEventListener('pointerleave', () => { this.hovered = null; });
    }
    this.dialog.addEventListener('pointermove', event => { this.pointer = { x: event.clientX, y: event.clientY }; this.positionCursor(); });
    this.dialog.querySelector('#inventory-reset').addEventListener('click', callbacks.reset);
    this.dialog.querySelector('#inventory-craft').addEventListener('click', () => void this.craft());
    this.back.addEventListener('click', () => callbacks.close(true));
    this.dialog.querySelector('#inventory-close').addEventListener('click', () => callbacks.close(true));
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); callbacks.escape(); });
    this.render();
  }
  icon(block) { return this.icons.get(block)?.cloneNode(true) || document.createElement('span'); }
  positionCursor() { this.cursor.style.left = `${Math.min(innerWidth - 50, this.pointer.x + 12)}px`; this.cursor.style.top = `${Math.min(innerHeight - 55, this.pointer.y + 12)}px`; }
  renderCursor() {
    this.cursor.hidden = !this.held; this.cursor.replaceChildren();
    if (this.held) {
      const count = document.createElement('b'); count.textContent = this.held.amount; this.cursor.append(this.icon(this.held.block), count);
      this.cursor.setAttribute('aria-label', `${this.held.amount} ${itemName(this.held.block)} held`);
    }
    this.positionCursor();
  }
  stackButton(index, gather) {
    const block = gather ? this.model.stacks[index]?.block : this.model.slots[index];
    let count = gather ? this.model.slotCount(index) : Infinity;
    if (this.held?.source === index) count -= this.held.amount;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-slot'; button.dataset.inventorySlot = index;
    button.setAttribute('aria-label', `${index < 9 ? 'Hotbar' : 'Inventory'} slot ${index < 9 ? index + 1 : index - 8}: ${count && block ? `${itemName(block)}, ${gather ? count : 'unlimited'}` : 'Empty'}`);
    button.setAttribute('aria-pressed', String(index < 9 && index === this.model.selected));
    button.disabled = this.pending;
    if (index < 9) { const key = document.createElement('kbd'); key.textContent = index + 1; button.append(key); }
    if (block && count) {
      button.append(this.icon(block));
      const label = document.createElement('span'); label.className = 'inventory-slot-name'; label.textContent = itemName(block); button.append(label);
      if (gather) { const amount = document.createElement('b'); amount.className = 'inventory-quantity'; amount.textContent = count; button.append(amount); }
    }
    return button;
  }
  render() {
    const gather = this.model.mode === 'gather';
    if (!this.pending && this.held && (this.model.stacks?.[this.held.source]?.block !== this.held.block || this.model.slotCount(this.held.source) < this.held.amount)) this.held = null;
    const focus = document.activeElement?.dataset?.inventorySlot;
    if (focus !== undefined) this.restoreFocus = focus;
    this.dialog.classList.toggle('gather-inventory', gather); this.dialog.setAttribute('aria-busy', String(this.pending));
    this.dialog.querySelector('#inventory-title').textContent = gather ? 'Inventory' : 'Creative inventory';
    this.dialog.querySelector('.eyebrow').textContent = gather ? 'GATHER & BUILD' : 'UNLIMITED SUPPLIES';
    this.dialog.querySelector('#inventory-description').textContent = gather ? 'Click to move a stack. Right-click to split or place one. Shift-click to move between your backpack and hotbar.' : 'Choose a hotbar slot, then choose its block. Your supplies never run out.';
    this.dialog.querySelector('.inventory-footer > span').textContent = gather ? 'Click move · Right-click split · I return · Esc return' : '1–9 choose slot · I return · Esc return';
    this.dialog.querySelector('#inventory-catalog').hidden = gather;
    this.dialog.querySelector('#inventory-storage-section').hidden = !gather;
    this.dialog.querySelector('#inventory-reset').hidden = gather;
    this.dialog.querySelector('#inventory-crafting').hidden = !gather;
    this.dialog.querySelector('#inventory-hotbar-label').hidden = !gather;
    this.slots.replaceChildren(...Array.from({ length: 9 }, (_, i) => this.stackButton(i, gather)));
    this.storage.replaceChildren(...(gather ? Array.from({ length: 27 }, (_, i) => this.stackButton(i + 9, true)) : []));
    for (const button of this.grid.children) {
      const block = Number(button.dataset.item); button.setAttribute('aria-label', `Add ${itemName(block)} to slot ${this.model.selected + 1}`);
      button.setAttribute('aria-pressed', String(block === this.model.block));
    }
    this.status.textContent = gather ? this.held ? `${this.held.amount} ${itemName(this.held.block)} held · Click a slot to place. Close inventory to return them.` : 'Hover a slot and press 1–9 to swap with your hotbar. Stacks hold up to 64.'
      : `Slot ${this.model.selected + 1}: ${itemName(this.model.block)}. Choose a block below to replace it.`;
    if (gather) {
      const recipe = RECIPES.find(recipe => recipe.block === this.recipeBlock);
      for (const button of this.dialog.querySelector('#inventory-recipes').children) button.setAttribute('aria-pressed', String(Number(button.dataset.recipe) === this.recipeBlock));
      this.dialog.querySelector('#inventory-recipe').textContent = recipe.needs.map(([block, count]) => `${count} ${itemName(block)} (${this.model.count(block)})`).join(' + ');
      const craft = this.dialog.querySelector('#inventory-craft'); craft.textContent = `Make ${recipe.amount} ${itemName(recipe.block)}`;
      craft.disabled = this.pending || !!this.held || !this.model.recipePlan(recipe.block).ok;
    }
    this.filter(); this.renderCursor();
    if (this.restoreFocus !== undefined && !this.pending && this.dialog.open) { this.dialog.querySelector(`[data-inventory-slot="${this.restoreFocus}"]`)?.focus({ preventScroll: true }); this.restoreFocus = undefined; }
  }
  async run(args) {
    if (this.pending) return { ok: false, reason: 'busy' };
    this.pending = true; this.render();
    try { return await this.callbacks.action(args); }
    catch { return { ok: false, reason: 'disconnected' }; }
    finally { this.pending = false; }
  }
  async clickSlot(index, right = false, shift = false) {
    if (this.pending) return;
    const stack = this.model.stacks[index];
    if (shift) {
      this.held = null;
      if (stack) { const result = await this.run({ action: 'quickMove', source: index, expectedSource: { ...stack } }); this.render(); if (!result.ok) this.failure(result); }
      else this.render();
      return;
    }
    if (!this.held) { if (stack) this.held = { source: index, block: stack.block, amount: right ? Math.ceil(stack.count / 2) : stack.count }; this.render(); return; }
    const held = { ...this.held };
    if (held.source === index) { if (!right || --this.held.amount === 0) this.held = null; this.render(); return; }
    const result = await this.run({ action: 'move', source: held.source, target: index, amount: right ? 1 : held.amount, swap: !right,
      expectedSource: { ...this.model.stacks[held.source] }, expectedTarget: stack ? { ...stack } : null });
    if (result.ok) {
      if (result.swapped) { const current = this.model.stacks[held.source]; this.held = current ? { source: held.source, block: current.block, amount: current.count } : null; }
      else this.held = held.amount > result.moved ? { ...held, amount: held.amount - result.moved } : null;
    }
    this.render(); if (!result.ok) this.failure(result);
  }
  hotbarKey(index) {
    if (this.model.mode !== 'gather') return false;
    const source = this.hovered ?? Number(document.activeElement?.dataset?.inventorySlot);
    if (!Number.isInteger(source) || source < 0 || source >= 36 || source === index) return false;
    if (this.pending) return true;
    this.held = null;
    const stack = this.model.stacks[source], target = this.model.stacks[index];
    // Moving an empty slot swaps the hotbar stack in the other direction.
    if (!stack && !target) return true;
    const from = stack ? source : index, to = stack ? index : source;
    void this.run({ action: 'move', source: from, target: to, amount: this.model.stacks[from].count,
      expectedSource: { ...this.model.stacks[from] }, expectedTarget: this.model.stacks[to] ? { ...this.model.stacks[to] } : null }).then(result => { this.render(); if (!result.ok) this.failure(result); });
    return true;
  }
  async craft() {
    if (this.pending || this.held) return;
    this.pending = true; this.render();
    try { const result = await this.callbacks.craft(this.recipeBlock); this.pending = false; this.render(); if (!result.ok) this.failure(result); }
    catch { this.status.textContent = 'Could not complete crafting. Check the connection.'; }
    finally { this.pending = false; }
  }
  failure(result) {
    this.status.textContent = { inventory_full: 'There is no room for that stack.', supplies: 'Collect the ingredients first.', occupied: 'Put the held items in an empty or matching slot.', changed: 'That stack changed. Pick it up again.', storage: 'Could not save this move. Retry saving from the menu.', disconnected: 'Waiting for the host to reconnect…' }[result.reason] || 'That move could not be completed.';
  }
  filter() {
    const query = this.search.value.trim().toLowerCase(); let count = 0;
    for (const button of this.grid.children) { button.hidden = !itemName(Number(button.dataset.item)).toLowerCase().includes(query); if (!button.hidden) count++; }
    this.dialog.querySelector('#inventory-results').textContent = count ? `${count} blocks · Unlimited supplies` : 'No blocks found. Try another name.';
  }
  open(resume) { this.held = null; this.hovered = null; this.search.value = ''; this.render(); this.back.textContent = resume ? 'Back to game' : 'Back to menu'; this.dialog.showModal(); this.dialog.querySelector('#inventory-close').focus(); }
  close() { this.held = null; this.hovered = null; this.renderCursor(); this.dialog.close(); }
}
