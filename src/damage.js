import * as THREE from 'three';
import { STONE, WOOD, STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR, buildBlock, doorState } from './world.js';
import { strength } from './infrastructure.js';
import { TILE_SIZE, TILE_PADDING, TILE_STRIDE, ATLAS_WIDTH, ATLAS_HEIGHT } from './textures.js';

export const DAMAGE_VARIANTS = 4;
export const DAMAGE_TILE_SIZE = 32;
export const DAMAGE_PADDING = 4;
export const DAMAGE_STRIDE = DAMAGE_TILE_SIZE + DAMAGE_PADDING * 2;
export const DAMAGE_ATLAS_WIDTH = DAMAGE_STRIDE * 4;
export const DAMAGE_ATLAS_HEIGHT = DAMAGE_STRIDE * DAMAGE_VARIANTS * 3;
export const DAMAGE_RANGE_SIZE = 6;
const DAMAGE_STYLES = Object.freeze({ [STONE]: 0, [WOOD]: 1, [STONE_BRICKS]: 0, [BRACED_TIMBER]: 1, [WOODEN_CHEST]: 2, [BRACED_DOOR]: 2 });
export const damageStyle = block => DAMAGE_STYLES[buildBlock(block)] ?? -1;
export const damageStage = (block, remaining) => Math.max(0, Math.min(3, Math.ceil((1 - remaining / strength(block)) * 3)));
export const damageVariant = (x, y, z) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) % DAMAGE_VARIANTS;
const chunkKey = p => `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
export const damageIndex = (x, y, z, block) => x % 16 + (z % 16) * 16 + (y - Number(doorState(block)?.upper || false)) * 256;
const validRecord = p => p && [p.x, p.y, p.z].every(Number.isInteger) && damageStyle(p.block) >= 0 && buildBlock(p.block) === p.block && Number.isInteger(p.remaining) && p.remaining > 0 && p.remaining <= strength(p.block);

function lineDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

// R: dark cracks/wood splits, G: chipped surface/exposed material, B: edge highlight.
// Masks are generated once; no animated noise or per-frame texture generation.
export function damageMaskPixel(style, variant, stage, x, y) {
  if (!stage) return [0, 0, 0, 255];
  const shift = variant * 2 - 3, width = .22 + stage * .27;
  const lines = style === 0 ? [
    [13 + shift, 1, 17 + shift, 12, 1], [17 + shift, 12, 11 + shift, 23, 1], [11 + shift, 23, 15 + shift, 31, 2],
    [17 + shift, 12, 28, 7 + variant, 2], [11 + shift, 23, 2, 17 + variant, 2], [17 + shift, 12, 25, 24, 3], [25, 24, 31, 27 - variant, 3],
  ] : style === 1 ? [
    [7 + shift, 2, 9 + shift, 13, 1], [9 + shift, 13, 6 + shift, 28, 1], [9 + shift, 13, 14 + shift, 19, 2],
    [23 - shift, 5, 21 - shift, 17, 2], [21 - shift, 17, 24 - shift, 30, 3], [6 + shift, 28, 2, 31, 3],
  ] : [
    [11 + shift, 3, 9 + shift, 17, 1], [9 + shift, 17, 12 + shift, 29, 1], [9 + shift, 17, 4, 23, 2],
    [23 - shift, 8, 25 - shift, 26, 2], [25 - shift, 26, 30, 31, 3], [12 + shift, 29, 16, 31, 3],
  ];
  let distance = 100;
  for (const [ax, ay, bx, by, first] of lines) if (stage >= first) distance = Math.min(distance, lineDistance(x, y, ax, ay, bx, by));
  let dark = distance < width ? 230 : 0, chip = distance < width + .6 && stage >= 2 ? 120 : 0, highlight = distance >= width && distance < width + .8 ? 125 : 0;
  if (style === 0) {
    const grain = ((x * 37 + y * 71 + variant * 19) % 23) / 23;
    if (stage >= 2 && distance < width + 1.3 && grain > .68) chip = 210;
    if (stage === 3 && Math.min(x, y, 31 - x, 31 - y) < 2 && grain > .52) chip = 230;
  } else {
    const grain = (x * 11 + y * 3 + variant * 7) % 13;
    if (stage >= 2 && distance < width + 1.2 && grain < 5) chip = 175 + stage * 15;
    if (stage === 3 && Math.min(x, y, 31 - x, 31 - y) < 2 && grain < 4) chip = 225;
    if (distance >= width && distance < width + 1 && x % 2 === variant % 2) highlight = Math.max(highlight, 150);
  }
  return [dark, chip, highlight, 255];
}

export function generateDamageAtlas() {
  const pixels = new Uint8Array(DAMAGE_ATLAS_WIDTH * DAMAGE_ATLAS_HEIGHT * 4);
  for (let style = 0; style < 3; style++) for (let variant = 0; variant < DAMAGE_VARIANTS; variant++) for (let stage = 0; stage < 4; stage++) {
    const row = style * DAMAGE_VARIANTS + variant;
    for (let y = 0; y < DAMAGE_STRIDE; y++) for (let x = 0; x < DAMAGE_STRIDE; x++) {
      const sx = Math.max(0, Math.min(31, x - DAMAGE_PADDING)), sy = Math.max(0, Math.min(31, y - DAMAGE_PADDING));
      pixels.set(damageMaskPixel(style, variant, stage, sx, sy), ((stage * DAMAGE_STRIDE + x) + (row * DAMAGE_STRIDE + y) * DAMAGE_ATLAS_WIDTH) * 4);
    }
  }
  return pixels;
}

export function createDamageTexture() {
  const texture = new THREE.DataTexture(generateDamageAtlas(), DAMAGE_ATLAS_WIDTH, DAMAGE_ATLAS_HEIGHT);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

export function applyDamageMaterial(material, texture) {
  if (material.userData.structuralDamage) return;
  texture ||= createDamageTexture();
  material.userData.structuralDamage = true;
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}:structural-damage-v1`;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.structuralDamageMap = { value: texture };
    const varyings = '\nvarying vec3 vStructuralDamage;\nvarying vec2 vStructuralDamageUv;\n';
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nattribute vec3 damageData;${varyings}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vStructuralDamage = damageData;
        vStructuralDamageUv = clamp((mod(vec2(vMapUv.x, 1.0 - vMapUv.y) * vec2(${ATLAS_WIDTH}.0, ${ATLAS_HEIGHT}.0), ${TILE_STRIDE}.0) - ${TILE_PADDING}.0) / ${TILE_SIZE}.0, 0.0, 1.0);
        if (damageData.z > 0.5) vStructuralDamageUv.y = (vStructuralDamageUv.y + (damageData.z < 1.5 ? 1.0 : 0.0)) * 0.5;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${varyings}\nuniform sampler2D structuralDamageMap;\n`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vStructuralDamage.x > 0.5) {
          vec2 wearTile = floor(vStructuralDamage.xy + 0.5) * ${DAMAGE_STRIDE}.0;
          vec2 wearUv = (wearTile + ${DAMAGE_PADDING}.0 + 0.5 + vStructuralDamageUv * ${DAMAGE_TILE_SIZE - 1}.0) / vec2(${DAMAGE_ATLAS_WIDTH}.0, ${DAMAGE_ATLAS_HEIGHT}.0);
          vec3 wear = texture2D(structuralDamageMap, wearUv).rgb;
          vec3 exposedSurface = vStructuralDamage.y < ${DAMAGE_VARIANTS}.0 ? vec3(0.46, 0.47, 0.43) : vec3(0.52, 0.32, 0.14);
          diffuseColor.rgb *= 1.0 - wear.r * 0.72;
          diffuseColor.rgb = mix(diffuseColor.rgb, exposedSurface, wear.g * 0.75);
          diffuseColor.rgb = clamp(diffuseColor.rgb + vec3(0.13, 0.10, 0.06) * wear.b, 0.0, 1.0);
        }
      `);
  };
  material.needsUpdate = true;
}

