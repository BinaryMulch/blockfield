import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, SIZE, HEIGHT, GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, PLAYER_HEIGHT, overlapsPlayer, spawnPlayer, stepPlayer } from '../src/world.js';
import { buildTerrainGeometry, buildWaterGeometry } from '../src/terrain.js';
import { ATLAS_WIDTH, ATLAS_HEIGHT, TILE_SIZE, TILE_PADDING, TILE_STRIDE, TILES, generateTextureTiles } from '../src/textures.js';

const DT = 1 / 120;
function flatWorld() {
  const world = new World({ generate: false });
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) world.set(x, 0, z, STONE);
  }
  return world;
}
function advance(player, world, frames, input = {}) {
  for (let frame = 0; frame < frames; frame++) stepPlayer(player, world, input, DT);
}

test('generated terrain has a solid foundation, expected surface materials, and a clear spawn', () => {
  const world = new World();
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      assert.equal(world.get(x, 0, z), STONE);
      assert.ok([GRASS, LEAVES, SAND, WATER].includes(world.get(x, world.surface(x, z) - 1, z)));
    }
  }
  const player = spawnPlayer(world);
  assert.ok(player.y > world.surface(Math.floor(player.x), Math.floor(player.z)));
  assert.ok(player.y + PLAYER_HEIGHT < HEIGHT);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let y = 0; y < HEIGHT; y++) {
        assert.ok(![WOOD, LEAVES].includes(world.get(Math.floor(player.x) + dx, y, Math.floor(player.z) + dz)));
      }
    }
  }
});

test('trees are rooted in grass with continuous trunks and bounded leaf canopies', () => {
  const world = new World();
  let trees = 0;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      for (let y = 1; y < HEIGHT; y++) {
        if (world.get(x, y, z) !== WOOD || world.get(x, y - 1, z) !== GRASS) continue;
        trees++;
        let trunkHeight = 0;
        while (world.get(x, y + trunkHeight, z) === WOOD) trunkHeight++;
        assert.ok(trunkHeight === 4 || trunkHeight === 5);
        assert.equal(world.get(x, y + trunkHeight, z), LEAVES);
        assert.equal(world.get(x, y + trunkHeight + 1, z), LEAVES);
        assert.ok(y + trunkHeight + 1 < HEIGHT);
        assert.ok(x >= 2 && x < SIZE - 2 && z >= 2 && z < SIZE - 2);
      }
    }
  }
  assert.ok(trees >= 20, `expected scattered trees, found ${trees}`);
  assert.deepEqual(world.blocks, new World().blocks, 'world generation should be repeatable');
});

test('out-of-bounds edits cannot wrap around to other cells', () => {
  const world = new World({ generate: false });
  assert.equal(world.set(SIZE, 0, 0, STONE), false);
  assert.equal(world.set(0, HEIGHT, 0, STONE), false);
  assert.equal(world.set(-1, 0, 0, STONE), false);
  assert.equal(world.set(0.5, 0, 0, STONE), false);
  assert.equal(world.set(0, 0, 0, 255), false);
  assert.equal(world.get(0, 0, 1), 0);
});

test('gravity lands the player on the surface without sinking', () => {
  const world = flatWorld();
  const player = { x: 8.5, y: 12, z: 8.5, vy: 0, grounded: false };
  advance(player, world, 360);
  assert.equal(player.y, 1);
  assert.equal(player.vy, 0);
  assert.equal(player.grounded, true);
});

test('jump rises, cannot repeat in midair, and lands', () => {
  const world = flatWorld();
  const player = { x: 8.5, y: 1, z: 8.5, vy: 0, grounded: true };
  stepPlayer(player, world, { jump: true }, DT);
  const initialVelocity = player.vy;
  advance(player, world, 20, { jump: true });
  assert.ok(player.y > 2);
  assert.ok(player.vy < initialVelocity);
  advance(player, world, 140);
  assert.equal(player.y, 1);
  assert.equal(player.grounded, true);
});

test('collision stops movement into walls on either horizontal axis', () => {
  const world = flatWorld();
  for (let y = 1; y <= 3; y++) {
    for (let n = 0; n < SIZE; n++) {
      world.set(10, y, n, STONE);
      world.set(n, y, 5, STONE);
    }
  }
  const player = { x: 8.5, y: 1, z: 8.5, vy: 0, grounded: true };
  advance(player, world, 120, { strafe: 1 });
  assert.ok(Math.abs(player.x - 9.7) < 0.00001);
  advance(player, world, 120, { forward: 1 });
  assert.ok(Math.abs(player.z - 6.3) < 0.00001);
});

