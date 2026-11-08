export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const WOOD = 4;
export const LEAVES = 5;
export const SAND = 6;
export const WATER = 7;
export const PLANKS = 8;
export const BRICKS = 9;
export const GLASS = 10;
export const DOOR = 11;
// Door states occupy IDs 11–26.
export const LANTERN = 27;
export const SLAB = 28;
export const UPPER_SLAB = 29;
export const RED_FLOWER = 30;
export const YELLOW_FLOWER = 31;
export const DAISY = 32;
export const WARD_LANTERN = 33;
export const STONE_BRICKS = 34;
export const BRACED_TIMBER = 35;
export const WOODEN_CHEST = 36;
export const BRACED_DOOR = 37; // States occupy IDs 37–52.
// Keep the original cabinet ID facing +Z. Other orientations use IDs 53–55.
const CABINET_STATES = Object.freeze([WOODEN_CHEST, 53, 54, 55]);
export const SAPLING = 56;
export const YOUNG_SAPLING = 57;
export const TALL_SAPLING = 58;
export const SALVAGE_CRATE = 59;
// Inventory-only items never enter terrain data.
export const WOODEN_PEGS = 60;
export const CHARCOAL = 61;
export const STONE_HAMMER = 62;
// Legacy exported names retain their numeric save/network IDs.
export const CONCRETE = STONE_BRICKS;
export const REINFORCED_PANEL = BRACED_TIMBER;
export const STORAGE_CABINET = WOODEN_CHEST;
export const SECURITY_DOOR = BRACED_DOOR;
export const SCRAP = WOODEN_PEGS;
export const BIOFUEL = CHARCOAL;
export const REPAIR_TOOL = STONE_HAMMER;
export const FLOWER_TYPES = [RED_FLOWER, YELLOW_FLOWER, DAISY];
export const FLOWER_COLORS = {
  [RED_FLOWER]: { petals: 0xe8616c, center: 0xffcf68 },
  [YELLOW_FLOWER]: { petals: 0xffd65c, center: 0xb66c36 },
  [DAISY]: { petals: 0xfffae5, center: 0xf5b83b },
};
export const BUILD_BLOCKS = [GRASS, DIRT, STONE, WOOD, LEAVES, SAND, PLANKS, BRICKS, GLASS, DOOR, LANTERN, WARD_LANTERN, SLAB, RED_FLOWER, STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR];
const BLOCK_TYPES = new Set([AIR, WATER, UPPER_SLAB, ...FLOWER_TYPES, ...BUILD_BLOCKS, ...CABINET_STATES, SAPLING, YOUNG_SAPLING, TALL_SAPLING, SALVAGE_CRATE, ...[DOOR, BRACED_DOOR].flatMap(base => Array.from({ length: 16 }, (_, i) => base + i))]);
export const SIZE = 64;
export const HEIGHT = 24;
const SPAWN_X = Math.floor(SIZE / 2);
const SPAWN_Z = Math.floor(SIZE * 0.72);

export function isSolid(block) {
  return block !== AIR && block !== WATER && !isPlant(block);
}

export const isSapling = block => block >= SAPLING && block <= TALL_SAPLING && Number.isInteger(block);
export const isPlant = block => isFlower(block) || isSapling(block);
export const isFlower = block => FLOWER_TYPES.includes(block);
export const isFlowerSoil = block => block === GRASS || block === DIRT;
export const isBlock = block => BLOCK_TYPES.has(block);
export const isDoor = block => Number.isInteger(block) && (block >= DOOR && block < DOOR + 16 || block >= BRACED_DOOR && block < BRACED_DOOR + 16);
export const doorType = block => block >= BRACED_DOOR && block < BRACED_DOOR + 16 ? BRACED_DOOR : DOOR;
export const isSlab = block => block === SLAB || block === UPPER_SLAB;
export const isLantern = block => block === LANTERN || block === WARD_LANTERN;
export const isCabinet = block => CABINET_STATES.includes(block);
export const cabinetFacing = block => CABINET_STATES.indexOf(block);
// Front directions follow the door convention: +Z, -X, -Z, +X.
export const cabinetBlock = facing => CABINET_STATES[(facing % 4 + 4) % 4];
export const cabinetBlockFromYaw = yaw => cabinetBlock(Math.round(-yaw / (Math.PI / 2)));
export const buildBlock = block => isDoor(block) ? doorType(block) : isSlab(block) ? SLAB : isCabinet(block) ? WOODEN_CHEST : isSapling(block) ? SAPLING : block;
export const isOpaque = block => isSolid(block) && block !== GLASS && !isLantern(block) && !isDoor(block) && !isSlab(block);
// Fixtures sit on a cell's upper surface, which lower slabs do not reach.
export const isSupport = block => isSolid(block) && !isLantern(block) && block !== SLAB && !isDoor(block);

