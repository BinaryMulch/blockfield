import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickAxes, touchRotation } from '../src/touch.js';

test('touch stick has a dead zone, analog speed, and a bounded diagonal', () => {
  assert.deepEqual(joystickAxes(2, -2), { strafe: 0, forward: 0, x: 0, y: 0 });
  assert.equal(joystickAxes(0, -22).forward, 0.5);
  assert.equal(joystickAxes(44, 0).strafe, 1);
  const diagonal = joystickAxes(100, -100);
  assert.ok(Math.abs(Math.hypot(diagonal.strafe, diagonal.forward) - 1) < 1e-12);
  assert.ok(diagonal.strafe > 0 && diagonal.forward > 0);
  assert.ok(joystickAxes(-22, 22).strafe < 0 && joystickAxes(-22, 22).forward < 0);
});

test('touch look turns naturally and cannot flip over at the poles', () => {
  assert.equal(touchRotation(0, 0, 100, 0).yaw, -0.4);
  assert.equal(touchRotation(0, 0, 0, -100).pitch, 0.4);
  assert.equal(touchRotation(0, 0, 0, -10000).pitch, Math.PI / 2 - 0.05);
  assert.equal(touchRotation(0, 0, 0, 10000).pitch, -Math.PI / 2 + 0.05);
});
