import * as THREE from 'three';
import { isPlant } from './world.js';
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
      const mesh = new THREE.Mesh(this.geometries.get(item.block), isPlant(item.block) ? this.flowers : this.material);
      mesh.scale.setScalar(0.3); mesh.receiveShadow = true;
      mesh.position.set(item.x, Number.isFinite(item.spawnY) ? Math.max(item.y, item.spawnY) : item.y, item.z);
      mesh.userData.fallSpeed = 0;
      this.meshes.set(item.id, mesh); this.root.add(mesh);
    }
  }

  update(seconds, world) {
    this.age += seconds;
    for (const item of this.items) {
      const mesh = this.meshes.get(item.id);
      mesh.visible = !!world.getChunk(Math.floor(item.x / CHUNK_SIZE), Math.floor(item.z / CHUNK_SIZE), false);
      // Gravity is presentation only: the host owns the exact supporting surface
      // and pickup position. Remove the old hover/bob offset at rest.
      if (mesh.visible) {
        let left = Math.min(Math.max(seconds, 0), 1);
        while (left > 0 && mesh.position.y > item.y) {
          const step = Math.min(left, 1 / 60); left -= step;
          mesh.userData.fallSpeed = Math.min(24, mesh.userData.fallSpeed + 20 * step);
          mesh.position.y = Math.max(item.y, mesh.position.y - mesh.userData.fallSpeed * step);
        }
        if (mesh.position.y <= item.y) { mesh.position.y = item.y; mesh.userData.fallSpeed = 0; }
        mesh.position.x = item.x; mesh.position.z = item.z;
      }
      mesh.rotation.y = this.age * 0.7;
    }
  }
}