export function doorBlock(facing, open = false, upper = false, type = DOOR) {
  return type + ((facing % 4 + 4) % 4) * 2 + Number(open) + Number(upper) * 8;
}

export function doorState(block) {
  if (!isDoor(block)) return null;
  const state = block - doorType(block);
  return { facing: Math.floor(state % 8 / 2), open: Boolean(state % 2), upper: state >= 8 };
}

export function blockBounds(block, x, y, z) {
  const b = { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
  const door = doorState(block);
  if (door) {
    const side = (door.facing + Number(door.open)) % 4;
    if (side === 0) b.minZ = z + 0.8125;
    if (side === 1) b.maxX = x + 0.1875;
    if (side === 2) b.maxZ = z + 0.1875;
    if (side === 3) b.minX = x + 0.8125;
  }
  if (isLantern(block)) {
    b.minX += 0.25; b.maxX -= 0.25;
    b.minZ += 0.25; b.maxZ -= 0.25;
    b.maxY = y + 0.92;
  }
  if (block === SLAB) b.maxY = y + 0.5;
  if (block === UPPER_SLAB) b.minY = y + 0.5;
  if (isPlant(block)) {
    b.minX += 0.2; b.maxX -= 0.2;
    b.minZ += 0.2; b.maxZ -= 0.2;
    b.maxY = y + (isSapling(block) ? .5 + (block - SAPLING) * .2 : .64);
  }
  return b;
}

export function lanternParts(x, y, z) {
  return [
    { minX: x + 0.25, maxX: x + 0.75, minY: y, maxY: y + 0.7, minZ: z + 0.25, maxZ: z + 0.75 },
    { minX: x + 0.38, maxX: x + 0.44, minY: y + 0.7, maxY: y + 0.86, minZ: z + 0.47, maxZ: z + 0.53 },
    { minX: x + 0.56, maxX: x + 0.62, minY: y + 0.7, maxY: y + 0.86, minZ: z + 0.47, maxZ: z + 0.53 },
    { minX: x + 0.38, maxX: x + 0.62, minY: y + 0.86, maxY: y + 0.92, minZ: z + 0.47, maxZ: z + 0.53 },
  ];
}

export function flowerParts(block, x, y, z) {
  if (isSapling(block)) {
    const stage = block - SAPLING, height = .5 + stage * .2, spread = .14 + stage * .06;
    return [
      { minX: x + .46, maxX: x + .54, minY: y, maxY: y + height, minZ: z + .46, maxZ: z + .54, color: 0x6c7564 },
      { minX: x + .5 - spread, maxX: x + .5 + spread, minY: y + height * .4, maxY: y + height, minZ: z + .5 - spread, maxZ: z + .5 + spread, color: 0x639878 },
    ];
  }
  const { petals, center } = FLOWER_COLORS[block];
  const box = (minX, minY, minZ, maxX, maxY, maxZ, color) => ({ minX: x + minX, minY: y + minY, minZ: z + minZ, maxX: x + maxX, maxY: y + maxY, maxZ: z + maxZ, color });
  return [
    box(0.46, 0, 0.46, 0.54, 0.51, 0.54, 0x568342),
    box(0.3, 0.16, 0.46, 0.46, 0.23, 0.54, 0x709c48),
    box(0.54, 0.29, 0.46, 0.7, 0.36, 0.54, 0x709c48),
    box(0.2, 0.49, 0.4, 0.4, 0.6, 0.6, petals),
    box(0.6, 0.49, 0.4, 0.8, 0.6, 0.6, petals),
    box(0.4, 0.49, 0.2, 0.6, 0.6, 0.4, petals),
    box(0.4, 0.49, 0.6, 0.6, 0.6, 0.8, petals),
    box(0.4, 0.49, 0.4, 0.6, 0.64, 0.6, center),
  ];
}

export function overlapsBlock(player, x, y, z, block) {
  const b = blockBounds(block, x, y, z);
  return player.x + PLAYER_RADIUS > b.minX && player.x - PLAYER_RADIUS < b.maxX
    && player.y + PLAYER_HEIGHT > b.minY && player.y < b.maxY
    && player.z + PLAYER_RADIUS > b.minZ && player.z - PLAYER_RADIUS < b.maxZ;
}

function treeSeed(x, z) {
  let seed = Math.imul(x + 11, 374761393) ^ Math.imul(z + 17, 668265263);
  seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
  return (seed ^ (seed >>> 16)) >>> 0;
}

export class World {
  constructor({ generate = true } = {}) {
    this.serial = 0;
    this.shelterRevisions = new Map();
    this.wardChunks = new Map();
    this.blocks = new Uint8Array(SIZE * HEIGHT * SIZE);
    if (generate) this.generate();
  }

  contains(x, y, z) {
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
      && x >= 0 && x < SIZE && y >= 0 && y < HEIGHT && z >= 0 && z < SIZE;
  }

  get(x, y, z) {
    return this.contains(x, y, z) ? this.blocks[x + SIZE * (z + SIZE * y)] : AIR;
  }

  set(x, y, z, block) {
    if (!this.contains(x, y, z) || !BLOCK_TYPES.has(block)) return false;
    if (this.get(x, y, z) === block) return true;
    this.blocks[x + SIZE * (z + SIZE * y)] = block;
    this.serial++;
    this.touchShelter(x, y, z, block);
    return true;
  }

  touchShelter(x, y, z, block) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), section = `${cx},${Math.floor(y / 4)},${cz}`;
    this.shelterRevisions.set(section, (this.shelterRevisions.get(section) || 0) + 1);
    const chunk = `${cx},${cz}`, cell = x % 16 + 16 * (z % 16 + 16 * y);
    if (block === WARD_LANTERN) {
      if (!this.wardChunks.has(chunk)) this.wardChunks.set(chunk, new Map());
      this.wardChunks.get(chunk).set(cell, { x, y, z });
    } else {
      const wards = this.wardChunks.get(chunk);
      wards?.delete(cell);
      if (wards?.size === 0) this.wardChunks.delete(chunk);
    }
  }

  touchShelterChunk(cx, cz) {
    for (let sy = 0; sy < HEIGHT / 4; sy++) {
      const section = `${cx},${sy},${cz}`;
      this.shelterRevisions.set(section, (this.shelterRevisions.get(section) || 0) + 1);
    }
  }

  doorAt(x, y, z) {
    const state = doorState(this.get(x, y, z));
    if (!state) return null;
    const baseY = y - Number(state.upper);
    const type = doorType(this.get(x, y, z));
    const bottom = doorBlock(state.facing, state.open, false, type);
    const top = doorBlock(state.facing, state.open, true, type);
    if (this.get(x, baseY, z) !== bottom || this.get(x, baseY + 1, z) !== top) return null;
    return { x, y: baseY, z, facing: state.facing, open: state.open, bottom, top };
  }

  doors() {
    const doors = [];
    for (let i = 0; i < this.blocks.length; i++) {
      const state = doorState(this.blocks[i]);
      if (!state || state.upper) continue;
      const door = this.doorAt(i % SIZE, Math.floor(i / (SIZE * SIZE)), Math.floor(i / SIZE) % SIZE);
      if (door) doors.push(door);
    }
    return doors;
  }

  surface(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const block = this.get(x, y, z);
      if (block && !isPlant(block)) return blockBounds(block, x, y, z).maxY;
    }
    return 0;
  }

  generate() {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const hill = 2.2 * Math.sin(x * 0.13) * Math.cos(z * 0.12)
          + 1.4 * Math.sin((x + z) * 0.16) + 0.6 * Math.cos(z * 0.38);
        const top = Math.floor(5 + hill);
        for (let y = 0; y <= top; y++) {
          this.set(x, y, z, y === 0 ? STONE : y === top ? GRASS : y >= top - 2 ? DIRT : STONE);
        }
      }
    }
    this.generatePonds();
    this.generateTrees();
    this.generateFlowers();
  }

  generatePonds() {
    for (const { x: cx, z: cz, rx, rz } of [
      { x: 25, z: 33, rx: 6, rz: 5 },
      { x: 46, z: 21, rx: 7, rz: 5 },
      { x: 13, z: 15, rx: 5, rz: 4 },
    ]) {
      const waterY = Math.max(2, this.surface(cx, cz) - 1);
      for (let z = Math.floor(cz - rz * 1.7); z <= cz + rz * 1.7; z++) {
        for (let x = Math.floor(cx - rx * 1.7); x <= cx + rx * 1.7; x++) {
          if (!this.contains(x, 0, z)) continue;
          const radius = Math.hypot((x - cx) / rx, (z - cz) / rz)
            + 0.045 * Math.sin(x * 0.8 + z * 0.5);
          if (radius > 1.6) continue;
          const wet = radius < 0.85;
          const sandy = radius <= 1.15;
          const oldTop = this.surface(x, z) - 1;
          const top = wet ? waterY - 1 : sandy ? waterY
            : Math.round(waterY + (oldTop - waterY) * (radius - 1.15) / 0.45);
          for (let y = 1; y < HEIGHT; y++) {
            this.set(x, y, z, y > top ? AIR : y === top ? (sandy ? SAND : GRASS)
              : y >= top - 2 ? DIRT : STONE);
          }
          if (wet) this.set(x, waterY, z, WATER);
        }
      }
    }
  }

  generateTrees() {
    // Jitter a sparse grid for natural spacing, with a small clearing at spawn.
    for (let gridZ = 5; gridZ < SIZE - 7; gridZ += 8) {
      for (let gridX = 5; gridX < SIZE - 7; gridX += 8) {
        const seed = treeSeed(gridX, gridZ);
        if (seed % 5 === 0) continue;
        const x = gridX + seed % 4;
        const z = gridZ + (seed >>> 3) % 4;
        if (Math.hypot(x - SPAWN_X, z - SPAWN_Z) < 7) continue;
        const base = this.surface(x, z);
        const trunkHeight = 4 + (seed >>> 8) % 2;
        if (this.get(x, base - 1, z) !== GRASS || base + trunkHeight + 1 >= HEIGHT) continue;
        for (let y = base; y < base + trunkHeight; y++) this.set(x, y, z, WOOD);
        for (let layer = -2; layer <= 1; layer++) {
          const radius = layer < 0 ? 2 : 1;
          for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.abs(dx) + Math.abs(dz) > (layer === 1 ? 1 : radius * 2 - 1)) continue;
              const y = base + trunkHeight + layer;
              if (!this.get(x + dx, y, z + dz)) this.set(x + dx, y, z + dz, LEAVES);
            }
          }
        }
      }
    }
  }

  generateFlowers() {
    for (let z = 1; z < SIZE - 1; z++) for (let x = 1; x < SIZE - 1; x++) {
      if (Math.hypot(x - SPAWN_X, z - SPAWN_Z) < 2.5) continue;
      const seed = treeSeed(x + 91, z + 47);
      const patch = Math.sin(x * 0.32) + Math.cos(z * 0.38);
      if (patch < -0.2 || seed % 19 > 1) continue;
      const y = this.surface(x, z);
      if (y < HEIGHT && this.get(x, y - 1, z) === GRASS && this.get(x, y, z) === AIR) {
        this.set(x, y, z, FLOWER_TYPES[(seed >>> 9) % FLOWER_TYPES.length]);
      }
    }
  }
}

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.6;
const EPSILON = 0.00001;