test('jumping into a ceiling stops upward velocity', () => {
  const world = flatWorld();
  world.set(8, 3, 8, STONE);
  const player = { x: 8.5, y: 1, z: 8.5, vy: 0, grounded: true };
  stepPlayer(player, world, { jump: true }, DT);
  advance(player, world, 4);
  assert.ok(player.y + PLAYER_HEIGHT <= 3);
  assert.ok(player.vy <= 0);
  advance(player, world, 120);
  assert.equal(player.y, 1);
});

test('diagonal movement has the same speed as forward movement', () => {
  const world = flatWorld();
  const start = { x: 20.5, y: 1, z: 20.5, vy: 0, grounded: true };
  const straight = { ...start };
  const diagonal = { ...start };
  advance(straight, world, 120, { forward: 1 });
  advance(diagonal, world, 120, { forward: 1, strafe: 1 });
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.z - start.z) - (start.z - straight.z)) < 0.00001);
});

test('sprint is faster, stops on release, and normalizes diagonal speed', () => {
  const world = flatWorld();
  const start = { x: 30.5, y: 1, z: 30.5, vy: 0, grounded: true };
  const walk = { ...start };
  const sprint = { ...start };
  const diagonal = { ...start };
  advance(walk, world, 120, { forward: 1 });
  advance(sprint, world, 120, { forward: 1, sprint: true });
  advance(diagonal, world, 120, { forward: 1, strafe: 1, sprint: true });
  assert.ok(Math.abs(start.z - walk.z - 4.5) < 0.00001);
  assert.ok(Math.abs(start.z - sprint.z - 7.5) < 0.00001);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.z - start.z) - 7.5) < 0.00001);
  const beforeRelease = sprint.z;
  advance(sprint, world, 120, { forward: 1 });
  assert.ok(Math.abs(beforeRelease - sprint.z - 4.5) < 0.00001);
});

test('sprinting collides with wood and leaf blocks without passing through', () => {
  const world = flatWorld();
  world.set(8, 1, 5, WOOD);
  world.set(8, 2, 5, LEAVES);
  const player = { x: 8.5, y: 1, z: 8.5, vy: 0, grounded: true };
  advance(player, world, 120, { forward: 1, sprint: true });
  assert.ok(Math.abs(player.z - 6.3) < 0.00001);
  world.set(8, 1, 5, 0);
  advance(player, world, 120, { forward: 1, sprint: true });
  assert.ok(Math.abs(player.z - 6.3) < 0.00001);
  world.set(8, 2, 5, 0);
  advance(player, world, 30, { forward: 1, sprint: true });
  assert.ok(player.z < 5);
});

test('removing the block underfoot makes the player fall', () => {
  const world = flatWorld();
  world.set(8, 1, 8, DIRT);
  const player = { x: 8.5, y: 2, z: 8.5, vy: 0, grounded: true };
  world.set(8, 1, 8, 0);
  advance(player, world, 120);
  assert.equal(player.y, 1);
});

test('placement detects the player body but permits blocks underfoot', () => {
  const player = { x: 8.5, y: 1, z: 8.5 };
  assert.equal(overlapsPlayer(player, 8, 1, 8), true);
  assert.equal(overlapsPlayer(player, 8, 2, 8), true);
  assert.equal(overlapsPlayer(player, 8, 0, 8), false);
  assert.equal(overlapsPlayer(player, 9, 1, 8), false);
});

test('meshing omits shared faces and restores them after removing a block', () => {
  const world = new World({ generate: false });
  world.set(8, 1, 8, STONE);
  world.set(9, 1, 8, STONE);
  const joined = buildTerrainGeometry(world);
  assert.equal(joined.index.count, 10 * 6);
  world.set(9, 1, 8, 0);
  const single = buildTerrainGeometry(world);
  assert.equal(single.index.count, 6 * 6);
  joined.dispose();
  single.dispose();
});

