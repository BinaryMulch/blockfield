import { GRASS, DIRT, STONE, WOOD, LEAVES, SAND, PLANKS, BRICKS, GLASS, DOOR, LANTERN, WARD_LANTERN, SLAB, RED_FLOWER, YELLOW_FLOWER, DAISY, CONCRETE, REINFORCED_PANEL, STORAGE_CABINET, SECURITY_DOOR, SAPLING, SCRAP, BIOFUEL, REPAIR_TOOL, isDoor, isSlab, doorState, buildBlock } from './world.js';

export const MATERIALS = Object.freeze([
  { id: GRASS, name: 'Grass', style: 'grass' }, { id: DIRT, name: 'Dirt', style: 'dirt' },
  { id: STONE, name: 'Stone', style: 'stone' }, { id: WOOD, name: 'Wood', style: 'wood' },
  { id: LEAVES, name: 'Leaves', style: 'leaves' }, { id: SAND, name: 'Sand', style: 'sand' },
  { id: PLANKS, name: 'Wood cladding', style: 'planks' }, { id: BRICKS, name: 'Pavers', style: 'bricks' },
  { id: GLASS, name: 'Glass', style: 'glass' }, { id: DOOR, name: 'Service door', style: 'door' },
  { id: LANTERN, name: 'Utility light', style: 'lantern' }, { id: SLAB, name: 'Wooden slab', style: 'slab' },
  { id: RED_FLOWER, name: 'Red flower', style: 'flower' }, { id: YELLOW_FLOWER, name: 'Yellow flower', style: 'flower' },
  { id: DAISY, name: 'Daisy', style: 'flower' },
  { id: WARD_LANTERN, name: 'Ward emitter', style: 'lantern' },
  { id: CONCRETE, name: 'Concrete', style: 'concrete' },
  { id: REINFORCED_PANEL, name: 'Reinforced panel', style: 'steel' },
  { id: STORAGE_CABINET, name: 'Storage cabinet', style: 'steel' },
  { id: SECURITY_DOOR, name: 'Security door', style: 'steel' },
  { id: SAPLING, name: 'Sapling', style: 'sapling' },
  { id: SCRAP, name: 'Scrap metal', style: 'steel' },
  { id: BIOFUEL, name: 'Biomass cartridge', style: 'steel' },
  { id: REPAIR_TOOL, name: 'Repair tool', style: 'steel' },
]);
export const DEFAULT_HOTBAR = Object.freeze([GRASS, DIRT, STONE, WOOD, LEAVES, SAND, PLANKS, BRICKS, GLASS]);
const items = new Set(MATERIALS.map(item => item.id));
export const STACK_LIMIT = 64;
// Legacy mode names are accepted only by the save reader for migration.
export const GAME_MODES = ['horror'];
export const RECIPES = [
  { block: PLANKS, amount: 4, needs: [[WOOD, 1]] },
  { block: BRICKS, amount: 4, needs: [[STONE, 4]] },
  { block: GLASS, amount: 1, needs: [[SAND, 2]] },
  { block: DOOR, amount: 1, needs: [[PLANKS, 6]] },
  { block: SLAB, amount: 6, needs: [[PLANKS, 3]] },
  { block: LANTERN, amount: 1, needs: [[STONE, 4], [WOOD, 1], [GLASS, 1]] },
  { block: WARD_LANTERN, amount: 1, needs: [[STONE, 8], [WOOD, 2], [GLASS, 2]] },
  { block: CONCRETE, amount: 4, needs: [[STONE, 4], [SAND, 1]] },
  { block: REINFORCED_PANEL, amount: 2, needs: [[CONCRETE, 4], [SCRAP, 1]] },
  { block: STORAGE_CABINET, amount: 1, needs: [[REINFORCED_PANEL, 4], [PLANKS, 2]] },
  { block: SECURITY_DOOR, amount: 1, needs: [[REINFORCED_PANEL, 6], [GLASS, 1]] },
  { block: SAPLING, amount: 1, needs: [[LEAVES, 1]] },
  { block: BIOFUEL, amount: 2, needs: [[WOOD, 1]] },
  { block: REPAIR_TOOL, amount: 1, needs: [[SCRAP, 2], [PLANKS, 2]] },
];
export const INVENTORY_SIZE = 36;
const clone = stack => stack ? { ...stack } : null;
const sameStack = (a, b) => a === null ? b === null : !!a && !!b && a.block === b.block && a.count === b.count;
export const validStack = stack => stack === null || !!stack && items.has(stack.block) && Number.isInteger(stack.count) && stack.count > 0 && stack.count <= STACK_LIMIT;
const validIndex = index => Number.isInteger(index) && index >= 0 && index < INVENTORY_SIZE;
export const emptyGatherInventory = () => ({ version: 3, mode: 'gather', stacks: Array(INVENTORY_SIZE).fill(null), selected: 0 });