export function overlapsPlayer(player, x, y, z) {
  return player.x + PLAYER_RADIUS > x && player.x - PLAYER_RADIUS < x + 1
    && player.y + PLAYER_HEIGHT > y && player.y < y + 1
    && player.z + PLAYER_RADIUS > z && player.z - PLAYER_RADIUS < z + 1;
}

export function spawnPlayer(world) {
  const x = world.spawn?.x ?? SPAWN_X;
  const z = world.spawn?.z ?? SPAWN_Z;
  const waiting = world.isAreaReady && !world.isAreaReady(x + 0.5, z + 0.5);
  return { x: x + 0.5, y: waiting ? HEIGHT + 2 : world.surface(x, z) + 0.01, z: z + 0.5, vy: 0, grounded: false, flying: false };
}

function moveAxis(player, world, axis, amount) {
  if (amount === 0) return;
  player[axis] += amount;
  const minX = Math.floor(player.x - PLAYER_RADIUS + EPSILON);
  const maxX = Math.floor(player.x + PLAYER_RADIUS - EPSILON);
  const minY = Math.floor(player.y + EPSILON);
  const maxY = Math.floor(player.y + PLAYER_HEIGHT - EPSILON);
  const minZ = Math.floor(player.z - PLAYER_RADIUS + EPSILON);
  const maxZ = Math.floor(player.z + PLAYER_RADIUS - EPSILON);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const block = world.get(x, y, z);
        if (!isSolid(block) || !overlapsBlock(player, x, y, z, block)) continue;
        const b = blockBounds(block, x, y, z);
        if (axis === 'y') {
          player.y = amount > 0 ? b.minY - PLAYER_HEIGHT : b.maxY;
          player.vy = 0;
          if (amount < 0) player.grounded = true;
        } else {
          player[axis] = amount > 0 ? b[axis === 'x' ? 'minX' : 'minZ'] - PLAYER_RADIUS
            : b[axis === 'x' ? 'maxX' : 'maxZ'] + PLAYER_RADIUS;
        }
      }
    }
  }
}

