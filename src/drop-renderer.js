import * as THREE from 'three';
import { isFlower } from './world.js';
import { CHUNK_SIZE } from './generation.js';
import { buildItemGeometry } from './terrain.js';

export class DropRenderer {
  items = [];
  meshes = new Map();
  geometries = new Map();
  age = 0;

  constructor(scene, atlas, prepareMaterial) {
    this.root = new THREE.Group(); this.root.name = 'dropped-items'; scene.add(this.root);
    this.material = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
    this.flowers = new THREE.MeshLambertMaterial({ vertexColors: true });
    prepareMaterial(this.material); prepareMaterial(this.flowers);
  }

  sync(items) {
    this.items = items;
    const ids = new Set(items.map(item => item.id));
    for (const [id, mesh] of this.meshes) if (!ids.has(id)) { this.root.remove(mesh); this.meshes.delete(id); }
    for (const item of items) if (!this.meshes.has(item.id)) {
      if (!this.geometries.has(item.block)) {
        const geometry = buildItemGeometry(item.block);
        geometry.translate(-0.5, -0.5, -0.5);
        this.geometries.set(item.block, geometry);
      }
      const mesh = new THREE.Mesh(this.geometries.get(item.block), isFlower(item.block) ? this.flowers : this.material);
      mesh.scale.setScalar(0.3); mesh.receiveShadow = true;
      this.meshes.set(item.id, mesh); this.root.add(mesh);
    }
  }

  update(seconds, world) {
    this.age += seconds;
    for (const item of this.items) {
      const mesh = this.meshes.get(item.id);
      mesh.visible = !!world.getChunk(Math.floor(item.x / CHUNK_SIZE), Math.floor(item.z / CHUNK_SIZE), false);
      // Keep items out of view until their terrain has arrived.
      mesh.position.set(item.x, item.y + 0.08 + Math.sin(this.age * 2 + item.x) * 0.035, item.z);
      mesh.rotation.y = this.age * 0.7;
    }
  }
}