// Only loaded terrain holds visual damage. GPU updates touch the vertex ranges
// for one block (both door halves share an anchor); topology stays unchanged.
export class DamageState {
  chunks = new Map();
  geometries = new Map();
  constructor(world) { this.world = world; }
  clear() { this.chunks.clear(); for (const [key, geometry] of this.geometries) this.refresh(key, geometry); }
  prune() { if (this.world.chunks) for (const key of this.chunks.keys()) if (!this.world.chunks.has(key)) this.chunks.delete(key); }
  setChunk(key, records = []) {
    const damage = new Map();
    for (const p of records) if (validRecord(p) && chunkKey(p) === key && this.world.contains(p.x, p.y, p.z) && buildBlock(this.world.get(p.x, p.y, p.z)) === p.block && p.remaining < strength(p.block)) damage.set(damageIndex(p.x, p.y, p.z, p.block), { ...p });
    if (damage.size) this.chunks.set(key, damage); else this.chunks.delete(key);
    const geometry = this.geometries.get(key); if (geometry) this.refresh(key, geometry);
  }
  set(p) {
    if (!validRecord(p) || !this.world.contains(p.x, p.y, p.z)) return;
    const key = chunkKey(p), index = damageIndex(p.x, p.y, p.z, p.block);
    if (this.world.chunks && !this.world.chunks.has(key)) return;
    if (buildBlock(this.world.get(p.x, p.y, p.z)) !== p.block) return;
    if (p.remaining < strength(p.block)) {
      if (!this.chunks.has(key)) this.chunks.set(key, new Map());
      this.chunks.get(key).set(index, { ...p });
    } else this.delete(key, index);
    const geometry = this.geometries.get(key); if (geometry) this.update(key, index, geometry);
  }
  delete(key, index) { const records = this.chunks.get(key); records?.delete(index); if (!records?.size) this.chunks.delete(key); }
  edited(changes) {
    for (const c of changes) if (buildBlock(c.from) !== buildBlock(c.to)) {
      const key = chunkKey(c), index = damageIndex(c.x, c.y, c.z, c.from);
      this.delete(key, index);
      const geometry = this.geometries.get(key); if (geometry) this.update(key, index, geometry);
    }
  }
  remaining(x, y, z, block) {
    const record = this.chunks.get(chunkKey({ x, z }))?.get(damageIndex(x, y, z, block));
    return record?.block === buildBlock(block) ? record.remaining : strength(block);
  }
  bind(key, geometry, ranges) {
    const byBlock = new Map(), data = new Uint8Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < ranges.length; i += DAMAGE_RANGE_SIZE) {
      const [index, start, count, row, half, block] = ranges.subarray(i, i + DAMAGE_RANGE_SIZE);
      if (!byBlock.has(index)) byBlock.set(index, []);
      byBlock.get(index).push({ start, count, block });
      for (let vertex = start; vertex < start + count; vertex++) { data[vertex * 3 + 1] = row; data[vertex * 3 + 2] = half; }
    }
    geometry.userData.damageRanges = byBlock;
    geometry.setAttribute('damageData', new THREE.BufferAttribute(data, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometries.set(key, geometry); this.refresh(key, geometry);
    geometry.attributes.damageData.clearUpdateRanges();
  }
  refresh(key, geometry) { for (const index of geometry.userData.damageRanges.keys()) this.update(key, index, geometry); }
  update(key, index, geometry) {
    const attribute = geometry.attributes.damageData, record = this.chunks.get(key)?.get(index);
    for (const range of geometry.userData.damageRanges.get(index) || []) {
      const stage = record?.block === range.block ? damageStage(record.block, record.remaining) : 0;
      for (let vertex = range.start; vertex < range.start + range.count; vertex++) attribute.array[vertex * 3] = stage;
      attribute.addUpdateRange(range.start * 3, range.count * 3);
      attribute.needsUpdate = true;
    }
  }
}