function collides(player, world) {
  for (let y = Math.floor(player.y + EPSILON); y <= Math.floor(player.y + PLAYER_HEIGHT - EPSILON); y++) {
    for (let z = Math.floor(player.z - PLAYER_RADIUS + EPSILON); z <= Math.floor(player.z + PLAYER_RADIUS - EPSILON); z++) {
      for (let x = Math.floor(player.x - PLAYER_RADIUS + EPSILON); x <= Math.floor(player.x + PLAYER_RADIUS - EPSILON); x++) {
        const block = world.get(x, y, z);
        if (isSolid(block) && overlapsBlock(player, x, y, z, block)) return true;
      }
    }
  }
  return false;
}

function moveHorizontal(player, world, axis, amount, canStep) {
  const start = { ...player };
  moveAxis(player, world, axis, amount);
  if (!canStep || Math.abs(player[axis] - start[axis] - amount) < EPSILON) return;
  // Try a half-block rise only when walking on the ground. Check the entire
  // raised body before moving sideways so a low ceiling cannot be bypassed.
  const raised = { ...start, y: start.y + 0.5, grounded: false };
  if (collides(raised, world)) return;
  moveAxis(raised, world, axis, amount);
  if (Math.abs(raised[axis] - start[axis]) <= Math.abs(player[axis] - start[axis]) + EPSILON) return;
  moveAxis(raised, world, 'y', -0.5 - EPSILON);
  if (raised.grounded && raised.y > start.y + EPSILON && !collides(raised, world)) Object.assign(player, raised);
}

