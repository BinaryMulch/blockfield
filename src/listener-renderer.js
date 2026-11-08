import * as THREE from 'three';

// A restrained, faceless raincoat silhouette. Gameplay stays on the host.
export class ListenerRenderer {
  constructor(scene, prepareMaterial = () => {}) {
    this.group = new THREE.Group(); this.group.name = 'listener'; this.group.visible = false; scene.add(this.group);
    this.geometry = new THREE.BoxGeometry(); this.phase = 0; this.snapshot = null; this.sequence = null; this.crouch = 0;
    this.materials = [new THREE.MeshLambertMaterial({ color: '#263139', transparent: true }), new THREE.MeshLambertMaterial({ color: '#111b22', transparent: true }), new THREE.MeshLambertMaterial({ color: '#59676b', transparent: true })];
    for (const material of this.materials) prepareMaterial(material);
    const part = (parent, scale, position, material = this.materials[0]) => { const mesh = new THREE.Mesh(this.geometry, material); mesh.scale.set(...scale); mesh.position.set(...position); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
    this.body = part(this.group, [.46, 1.05, .3], [0, 1.28, 0]);
    part(this.group, [.52, .32, .34], [0, .85, 0]);
    this.head = part(this.group, [.34, .45, .3], [0, 2.08, 0], this.materials[1]);
    part(this.head, [.68, .72, .08], [0, -.02, -.52], this.materials[2]);
    this.limbs = [];
    for (const sign of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(sign * .13, .82, 0); this.group.add(leg);
      part(leg, [.15, .8, .2], [0, -.4, 0], this.materials[1]);
      const arm = new THREE.Group(); arm.position.set(sign * .32, 1.74, 0); this.group.add(arm);
      part(arm, [.13, 1.12, .17], [0, -.56, 0]); this.limbs.push({ leg, arm, sign });
    }
  }
  sync(state) {
    if (!state) { this.snapshot = null; this.sequence = null; this.group.visible = false; this.crouch = 0; return []; }
    const events = [];
    if (this.sequence && state.state !== 'dormant') {
      if (state.cueSeq > this.sequence.cueSeq) events.push({ kind: state.cueKind, source: { x: state.x, y: state.y + 1.8, z: state.z } });
      if (state.stepSeq > this.sequence.stepSeq) events.push({ kind: 'step', source: { x: state.x, y: state.y + .1, z: state.z } });
    }
    if (!this.snapshot || this.snapshot.state === 'dormant') this.group.position.set(state.x, state.y, state.z);
    this.snapshot = state; this.sequence = { cueSeq: state.cueSeq, stepSeq: state.stepSeq };
    return events;
  }
  update(seconds, world, viewer) {
    const p = this.snapshot;
    const loaded = p && (!world.chunks || world.getChunk(Math.floor(p.x / 16), Math.floor(p.z / 16), false));
    const visible = !!p && p.state !== 'dormant' && !!loaded && Math.hypot(p.x - viewer.x, p.z - viewer.z) < 56;
    const changed = visible !== this.group.visible; this.group.visible = visible;
    if (!visible) return changed;
    const amount = Math.min(1, seconds * 9), before = this.group.position.clone();
    this.group.position.lerp(new THREE.Vector3(p.x, p.y, p.z), amount); this.group.rotation.y += Math.atan2(Math.sin(p.yaw - this.group.rotation.y), Math.cos(p.yaw - this.group.rotation.y)) * amount;
    const moved = before.distanceTo(this.group.position); this.phase += moved * Math.PI / .9;
    const movement = Math.min(1, moved / Math.max(.001, seconds));
    this.crouch += ((p.crouched ? 1 : 0) - this.crouch) * amount;
    this.body.position.y = 1.28 - this.crouch * .22; this.body.scale.y = 1.05 - this.crouch * .18;
    this.head.position.y = 2.08 - this.crouch * .48; this.head.rotation.x = this.crouch * .2;
    for (const { leg, arm, sign } of this.limbs) { leg.rotation.x += (Math.sin(this.phase) * sign * .48 * movement - leg.rotation.x) * amount; arm.rotation.x += ((p.winding ? -.9 : p.pressing ? -.65 : Math.sin(this.phase + .6) * sign * .1 * movement) - arm.rotation.x) * amount; arm.position.y = 1.74 - this.crouch * .35; }
    this.head.rotation.z = p.state === 'search' ? Math.sin(this.phase * .2) * .12 : p.state === 'shadow' ? .1 : p.state === 'stalk' ? .06 : .02;
    for (const material of this.materials) material.opacity = p.alpha;
    return changed || moved > .002 || p.alpha < 1 || Math.abs(this.crouch - (p.crouched ? 1 : 0)) > .01;
  }
  dispose() { this.group.removeFromParent(); this.geometry.dispose(); for (const material of this.materials) material.dispose(); }
}
