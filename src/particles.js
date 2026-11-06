import * as THREE from 'three';
import { isSolid, isFlower, FLOWER_COLORS, blockBounds } from './world.js';
import { TILE_SIZE, faceTile, generateTextureTiles } from './textures.js';

export class BlockParticles {
  activeCount = 0;
  cursor = 0;

  constructor(scene, { capacity = 192, random = Math.random } = {}) {
    this.random = random;
    this.tiles = generateTextureTiles();
    this.pool = Array.from({ length: capacity }, () => ({ life: 0 }));
    this.transform = new THREE.Object3D();
    this.color = new THREE.Color();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), capacity);
    this.mesh.name = 'block-particles';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.transform.scale.setScalar(0);
    this.transform.updateMatrix();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.transform.matrix);
    scene.add(this.mesh);
  }

  burst(x, y, z, block, normal = { x: 0, y: 1, z: 0 }) {
    if (!isSolid(block) && !isFlower(block)) return;
    const bounds = blockBounds(block, x, y, z);
    const pixels = this.tiles[faceTile(block, normal.y)];
    for (let chip = 0; chip < (isFlower(block) ? 8 : 16); chip++) {
      const index = this.cursor++ % this.pool.length;
      const particle = this.pool[index];
      if (particle.life <= 0) this.activeCount++;
      Object.assign(particle, {
        x: (bounds.minX + bounds.maxX) / 2 + (normal.x * 0.35 + (this.random() - 0.5) * 0.45) * (bounds.maxX - bounds.minX),
        y: (bounds.minY + bounds.maxY) / 2 + (normal.y * 0.35 + (this.random() - 0.5) * 0.3) * (bounds.maxY - bounds.minY),
        z: (bounds.minZ + bounds.maxZ) / 2 + (normal.z * 0.35 + (this.random() - 0.5) * 0.45) * (bounds.maxZ - bounds.minZ),
        vx: (this.random() - 0.5) * 3 + normal.x * 1.2,
        vy: 1.5 + this.random() * 2 + Math.max(0, normal.y) * 1.2,
        vz: (this.random() - 0.5) * 3 + normal.z * 1.2,
        spin: (this.random() - 0.5) * 14,
        size: 0.065 + this.random() * 0.055,
        life: 0.45 + this.random() * 0.25,
        age: 0,
      });
      const pixel = Math.floor(this.random() * TILE_SIZE * TILE_SIZE) * 4;
      if (isFlower(block)) this.color.setHex(FLOWER_COLORS[block].petals);
      else this.color.setRGB(pixels[pixel] / 255, pixels[pixel + 1] / 255, pixels[pixel + 2] / 255, THREE.SRGBColorSpace);
      this.mesh.setColorAt(index, this.color);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(seconds, world) {
    if (!this.activeCount) return;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (p.life <= 0) continue;
      p.life -= seconds;
      p.age += seconds;
      p.vy -= 10 * seconds;
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.z += p.vz * seconds;
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      const block = world.get(x, y, z), b = blockBounds(block, x, y, z);
      const hit = isSolid(block) && p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && p.z >= b.minZ && p.z <= b.maxZ;
      if (p.life <= 0 || hit) {
        p.life = 0;
        this.activeCount--;
        this.transform.scale.setScalar(0);
      } else {
        this.transform.position.set(p.x, p.y, p.z);
        this.transform.rotation.set(p.age * p.spin, p.age * p.spin * 0.7, p.age * p.spin * 0.3);
        this.transform.scale.setScalar(p.size * Math.min(1, p.life / 0.18));
      }
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(i, this.transform.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.activeCount > 0;
  }
}