export function validInventory(value) {
  if (!value || !Number.isInteger(value.selected) || value.selected < 0 || value.selected >= 9) return false;
  if (value.version === 3) return value.mode === 'gather' && Array.isArray(value.stacks) && value.stacks.length === INVENTORY_SIZE && Array.from(value.stacks).every(validStack);
  if (![1, 2].includes(value.version) || !Array.isArray(value.slots) || value.slots.length !== 9 || !Array.from(value.slots).every(block => items.has(block))) return false;
  return value.version === 1 || value.mode === 'gather' && Array.isArray(value.counts) && [15, 16, 20, MATERIALS.length].includes(value.counts.length)
    && Array.from(value.counts).every(count => Number.isInteger(count) && count >= 0 && count <= STACK_LIMIT);
}

export class Inventory {
  constructor(saved) { this.restore(saved); }
  restore(saved) {
    const valid = validInventory(saved);
    this.selected = valid ? saved.selected : 0;
    this.stacks = Array(INVENTORY_SIZE).fill(null);
    if (valid && saved.version === 3) this.stacks = saved.stacks.map(clone);
    if (valid && saved.version === 2) {
      const remaining = new Map(MATERIALS.map((item, i) => [item.id, saved.counts[i] || 0]));
      saved.slots.forEach((block, i) => { const count = remaining.get(block); if (count) { this.stacks[i] = { block, count }; remaining.set(block, 0); } });
      let index = 9;
      for (const [block, count] of remaining) if (count) this.stacks[index++] = { block, count };
    }
  }
  get mode() { return 'gather'; } // Inventory format tag retained for existing saves.
  get hotbar() { return this.stacks.slice(0, 9).map(stack => stack?.block || 0); }
  get block() { return this.hotbar[this.selected]; }
  count(block) { return this.stacks.reduce((sum, stack) => sum + (stack?.block === buildBlock(block) ? stack.count : 0), 0); }
  slotCount(index) { return this.stacks[index]?.count || 0; }
  snapshot() {
    return { version: 3, mode: 'gather', stacks: this.stacks.map(clone), selected: this.selected };
  }
  balance(delta, spendSlot) {
    const stacks = this.stacks.map(clone);
    for (const [block, amount] of delta) if (amount < 0) {
      let needed = -amount;
      const indices = spendSlot !== undefined ? [spendSlot] : [this.selected, ...stacks.map((_, i) => i).filter(i => i !== this.selected)];
      if (spendSlot !== undefined && (!Number.isInteger(spendSlot) || spendSlot < 0 || spendSlot >= 9)) return { ok: false, reason: 'supplies' };
      for (const i of indices) if (stacks[i]?.block === block) {
        const take = Math.min(needed, stacks[i].count); stacks[i].count -= take; needed -= take;
        if (!stacks[i].count) stacks[i] = null;
        if (!needed) break;
      }
      if (needed) return { ok: false, reason: 'supplies' };
    }
    for (const [block, amount] of delta) if (amount > 0) {
      let left = amount;
      for (const stack of stacks) if (stack?.block === block && stack.count < STACK_LIMIT) {
        const add = Math.min(left, STACK_LIMIT - stack.count); stack.count += add; left -= add;
        if (!left) break;
      }
      for (let i = 0; i < stacks.length && left; i++) if (!stacks[i]) {
        const count = Math.min(STACK_LIMIT, left); stacks[i] = { block, count }; left -= count;
      }
      if (left) return { ok: false, reason: 'inventory_full' };
    }
    return { ok: true, stacks };
  }
  plan(changes, spendSlot) {
    const delta = new Map(), add = (block, amount) => {
      if (isDoor(block) && doorState(block).upper) return;
      block = buildBlock(block);
      if (items.has(block)) delta.set(block, (delta.get(block) || 0) + amount);
    };
    for (const { from, to } of changes) {
      if (isSlab(from) && to === PLANKS) add(SLAB, -1);
      else if (from === PLANKS && isSlab(to)) add(SLAB, 1);
      else { add(from, 1); add(to, -1); }
    }
    return this.balance(delta, spendSlot);
  }
  applyBalance(result) { if (result.stacks) this.stacks = result.stacks.map(clone); }
  recipePlan(block) {
    const recipe = RECIPES.find(recipe => recipe.block === block);
    if (!this.stacks || !recipe) return { ok: false, reason: 'invalid' };
    const delta = new Map(recipe.needs.map(([id, count]) => [id, -count]));
    delta.set(block, (delta.get(block) || 0) + recipe.amount);
    return this.balance(delta);
  }
  craft(block) {
    const result = this.recipePlan(block);
    if (result.ok) this.applyBalance(result);
    return result;
  }
  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 9 || index === this.selected) return false;
    this.selected = index; return true;
  }
  assign() { return false; }
  pick(block) {
    block = buildBlock(block);
    if (!items.has(block)) return false;
    const existing = this.hotbar.indexOf(block);
    if (existing >= 0) return this.select(existing);
    const source = this.stacks.findIndex(stack => stack?.block === block);
    return source >= 9 ? this.move(source, this.selected, this.stacks[source].count).ok : false;
  }
  reset() { return false; }
  move(source, target, amount, swap = true) {
    if (!this.stacks || !validIndex(source) || !validIndex(target) || source === target || !Number.isInteger(amount) || amount < 1) return { ok: false, reason: 'invalid' };
    const from = this.stacks[source], to = this.stacks[target];
    if (!from || amount > from.count) return { ok: false, reason: 'changed' };
    if (to && to.block !== from.block) {
      if (!swap || amount !== from.count) return { ok: false, reason: 'occupied' };
      [this.stacks[source], this.stacks[target]] = [to, from]; return { ok: true, moved: amount, swapped: true };
    }
    const moved = Math.min(amount, STACK_LIMIT - (to?.count || 0));
    if (!moved) return { ok: false, reason: 'inventory_full' };
    this.stacks[target] = { block: from.block, count: (to?.count || 0) + moved };
    from.count -= moved; if (!from.count) this.stacks[source] = null;
    return { ok: true, moved };
  }
  quickMove(source) {
    if (!this.stacks || !validIndex(source) || !this.stacks[source]) return { ok: false, reason: 'invalid' };
    const indices = source < 9 ? Array.from({ length: 27 }, (_, i) => i + 9) : Array.from({ length: 9 }, (_, i) => i);
    let moved = 0;
    for (const i of [...indices.filter(i => this.stacks[i]?.block === this.stacks[source].block), ...indices.filter(i => !this.stacks[i])]) {
      const result = this.move(source, i, this.stacks[source].count, false); if (result.ok) moved += result.moved;
      if (!this.stacks[source]) break;
    }
    return moved ? { ok: true, moved } : { ok: false, reason: 'inventory_full' };
  }
  action(args) {
    if (!this.stacks) return { ok: false, reason: 'invalid' };
    if (args.action === 'select') { if (!Number.isInteger(args.index) || args.index < 0 || args.index >= 9) return { ok: false, reason: 'invalid' }; this.select(args.index); return { ok: true }; }
    if (args.action === 'pick') { if (!this.count(args.block)) return { ok: false, reason: 'supplies' }; if (Number.isInteger(args.slot)) this.select(args.slot); this.pick(args.block); return { ok: true }; }
    const { source, target } = args;
    if (!validIndex(source) || !sameStack(this.stacks[source], args.expectedSource)) return { ok: false, reason: 'changed' };
    if (args.action === 'quickMove') return this.quickMove(source);
    if (args.action !== 'move' || !validIndex(target) || !sameStack(this.stacks[target], args.expectedTarget)) return { ok: false, reason: 'changed' };
    return this.move(source, target, args.amount, args.swap !== false);
  }
}
