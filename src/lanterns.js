import * as THREE from 'three';
import { SIZE, LANTERN } from './world.js';
import { CHUNK_SIZE } from './generation.js';

export const MAX_LANTERN_LIGHTS = 8;
export const LANTERN_RANGE = 8;
export const LANTERN_INTENSITY = 9;

export function nearestLanterns(sources, position, limit = MAX_LANTERN_LIGHTS) {
  const distance = source => (source.x + 0.5 - position.x) ** 2
    + (source.y + 0.45 - position.y) ** 2 + (source.z + 0.5 - position.z) ** 2;
  return [...sources].sort((a, b) => distance(a) - distance(b) || a.index - b.index).slice(0, limit);
}

export class LanternLighting {
  sources = [];
  activeSources = [];
  dirty = true;
  elapsed = 0;
  lastPosition = new THREE.Vector3();

  constructor(scene, world) {
    this.group = new THREE.Group();
    this.group.name = 'lantern-lights';
    this.lights = Array.from({ length: MAX_LANTERN_LIGHTS }, (_, index) => {
      const light = new THREE.PointLight('#ffb65c', 0, LANTERN_RANGE, 2);
      light.name = `lantern-light-${index}`;
      // Reuse a fixed set of unshadowed lights; the sun retains the shadow map.
      this.group.add(light);
      return light;
    });
    scene.add(this.group);
    this.sync(world);
  }

  sync(world, keys = null) {
    if (world.chunks) {
      if (!keys) this.chunkSources = new Map();
      this.chunkSources ||= new Map();
      for (const key of keys || world.chunks.keys()) {
        const chunk = world.chunks.get(key);
        if (!chunk) { this.chunkSources.delete(key); continue; }
        const sources = [];
        for (let index = 0; index < chunk.blocks.length; index++) if (chunk.blocks[index] === LANTERN) {
          sources.push({ index: (chunk.cx + chunk.cz * 32) * chunk.blocks.length + index,
            x: chunk.cx * CHUNK_SIZE + index % CHUNK_SIZE, y: Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE)),
            z: chunk.cz * CHUNK_SIZE + Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE });
        }
        this.chunkSources.set(key, sources);
      }
      this.sources = [...this.chunkSources.values()].flat(); this.dirty = true;
      return;
    }
    this.sources = [];
    for (let index = 0; index < world.blocks.length; index++) {
      if (world.blocks[index] !== LANTERN) continue;
      this.sources.push({ index, x: index % SIZE, y: Math.floor(index / (SIZE * SIZE)), z: Math.floor(index / SIZE) % SIZE });
    }
    this.dirty = true;
  }

  update(seconds, position, daylight) {
    this.elapsed += seconds;
    if (this.dirty || this.elapsed >= 0.15 && this.lastPosition.distanceToSquared(position) >= 0.25) {
      this.activeSources = nearestLanterns(this.sources, position);
      this.lastPosition.copy(position);
      this.elapsed = 0;
      this.dirty = false;
    }
    const intensity = LANTERN_INTENSITY * (1 - 0.6 * THREE.MathUtils.clamp(daylight, 0, 1));
    this.lights.forEach((light, index) => {
      const source = this.activeSources[index];
      if (source) light.position.set(source.x + 0.5, source.y + 0.45, source.z + 0.5);
      light.intensity = source ? intensity : 0;
    });
  }
}
