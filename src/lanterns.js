import * as THREE from 'three';
import { LANTERN, WARD_LANTERN } from './world.js';
import { WorldJobs } from './jobs.js';
import { lightBounds, captureLightBlocks, buildLanternField } from './lantern-field.js';
export { LANTERN_RANGE } from './lantern-field.js';

function fieldTexture(data = new Uint8Array(1), width = 1, height = 1, depth = 1) {
  const texture = new THREE.Data3DTexture(data, width, height, depth);
  texture.format = THREE.RedFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const varyings = '\nvarying vec3 vLanternPosition;\nvarying vec3 vLanternNormal;\n';
const uniforms = `
uniform highp sampler3D lanternField;
uniform vec3 lanternOrigin;
uniform vec3 lanternSize;
uniform vec3 lanternColor;
uniform float lanternStrength;
uniform float lanternSurfaceOffset;
`;

export class LanternLighting {
  revision = 0;
  dirty = false;
  busy = false;
  sourceCount = 0;
  chunkSources = new Map();

  constructor(scene, world, { jobs, onError = console.error } = {}) {
    this.jobs = jobs || null;
    this.useWorker = jobs === undefined && typeof Worker === 'function';
    this.onError = onError;
    this.uniforms = { lanternField: { value: fieldTexture() }, lanternOrigin: { value: new THREE.Vector3() },
      lanternSize: { value: new THREE.Vector3(1, 1, 1) }, lanternColor: { value: new THREE.Color('#d8e7ef') }, lanternStrength: { value: 1.25 } };
    this.sync(world);
  }

  applyMaterial(material, { surfaceOffset = 0.02 } = {}) {
    if (material.userData.voxelLanterns) return;
    material.userData.voxelLanterns = true;
    material.customProgramCacheKey = () => 'voxel-lantern-field-v1';
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.uniforms.lanternSurfaceOffset = { value: surfaceOffset };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>${varyings}`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 lanternPosition = vec4(transformed, 1.0);
          vec3 lanternNormal = objectNormal;
          #ifdef USE_INSTANCING
            lanternPosition = instanceMatrix * lanternPosition;
            lanternNormal = mat3(instanceMatrix) * lanternNormal;
          #endif
          vLanternPosition = (modelMatrix * lanternPosition).xyz;
          vLanternNormal = normalize(mat3(modelMatrix) * lanternNormal);
        `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${varyings}${uniforms}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec3 lanternCell = floor(vLanternPosition + normalize(vLanternNormal) * lanternSurfaceOffset) - lanternOrigin;
          if (all(greaterThanEqual(lanternCell, vec3(0.0))) && all(lessThan(lanternCell, lanternSize))) {
            float blockLight = texture(lanternField, (lanternCell + 0.5) / lanternSize).r;
            totalEmissiveRadiance += diffuseColor.rgb * lanternColor * lanternStrength * blockLight;
          }
        `);
    };
    material.needsUpdate = true;
  }

  clear() {
    const texture = this.uniforms.lanternField.value;
    if (texture.image.width !== 1 || this.sourceCount) {
      texture.dispose(); this.uniforms.lanternField.value = fieldTexture();
    }
    this.uniforms.lanternSize.value.set(1, 1, 1); this.sourceCount = 0;
  }

  sync(world, keys = null) {
    this.world = world; this.revision++; this.dirty = true;
    if (!keys) { this.chunkSources.clear(); this.clear(); this.area = null; }
    if (world.chunks) {
      for (const key of keys || world.chunks.keys()) {
        const chunk = world.chunks.get(key);
        if (chunk) this.chunkSources.set(key, (chunk.blocks.includes(LANTERN) || chunk.blocks.includes(WARD_LANTERN)));
        else this.chunkSources.delete(key);
      }
      this.hasSources = [...this.chunkSources.values()].some(Boolean);
    } else this.hasSources = (world.blocks.includes(LANTERN) || world.blocks.includes(WARD_LANTERN));
    if (!this.hasSources) { this.clear(); this.dirty = false; }
  }

  update(seconds, position, daylight) {
    if (this.disposed) return;
    this.uniforms.lanternStrength.value = 1.25 * (1 - 0.6 * THREE.MathUtils.clamp(daylight, 0, 1));
    if (!this.hasSources) return;
    const bounds = lightBounds(this.world, position), area = `${bounds.x},${bounds.z},${bounds.width},${bounds.depth}`;
    if (area !== this.area) { this.area = area; this.revision++; this.dirty = true; }
    if (!this.dirty || this.busy) return this.pending;
    if (this.world.chunks && ![...this.chunkSources].some(([key, present]) => {
      if (!present) return false;
      const [cx, cz] = key.split(',').map(Number);
      return cx * 16 >= bounds.x && cx * 16 < bounds.x + bounds.width && cz * 16 >= bounds.z && cz * 16 < bounds.z + bounds.depth;
    })) { this.clear(); this.dirty = false; return; }
    this.dirty = false; this.busy = true;
    const revision = this.revision, blocks = captureLightBlocks(this.world, bounds);
    const job = { kind: 'light', ...bounds, blocks };
    if (this.useWorker && !this.jobs) this.jobs = new WorldJobs();
    const work = this.jobs ? this.jobs.call(job, [blocks.buffer]) : Promise.resolve(buildLanternField(job));
    this.pending = work.then(({ light, sources }) => {
      if (revision !== this.revision) return;
      this.sourceCount = sources;
      if (!sources) { this.clear(); return; }
      const { width, height, depth } = bounds, texture = this.uniforms.lanternField.value;
      if (texture.image.width === width && texture.image.height === height && texture.image.depth === depth) {
        texture.image.data = light; texture.needsUpdate = true;
      } else {
        texture.dispose(); this.uniforms.lanternField.value = fieldTexture(light, width, height, depth);
      }
      this.uniforms.lanternOrigin.value.set(bounds.x, 0, bounds.z);
      this.uniforms.lanternSize.value.set(width, height, depth);
    }).catch(error => { if (!this.disposed) { this.clear(); this.onError(error); } }).finally(() => { this.busy = false; this.pending = null; });
    return this.pending;
  }

  dispose() { this.disposed = true; this.revision++; this.jobs?.dispose(); this.uniforms.lanternField.value.dispose(); }
}
