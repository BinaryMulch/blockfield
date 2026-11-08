import * as THREE from 'three';
import { GRASS, DIRT, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, LANTERN, WARD_LANTERN, STONE_BRICKS, BRACED_TIMBER, BRACED_DOOR, WOODEN_PEGS, CHARCOAL, STONE_HAMMER, SALVAGE_CRATE, isSapling, buildBlock, FLOWER_COLORS, isDoor, isSlab, isCabinet, cabinetFacing, doorState } from './world.js';

export const TILE_SIZE = 16;
// Replicated borders keep neighboring materials out of the texture's mipmaps.
export const TILE_PADDING = 8;
export const TILE_STRIDE = TILE_SIZE + TILE_PADDING * 2;
export const ATLAS_WIDTH = TILE_STRIDE * 4;
export const ATLAS_HEIGHT = TILE_STRIDE * 8;
export const TILES = { GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, BARK: 4, WOOD_END: 5, LEAVES: 6, SAND: 7, WATER: 8, PLANKS: 9, BRICKS: 10, GLASS: 11, DOOR_BOTTOM: 12, DOOR_TOP: 13, LANTERN: 14, LANTERN_TOP: 15, WARD_LANTERN: 16, STONE_BRICKS: 17, BRACED_TIMBER: 18, CHEST_FRONT: 19, CHEST_SIDE: 20, CHEST_TOP: 21, BRACED_DOOR_BOTTOM: 22, BRACED_DOOR_TOP: 23, SAPLING: 24, WOODEN_PEGS: 25, CHARCOAL: 26, STONE_HAMMER: 27, SALVAGE_FRONT: 28, SALVAGE_SIDE: 29 };
const lanternFrame = (x, y) => x < 2 || x > 13 || y < 2 || y > 13 || x === 7 || x === 8;
const ITEM_TILES = new Set([TILES.SAPLING, TILES.WOODEN_PEGS, TILES.CHARCOAL, TILES.STONE_HAMMER]);

function itemPixel(tile, x, y) {
  const shape = (x, y) => {
    if (x < 0 || x > 15 || y < 0 || y > 15) return false;
    if (tile === TILES.SAPLING) return x >= 7 && x <= 8 && y >= 7 && y <= 14
      || Math.abs(x - 7) + Math.abs(y - 4) <= 4 || Math.abs(x - 4) + Math.abs(y - 7) <= 3 || Math.abs(x - 11) + Math.abs(y - 7) <= 3;
    if (tile === TILES.WOODEN_PEGS) return [[-3, 2, 10], [1, 3, 13], [5, 6, 14]].some(([offset, low, high]) => y >= low && y <= high && Math.abs(x - (y + offset)) <= 1);
    if (tile === TILES.CHARCOAL) return y >= 3 && y <= 13 && x >= 2 && x <= 13 && Math.abs(x - 8) + Math.abs(y - 8) <= 8 && !(x < 5 && y < 5) && !(x > 11 && y > 11);
    return x >= 6 && x <= 14 && y >= 2 && y <= 6 || y >= 6 && y <= 14 && Math.abs(x + y - 16) <= 1;
  };
  if (!shape(x, y)) return [0, 0, 0, 0];
  const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !shape(x + dx, y + dy));
  let color;
  if (tile === TILES.SAPLING) color = x >= 7 && x <= 8 && y >= 9 ? edge ? [87, 53, 24] : [171, 119, 55]
    : edge ? [31, 67, 24] : x + y < 12 ? [124, 184, 65] : [69, 136, 42];
  else if (tile === TILES.WOODEN_PEGS) color = edge ? [84, 48, 22] : y % 4 === 2 ? [235, 190, 112] : [193, 137, 65];
  else if (tile === TILES.CHARCOAL) color = edge ? [14, 17, 21] : y < 7 && x < 9 ? [99, 105, 111] : x + y < 18 ? [53, 58, 64] : [29, 33, 39];
  else color = y <= 6 ? edge ? [55, 59, 64] : y <= 3 ? [192, 198, 196] : [127, 139, 142]
    : edge ? [91, 54, 24] : [194, 138, 68];
  return [...shade(color, (noise(x, y, tile) - .5) * 10), 255];
}

