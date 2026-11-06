import test from 'node:test';
import assert from 'node:assert/strict';
import { HotbarScroll } from '../src/input.js';
import { Inventory } from '../src/inventory.js';

test('wheel notches select adjacent hotbar slots and wrap in both directions', () => {
  const scroll = new HotbarScroll(), inventory = new Inventory();
  const wheel = (deltaY, deltaMode = 0) => {
    const direction = scroll.update({ deltaX: 0, deltaY, deltaMode }, 0);
    inventory.select((inventory.selected + direction + inventory.hotbar.length) % inventory.hotbar.length);
  };
  wheel(-100);
  assert.equal(inventory.selected, 8);
  wheel(100);
  assert.equal(inventory.selected, 0);
  wheel(1, 1);
  assert.equal(inventory.selected, 1);
  wheel(-1, 2);
  assert.equal(inventory.selected, 0);
});

test('trackpad scrolling accumulates, changes direction promptly, and resets after pauses', () => {
  const scroll = new HotbarScroll();
  const wheel = (deltaY, now) => scroll.update({ deltaX: 0, deltaY, deltaMode: 0 }, now);
  assert.equal(wheel(20, 0), 0);
  assert.equal(wheel(20, 16), 1);
  assert.equal(wheel(30, 32), 0);
  assert.equal(wheel(-20, 48), 0);
  assert.equal(wheel(-20, 64), -1);
  assert.equal(wheel(30, 80), 0);
  assert.equal(wheel(20, 400), 0, 'a new gesture must not inherit old motion');
  scroll.reset();
  assert.equal(wheel(20, 416), 0, 'pausing clears partial scrolling');
  assert.equal(scroll.update({ deltaX: -50, deltaY: 0, deltaMode: 0 }, 432), -1);
  assert.equal(wheel(0, 448), 0);
});
