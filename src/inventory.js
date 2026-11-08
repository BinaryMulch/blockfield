import { GRASS, DIRT, STONE, WOOD, LEAVES, SAND, PLANKS, BRICKS, GLASS, DOOR, LANTERN, WARD_LANTERN, SLAB, RED_FLOWER, YELLOW_FLOWER, DAISY, STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR, SAPLING, WOODEN_PEGS, CHARCOAL, STONE_HAMMER, isDoor, isSlab, doorState, buildBlock } from './world.js';

export const MATERIALS = Object.freeze([
  { id: GRASS, name: 'Grass', style: 'grass' }, { id: DIRT, name: 'Dirt', style: 'dirt' },
  { id: STONE, name: 'Stone', style: 'stone' }, { id: WOOD, name: 'Wood', style: 'wood' },
  { id: LEAVES, name: 'Leaves', style: 'leaves' }, { id: SAND, name: 'Sand', style: 'sand' },
  { id: PLANKS, name: 'Wooden planks', style: 'planks' }, { id: BRICKS, name: 'Bricks', style: 'bricks' },
  { id: GLASS, name: 'Glass', style: 'glass' }, { id: DOOR, name: 'Wooden door', style: 'door' },
  { id: LANTERN, name: 'Lantern', style: 'lantern' }, { id: SLAB, name: 'Wooden slab', style: 'slab' },
  { id: RED_FLOWER, name: 'Red flower', style: 'flower' }, { id: YELLOW_FLOWER, name: 'Yellow flower', style: 'flower' },
  { id: DAISY, name: 'Daisy', style: 'flower' },
  { id: WARD_LANTERN, name: 'Ward lantern', style: 'lantern' },
  { id: STONE_BRICKS, name: 'Stone bricks', style: 'stone' },
  { id: BRACED_TIMBER, name: 'Braced timber', style: 'wood' },
  { id: WOODEN_CHEST, name: 'Wooden chest', style: 'wood' },
  { id: BRACED_DOOR, name: 'Braced wooden door', style: 'door' },
  { id: SAPLING, name: 'Sapling', style: 'sapling' },
  { id: WOODEN_PEGS, name: 'Wooden pegs', style: 'wood' },
  { id: CHARCOAL, name: 'Charcoal', style: 'stone' },
  { id: STONE_HAMMER, name: 'Stone hammer', style: 'stone' },
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
  { block: STONE_BRICKS, amount: 4, needs: [[STONE, 4]] },
  { block: BRACED_TIMBER, amount: 2, needs: [[PLANKS, 4], [WOODEN_PEGS, 1]] },
  { block: WOODEN_CHEST, amount: 1, needs: [[PLANKS, 8]] },
  { block: BRACED_DOOR, amount: 1, needs: [[BRACED_TIMBER, 6]] },
  { block: SAPLING, amount: 1, needs: [[LEAVES, 1]] },
  { block: WOODEN_PEGS, amount: 4, needs: [[PLANKS, 2]] },
  { block: CHARCOAL, amount: 2, needs: [[WOOD, 1], [STONE, 1]] },
  { block: STONE_HAMMER, amount: 1, needs: [[STONE, 2], [PLANKS, 2]] },
];
export const INVENTORY_SIZE = 36;
export const CRAFTING_SIZE = 9;
// A cell normally costs one item. The ward's heavier fittings use two per cell.
const patterns = new Map([
  [PLANKS, [[WOOD]]],
  [BRICKS, [[STONE, STONE, STONE], [0, STONE, 0]]],
  [GLASS, [[SAND, SAND]]],
  [DOOR, [[PLANKS, PLANKS], [PLANKS, PLANKS], [PLANKS, PLANKS]]],
  [SLAB, [[PLANKS, PLANKS, PLANKS]]],
  [LANTERN, [[0, STONE, 0], [STONE, GLASS, STONE], [0, WOOD, STONE]]],
  [WARD_LANTERN, [[[STONE, 2], [WOOD, 2], [STONE, 2]], [0, [GLASS, 2], 0], [[STONE, 2], 0, [STONE, 2]]]],
  [STONE_BRICKS, [[STONE, STONE], [STONE, STONE]]],
  [BRACED_TIMBER, [[PLANKS, WOODEN_PEGS, PLANKS], [PLANKS, 0, PLANKS]]],
  [WOODEN_CHEST, [[PLANKS, PLANKS, PLANKS], [PLANKS, 0, PLANKS], [PLANKS, PLANKS, PLANKS]]],
  [BRACED_DOOR, [[BRACED_TIMBER, BRACED_TIMBER], [BRACED_TIMBER, BRACED_TIMBER], [BRACED_TIMBER, BRACED_TIMBER]]],
  [SAPLING, [[LEAVES]]],
  [WOODEN_PEGS, [[PLANKS], [PLANKS]]],
  [CHARCOAL, [[WOOD], [STONE]]],
  [STONE_HAMMER, [[STONE, STONE], [0, PLANKS], [0, PLANKS]]],
]);
for (const recipe of RECIPES) recipe.pattern = patterns.get(recipe.block).map(row => row.map(cell => !cell ? null : { block: Array.isArray(cell) ? cell[0] : cell, count: Array.isArray(cell) ? cell[1] : 1 }));

export function matchCrafting(grid) {
  if (!Array.isArray(grid) || grid.length !== CRAFTING_SIZE || !Array.from(grid).every(validStack)) return null;
  for (const recipe of RECIPES) {
    const height = recipe.pattern.length, width = recipe.pattern[0].length;
    for (let y = 0; y <= 3 - height; y++) for (let x = 0; x <= 3 - width; x++) for (const mirrored of [false, true]) {
      const costs = Array(CRAFTING_SIZE).fill(0);
      const matches = grid.every((stack, index) => {
        const row = Math.floor(index / 3) - y, column = index % 3 - x;
        const cell = row >= 0 && row < height && column >= 0 && column < width ? recipe.pattern[row][mirrored ? width - 1 - column : column] : null;
        if (!cell) return stack === null;
        costs[index] = cell.count;
        return stack?.block === cell.block && stack.count >= cell.count;
      });
      if (matches) return { recipe, costs };
    }
  }
  return null;
}
const clone = stack => stack ? { ...stack } : null;
const sameStack = (a, b) => a === null ? b === null : !!a && !!b && a.block === b.block && a.count === b.count;
export const validStack = stack => stack === null || !!stack && items.has(stack.block) && Number.isInteger(stack.count) && stack.count > 0 && stack.count <= STACK_LIMIT;
const validIndex = index => Number.isInteger(index) && index >= 0 && index < INVENTORY_SIZE + CRAFTING_SIZE;
export const emptyGatherInventory = () => ({ version: 3, mode: 'gather', stacks: Array(INVENTORY_SIZE).fill(null), selected: 0 });

export function validInventory(value) {
  if (!value || !Number.isInteger(value.selected) || value.selected < 0 || value.selected >= 9) return false;
  if (value.version === 3) return value.mode === 'gather' && Array.isArray(value.stacks) && value.stacks.length === INVENTORY_SIZE && Array.from(value.stacks).every(validStack)
    && (value.crafting === undefined || Array.isArray(value.crafting) && value.crafting.length === CRAFTING_SIZE && Array.from(value.crafting).every(validStack));
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
    this.crafting = valid && saved.version === 3 && saved.crafting ? saved.crafting.map(clone) : Array(CRAFTING_SIZE).fill(null);
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
  slot(index) { return index < INVENTORY_SIZE ? this.stacks[index] : this.crafting[index - INVENTORY_SIZE]; }
  setSlot(index, stack) { if (index < INVENTORY_SIZE) this.stacks[index] = stack; else this.crafting[index - INVENTORY_SIZE] = stack; }
  slotCount(index) { return this.slot(index)?.count || 0; }
  snapshot() {
    return { version: 3, mode: 'gather', stacks: this.stacks.map(clone), crafting: this.crafting.map(clone), selected: this.selected };
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
  plan(changes, spendSlot, collect = true) {
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
    const collected = [...delta].filter(([, amount]) => amount > 0);
    if (!collect) for (const [block] of collected) delta.delete(block);
    return { ...this.balance(delta, spendSlot), collected };
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
  clearCrafting() {
    const delta = new Map();
    for (const stack of this.crafting) if (stack) delta.set(stack.block, (delta.get(stack.block) || 0) + stack.count);
    const result = this.balance(delta);
    if (result.ok) { this.applyBalance(result); this.crafting.fill(null); }
    return result.ok ? { ok: true } : result;
  }
  fillRecipe(block, all = false) {
    const recipe = RECIPES.find(recipe => recipe.block === block);
    if (!recipe) return { ok: false, reason: 'invalid' };
    const draft = new Inventory(this.snapshot());
    const returned = draft.clearCrafting();
    if (!returned.ok) return returned;
    const batches = all ? Math.min(...recipe.needs.map(([id, count]) => Math.floor(draft.count(id) / count)),
      ...recipe.pattern.flat().filter(Boolean).map(cell => Math.floor(STACK_LIMIT / cell.count))) : 1;
    if (!batches) return { ok: false, reason: 'supplies' };
    const ingredients = draft.balance(new Map(recipe.needs.map(([id, count]) => [id, -count * batches])));
    if (!ingredients.ok) return ingredients;
    draft.applyBalance(ingredients);
    recipe.pattern.forEach((row, y) => row.forEach((cell, x) => { draft.crafting[y * 3 + x] = cell ? { block: cell.block, count: cell.count * batches } : null; }));
    this.stacks = draft.stacks; this.crafting = draft.crafting;
    return { ok: true };
  }
  craftGrid(all = false, target) {
    const match = matchCrafting(this.crafting);
    if (!match) return { ok: false, reason: 'recipe' };
    const { recipe, costs } = match, draft = new Inventory(this.snapshot());
    let batches = 0, outputSlot = target;
    if (target !== undefined && (!Number.isInteger(target) || target < 0 || target >= INVENTORY_SIZE || this.stacks[target]?.block !== recipe.block)) return { ok: false, reason: 'changed' };
    for (let batch = 0; batch < (all ? STACK_LIMIT : 1); batch++) {
      if (costs.some((cost, i) => cost && (draft.crafting[i]?.count || 0) < cost)) break;
      if (all) {
        const result = draft.balance(new Map([[recipe.block, recipe.amount]]));
        if (!result.ok) break;
        draft.applyBalance(result);
      } else {
        // One click produces one cursor stack; never split it across storage slots.
        outputSlot ??= draft.stacks.findIndex(stack => stack?.block === recipe.block && stack.count + recipe.amount <= STACK_LIMIT);
        if (outputSlot === -1) outputSlot = draft.stacks.findIndex(stack => !stack);
        if (outputSlot === -1 || (draft.stacks[outputSlot]?.count || 0) + recipe.amount > STACK_LIMIT) break;
        draft.stacks[outputSlot] = { block: recipe.block, count: (draft.stacks[outputSlot]?.count || 0) + recipe.amount };
      }
      costs.forEach((cost, i) => { if (cost) { draft.crafting[i].count -= cost; if (!draft.crafting[i].count) draft.crafting[i] = null; } });
      batches++;
    }
    if (!batches) return { ok: false, reason: 'inventory_full' };
    this.stacks = draft.stacks; this.crafting = draft.crafting;
    return { ok: true, block: recipe.block, amount: batches * recipe.amount, batches, source: all ? undefined : outputSlot };
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
    const from = this.slot(source), to = this.slot(target);
    if (!from || amount > from.count) return { ok: false, reason: 'changed' };
    if (to && to.block !== from.block) {
      if (!swap || amount !== from.count) return { ok: false, reason: 'occupied' };
      this.setSlot(source, to); this.setSlot(target, from); return { ok: true, moved: amount, swapped: true };
    }
    const moved = Math.min(amount, STACK_LIMIT - (to?.count || 0));
    if (!moved) return { ok: false, reason: 'inventory_full' };
    this.setSlot(target, { block: from.block, count: (to?.count || 0) + moved });
    from.count -= moved; if (!from.count) this.setSlot(source, null);
    return { ok: true, moved };
  }
  quickMove(source) {
    if (!this.stacks || !validIndex(source) || !this.slot(source)) return { ok: false, reason: 'invalid' };
    const indices = source >= INVENTORY_SIZE ? [...Array.from({ length: 27 }, (_, i) => i + 9), ...Array.from({ length: 9 }, (_, i) => i)]
      : source < 9 ? Array.from({ length: 27 }, (_, i) => i + 9) : Array.from({ length: 9 }, (_, i) => i);
    let moved = 0;
    for (const i of [...indices.filter(i => this.stacks[i]?.block === this.slot(source).block), ...indices.filter(i => !this.stacks[i])]) {
      const result = this.move(source, i, this.slot(source).count, false); if (result.ok) moved += result.moved;
      if (!this.slot(source)) break;
    }
    return moved ? { ok: true, moved } : { ok: false, reason: 'inventory_full' };
  }
  action(args) {
    if (!this.stacks) return { ok: false, reason: 'invalid' };
    if (['craftGrid', 'fillRecipe', 'clearCrafting'].includes(args.action)) {
      if (!Array.isArray(args.expectedCrafting) || args.expectedCrafting.length !== CRAFTING_SIZE
        || !Array.from(args.expectedCrafting).every((stack, i) => sameStack(this.crafting[i], stack))) return { ok: false, reason: 'changed' };
      if (args.action === 'fillRecipe') return this.fillRecipe(args.block, args.all === true);
      if (args.action === 'clearCrafting') return this.clearCrafting();
      if (args.target !== undefined && !sameStack(this.stacks[args.target], args.expectedTarget)) return { ok: false, reason: 'changed' };
      return this.craftGrid(args.all === true, args.target);
    }
    if (args.action === 'select') { if (!Number.isInteger(args.index) || args.index < 0 || args.index >= 9) return { ok: false, reason: 'invalid' }; this.select(args.index); return { ok: true }; }
    if (args.action === 'pick') { if (!this.count(args.block)) return { ok: false, reason: 'supplies' }; if (Number.isInteger(args.slot)) this.select(args.slot); this.pick(args.block); return { ok: true }; }
    const { source, target } = args;
    if (!validIndex(source) || !sameStack(this.slot(source), args.expectedSource)) return { ok: false, reason: 'changed' };
    if (args.action === 'quickMove') return this.quickMove(source);
    if (args.action !== 'move' || !validIndex(target) || !sameStack(this.slot(target), args.expectedTarget)) return { ok: false, reason: 'changed' };
    return this.move(source, target, args.amount, args.swap !== false);
  }
}