function noise(x, y, seed) {
  let value = Math.imul(x + seed * 17, 374761393) ^ Math.imul(y + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function shade(color, amount) {
  return color.map(channel => Math.max(0, Math.min(255, Math.round(channel + amount))));
}

function grassPixel(x, y) {
  const n = noise(x, y, 1);
  const patch = noise(Math.floor(x / 2), Math.floor(y / 2), 2);
  return shade([133, 170, 83], (n - 0.5) * 18 + (patch - 0.5) * 15 + (n > 0.88 ? 13 : 0));
}

function dirtPixel(x, y) {
  const n = noise(x, y, 3);
  const grain = noise(Math.floor(x / 2), Math.floor(y / 2), 4);
  const pebble = n > 0.95 ? [166, 151, 123] : [158, 119, 80];
  return shade(pebble, (grain - 0.5) * 19 + (n - 0.5) * 14);
}

function texturePixel(tile, x, y) {
  switch (tile) {
    case TILES.GRASS_TOP:
      return grassPixel(x, y);
    case TILES.GRASS_SIDE: {
      const fringe = 3 + Math.floor(noise(x, 0, 5) * 3);
      return y < fringe ? shade(grassPixel(x, y), -8) : dirtPixel(x, y);
    }
    case TILES.DIRT:
      return dirtPixel(x, y);
    case TILES.STONE: {
      const patch = noise(Math.floor(x / 3), Math.floor(y / 3), 6);
      const crack = (y === 5 + Math.floor(x / 4) || y === 12 - Math.floor(x / 5))
        && noise(x, y, 7) > 0.35;
      return shade([153, 161, 158], (patch - 0.5) * 22 + (noise(x, y, 8) - 0.5) * 12 - (crack ? 22 : 0));
    }
    case TILES.BARK: {
      const groove = (x + Math.floor(y / 6)) % 5;
      const streak = groove === 0 ? -22 : groove === 1 ? 10 : 0;
      return shade([145, 109, 67], streak + (noise(x, Math.floor(y / 3), 9) - 0.5) * 15);
    }
    case TILES.WOOD_END: {
      const radius = Math.hypot(x - 7.5, (y - 7.5) * 1.05);
      const ring = Math.floor(radius + noise(x, y, 10) * 0.4) % 3 === 0;
      return shade([195, 161, 109], (ring ? -25 : 4) + (noise(x, y, 11) - 0.5) * 10);
    }
    case TILES.LEAVES: {
      const cluster = noise(Math.floor(x / 3), Math.floor(y / 3), 12);
      const edge = x % 3 === 0 || y % 3 === 0;
      return shade([86, 132, 62], (cluster - 0.5) * 33 + (noise(x, y, 13) - 0.5) * 14 + (edge ? -8 : 5));
    }
    case TILES.SAND: {
      const grain = noise(x, y, 14);
      return shade([214, 193, 142], (grain - 0.5) * 19 + (grain > 0.94 ? 10 : 0));
    }
    case TILES.WATER: {
      const ripple = Math.sin(x * 0.7 + y * 0.35) + Math.sin(y * 0.8 - x * 0.25);
      return shade([83, 157, 177], ripple * 4 + (noise(x, y, 15) - 0.5) * 5);
    }
    case TILES.PLANKS: {
      const row = Math.floor(y / 4);
      const seam = y % 4 === 0 || (x + row % 2 * 8) % 16 === 0;
      const grain = (noise(x, Math.floor(y / 2), 16) - 0.5) * 14;
      return shade(seam ? [136, 99, 57] : [188, 148, 91], grain + (y % 4 === 1 ? 7 : 0));
    }
    case TILES.BRICKS: {
      const row = Math.floor(y / 4);
      const column = Math.floor((x + row % 2 * 4) / 8);
      const mortar = y % 4 === 0 || (x + row % 2 * 4) % 8 === 0;
      const variation = (noise(column, row, 17) - 0.5) * 18 + (noise(x, y, 18) - 0.5) * 10;
      return shade(mortar ? [173, 162, 140] : [168, 89, 65], variation);
    }
    case TILES.GLASS: {
      const edge = x === 0 || x === 15 || y === 0 || y === 15;
      const glint = x + y === 8 || x + y === 9 || x + y === 22;
      return shade(edge ? [143, 194, 205] : glint ? [226, 245, 249] : [182, 223, 231], (noise(x, y, 19) - 0.5) * 10);
    }
    case TILES.DOOR_BOTTOM:
    case TILES.DOOR_TOP: {
      const frame = x < 2 || x > 13 || y < 2 || y > 13;
      const panelEdge = x === 3 || x === 12 || y === 4 || y === 12;
      const handle = tile === TILES.DOOR_BOTTOM && x >= 11 && x <= 13 && y >= 2 && y <= 3;
      return shade(handle ? [219, 183, 80] : frame ? [143, 101, 57] : panelEdge ? [131, 92, 51] : [179, 135, 78], (noise(x, Math.floor(y / 2), 20) - 0.5) * 14);
    }
    case TILES.LANTERN: {
      const glow = Math.max(0, 1 - Math.hypot(x - 7.5, y - 7.5) / 11);
      return lanternFrame(x, y) ? shade([52, 59, 58], (noise(x, y, 21) - 0.5) * 16)
        : [255, Math.round(161 + glow * 61), Math.round(49 + glow * 81)];
    }
    case TILES.LANTERN_TOP:
      return shade([55, 62, 61], (noise(x, y, 22) - 0.5) * 19 + (x === 2 || x === 13 || y === 2 || y === 13 ? 15 : 0));
    case TILES.WARD_LANTERN: {
      const rune = (x === 5 || x === 10) && y >= 5 && y <= 10
        || (y === 5 || y === 10) && x >= 5 && x <= 10;
      return lanternFrame(x, y) ? shade([52, 59, 58], (noise(x, y, 23) - .5) * 16)
        : rune ? [220, 255, 193] : shade([91, 174, 104], (noise(x, y, 24) - .5) * 20);
    }
    case TILES.STONE_BRICKS: {
      const row = Math.floor(y / 8), offset = row % 2 * 8;
      const mortar = y % 8 === 0 || (x + offset) % 16 === 0;
      const edge = y % 8 === 1 || (x + offset) % 16 === 1;
      return shade(mortar ? [83, 85, 78] : [143, 145, 134], (noise(x, y, 31) - .5) * 22 + (edge ? 17 : 0));
    }
    case TILES.BRACED_TIMBER: {
      const frame = x < 2 || x > 13 || y < 2 || y > 13;
      const brace = Math.abs(x - y) < 2 || Math.abs(x + y - 15) < 2;
      const peg = (x === 2 || x === 13) && (y === 2 || y === 13);
      const seam = x % 4 === 0;
      return shade(peg ? [91, 57, 27] : frame ? [105, 69, 33] : brace ? [161, 114, 57] : seam ? [119, 79, 38] : [187, 139, 76], (noise(x, Math.floor(y / 2), 32) - .5) * 20);
    }
    case TILES.CHEST_FRONT: {
      const frame = x < 2 || x > 13 || y < 2 || y > 13;
      const lid = y === 5 || y === 6;
      const latch = x >= 7 && x <= 8 && y >= 5 && y <= 9;
      const seam = x % 4 === 0;
      return shade(latch ? [211, 176, 78] : frame || lid ? [89, 55, 26] : seam ? [137, 87, 39] : [178, 123, 56], (noise(x, Math.floor(y / 2), 33) - .5) * 22);
    }
    case TILES.CHEST_SIDE:
    case TILES.CHEST_TOP: {
      const frame = x < 2 || y < 2 || x > 13 || y > 13;
      const lid = tile === TILES.CHEST_SIDE && y === 5;
      const seam = x % 4 === 0;
      return shade(frame || lid ? [89, 55, 26] : seam ? [137, 87, 39] : [170, 116, 51], (noise(x, Math.floor(y / 2), 34) - .5) * 22);
    }
    case TILES.BRACED_DOOR_BOTTOM:
    case TILES.BRACED_DOOR_TOP: {
      const frame = x < 2 || x > 13 || y < 2 || y > 13;
      const brace = Math.abs(x - y) < 2 || y === 4 || y === 11;
      const peg = (x === 3 || x === 12) && (y === 4 || y === 11);
      const handle = tile === TILES.BRACED_DOOR_BOTTOM && x >= 11 && x <= 12 && y >= 2 && y <= 3;
      return shade(handle ? [211, 176, 78] : peg ? [77, 46, 23] : frame ? [93, 57, 27] : brace ? [146, 96, 45] : [178, 125, 65], (noise(x, Math.floor(y / 2), 35) - .5) * 20);
    }
    case TILES.SAPLING: {
      const stem = x >= 7 && x <= 8 && y >= 4;
      const leaf = Math.abs(x - 8) + Math.abs(y - 5) < 6 || x > 2 && x < 8 && y > 7 && y < 11;
      return shade(stem ? [126, 92, 49] : leaf ? [86, 132, 62] : [38, 63, 29], (noise(x, y, 40) - .5) * 26);
    }
    case TILES.WOODEN_PEGS: {
      const peg = Math.abs(x - y) < 2 && x > 2 && x < 14 || Math.abs(x - y - 6) < 2 && x > 7 && x < 15;
      return shade(peg ? [179, 129, 66] : [65, 45, 26], (noise(x, y, 41) - .5) * 24);
    }
    case TILES.CHARCOAL: {
      const lump = Math.abs(x - 8) + Math.abs(y - 8) < 9;
      const crack = (x + y) % 5 === 0;
      return shade(lump ? crack ? [31, 29, 27] : [69, 65, 58] : [25, 24, 21], (noise(x, y, 42) - .5) * 22);
    }
    case TILES.STONE_HAMMER: {
      const shaft = Math.abs(x + y - 15) < 2;
      const head = Math.hypot(x - 11, y - 4) < 4;
      return shade(head ? [147, 146, 133] : shaft ? [156, 111, 59] : [58, 55, 44], (noise(x, y, 43) - .5) * 24);
    }
    case TILES.SALVAGE_FRONT:
    case TILES.SALVAGE_SIDE: {
      const frame = x < 2 || x > 13 || y < 2 || y > 13;
      const band = y === 3 || y === 12;
      const latch = tile === TILES.SALVAGE_FRONT && x >= 7 && x <= 8 && y >= 6 && y <= 10;
      const seam = x % 4 === 0;
      return shade(latch ? [217, 187, 91] : band ? [91, 89, 74] : frame || seam ? [106, 73, 37] : [164, 121, 62], (noise(x, y, tile) - .5) * 20);
    }
    default:
      throw new Error(`Unknown texture tile: ${tile}`);
  }
}

export function generateTextureTiles() {
  return Object.values(TILES).map(tile => {
    const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const offset = (x + y * TILE_SIZE) * 4;
        const alpha = tile === TILES.GLASS ? (x === 0 || x === 15 || y === 0 || y === 15 ? 190 : x + y === 8 || x + y === 9 || x + y === 22 ? 80 : 18) : 255;
        pixels.set(ITEM_TILES.has(tile) ? itemPixel(tile, x, y) : [...texturePixel(tile, x, y), alpha], offset);
      }
    }
    return pixels;
  });
}

