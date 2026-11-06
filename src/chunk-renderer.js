import * as THREE from 'three';
import { HEIGHT } from './world.js';
import { CHUNK_SIZE, nearbyChunks, chunkKey } from './generation.js';
import { WorldJobs } from './jobs.js';
import { DamageState } from './damage.js';

export class ChunkRenderer {
  chunks = new Map();
  dirty = new Set();
  groups = {};
  jobs = new WorldJobs();
  epoch = 0;
  busy = false;

  constructor(scene, world, materials, onChange, onError) {
    this.damage = new DamageState(world);
    this.world = world; this.materials = materials; this.onChange = onChange; this.onError = onError;
    for (const mode of Object.keys(materials)) {
      const group = new THREE.Group();
      group.name = { solid: 'terrain', lantern: 'lanterns' }[mode] || mode;
      this.groups[mode] = group; scene.add(group);
    }
  }

  remove(key) {
    const meshes = this.chunks.get(key);
    if (!meshes) return;
    for (const [mode, mesh] of Object.entries(meshes)) { this.groups[mode].remove(mesh); mesh.geometry.dispose(); }
    this.chunks.delete(key); this.damage.geometries.delete(key);
    this.onChange();
  }

  reset() {
    this.epoch++;
    for (const key of this.chunks.keys()) this.remove(key);
    this.dirty.clear();
  }

  mark(key) {
    const [cx, cz] = key.split(',').map(Number);
    for (const [dx, dz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) this.dirty.add(chunkKey(cx + dx, cz + dz));
  }

  signature(cx, cz) {
    return [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz]) => this.world.chunks.get(chunkKey(cx + dx, cz + dz))?.serial || 0).join(':');
  }

  ready(cx, cz) {
    return [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dz]) => {
      const x = (cx + dx) * CHUNK_SIZE, z = (cz + dz) * CHUNK_SIZE;
      return x < 0 || z < 0 || x >= this.world.size || z >= this.world.size || this.world.chunks.has(chunkKey(cx + dx, cz + dz));
    });
  }

  readyAt(position) { return nearbyChunks(position.x, position.z, 3, this.world.size).every(chunk => this.chunks.has(chunk.key)); }

  update(position) {
    this.damage.prune();
    const wanted = nearbyChunks(position.x, position.z, 3, this.world.size), keys = new Set(wanted.map(chunk => chunk.key));
    for (const key of this.chunks.keys()) if (!keys.has(key) || !this.world.chunks.has(key)) this.remove(key);
    for (const key of this.dirty) if (!keys.has(key)) this.dirty.delete(key);
    for (const chunk of wanted) if (!this.chunks.has(chunk.key)) this.dirty.add(chunk.key);
    if (this.busy) return;
    const next = wanted.find(chunk => this.dirty.has(chunk.key) && this.ready(chunk.cx, chunk.cz));
    if (!next) return;
    this.dirty.delete(next.key);
    const signature = this.signature(next.cx, next.cz), epoch = this.epoch;
    const stride = CHUNK_SIZE + 2, halo = new Uint8Array(stride * stride * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < stride; z++) for (let x = 0; x < stride; x++) {
      halo[x + stride * (z + stride * y)] = this.world.get(next.cx * CHUNK_SIZE + x - 1, y, next.cz * CHUNK_SIZE + z - 1);
    }
    this.busy = true;
    this.jobs.call({ kind: 'mesh', cx: next.cx, cz: next.cz, halo }, [halo.buffer]).then(({ result }) => {
      if (epoch !== this.epoch || !this.world.chunks.has(next.key)) return;
      if (this.signature(next.cx, next.cz) !== signature) { this.dirty.add(next.key); return; }
      this.remove(next.key);
      const meshes = {};
      for (const [mode, data] of Object.entries(result)) {
        if (!data.index.length) continue;
        const geometry = new THREE.BufferGeometry();
        for (const [name, array] of Object.entries(data)) {
          if (name === 'damageRanges') continue;
          if (name === 'index') geometry.setIndex(new THREE.BufferAttribute(array, 1));
          else geometry.setAttribute(name, new THREE.BufferAttribute(array, name === 'uv' ? 2 : 3));
        }
        if (mode === 'solid') this.damage.bind(next.key, geometry, data.damageRanges || new Uint32Array());
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, this.materials[mode]);
        mesh.name = `${mode}-${next.key}`;
        mesh.castShadow = mode !== 'water' && mode !== 'glass'; mesh.receiveShadow = true;
        if (mode === 'water') mesh.renderOrder = 1;
        this.groups[mode].add(mesh); meshes[mode] = mesh;
      }
      this.chunks.set(next.key, meshes); this.onChange();
    }).catch(error => { if (epoch === this.epoch) this.onError(error); }).finally(() => { this.busy = false; });
  }
}
