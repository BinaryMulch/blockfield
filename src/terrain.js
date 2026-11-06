import * as THREE from 'three';
import { SIZE, HEIGHT, WATER, GLASS, LANTERN, isSolid, isOpaque, isSlab, isFlower, doorState, blockBounds, lanternParts, flowerParts } from './world.js';
import { TILES, faceTile, tileUVs } from './textures.js';

// Counterclockwise corners, viewed from outside each face.
const FACES = [
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 1], [1, 1, 0]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]] },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
];

function coversFace(bounds, other, normal) {
  const axis = normal[0] ? 'X' : normal[1] ? 'Y' : 'Z';
  const positive = normal[0] + normal[1] + normal[2] > 0;
  if (bounds[`${positive ? 'max' : 'min'}${axis}`] !== other[`${positive ? 'min' : 'max'}${axis}`]) return false;
  return ['X', 'Y', 'Z'].filter(a => a !== axis).every(a => other[`min${a}`] <= bounds[`min${a}`] && other[`max${a}`] >= bounds[`max${a}`]);
}
export function buildTerrainGeometry(world) {
  return buildGeometry(world, 'solid');
}

export function buildWaterGeometry(world) {
  return buildGeometry(world, 'water');
}

export function buildGlassGeometry(world) {
  return buildGeometry(world, 'glass');
}

export function buildLanternGeometry(world) {
  return buildGeometry(world, 'lantern');
}

export function buildFlowerGeometry(world) {
  return buildGeometry(world, 'flowers');
}

export function buildItemGeometry(block) {
  const mode = isFlower(block) ? 'flowers' : block === LANTERN ? 'lantern' : block === GLASS ? 'glass' : 'solid';
  return buildGeometry({ get: (x, y, z) => x === 0 && y === 0 && z === 0 ? block : 0 }, mode, { minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
}

export function buildChunkGeometry(world, cx, cz) {
  return Object.fromEntries(['solid', 'water', 'glass', 'lantern', 'flowers'].map(mode => [mode, buildGeometry(world, mode, { minX: cx * 16, maxX: cx * 16 + 16, minZ: cz * 16, maxZ: cz * 16 + 16 })]));
}

function buildGeometry(world, mode, { minX = 0, maxX = SIZE, minZ = 0, maxZ = SIZE } = {}) {
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = minZ; z < maxZ; z++) {
      for (let x = minX; x < maxX; x++) {
        const block = world.get(x, y, z);
        const included = mode === 'water' ? block === WATER : mode === 'glass' ? block === GLASS
          : mode === 'lantern' ? block === LANTERN : mode === 'flowers' ? isFlower(block) : isSolid(block) && block !== GLASS && block !== LANTERN;
        if (!included) continue;
        const door = doorState(block);
        const variation = 0.94 + (((x * 73 + y * 31 + z * 97) % 19) / 19) * 0.12;
        const parts = block === LANTERN ? lanternParts(x, y, z) : isFlower(block) ? flowerParts(block, x, y, z) : [blockBounds(block, x, y, z)];
        for (const [partIndex, bounds] of parts.entries()) {
          const tint = isFlower(block) ? new THREE.Color(bounds.color).multiplyScalar(variation).toArray() : [variation, variation, variation];
          if (mode === 'water') bounds.maxY = y + (world.get(x, y + 1, z) === WATER ? 1 : 0.88);
          for (const { normal, corners } of FACES) {
            const neighbor = world.get(x + normal[0], y + normal[1], z + normal[2]);
            if (door) {
              const other = doorState(neighbor);
              if (normal[1] && other && other.facing === door.facing && other.open === door.open) continue;
            } else if (block !== LANTERN && !isFlower(block) && (isOpaque(neighbor) || isSlab(neighbor) || mode === 'water' && neighbor === WATER || mode === 'glass' && neighbor === GLASS)) {
              const other = blockBounds(neighbor, x + normal[0], y + normal[1], z + normal[2]);
              if (neighbor === WATER && world.get(x + normal[0], y + normal[1] + 1, z + normal[2]) !== WATER) other.maxY -= 0.12;
              if (coversFace(bounds, other, normal)) continue;
            }
            const longX = bounds.maxX - bounds.minX > 0.5;
            const broadDoorFace = door && (longX ? normal[2] !== 0 : normal[0] !== 0);
            const tile = block === LANTERN ? (partIndex === 0 && normal[1] === 0 ? TILES.LANTERN : TILES.LANTERN_TOP)
              : door && !broadDoorFace ? TILES.PLANKS : faceTile(block, normal[1]);
            const faceUVs = tileUVs(tile);
            const offset = positions.length / 3;
            for (let corner = 0; corner < corners.length; corner++) {
              const [cx, cy, cz] = corners[corner];
              positions.push(bounds.minX + cx * (bounds.maxX - bounds.minX), bounds.minY + cy * (bounds.maxY - bounds.minY), bounds.minZ + cz * (bounds.maxZ - bounds.minZ));
              normals.push(...normal);
              colors.push(...tint);
              if (broadDoorFace) {
                const u = longX ? (door.facing >= 2 ? 1 - cx : cx) : (door.facing === 0 || door.facing === 3 ? 1 - cz : cz);
                uvs.push(faceUVs[0][0] + u * (faceUVs[1][0] - faceUVs[0][0]), faceUVs[0][1] + cy * (faceUVs[2][1] - faceUVs[0][1]));
              } else if (isSlab(block) && normal[1] === 0) {
                const v = bounds.minY - y + cy * (bounds.maxY - bounds.minY);
                uvs.push(faceUVs[corner][0], faceUVs[0][1] + v * (faceUVs[2][1] - faceUVs[0][1]));
              } else uvs.push(...faceUVs[corner]);
            }
            indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