const CABINET_FRONTS = [[0, 1], [-1, 0], [0, -1], [1, 0]];

export function faceTile(block, normalY, normalX = 0, normalZ = 0) {
  if (isSapling(block)) return TILES.SAPLING;
  if (block === WOODEN_PEGS) return TILES.WOODEN_PEGS;
  if (block === CHARCOAL) return TILES.CHARCOAL;
  if (block === STONE_HAMMER) return TILES.STONE_HAMMER;
  if (block === SALVAGE_CRATE) return !normalY && (normalZ > 0 || !normalX && !normalZ) ? TILES.SALVAGE_FRONT : TILES.SALVAGE_SIDE;
  if (block === STONE_BRICKS) return TILES.STONE_BRICKS;
  if (block === BRACED_TIMBER) return TILES.BRACED_TIMBER;
  if (isCabinet(block)) {
    if (normalY) return TILES.CHEST_TOP;
    const [x, z] = CABINET_FRONTS[cabinetFacing(block)];
    // Inventory previews request a side without a world-space normal.
    return !normalX && !normalZ || normalX === x && normalZ === z ? TILES.CHEST_FRONT : TILES.CHEST_SIDE;
  }
  if (isDoor(block) && buildBlock(block) === BRACED_DOOR) return doorState(block).upper ? TILES.BRACED_DOOR_TOP : TILES.BRACED_DOOR_BOTTOM;
  if (block === GRASS) return normalY > 0 ? TILES.GRASS_TOP : normalY < 0 ? TILES.DIRT : TILES.GRASS_SIDE;
  if (block === DIRT) return TILES.DIRT;
  if (block === WOOD) return normalY === 0 ? TILES.BARK : TILES.WOOD_END;
  if (block === LEAVES) return TILES.LEAVES;
  if (block === SAND) return TILES.SAND;
  if (block === WATER) return TILES.WATER;
  if (block === PLANKS || isSlab(block)) return TILES.PLANKS;
  if (block === BRICKS) return TILES.BRICKS;
  if (block === GLASS) return TILES.GLASS;
  if (block === WARD_LANTERN) return normalY === 0 ? TILES.WARD_LANTERN : TILES.LANTERN_TOP;
  if (block === LANTERN) return normalY === 0 ? TILES.LANTERN : TILES.LANTERN_TOP;
  if (isDoor(block)) return doorState(block).upper ? TILES.DOOR_TOP : TILES.DOOR_BOTTOM;
  return TILES.STONE;
}

