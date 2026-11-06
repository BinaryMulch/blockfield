import * as THREE from 'three';
import { GRASS, DIRT, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, LANTERN, WARD_LANTERN, CONCRETE, REINFORCED_PANEL, SECURITY_DOOR, SCRAP, BIOFUEL, REPAIR_TOOL, SALVAGE_CRATE, isSapling, buildBlock, FLOWER_COLORS, isDoor, isSlab, isCabinet, cabinetFacing, doorState } from './world.js';

export const TILE_SIZE = 32;
// Replicated borders keep neighboring materials out of the texture's mipmaps.
export const TILE_PADDING = 16;
export const TILE_STRIDE = TILE_SIZE + TILE_PADDING * 2;
export const ATLAS_WIDTH = TILE_STRIDE * 4;
export const ATLAS_HEIGHT = TILE_STRIDE * 8;
export const TILES = { GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, BARK: 4, WOOD_END: 5, LEAVES: 6, SAND: 7, WATER: 8, PLANKS: 9, BRICKS: 10, GLASS: 11, DOOR_BOTTOM: 12, DOOR_TOP: 13, LANTERN: 14, LANTERN_TOP: 15, WARD_LANTERN: 16, CONCRETE: 17, REINFORCED: 18, CABINET_FRONT: 19, CABINET_SIDE: 20, CABINET_TOP: 21, SECURITY_BOTTOM: 22, SECURITY_TOP: 23, SAPLING: 24, SCRAP: 25, BIOFUEL: 26, REPAIR_TOOL: 27, SALVAGE_FRONT: 28, SALVAGE_SIDE: 29 };
const lanternFrame = (x, y) => x < 3 || x > 28 || y < 3 || y > 28 || x === 15 || x === 16;

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
  return shade([99, 132, 80], (n - 0.5) * 18 + (patch - 0.5) * 15 + (n > 0.88 ? 13 : 0));
}

function dirtPixel(x, y) {
  const n = noise(x, y, 3);
  const grain = noise(Math.floor(x / 2), Math.floor(y / 2), 4);
  const pebble = n > 0.95 ? [166, 151, 123] : [122, 102, 83];
  return shade(pebble, (grain - 0.5) * 19 + (n - 0.5) * 14);
}