test('all six block faces have correct lighting normals and outward picking normals', () => {
  const world = new World({ generate: false });
  world.set(8, 8, 8, STONE);
  const geometry = buildTerrainGeometry(world);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const center = new THREE.Vector3(8.5, 8.5, 8.5);
  for (const vector of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const normal = new THREE.Vector3(...vector);
    const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, 3), normal.clone().negate());
    const [hit] = ray.intersectObject(mesh);
    assert.ok(hit, `missing face ${vector}`);
    assert.deepEqual(hit.face.normal.toArray(), vector);
    for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) {
      assert.deepEqual(new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('normal'), vertex).toArray(), vector);
    }
    assert.ok(Math.abs(hit.distance - 2.5) < 0.00001);
  }
  geometry.dispose();
  material.dispose();
});

test('procedural materials are distinct and repeatable, with cutout item sprites and translucent glass', () => {
  const tiles = generateTextureTiles();
  assert.deepEqual(tiles, generateTextureTiles());
  const signatures = new Set();
  for (const [tileId, tile] of tiles.entries()) {
    assert.equal(tile.length, TILE_SIZE * TILE_SIZE * 4);
    const colors = new Set();
    for (let pixel = 0; pixel < tile.length; pixel += 4) {
      if (tileId === TILES.GLASS) assert.ok([18, 80, 190].includes(tile[pixel + 3]));
      else if ([TILES.SAPLING, TILES.WOODEN_PEGS, TILES.CHARCOAL, TILES.STONE_HAMMER].includes(tileId)) assert.ok([0, 255].includes(tile[pixel + 3]));
      else assert.equal(tile[pixel + 3], 255);
      colors.add(`${tile[pixel]},${tile[pixel + 1]},${tile[pixel + 2]}`);
    }
    assert.ok(colors.size > 10, 'each material needs visible variation');
    signatures.add(Buffer.from(tile).toString('base64'));
  }
  assert.equal(signatures.size, tiles.length);
  for (const tile of [TILES.SAPLING, TILES.WOODEN_PEGS, TILES.CHARCOAL, TILES.STONE_HAMMER]) {
    const alpha = [...tiles[tile]].filter((_, i) => i % 4 === 3);
    assert.ok(alpha.includes(0) && alpha.includes(255), 'item sprites need a clear silhouette');
  }
  const grassSide = tiles[TILES.GRASS_SIDE];
  for (let x = 0; x < TILE_SIZE; x++) {
    assert.ok(grassSide[x * 4 + 1] > grassSide[x * 4], 'grass fringe belongs along the top edge');
    const bottom = (x + (TILE_SIZE - 1) * TILE_SIZE) * 4;
    assert.ok(grassSide[bottom] > grassSide[bottom + 1], 'dirt belongs below the grass fringe');
  }
});

test('all block faces map to the correct atlas tile with upright side textures', () => {
  const cases = [
    [GRASS, { 1: TILES.GRASS_TOP, 0: TILES.GRASS_SIDE, '-1': TILES.DIRT }],
    [DIRT, { 1: TILES.DIRT, 0: TILES.DIRT, '-1': TILES.DIRT }],
    [STONE, { 1: TILES.STONE, 0: TILES.STONE, '-1': TILES.STONE }],
    [WOOD, { 1: TILES.WOOD_END, 0: TILES.BARK, '-1': TILES.WOOD_END }],
    [LEAVES, { 1: TILES.LEAVES, 0: TILES.LEAVES, '-1': TILES.LEAVES }],
    [SAND, { 1: TILES.SAND, 0: TILES.SAND, '-1': TILES.SAND }],
    [PLANKS, { 1: TILES.PLANKS, 0: TILES.PLANKS, '-1': TILES.PLANKS }],
    [BRICKS, { 1: TILES.BRICKS, 0: TILES.BRICKS, '-1': TILES.BRICKS }],
  ];
  for (const [block, expected] of cases) {
    const world = new World({ generate: false });
    world.set(8, 8, 8, block);
    const geometry = buildTerrainGeometry(world);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    assert.equal(uv.count, positions.count);
    for (let face = 0; face < positions.count; face += 4) {
      const normalY = normals.getY(face);
      const tile = expected[normalY];
      const left = (tile % 4) * TILE_STRIDE + TILE_PADDING;
      const top = Math.floor(tile / 4) * TILE_STRIDE + TILE_PADDING;
      const corners = new Set();
      for (let vertex = face; vertex < face + 4; vertex++) {
        const x = uv.getX(vertex) * ATLAS_WIDTH;
        const y = (1 - uv.getY(vertex)) * ATLAS_HEIGHT;
        assert.ok(x === left || x === left + TILE_SIZE);
        assert.ok(y === top || y === top + TILE_SIZE);
        corners.add(`${x},${y}`);
        if (normalY === 0) assert.equal(y, positions.getY(vertex) === 9 ? top : top + TILE_SIZE);
      }
      assert.equal(corners.size, 4, 'a whole texture must cover every face');
    }
    geometry.dispose();
  }
});

