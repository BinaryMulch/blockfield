import * as THREE from 'three';

function nameTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.font = '600 32px -apple-system, sans-serif';
  canvas.width = Math.max(128, Math.min(512, Math.ceil(context.measureText(name).width) + 40));
  context.fillStyle = '#203c33dd';
  context.fillRect(0, 2, canvas.width, 60);
  context.font = '600 32px -apple-system, sans-serif';
  context.fillStyle = '#fffbea';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(name, canvas.width / 2, 32, canvas.width - 24);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class OtherPlayers {
  avatars = new Map();
  geometry = new THREE.BoxGeometry();

  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'other-players';
    scene.add(this.group);
  }

  create(player) {
    const group = new THREE.Group();
    group.name = `player-${player.id}`;
    const materials = { shirt: new THREE.MeshLambertMaterial({ color: player.color }), skin: new THREE.MeshLambertMaterial({ color: '#e0b18a' }),
      dark: new THREE.MeshLambertMaterial({ color: '#394e56' }), eyes: new THREE.MeshLambertMaterial({ color: '#263c35' }) };
    const part = (parent, size, position, material) => {
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.scale.set(...size); mesh.position.set(...position);
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const head = new THREE.Group(); head.position.y = 1.52; group.add(head);
    part(head, [0.46, 0.46, 0.46], [0, 0, 0], materials.skin);
    for (const x of [-0.1, 0.1]) part(head, [0.055, 0.055, 0.025], [x, 0.025, -0.235], materials.eyes);
    part(group, [0.48, 0.65, 0.28], [0, 0.975, 0], materials.shirt);
    const limbs = [];
    for (const sign of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(sign * 0.14, 0.65, 0); group.add(leg);
      part(leg, [0.19, 0.65, 0.24], [0, -0.325, 0], materials.dark);
      const arm = new THREE.Group(); arm.position.set(sign * 0.34, 1.27, 0); group.add(arm);
      part(arm, [0.16, 0.6, 0.22], [0, -0.3, 0], materials.shirt);
      limbs.push({ leg, arm, sign });
    }
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(player.name), depthWrite: false }));
    label.position.y = 2.08; label.scale.set(label.material.map.image.width / 64 * 0.26, 0.26, 1); group.add(label);
    group.position.set(player.x, player.y, player.z);
    group.rotation.y = player.yaw;
    this.group.add(group);
    const avatar = { group, head, limbs, label, materials, target: player, name: player.name, stride: 0 };
    this.avatars.set(player.id, avatar);
    return avatar;
  }

  sync(players, selfId) {
    const ids = new Set();
    let changed = false;
    for (const player of players) {
      if (player.id === selfId) continue;
      ids.add(player.id);
      let avatar = this.avatars.get(player.id);
      if (!avatar) { avatar = this.create(player); changed = true; }
      avatar.target = player;
      if (avatar.name !== player.name) {
        avatar.label.material.map.dispose();
        avatar.label.material.map = nameTexture(player.name);
        avatar.label.scale.x = avatar.label.material.map.image.width / 64 * 0.26;
        avatar.name = player.name;
      }
    }
    for (const [id, avatar] of this.avatars) if (!ids.has(id)) {
      this.group.remove(avatar.group);
      for (const material of Object.values(avatar.materials)) material.dispose();
      avatar.label.material.map.dispose(); avatar.label.material.dispose();
      this.avatars.delete(id);
      changed = true;
    }
    return changed;
  }

  update(seconds) {
    const blend = 1 - Math.exp(-seconds * 14);
    let moved = false;
    for (const avatar of this.avatars.values()) {
      const { group, target, head, limbs } = avatar;
      const distance = Math.hypot(target.x - group.position.x, target.z - group.position.z);
      const turn = Math.atan2(Math.sin(target.yaw - group.rotation.y), Math.cos(target.yaw - group.rotation.y));
      if (distance > 0.01 || Math.abs(target.y - group.position.y) > 0.01 || Math.abs(turn) > 0.01 || Math.abs(target.pitch - head.rotation.x) > 0.01) moved = true;
      group.position.lerp(new THREE.Vector3(target.x, target.y, target.z), blend);
      group.rotation.y += turn * blend;
      head.rotation.x += (target.pitch - head.rotation.x) * blend;
      avatar.stride += distance * blend * 7;
      const swing = target.active && !target.flying ? Math.sin(avatar.stride) * Math.min(0.45, distance * 2) : 0;
      for (const { leg, arm, sign } of limbs) { leg.rotation.x = swing * sign; arm.rotation.x = -swing * sign; }
    }
    return moved;
  }
}