function texturePixel(tile, x, y) {
  switch (tile) {
    case TILES.GRASS_TOP:
      return grassPixel(x, y);
    case TILES.GRASS_SIDE: {
      const fringe = 5 + Math.floor(noise(Math.floor(x / 2), 0, 5) * 5);
      return y < fringe ? shade(grassPixel(x, y), -8) : dirtPixel(x, y);
    }
    case TILES.DIRT:
      return dirtPixel(x, y);
    case TILES.STONE: {
      const patch = noise(Math.floor(x / 3), Math.floor(y / 3), 6);
      const crack = (y === 10 + Math.floor(x / 5) || y === 26 - Math.floor(x / 6))
        && noise(x, y, 7) > 0.35;
      return shade([153, 161, 158], (patch - 0.5) * 22 + (noise(x, y, 8) - 0.5) * 12 - (crack ? 22 : 0));
    }
    case TILES.BARK: {
      const groove = (x + Math.floor(y / 6)) % 5;
      const streak = groove === 0 ? -22 : groove === 1 ? 10 : 0;
      return shade([145, 109, 67], streak + (noise(x, Math.floor(y / 3), 9) - 0.5) * 15);
    }
    case TILES.WOOD_END: {
      const radius = Math.hypot(x - 15.5, (y - 15.5) * 1.05);
      const ring = Math.floor(radius + noise(x, y, 10) * 0.4) % 3 === 0;
      return shade([195, 161, 109], (ring ? -25 : 4) + (noise(x, y, 11) - 0.5) * 10);
    }
    case TILES.LEAVES: {
      const cluster = noise(Math.floor(x / 3), Math.floor(y / 3), 12);
      const edge = x % 3 === 0 || y % 3 === 0;
      return shade([64, 101, 70], (cluster - 0.5) * 33 + (noise(x, y, 13) - 0.5) * 14 + (edge ? -8 : 5));
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
      const seam = y % 8 === 0;
      const grain = (noise(x, Math.floor(y / 2), 16) - .5) * 12;
      return shade(seam ? [66, 72, 73] : [118, 127, 126], grain + (y % 8 === 1 ? 9 : 0));
    }
    case TILES.BRICKS: {
      const row = Math.floor(y / 16), mortar = y % 16 === 0 || (x + row % 2 * 16) % 32 === 0;
      return shade(mortar ? [68, 75, 78] : [137, 143, 143], (noise(x, y, 18) - .5) * 14);
    }
    case TILES.GLASS: {
      const edge = x === 0 || x === 31 || y === 0 || y === 31;
      const glint = x + y === 16 || x + y === 17 || x + y === 44;
      return shade(edge ? [143, 194, 205] : glint ? [226, 245, 249] : [182, 223, 231], (noise(x, y, 19) - 0.5) * 10);
    }
    case TILES.DOOR_BOTTOM:
    case TILES.DOOR_TOP:
    case TILES.SECURITY_BOTTOM:
    case TILES.SECURITY_TOP: {
      const secure = tile === TILES.SECURITY_BOTTOM || tile === TILES.SECURITY_TOP;
      const top = tile === TILES.DOOR_TOP || tile === TILES.SECURITY_TOP;
      const frame = x < 3 || x > 28 || y < 2 || y > 29;
      const window = top && x >= 9 && x <= 22 && y >= 6 && y <= 24;
      const handle = !top && x >= 23 && x <= 27 && y >= 3 && y <= 5;
      const brace = secure && (y === 10 || y === 11 || y === 24 || y === 25);
      const bolt = secure && (x === 4 || x === 27) && y % 8 === 4;
      return shade(handle || bolt ? [185, 199, 198] : frame || brace ? [46, 57, 64] : window ? [66, 116, 126] : secure ? [76, 99, 109] : [160, 168, 166], (noise(x, y, 20) - .5) * 8);
    }
    case TILES.LANTERN: {
      const glow = Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 23);
      return lanternFrame(x, y) ? shade([45, 53, 61], (noise(x, y, 21) - 0.5) * 16)
        : [Math.round(204 + glow * 40), Math.round(220 + glow * 30), 244];
    }
    case TILES.WARD_LANTERN: {
      const rune = Math.abs(x - 15.5) + Math.abs(y - 15.5) < 11 && (x === 10 || x === 21 || y === 10 || y === 21);
      return lanternFrame(x, y) ? shade([44, 69, 67], (noise(x, y, 23) - .5) * 16)
        : rune ? [230, 255, 230] : shade([102, 200, 181], (noise(x, y, 24) - .5) * 12);
    }
    case TILES.LANTERN_TOP:
      return shade([55, 62, 61], (noise(x, y, 22) - 0.5) * 19 + (x === 3 || x === 28 || y === 3 || y === 28 ? 15 : 0));
    case TILES.CONCRETE: {
      const pore = noise(x, y, 31), seam = x === 0 || y === 0;
      const bolt = (x === 5 || x === 26) && (y === 5 || y === 26);
      return shade(seam ? [98, 106, 108] : bolt ? [78, 88, 92] : [161, 169, 169], (pore - .5) * 11 - (pore > .96 ? 15 : 0));
    }
    case TILES.REINFORCED: {
      const seam = x < 2 || x > 29 || y < 2 || y > 29;
      const brace = Math.abs(x - y) < 2 || Math.abs(x + y - 31) < 2;
      const screw = (x === 4 || x === 27) && (y === 4 || y === 27);
      return shade(screw ? [185, 198, 202] : seam ? [43, 54, 64] : brace ? [87, 108, 121] : [64, 84, 98], (noise(x, y, 32) - .5) * 7);
    }
    case TILES.CABINET_FRONT: {
      const frame = x < 2 || x > 29 || y < 2 || y > 29 || x === 15;
      const vent = y >= 21 && y <= 26 && y % 2 === 1 && x > 4 && x < 27;
      const handle = (x === 12 || x === 18) && y >= 9 && y <= 16;
      const label = x >= 5 && x <= 10 && y >= 5 && y <= 7;
      return shade(handle ? [192, 204, 203] : label ? [167, 195, 186] : frame || vent ? [38, 48, 58] : [89, 108, 118], (noise(x, y, 33) - .5) * 7);
    }
    case TILES.CABINET_SIDE:
    case TILES.CABINET_TOP:
      return shade(x < 2 || y < 2 || x > 29 || y > 29 ? [43, 54, 64] : tile === TILES.CABINET_TOP ? [98, 115, 124] : [80, 98, 109], (noise(x, y, 34) - .5) * 7);
    case TILES.SAPLING: {
      const stem = x >= 14 && x <= 17 && y >= 8;
      const leaf = Math.abs(x - 16) + Math.abs(y - 10) < 11 || x > 5 && x < 15 && y > 16 && y < 21;
      return shade(stem ? [122, 139, 102] : leaf ? [103, 169, 122] : [32, 60, 53], (noise(x, y, 40) - .5) * 12);
    }
    case TILES.SCRAP: {
      const edge = Math.abs(x - y) < 4 || y > 20 && x > 4 && x < 27;
      return shade(edge ? [158, 173, 182] : [54, 70, 82], (noise(x, y, 41) - .5) * 18);
    }
    case TILES.BIOFUEL: {
      const body = x >= 7 && x <= 24 && y >= 4 && y <= 28;
      const band = y > 12 && y < 21;
      return shade(body ? band ? [105, 183, 145] : [151, 168, 174] : [37, 55, 64], (noise(x, y, 42) - .5) * 10);
    }
    case TILES.REPAIR_TOOL: {
      const shaft = Math.abs(x + y - 31) < 4;
      const head = Math.hypot(x - 23, y - 8) < 7;
      return shade(head ? [167, 186, 193] : shaft ? [210, 168, 76] : [37, 55, 64], (noise(x, y, 43) - .5) * 12);
    }
    case TILES.SALVAGE_FRONT:
    case TILES.SALVAGE_SIDE: {
      const frame = x < 3 || x > 28 || y < 3 || y > 28;
      const hazard = y > 22 && y < 28;
      const label = tile === TILES.SALVAGE_FRONT && x > 6 && x < 25 && y > 7 && y < 17;
      return shade(frame ? [54, 66, 72] : hazard ? (x + y) % 12 < 6 ? [202, 166, 71] : [44, 56, 64] : label ? [171, 198, 192] : [82, 105, 115], (noise(x, y, tile) - .5) * 11);
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
        const alpha = tile === TILES.GLASS ? (x === 0 || x === 31 || y === 0 || y === 31 ? 190 : x + y === 16 || x + y === 17 || x + y === 44 ? 80 : 18) : 255;
        pixels.set([...texturePixel(tile, x, y), alpha], offset);
      }
    }
    return pixels;
  });
}