test('generated ponds are shallow, have sand beds, and leave spawn dry', () => {
  const world = new World();
  let waterCells = 0;
  for (let y = 1; y < HEIGHT; y++) {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (world.get(x, y, z) !== WATER) continue;
        waterCells++;
        assert.equal(world.get(x, y - 1, z), SAND);
        assert.equal(world.get(x, y + 1, z), 0);
      }
    }
  }
  assert.ok(waterCells > 100);
  const player = spawnPlayer(world);
  assert.equal(world.get(Math.floor(player.x), Math.floor(player.y - 0.05), Math.floor(player.z)), GRASS);
});

test('water is passable and slows walking while the sandy bed supports the player', () => {
  const world = flatWorld();
  for (let z = 10; z < 20; z++) {
    world.set(8, 0, z, SAND);
    world.set(8, 1, z, WATER);
  }
  const player = { x: 8.5, y: 3, z: 18.5, vy: 0, grounded: false };
  advance(player, world, 120);
  assert.equal(player.y, 1);
  assert.equal(player.grounded, true);
  const before = player.z;
  advance(player, world, 120, { forward: 1, sprint: true });
  assert.ok(Math.abs(before - player.z - 2.8) < 0.00001);
  stepPlayer(player, world, { jump: true }, DT);
  assert.ok(player.y > 1 && player.vy > 0, 'jumping out of water should work');
});

test('water meshing leaves the sand bed visible and removes shared water faces', () => {
  const world = new World({ generate: false });
  world.set(8, 1, 8, SAND);
  world.set(9, 1, 8, SAND);
  world.set(8, 2, 8, WATER);
  world.set(9, 2, 8, WATER);
  const terrain = buildTerrainGeometry(world);
  const water = buildWaterGeometry(world);
  assert.equal(terrain.index.count, 10 * 6, 'sand tops must remain visible beneath water');
  assert.equal(water.index.count, 8 * 6, 'water has no internal or bed-facing surfaces');
  water.computeBoundingBox();
  assert.ok(Math.abs(water.boundingBox.max.y - 2.88) < 0.00001);
  world.set(8, 2, 8, SAND);
  const filled = buildWaterGeometry(world);
  assert.equal(filled.index.count, 4 * 6, 'filling a water cell removes it from the water mesh');
  for (const geometry of [terrain, water, filled]) geometry.dispose();
});

test('flying can rise, hover, descend, and return to gravity', () => {
  const world = flatWorld();
  const player = { x: 20.5, y: 1, z: 20.5, vy: 0, grounded: false, flying: true };
  advance(player, world, 120, { rise: 1 });
  assert.ok(Math.abs(player.y - 7) < 0.00001);
  advance(player, world, 120);
  assert.ok(Math.abs(player.y - 7) < 0.00001, 'release movement to hover');
  advance(player, world, 60, { rise: -1 });
  assert.ok(Math.abs(player.y - 4) < 0.00001);
  assert.equal(player.grounded, false);
  player.flying = false;
  advance(player, world, 120);
  assert.equal(player.y, 1);
  assert.equal(player.grounded, true);
});

test('flight normalizes movement, supports boosting, and respects walls and its ceiling', () => {
  const world = flatWorld();
  const start = { x: 30.5, y: 10, z: 30.5, vy: 0, grounded: false, flying: true };
  const diagonal = { ...start };
  advance(diagonal, world, 120, { forward: 1, strafe: 1, rise: 1, sprint: true });
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y, diagonal.z - start.z) - 10) < 0.00001);
  world.set(30, 10, 28, STONE);
  world.set(30, 11, 28, STONE);
  const blocked = { ...start };
  advance(blocked, world, 120, { forward: 1, sprint: true });
  assert.ok(Math.abs(blocked.z - 29.3) < 0.00001);
  advance(diagonal, world, 600, { rise: 1, sprint: true });
  assert.equal(diagonal.y, HEIGHT + 12);
});
