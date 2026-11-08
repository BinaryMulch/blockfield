import { Inventory, MATERIALS, RECIPES, INVENTORY_SIZE, matchCrafting } from './inventory.js';
import { isFlower } from './world.js';
import { faceTile, tilePreview, flowerPreview } from './textures.js';
const itemName = block => MATERIALS.find(item => item.id === block)?.name || 'Empty';

export class InventoryView {
  constructor(model, atlas, callbacks) {
    this.model = model; this.callbacks = callbacks;
    this.dialog = document.querySelector('#inventory-dialog');
    this.slots = this.dialog.querySelector('#inventory-hotbar'); this.storage = this.dialog.querySelector('#inventory-storage');
    this.status = this.dialog.querySelector('#inventory-status'); this.back = this.dialog.querySelector('#inventory-back');
    this.grid = this.dialog.querySelector('#inventory-crafting-grid');
    this.cursor = this.dialog.querySelector('#inventory-cursor'); this.icons = new Map(); this.recipeBlock = RECIPES[0].block;
    this.pointer = { x: 0, y: 0 }; this.held = null; this.pending = false; this.hovered = null;
    for (const item of MATERIALS) {
      const icon = document.createElement('span'); icon.className = `block-icon ${item.style}`; icon.setAttribute('aria-hidden', 'true');
      icon.style.backgroundImage = isFlower(item.id) ? flowerPreview(item.id) : tilePreview(atlas, faceTile(item.id, 0));
      this.icons.set(item.id, icon);
    }
    for (const recipe of RECIPES) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.recipe = recipe.block;
      button.setAttribute('aria-label', `Recipe: ${itemName(recipe.block)}`); button.title = `${recipe.amount} ${itemName(recipe.block)} · ${recipe.needs.map(([id, count]) => `${count} ${itemName(id)}`).join(' + ')}`;
      button.append(this.icon(recipe.block)); button.addEventListener('click', event => void this.fillRecipe(recipe.block, event.shiftKey));
      this.dialog.querySelector('#inventory-recipes').append(button);
    }
    for (const container of [this.slots, this.storage, this.grid]) {
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
    this.dialog.querySelector('#inventory-craft').addEventListener('click', event => void this.craft(event.shiftKey));
    this.dialog.querySelector('#inventory-craft').addEventListener('contextmenu', event => { event.preventDefault(); void this.craft(); });
    this.dialog.querySelector('#inventory-clear-crafting').addEventListener('click', () => void this.clearCrafting());
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
    const block = this.model.slot(index)?.block;
    let count = this.model.slotCount(index);
    if (this.held?.source === index) count -= this.held.amount;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-slot'; button.dataset.inventorySlot = index;
    button.setAttribute('aria-label', `${index >= INVENTORY_SIZE ? 'Crafting' : index < 9 ? 'Hotbar' : 'Inventory'} slot ${index >= INVENTORY_SIZE ? index - INVENTORY_SIZE + 1 : index < 9 ? index + 1 : index - 8}: ${count && block ? `${itemName(block)}, ${count}` : 'Empty'}`);
    button.title = count && block ? `${itemName(block)} (${count})` : 'Empty';
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
    if (!this.pending && this.held && (this.model.slot(this.held.source)?.block !== this.held.block || this.model.slotCount(this.held.source) < this.held.amount)) this.held = null;
    this.dialog.classList.add('gather-inventory'); this.dialog.setAttribute('aria-busy', String(this.pending));
    this.dialog.querySelector('#inventory-title').textContent = 'Inventory';
    this.dialog.querySelector('.eyebrow').textContent = 'SUPPLIES & SHELTER';
    this.dialog.querySelector('#inventory-description').textContent = 'Arrange ingredients in the crafting grid, then take the result. Use the recipe book to fill a recipe. The world keeps running.';
    this.dialog.querySelector('.inventory-footer > span').textContent = 'Click move · Right-click split · E return · Esc return';
    this.dialog.querySelector('#inventory-storage-section').hidden = false;
    this.dialog.querySelector('#inventory-crafting').hidden = false;
    this.dialog.querySelector('#inventory-drop-actions').hidden = false;
    for (const id of ['#inventory-drop-one', '#inventory-drop-stack']) this.dialog.querySelector(id).disabled = this.pending || this.held?.source >= INVENTORY_SIZE || !this.model.slot(this.held?.source ?? this.model.selected);
    this.dialog.querySelector('#inventory-hotbar-label').hidden = false;
    this.slots.replaceChildren(...Array.from({ length: 9 }, (_, i) => this.stackButton(i)));
    this.storage.replaceChildren(...Array.from({ length: 27 }, (_, i) => this.stackButton(i + 9)));
    this.grid.replaceChildren(...Array.from({ length: 9 }, (_, i) => this.stackButton(i + INVENTORY_SIZE)));
    this.status.textContent = this.held ? `${this.held.amount} ${itemName(this.held.block)} held · Click a slot to place. Close inventory to return them.`
      : 'Right-click to split or place one · 1–9 swaps a hovered slot · Ingredients in the grid are saved.';
    this.renderCrafting();
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
    const stack = this.model.slot(index);
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
      expectedSource: { ...this.model.slot(held.source) }, expectedTarget: stack ? { ...stack } : null });
    if (result.ok) {
      if (result.swapped) { const current = this.model.slot(held.source); this.held = current ? { source: held.source, block: current.block, amount: current.count } : null; }
      else this.held = held.amount > result.moved ? { ...held, amount: held.amount - result.moved } : null;
    }
    this.render(); if (!result.ok) this.failure(result);
  }
  hotbarKey(index) {
    const source = this.hovered;
    if (!Number.isInteger(source) || source < 0 || source >= INVENTORY_SIZE + 9 || source === index) return false;
    if (this.pending) return true;
    this.held = null;
    const stack = this.model.slot(source), target = this.model.slot(index);
    // Moving an empty slot swaps the hotbar stack in the other direction.
    if (!stack && !target) return true;
    const from = stack ? source : index, to = stack ? index : source;
    void this.run({ action: 'move', source: from, target: to, amount: this.model.slot(from).count,
      expectedSource: { ...this.model.slot(from) }, expectedTarget: this.model.slot(to) ? { ...this.model.slot(to) } : null }).then(result => { this.render(); if (!result.ok) this.failure(result); });
    return true;
  }
  renderCrafting() {
    const match = matchCrafting(this.model.crafting);
    const selected = RECIPES.find(recipe => recipe.block === this.recipeBlock);
    const available = new Map();
    for (const stack of [...this.model.stacks, ...this.model.crafting]) if (stack) available.set(stack.block, (available.get(stack.block) || 0) + stack.count);
    for (const button of this.dialog.querySelector('#inventory-recipes').children) {
      const block = Number(button.dataset.recipe), recipe = RECIPES.find(recipe => recipe.block === block);
      button.setAttribute('aria-pressed', String(block === this.recipeBlock));
      button.classList.toggle('recipe-unavailable', recipe.needs.some(([id, count]) => (available.get(id) || 0) < count));
      button.disabled = this.pending || !!this.held;
    }
    this.dialog.querySelector('#inventory-recipe').textContent = `${selected.amount} ${itemName(selected.block)}: ${selected.needs.map(([block, count]) => `${count} ${itemName(block)} (${available.get(block) || 0})`).join(' + ')}`;
    const craft = this.dialog.querySelector('#inventory-craft');
    craft.replaceChildren();
    craft.disabled = this.pending || !match || !!this.held && (this.held.source >= INVENTORY_SIZE || this.held.block !== match.recipe.block);
    craft.setAttribute('aria-label', match ? `Take ${match.recipe.amount} ${itemName(match.recipe.block)}. Shift-click to craft all.` : 'Crafting result: empty');
    craft.title = match ? `${match.recipe.amount} ${itemName(match.recipe.block)} · Shift-click to craft all` : 'Arrange a recipe in the grid';
    if (match) {
      const count = document.createElement('b'); count.className = 'inventory-quantity'; count.textContent = match.recipe.amount;
      craft.append(this.icon(match.recipe.block), count);
    }
    const empty = !this.model.crafting.some(Boolean);
    this.dialog.querySelector('#inventory-clear-crafting').disabled = this.pending || !!this.held || empty;
    // Selecting an unavailable recipe still teaches its shape without inventing items.
    if (empty) selected.pattern.forEach((row, y) => row.forEach((cell, x) => {
      if (!cell) return;
      const button = this.grid.children[y * 3 + x], icon = this.icon(cell.block);
      icon.classList.add('recipe-ghost'); button.append(icon);
      button.title = `Recipe guide: ${cell.count} ${itemName(cell.block)}`;
      button.setAttribute('aria-label', `Crafting slot ${y * 3 + x + 1}: empty. Recipe guide: ${cell.count} ${itemName(cell.block)}`);
      if (cell.count > 1) { const count = document.createElement('b'); count.className = 'inventory-quantity recipe-ghost'; count.textContent = cell.count; button.append(count); }
    }));
  }
  craftingArgs(action) { return { action, expectedCrafting: this.model.crafting.map(stack => stack ? { ...stack } : null) }; }
  async fillRecipe(block, all = false) {
    if (this.pending || this.held) return;
    this.recipeBlock = block;
    const preview = new Inventory(this.model.snapshot()).fillRecipe(block, all);
    if (!preview.ok) {
      // Return the previous recipe's real ingredients before showing a new guide.
      if (preview.reason === 'supplies' && this.model.crafting.some(Boolean)) {
        const returned = await this.run(this.craftingArgs('clearCrafting'));
        if (!returned.ok) { this.render(); this.failure(returned); return; }
      }
      this.render(); this.failure(preview); return;
    }
    const result = await this.run({ ...this.craftingArgs('fillRecipe'), block, all });
    this.render(); if (!result.ok) this.failure(result);
  }
  async clearCrafting() {
    if (this.pending || this.held) return;
    const result = await this.run(this.craftingArgs('clearCrafting'));
    this.render(); if (!result.ok) this.failure(result);
  }
  async craft(all = false) {
    if (this.pending) return;
    const match = matchCrafting(this.model.crafting), held = this.held ? { ...this.held } : null;
    if (!match || held && (held.source >= INVENTORY_SIZE || held.block !== match.recipe.block)) return;
    if (all && held) return;
    const args = { ...this.craftingArgs('craftGrid'), all };
    if (held) { args.target = held.source; args.expectedTarget = { ...this.model.slot(held.source) }; }
    const result = await this.run(args);
    if (result.ok && !all && this.dialog.open) this.held = { source: result.source, block: result.block, amount: (held?.amount || 0) + result.amount };
    this.render(); if (!result.ok) this.failure(result);
  }
  async drop(wholeStack) {
    if (this.pending) return;
    const source = this.held?.source ?? this.model.selected, stack = this.model.slot(source);
    if (!stack || source >= INVENTORY_SIZE) return;
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
    this.status.textContent = { drops_full: 'Too many dropped stacks. Pick some up first.', blocked: 'Move into an open space to drop items.', inventory_full: 'There is no room for that stack.', recipe: 'Arrange the ingredients to match a recipe.', supplies: 'Collect the missing ingredients first. The recipe guide shows the layout.', occupied: 'Put the held items in an empty or matching slot.', changed: 'That stack changed. Pick it up again.', storage: 'Could not save this move. Retry saving from the menu.', disconnected: 'Waiting for the host to reconnect…' }[result.reason] || 'That move could not be completed.';
  }
  open(resume) { this.held = null; this.hovered = null; this.render(); this.back.textContent = resume ? 'Back to game' : 'Back to menu'; this.dialog.showModal(); }
  close() { this.held = null; this.hovered = null; this.renderCursor(); this.dialog.close(); }
}
