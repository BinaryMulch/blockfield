import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DAY_LENGTH, DayClock, WorldSky, sampleSky, timeLabel } from '../src/sky.js';

test('the clock wraps a complete day and holding time discards elapsed time', () => {
  const clock = new DayClock();
  const start = clock.phase;
  clock.advance(DAY_LENGTH);
  assert.ok(Math.abs(clock.phase - start) < 0.000001);
  clock.held = true;
  clock.advance(DAY_LENGTH / 2);
  assert.ok(Math.abs(clock.phase - start) < 0.000001);
  clock.held = false;
  clock.advance(DAY_LENGTH / 4);
  assert.ok(Math.abs(clock.phase - start - 0.25) < 0.000001);
  const before = clock.phase;
  clock.advance(-10);
  assert.equal(clock.phase, before);
});

test('time shortcuts visit sunset, night, sunrise, and day while preserving hold', () => {
  const clock = new DayClock();
  clock.held = true;
  for (const label of ['Sunset', 'Night', 'Sunrise', 'Day']) {
    clock.next();
    assert.equal(timeLabel(clock.phase), label);
    assert.equal(clock.held, true);
  }
});

test('sky and light remain finite and continuous across dawn, dusk, and the day boundary', () => {
  for (let phase = 0; phase <= 1; phase += 0.005) {
    const sky = sampleSky(phase);
    const next = sampleSky(phase + 0.00001);
    assert.ok(sky.activeDirection.y > 0);
    assert.ok(Math.abs(sky.sunDirection.length() - 1) < 0.000001);
    assert.ok(sky.starOpacity >= 0 && sky.starOpacity <= 1);
    assert.ok(Number.isFinite(sky.lightIntensity) && sky.lightIntensity >= 0);
    assert.ok(sky.sky.toArray().every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1));
    assert.ok(Math.hypot(...sky.sky.toArray().map((channel, i) => channel - next.sky.toArray()[i])) < 0.01);
  }
  const day = sampleSky(0.25), night = sampleSky(0.75);
  assert.equal(day.starOpacity, 0);
  assert.equal(night.starOpacity, 1);
  assert.ok(night.lightIntensity > 0 && night.ambientIntensity > 1, 'night must remain usable for building');
  assert.ok(night.sky.toArray().reduce((a, b) => a + b) < day.sky.toArray().reduce((a, b) => a + b));
  assert.ok(sampleSky(0).sky.equals(sampleSky(1).sky));
});

test('sky follows the camera, refreshes moving shadows sparingly, and reuses held shadows', () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0, 20, 65);
  const renderer = { shadowMap: { needsUpdate: false } };
  const sky = new WorldSky(scene, renderer);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 100);
  camera.position.set(120, 18, -30);
  sky.update(0, camera);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  renderer.shadowMap.needsUpdate = false;
  sky.update(0.1, camera);
  assert.equal(renderer.shadowMap.needsUpdate, false);
  sky.update(0.11, camera);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  sky.toggleHeld();
  sky.update(0, camera);
  renderer.shadowMap.needsUpdate = false;
  const heldTime = sky.clock.phase;
  camera.position.x += 15;
  sky.update(10, camera);
  assert.equal(sky.clock.phase, heldTime);
  assert.equal(renderer.shadowMap.needsUpdate, true, 'moving to a new area refreshes held-time shadows');
  assert.equal(sky.light.target.position.x, Math.floor(camera.position.x / 8) * 8);
  assert.ok(sky.group.position.equals(camera.position));
  scene.updateMatrixWorld(true);
  assert.ok(Math.abs(sky.sun.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position) - 76) < 0.00001);
  sky.next();
  sky.next();
  sky.update(0, camera);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(sky.moon.visible, true);
  assert.equal(sky.sun.visible, false);
  assert.equal(sky.stars.visible, true);
  scene.traverse(object => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
});
