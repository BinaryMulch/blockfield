import { MATERIALS, RECIPES } from './inventory.js';
import { isFlower } from './world.js';
import { faceTile, tilePreview, flowerPreview } from './textures.js';
const itemName = block => MATERIALS.find(item => item.id === block)?.name || 'Empty';

export class InventoryView {
  constructor(model, atlas, callbacks) {
    this.model = model; this.callbacks = callbacks;
    this.dialog = document.querySelector('#inventory-dialog');
    this.slots = this.dialog.querySelector('#inventory-hotbar'); this.storage = this.dialog.querySelector('#inventory-storage');
    this.status = this.dialog.querySelector('#inventory-status'); this.back = this.dialog.querySelector('#inventory-back');
    this.cursor = this.dialog.querySelector('#inventory-cursor'); this.icons = new Map(); this.recipeBlock = RECIPES[0].block;
    this.pointer = { x: 0, y: 0 }; this.held = null; this.pending = false; this.hovered = null;
    for (const item of MATERIALS) {
      const icon = document.createElement('span'); icon.className = `block-icon ${item.style}`; icon.setAttribute('aria-hidden', 'true');
      icon.style.backgroundImage = isFlower(item.id) ? flowerPreview(item.id) : tilePreview(atlas, faceTile(item.id, 0));
      if (!isFlower(item.id)) icon.style.setProperty('--top-texture', tilePreview(atlas, faceTile(item.id, 1)));
      this.icons.set(item.id, icon);
    }
    for (const recipe of RECIPES) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.recipe = recipe.block;
      button.setAttribute('aria-label', `Recipe: ${itemName(recipe.block)}`); button.title = itemName(recipe.block);
      button.append(this.icon(recipe.block)); button.addEventListener('click', () => { this.recipeBlock = recipe.block; this.render(); });
      this.dialog.querySelector('#inventory-recipes').append(button);
    }
    for (const container of [this.slots, this.storage]) {
      container.addEventListener('click', event => {
        if (event.ctrlKey) return;
        const slot = event.target.closest('[data-inventory-slot]'); if (!slot) return;
        const index = Number(slot.dataset.inventorySlot);
        void this.clickSlot(index, false, event.shiftKey);
      });
      container.addEventListener('contextmenu', event => {
        event.preventDefault(); const slot = event.target.closest('[data-inventory-slot]');
        if (slot) void this.clickSlot(Number(slot.dataset.inventorySlot), true, event.shiftKey);
      });
      container.addEventListener('pointerover', event => { const slot = event.target.closest('[data-inventory-slot]'); this.hovered = slot ? Number(slot.dataset.inventorySlot) : null; });
      container.addEventListener('pointerleave', () => { this.hovered = null; });
    }
    this.dialog.addEventListener('pointermove', event => { this.pointer = { x: event.clientX, y: event.clientY }; this.positionCursor(); });
    this.dialog.querySelector('#inventory-craft').addEventListener('click', () => void this.craft());
    this.dialog.querySelector('#inventory-drop-one').addEventListener('click', () => void this.drop(false));
    this.dialog.querySelector('#inventory-drop-stack').addEventListener('click', () => void this.drop(true));
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
  stackButton(index) {
    const block = this.model.stacks[index]?.block;
    let count = this.model.slotCount(index);
    if (this.held?.source === index) count -= this.held.amount;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-slot'; button.dataset.inventorySlot = index;
    button.setAttribute('aria-label', `${index < 9 ? 'Hotbar' : 'Inventory'} slot ${index < 9 ? index + 1 : index - 8}: ${count && block ? `${itemName(block)}, ${count}` : 'Empty'}`);
    button.setAttribute('aria-pressed', String(index < 9 && index === this.model.selected));
    button.disabled = this.pending;
    if (index < 9) { const key = document.createElement('kbd'); key.textContent = index + 1; button.append(key); }
    if (block && count) {
      button.append(this.icon(block));
      const label = document.createElement('span'); label.className = 'inventory-slot-name'; label.textContent = itemName(block); button.append(label);
      { const amount = document.createElement('b'); amount.className = 'inventory-quantity'; amount.textContent = count; button.append(amount); }
    }
    return button;
  }
  render() {
    if (!this.pending && this.held && (this.model.stacks?.[this.held.source]?.block !== this.held.block || this.model.slotCount(this.held.source) < this.held.amount)) this.held = null;
    this.dialog.classList.add('gather-inventory'); this.dialog.setAttribute('aria-busy', String(this.pending));
    this.dialog.querySelector('#inventory-title').textContent = 'Inventory';
    this.dialog.querySelector('.eyebrow').textContent = 'SUPPLIES & SHELTER';
    this.dialog.querySelector('#inventory-description').textContent = 'Click to move a stack. Right-click to split or place one. Shift-click to move between your backpack and hotbar. The world keeps running while you use inventory.';
    this.dialog.querySelector('.inventory-footer > span').textContent = 'Click move · Right-click split · I return · Esc return';
    this.dialog.querySelector('#inventory-storage-section').hidden = false;
    this.dialog.querySelector('#inventory-crafting').hidden = false;
    this.dialog.querySelector('#inventory-drop-actions').hidden = false;
    for (const id of ['#inventory-drop-one', '#inventory-drop-stack']) this.dialog.querySelector(id).disabled = this.pending || !this.model.stacks?.[this.held?.source ?? this.model.selected];
    this.dialog.querySelector('#inventory-hotbar-label').hidden = false;
    this.slots.replaceChildren(...Array.from({ length: 9 }, (_, i) => this.stackButton(i)));
    this.storage.replaceChildren(...Array.from({ length: 27 }, (_, i) => this.stackButton(i + 9)));
    this.status.textContent = this.held ? `${this.held.amount} ${itemName(this.held.block)} held · Click a slot to place. Close inventory to return them.`
      : 'Hover a slot and press 1–9 to swap with your hotbar. Stacks hold up to 64.';
    {
      const recipe = RECIPES.find(recipe => recipe.block === this.recipeBlock);
      for (const button of this.dialog.querySelector('#inventory-recipes').children) button.setAttribute('aria-pressed', String(Number(button.dataset.recipe) === this.recipeBlock));
      this.dialog.querySelector('#inventory-recipe').textContent = recipe.needs.map(([block, count]) => `${count} ${itemName(block)} (${this.model.count(block)})`).join(' + ');
      const craft = this.dialog.querySelector('#inventory-craft'); craft.textContent = `Make ${recipe.amount} ${itemName(recipe.block)}`;
      craft.disabled = this.pending || !!this.held || !this.model.recipePlan(recipe.block).ok;
    }
    this.renderCursor();
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
    const source = this.hovered;
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
  async drop(wholeStack) {
    if (this.pending) return;
    const source = this.held?.source ?? this.model.selected, stack = this.model.stacks[source];
    if (!stack) return;
    const held = this.held ? { ...this.held } : null;
    const amount = wholeStack ? held?.amount ?? stack.count : 1;
    this.pending = true; this.render();
    let result;
    try { result = await this.callbacks.drop({ source, amount, expectedSource: { ...stack } }); }
    catch { result = { ok: false, reason: 'disconnected' }; }
    finally { this.pending = false; }
    if (result.ok) this.held = held && held.amount > amount ? { ...held, amount: held.amount - amount } : null;
    this.render();
    if (!result.ok) this.failure(result);
  }
  failure(result) {
    this.status.textContent = { drops_full: 'Too many dropped stacks. Pick some up first.', blocked: 'Move into an open space to drop items.', inventory_full: 'There is no room for that stack.', supplies: 'Collect the ingredients first.', occupied: 'Put the held items in an empty or matching slot.', changed: 'That stack changed. Pick it up again.', storage: 'Could not save this move. Retry saving from the menu.', disconnected: 'Waiting for the host to reconnect…' }[result.reason] || 'That move could not be completed.';
  }
  open(resume) { this.held = null; this.hovered = null; this.render(); this.back.textContent = resume ? 'Back to game' : 'Back to menu'; this.dialog.showModal(); }
  close() { this.held = null; this.hovered = null; this.renderCursor(); this.dialog.close(); }
}
