import * as THREE from 'three';
import { SIZE } from './world.js';
import { DayClock, timeLabel } from './clock.js';
export { DAY_LENGTH, DayClock, timeLabel } from './clock.js';

const TAU = Math.PI * 2;
const smoothstep = (low, high, value) => {
  const t = THREE.MathUtils.clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = value => ((value % 1) + 1) % 1;
const SKY_COLORS = [
  [0, '#dba58d'], [0.08, '#c0dce8'], [0.25, '#bfdce5'],
  [0.42, '#e4b692'], [0.5, '#ce8e85'], [0.58, '#253758'],
  [0.75, '#101c36'], [0.92, '#253758'], [1, '#dba58d'],
].map(([time, color]) => [time, new THREE.Color(color)]);
const DAY_SKY = new THREE.Color('#e5f3ff');
const NIGHT_SKY = new THREE.Color('#b7c9ee');
const DAY_GROUND = new THREE.Color('#b1a68a');
const NIGHT_GROUND = new THREE.Color('#65718d');
const SUN_COLOR = new THREE.Color('#fff0d2');
const SUNSET_COLOR = new THREE.Color('#ffb37c');
const MOON_COLOR = new THREE.Color('#bdcff8');

export function sampleSky(phase) {
  const time = wrap(phase);
  const angle = time * TAU;
  const height = Math.sin(angle);
  const daylight = smoothstep(-0.12, 0.3, height);
  const sunDirection = new THREE.Vector3(-Math.cos(angle), height * 0.82, -height * 0.57).normalize();
  const activeDirection = sunDirection.clone().multiplyScalar(height >= 0 ? 1 : -1);
  activeDirection.y = Math.max(activeDirection.y, 0.12);
  activeDirection.normalize();
  const next = SKY_COLORS.findIndex(([at]) => at > time);
  const [start, startColor] = SKY_COLORS[next - 1];
  const [end, endColor] = SKY_COLORS[next];
  return {
    label: timeLabel(time),
    sky: new THREE.Color().lerpColors(startColor, endColor, smoothstep(start, end, time)),
    daylight,
    sunDirection,
    activeDirection,
    sunHeight: height,
    starOpacity: 1 - smoothstep(-0.28, -0.04, height),
    lightColor: height >= 0 ? new THREE.Color().lerpColors(SUNSET_COLOR, SUN_COLOR, smoothstep(0, 0.65, height)) : MOON_COLOR,
    lightIntensity: height >= 0 ? 2.6 * smoothstep(0, 0.4, height) : 0.65 * smoothstep(0, 0.4, -height),
    ambientIntensity: 1.35 + daylight * 0.65,
  };
}

function makeStars() {
  const positions = [];
  const colors = [];
  let seed = 8421;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 0; i < 280; i++) {
    const height = 0.08 + random() * 0.92;
    const angle = random() * TAU;
    const radius = Math.sqrt(1 - height * height);
    positions.push(Math.cos(angle) * radius * 84, height * 84, Math.sin(angle) * radius * 84);
    const brightness = 0.55 + random() * 0.45;
    colors.push(brightness * 0.9, brightness * 0.95, brightness);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const stars = new THREE.Points(geometry, new THREE.PointsMaterial({
    vertexColors: true, size: 2, sizeAttenuation: false,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  }));
  stars.name = 'stars';
  stars.renderOrder = -20;
  return stars;
}

export class WorldSky {
  clock = new DayClock();
  shadowElapsed = 0;
  forceShadow = true;
  externalClock = false;

  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.ambient = new THREE.HemisphereLight(DAY_SKY, DAY_GROUND, 2);
    this.ambient.name = 'daylight';
    this.light = new THREE.DirectionalLight(SUN_COLOR, 2.6);
    this.light.name = 'celestial-light';
    this.light.target.position.set(SIZE / 2, 0, SIZE / 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const extent = 48;
    Object.assign(this.light.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 150 });
    this.light.shadow.camera.updateProjectionMatrix();
    this.light.shadow.normalBias = 0.06;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.radius = 1.5;
    scene.add(this.ambient, this.light, this.light.target);

    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({ color: '#fff2bd', transparent: true, fog: false, depthWrite: false }));
    this.sun.name = 'sun-disc';
    this.sun.renderOrder = -10;
    this.moon = new THREE.Group();
    this.moon.name = 'moon-disc';
    this.moon.add(new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ color: '#d7e1eb', transparent: true, fog: false, depthWrite: false })));
    const craterMaterial = new THREE.MeshBasicMaterial({ color: '#aebfd2', transparent: true, fog: false, depthWrite: false });
    for (const [x, y, width] of [[-0.6, 0.5, 0.65], [0.7, -0.6, 0.8], [-0.7, -0.8, 0.35]]) {
      const crater = new THREE.Mesh(new THREE.PlaneGeometry(width, width), craterMaterial);
      crater.position.set(x, y, 0.01);
      this.moon.add(crater);
    }
    for (const part of this.moon.children) part.renderOrder = -10;
    this.stars = makeStars();
    this.group.add(this.sun, this.moon, this.stars);
    scene.add(this.group);
  }

  toggleHeld() {
    this.clock.held = !this.clock.held;
    this.forceShadow = true;
  }

  next() {
    this.clock.next();
    this.forceShadow = true;
  }

  update(seconds, camera) {
    if (!this.externalClock) this.clock.advance(seconds);
    const state = sampleSky(this.clock.phase);
    const targetX = Math.floor(camera.position.x / 8) * 8, targetZ = Math.floor(camera.position.z / 8) * 8;
    if (this.light.target.position.x !== targetX || this.light.target.position.z !== targetZ) {
      this.light.target.position.set(targetX, 0, targetZ); this.forceShadow = true;
    }
    this.group.position.copy(camera.position);
    this.sun.position.copy(state.sunDirection).multiplyScalar(76);
    this.moon.position.copy(state.sunDirection).multiplyScalar(-76);
    this.sun.quaternion.copy(camera.quaternion);
    this.moon.quaternion.copy(camera.quaternion);
    this.sun.visible = state.sunDirection.y > -0.04;
    this.moon.visible = state.sunDirection.y < 0.04;
    this.stars.visible = state.starOpacity > 0.01;
    this.stars.material.opacity = state.starOpacity;
    this.stars.rotation.y = this.clock.phase * TAU;
    this.scene.background.copy(state.sky);
    this.scene.fog.color.copy(state.sky);
    this.ambient.color.lerpColors(NIGHT_SKY, DAY_SKY, state.daylight);
    this.ambient.groundColor.lerpColors(NIGHT_GROUND, DAY_GROUND, state.daylight);
    this.ambient.intensity = state.ambientIntensity;
    this.light.color.copy(state.lightColor);
    this.light.intensity = state.lightIntensity;
    this.light.shadow.intensity = smoothstep(0.08, 0.45, Math.abs(state.sunHeight));

    // Cache shadows between five lighting updates per second, or indefinitely when held.
    if (!this.clock.held) this.shadowElapsed += seconds;
    if (this.forceShadow || this.shadowElapsed >= 0.2) {
      this.light.position.copy(state.activeDirection).multiplyScalar(75).add(this.light.target.position);
      this.renderer.shadowMap.needsUpdate = true;
      this.forceShadow = false;
      this.shadowElapsed = 0;
    }
    return state;
  }
}
