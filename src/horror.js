import { AIR, DIRT, GRASS, CONCRETE, REINFORCED_PANEL, STORAGE_CABINET, SALVAGE_CRATE, LANTERN, GLASS, WARD_LANTERN, HEIGHT } from './world.js';

import { terrainColumn } from './generation.js';

export const GAME_MODE = 'horror';
export const RESTRICTED_COMMANDS = new Set(['time', 'undo', 'redo', 'fly']);

// An authored overlay, applied once to new worlds. Terrain generation stays at
// version 1, so old worlds and sparse terrain edits retain their exact meaning.
export function buildStarterCabin(world) {
  const x = Math.floor(world.size / 2) + 4, z = Math.floor(world.size / 2) - 5;
  const floor = 7;
  const write = (dx, y, dz, block) => world.set(x + dx, y, z + dz, block);
  // A level apron connects the entrance to the existing spawn clearing.
  for (let dz = -2; dz <= 8; dz++) for (let dx = -2; dx <= 8; dx++) {
    for (let y = 1; y < HEIGHT; y++) write(dx, y, dz, y < floor ? DIRT : y === floor ? GRASS : AIR);
  }
  for (let dz = 0; dz <= 6; dz++) for (let dx = 0; dx <= 6; dx++) {
    write(dx, floor, dz, CONCRETE);
    for (let y = floor + 1; y <= floor + 3; y++) {
      const edge = dx === 0 || dx === 6 || dz === 0 || dz === 6;
      const corner = (dx === 0 || dx === 6) && (dz === 0 || dz === 6);
      const doorway = dz === 6 && dx === 3 && y <= floor + 2;
      const damage = dx === 6 && dz >= 3 && dz <= 4 && y <= floor + 2;
      const window = y === floor + 2 && (dx === 2 || dx === 4) && dz === 0;
      if (edge && !doorway && !damage) write(dx, y, dz, corner ? CONCRETE : window ? GLASS : REINFORCED_PANEL);
    }
    // A missing roof patch is an obvious, reachable repair project.
    if (!(dx >= 4 && dz >= 3 && dz <= 4)) write(dx, floor + 4, dz, REINFORCED_PANEL);
  }
  write(1, floor + 1, 1, WARD_LANTERN);
  write(5, floor + 1, 1, STORAGE_CABINET);
  const salvage = [];
  for (const [dx, dz, name] of [[-28, 14, 'Maintenance yard'], [30, 14, 'Roadside station'], [8, -32, 'Abandoned worksite']]) {
    const sx = Math.floor(world.size / 2) + dx, sz = Math.floor(world.size / 2) + dz;
    const sy = terrainColumn(world.seed, sx, sz, world.size).top;
    for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
      for (let h = sy; h < HEIGHT; h++) world.set(sx + ox, h, sz + oz, h === sy ? CONCRETE : AIR);
    }
    world.set(sx, sy + 1, sz, SALVAGE_CRATE);
    world.set(sx - 2, sy + 1, sz - 2, CONCRETE);
    world.set(sx - 2, sy + 2, sz - 2, LANTERN);
    world.set(sx + 2, sy + 1, sz - 2, REINFORCED_PANEL);
    world.set(sx + 2, sy + 2, sz - 2, GLASS);
    salvage.push({ x: sx, y: sy + 1, z: sz, name });
  }
  return { version: 1, cabin: { x, y: floor, z }, salvage };
}

export function validHorrorState(state, size) {
  if (!state || state.version !== 1) return false;
  if (state.salvage !== undefined) {
    if (!Array.isArray(state.salvage) || state.salvage.length > 32) return false;
    const seen = new Set();
    for (const p of state.salvage) {
      if (!p || ![p.x, p.y, p.z].every(Number.isInteger) || p.x < 0 || p.x >= size || p.z < 0 || p.z >= size || p.y <= 0 || p.y >= HEIGHT || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || seen.has(`${p.x},${p.y},${p.z}`)) return false;
      seen.add(`${p.x},${p.y},${p.z}`);
    }
  }
  if (state.cabin === null) return true; // Migrated worlds keep their existing structures.
  const c = state.cabin;
  return c && [c.x, c.y, c.z].every(Number.isInteger) && c.x >= 0 && c.z >= 0
    && c.x + 6 < size && c.z + 6 < size && c.y > 0 && c.y + 4 < HEIGHT;
}