export function tileUVs(tile) {
  const x = (tile % 4) * TILE_STRIDE + TILE_PADDING;
  const y = Math.floor(tile / 4) * TILE_STRIDE + TILE_PADDING;
  const left = x / ATLAS_WIDTH;
  const right = (x + TILE_SIZE) / ATLAS_WIDTH;
  const top = 1 - y / ATLAS_HEIGHT;
  const bottom = 1 - (y + TILE_SIZE) / ATLAS_HEIGHT;
  return [[left, bottom], [right, bottom], [left, top], [right, top]];
}

export function createTextureAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;
  const context = canvas.getContext('2d');
  const image = context.createImageData(ATLAS_WIDTH, ATLAS_HEIGHT);
  const tiles = generateTextureTiles();
  for (let tile = 0; tile < tiles.length; tile++) {
    const originX = (tile % 4) * TILE_STRIDE;
    const originY = Math.floor(tile / 4) * TILE_STRIDE;
    for (let y = 0; y < TILE_STRIDE; y++) {
      for (let x = 0; x < TILE_STRIDE; x++) {
        const sx = Math.max(0, Math.min(TILE_SIZE - 1, x - TILE_PADDING));
        const sy = Math.max(0, Math.min(TILE_SIZE - 1, y - TILE_PADDING));
        const source = (sx + sy * TILE_SIZE) * 4;
        const dest = (originX + x + (originY + y) * ATLAS_WIDTH) * 4;
        image.data.set(tiles[tile].subarray(source, source + 4), dest);
      }
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  return texture;
}

export function tilePreview(texture, tile) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_SIZE;
  canvas.getContext('2d').drawImage(texture.image,
    (tile % 4) * TILE_STRIDE + TILE_PADDING, Math.floor(tile / 4) * TILE_STRIDE + TILE_PADDING,
    TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
  return `url(${canvas.toDataURL()})`;
}

export function flowerPreview(block) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_SIZE;
  const context = canvas.getContext('2d');
  const hex = color => `#${color.toString(16).padStart(6, '0')}`;
  context.scale(TILE_SIZE / 16, TILE_SIZE / 16);
  context.fillStyle = '#568342';
  context.fillRect(7, 6, 2, 10);
  context.fillRect(4, 11, 3, 2);
  context.fillRect(9, 9, 3, 2);
  context.fillStyle = hex(FLOWER_COLORS[block].petals);
  for (const [x, y] of [[3, 3], [9, 3], [6, 0], [6, 6]]) context.fillRect(x, y, 4, 4);
  context.fillStyle = hex(FLOWER_COLORS[block].center);
  context.fillRect(6, 3, 4, 4);
  return `url(${canvas.toDataURL()})`;
}

export function createLanternEmissiveMap() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;
  const context = canvas.getContext('2d');
  context.fillStyle = '#000';
  context.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  for (const tile of [TILES.LANTERN, TILES.WARD_LANTERN]) {
    context.fillStyle = tile === TILES.WARD_LANTERN ? '#a5e68c' : '#ffc170';
    const ox = tile % 4 * TILE_STRIDE + TILE_PADDING;
    const oy = Math.floor(tile / 4) * TILE_STRIDE + TILE_PADDING;
    for (let y = 0; y < TILE_SIZE; y++) for (let x = 0; x < TILE_SIZE; x++) {
      if (!lanternFrame(x, y)) context.fillRect(ox + x, oy + y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  return texture;
}