const CABINET_FRONTS = [[0, 1], [-1, 0], [0, -1], [1, 0]];

export function faceTile(block, normalY, normalX = 0, normalZ = 0) {
  if (isSapling(block)) return TILES.SAPLING;
  if (block === SCRAP) return TILES.SCRAP;
  if (block === BIOFUEL) return TILES.BIOFUEL;
  if (block === REPAIR_TOOL) return TILES.REPAIR_TOOL;
  if (block === SALVAGE_CRATE) return !normalY && (normalZ > 0 || !normalX && !normalZ) ? TILES.SALVAGE_FRONT : TILES.SALVAGE_SIDE;
  if (block === CONCRETE) return TILES.CONCRETE;
  if (block === REINFORCED_PANEL) return TILES.REINFORCED;
  if (isCabinet(block)) {
    if (normalY) return TILES.CABINET_TOP;
    const [x, z] = CABINET_FRONTS[cabinetFacing(block)];
    // Inventory previews request a side without a world-space normal.
    return !normalX && !normalZ || normalX === x && normalZ === z ? TILES.CABINET_FRONT : TILES.CABINET_SIDE;
  }
  if (isDoor(block) && buildBlock(block) === SECURITY_DOOR) return doorState(block).upper ? TILES.SECURITY_TOP : TILES.SECURITY_BOTTOM;
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
    context.fillStyle = tile === TILES.WARD_LANTERN ? '#9ae6cf' : '#dcefff';
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
