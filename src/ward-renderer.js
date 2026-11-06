import * as THREE from 'three';
import { MAX_VISIBLE_WARDS } from './shelter.js';

// A mark around the source, not a shield radius. The host's enclosed-room
// result determines protection; these meshes only communicate that result.
export class WardRenderer {
  constructor(scene) {
    this.active = new THREE.InstancedMesh(new THREE.TorusGeometry(.37, .025, 4, 24),
      new THREE.MeshBasicMaterial({ color: '#9ae6cf', transparent: true, opacity: .8, depthWrite: false }), MAX_VISIBLE_WARDS);
    this.inactive = new THREE.InstancedMesh(new THREE.TorusGeometry(.37, .018, 4, 24, Math.PI * 1.5),
      new THREE.MeshBasicMaterial({ color: '#c6a46c', transparent: true, opacity: .5, depthWrite: false }), MAX_VISIBLE_WARDS);
    this.active.name = 'active-ward-marks'; this.inactive.name = 'inactive-ward-marks';
    for (const mesh of [this.active, this.inactive]) { mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh); }
    this.transform = new THREE.Object3D(); this.transform.rotation.x = -Math.PI / 2;
  }

  sync(wards = []) {
    this.active.count = this.inactive.count = 0;
    for (const ward of wards.slice(0, MAX_VISIBLE_WARDS)) {
      const mesh = ward.active ? this.active : this.inactive;
      this.transform.position.set(ward.x + .5, ward.y + .035, ward.z + .5);
      this.transform.updateMatrix(); mesh.setMatrixAt(mesh.count++, this.transform.matrix);
    }
    for (const mesh of [this.active, this.inactive]) mesh.instanceMatrix.needsUpdate = true;
  }

  update(seconds) { this.active.material.opacity = .7 + .1 * Math.sin(seconds * 2); }
}

export function shelterDescription(shelter) {
  if (!shelter || shelter.state === 'checking') {
    if (shelter?.reason === 'unloaded') return 'Checking shelter · Nearby terrain loading';
    if (shelter?.reason === 'capacity') return 'Checking shelter · Close doors to separate large areas';
    return 'Checking shelter · Verifying enclosure';
  }
  if (shelter.state === 'protected') return shelter.power?.low ? 'Protected · Ward charge low' : 'Protected · Ward active';
  if (shelter.state === 'sheltered') return shelter.reason === 'no_power' ? 'Shelter enclosed · Ward needs power' : 'Shelter enclosed · Add a ward emitter';
  if (shelter.reason === 'large') return 'Exposed · Find or finish an enclosed shelter';
  return 'Exposed · Seal walls, floor, roof and doors';
}

export function wardDescription(ward) {
  if (!ward) return 'Ward emitter · Checking protection';
  if (ward.powered === false) return ward.enabled === false ? 'Ward switched off · Protection inactive' : 'Ward empty · Load biomass cartridges';
  if (ward.active) return ward.low ? 'Ward active · Low charge' : 'Ward active · This enclosed room is protected';
  if (ward.reason === 'support') return 'Ward inactive · Needs a full-height support';
  if (ward.reason === 'unloaded') return 'Ward checking · Nearby terrain loading';
  if (ward.reason === 'calculating') return 'Ward checking · Verifying enclosure';
  if (ward.reason === 'capacity') return 'Ward checking · Close doors to separate large areas';
  if (ward.reason === 'large') return 'Ward inactive · Seal openings or divide large rooms';
  return 'Ward inactive · Seal walls, floor, roof and doors';
}