// Run at 120 Hz so even a falling player moves less than a block per step.
export function stepPlayer(player, world, { forward = 0, strafe = 0, yaw = 0, jump = false, sprint = false, rise = 0 }, dt) {
  const vertical = player.flying ? rise : 0;
  const length = Math.max(1, Math.hypot(forward, strafe, vertical));
  const inWater = world.get(Math.floor(player.x), Math.floor(player.y + 0.1), Math.floor(player.z)) === WATER;
  const speed = player.flying ? (sprint ? 10 : 6) : inWater ? 2.8 : sprint ? 7.5 : 4.5;
  const dx = (Math.cos(yaw) * strafe - Math.sin(yaw) * forward) / length;
  const dz = (-Math.sin(yaw) * strafe - Math.cos(yaw) * forward) / length;
  if (world.isAreaReady && (!world.isAreaReady(player.x, player.z) || !world.isAreaReady(player.x + dx * speed * dt, player.z + dz * speed * dt))) {
    player.vy = 0;
    return;
  }
  if (player.flying) {
    player.vy = 0;
    moveAxis(player, world, 'x', dx * speed * dt);
    moveAxis(player, world, 'z', dz * speed * dt);
    moveAxis(player, world, 'y', vertical / length * speed * dt);
    player.y = Math.min(player.y, HEIGHT + 12);
    player.grounded = false;
    return;
  }
  if (jump && player.grounded) {
    player.vy = 8;
    player.grounded = false;
  }
  player.vy = Math.max(player.vy - 24 * dt, -30);
  const canStep = player.grounded && player.vy <= 0;
  const startY = player.y;
  player.grounded = false;
  moveHorizontal(player, world, 'x', dx * speed * dt, canStep);
  moveHorizontal(player, world, 'z', dz * speed * dt, canStep && player.y <= startY + EPSILON);
  moveAxis(player, world, 'y', player.vy * dt);
}
