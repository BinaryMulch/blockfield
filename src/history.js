import { AIR, WATER, LANTERN, isBlock, isDoor, isFlower, isFlowerSoil, doorBlock, doorState, isSolid, isSupport, overlapsBlock } from './world.js';

export class EditHistory {
  undoStack = [];
  redoStack = [];

  constructor(world, limit = 128) {
    this.world = world;
    this.limit = limit;
  }

  apply(cells, forward, player) {
    const changes = cells.map(({ x, y, z, before, after }) => ({ x, y, z, from: forward ? before : after, to: forward ? after : before }));
    const future = new Map(changes.map(c => [`${c.x},${c.y},${c.z}`, c.to]));
    const get = (x, y, z) => future.has(`${x},${y},${z}`) ? future.get(`${x},${y},${z}`) : this.world.get(x, y, z);
    for (const c of changes) {
      if (!this.world.contains(c.x, c.y, c.z) || c.y === 0 || !isBlock(c.to)) return { ok: false, reason: 'invalid' };
      if (this.world.get(c.x, c.y, c.z) !== c.from) return { ok: false, reason: 'changed' };
      if (isSolid(c.to) && player && overlapsBlock(player, c.x, c.y, c.z, c.to)) return { ok: false, reason: 'blocked' };
      // Check fixtures and their support against the entire future edit.
      for (const y of [c.y - 1, c.y, c.y + 1]) {
        const block = get(c.x, y, c.z);
        if (block === LANTERN && !isSupport(get(c.x, y - 1, c.z))) return { ok: false, reason: 'invalid' };
        if (isFlower(block) && !isFlowerSoil(get(c.x, y - 1, c.z))) return { ok: false, reason: 'invalid' };
        const state = doorState(block);
        if (!state) continue;
        const base = y - Number(state.upper);
        if (get(c.x, base, c.z) !== doorBlock(state.facing, state.open)
          || get(c.x, base + 1, c.z) !== doorBlock(state.facing, state.open, true)
          || !isSupport(get(c.x, base - 1, c.z))) return { ok: false, reason: 'invalid' };
      }
    }
    // Every check finishes before any cell changes, keeping fixture edits atomic.
    const balance = this.inventory?.plan(changes, this.spendSlot);
    if (balance && !balance.ok) return balance;
    for (const c of changes) this.world.set(c.x, c.y, c.z, c.to);
    if (balance) this.inventory.applyBalance(balance);
    return { ok: true, changes, change: changes[0] };
  }

  commit(cells, player) {
    const result = this.apply(cells, true, player);
    if (!result.ok) return result;
    this.undoStack.push(cells);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return result;
  }

  edit(x, y, z, after, player) {
    const before = this.world.get(x, y, z);
    if (before === after) return { ok: false, reason: 'unchanged' };
    if (isDoor(after)) return { ok: false, reason: 'invalid' };
    const door = this.world.doorAt(x, y, z);
    if (door) {
      if (after !== AIR) return { ok: false, reason: 'invalid' };
      return this.commit([
        { x, y: door.y, z, before: door.bottom, after: AIR },
        { x, y: door.y + 1, z, before: door.top, after: AIR },
      ], player);
    }
    const cells = [{ x, y, z, before, after }];
    const above = this.world.doorAt(x, y + 1, z);
    if (!isSupport(after) && above?.y === y + 1) {
      cells.push({ x, y: above.y, z, before: above.bottom, after: AIR }, { x, y: above.y + 1, z, before: above.top, after: AIR });
    }
    if (!isSupport(after) && this.world.get(x, y + 1, z) === LANTERN) {
      cells.push({ x, y: y + 1, z, before: LANTERN, after: AIR });
    }
    const flower = this.world.get(x, y + 1, z);
    if (!isFlowerSoil(after) && isFlower(flower)) cells.push({ x, y: y + 1, z, before: flower, after: AIR });
    return this.commit(cells, player);
  }

  placeFlower(x, y, z, block, player) {
    if (!isFlower(block)) return { ok: false, reason: 'invalid' };
    const before = this.world.get(x, y, z);
    if (before !== AIR && !isFlower(before)) return { ok: false, reason: 'occupied' };
    return this.edit(x, y, z, block, player);
  }

  placeLantern(x, y, z, player) {
    const before = this.world.get(x, y, z);
    if (![AIR, WATER].includes(before) && !isFlower(before)) return { ok: false, reason: 'occupied' };
    return this.edit(x, y, z, LANTERN, player);
  }

  placeDoor(x, y, z, facing, player) {
    if (!Number.isInteger(facing) || facing < 0 || facing > 3) return { ok: false, reason: 'invalid' };
    const before = this.world.get(x, y, z), above = this.world.get(x, y + 1, z);
    if (![AIR, WATER].includes(before) && !isFlower(before) || ![AIR, WATER].includes(above) && !isFlower(above)) return { ok: false, reason: 'occupied' };
    return this.commit([
      { x, y, z, before, after: doorBlock(facing) },
      { x, y: y + 1, z, before: above, after: doorBlock(facing, false, true) },
    ], player);
  }

  toggleDoor(x, y, z, player) {
    const door = this.world.doorAt(x, y, z);
    if (!door) return { ok: false, reason: 'invalid' };
    return this.commit([
      { x, y: door.y, z, before: door.bottom, after: doorBlock(door.facing, !door.open) },
      { x, y: door.y + 1, z, before: door.top, after: doorBlock(door.facing, !door.open, true) },
    ], player);
  }

  undo(player) {
    const cells = this.undoStack.at(-1);
    if (!cells) return { ok: false, reason: 'empty' };
    const result = this.apply(cells, false, player);
    if (result.ok) { this.undoStack.pop(); this.redoStack.push(cells); }
    return result;
  }

  redo(player) {
    const cells = this.redoStack.at(-1);
    if (!cells) return { ok: false, reason: 'empty' };
    const result = this.apply(cells, true, player);
    if (result.ok) { this.redoStack.pop(); this.undoStack.push(cells); }
    return result;
  }
}
