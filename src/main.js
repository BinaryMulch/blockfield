import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { BUILD_BLOCKS, HEIGHT, WATER, DOOR, LANTERN, SLAB, RED_FLOWER, YELLOW_FLOWER, DAISY, FLOWER_TYPES, EYE_HEIGHT, isSolid, isDoor, isFlower, doorState, buildBlock, blockBounds, overlapsBlock, spawnPlayer, stepPlayer } from './world.js';
import { ChunkWorld } from './chunks.js';
import { ChunkRenderer } from './chunk-renderer.js';
import { createTextureAtlas, createLanternEmissiveMap, faceTile, tilePreview, flowerPreview } from './textures.js';
import { FootstepTracker, GameSounds } from './sound.js';
import { WorldSky } from './sky.js';
import { GameSession, serverURL } from './session.js';
import { browserSaves, saveMessage } from './browser-saves.js';
import { validateSave, newWorldId, MAX_SAVE_BYTES } from './saves.js';
import { OtherPlayers } from './players.js';
import { BlockParticles } from './particles.js';
import { LanternLighting } from './lanterns.js';
import { slabPlacement } from './slabs.js';
import { PerformanceOverlay } from './performance.js';
import './style.css';

const menu = document.querySelector('#menu');
const play = document.querySelector('#play');
const error = document.querySelector('#error');
const BLOCK_NAMES = ['', 'Grass', 'Dirt', 'Stone', 'Wood', 'Leaves', 'Sand', 'Water', 'Planks', 'Bricks', 'Glass', 'Door'];
BLOCK_NAMES[LANTERN] = 'Lantern';
BLOCK_NAMES[SLAB] = 'Wooden slab';
BLOCK_NAMES[RED_FLOWER] = 'Red flower';
BLOCK_NAMES[YELLOW_FLOWER] = 'Yellow flower';
BLOCK_NAMES[DAISY] = 'Daisy';

try {
  start();
} catch (cause) {
  console.error(cause);
  error.hidden = false;
  error.textContent = 'The 3D world could not start. Try a current version of Safari or Chrome with hardware acceleration enabled.';
  play.disabled = true;
}

function start() {
  const canvas = document.querySelector('#game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Reuse shadow maps between block edits and timed sky updates.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfdce5');
  scene.fog = new THREE.Fog('#bfdce5', 22, 46);

  const sky = new WorldSky(scene, renderer);
  sky.externalClock = true;
  const otherPlayers = new OtherPlayers(scene);
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.rotation.order = 'YXZ';
  camera.rotation.x = -0.12;

  const world = new ChunkWorld({ generate: false });
  const lanternLighting = new LanternLighting(scene, world);
  const player = spawnPlayer(world);
  const history = new GameSession(world);
  const particles = new BlockParticles(scene);
  const sounds = new GameSounds();
  const footsteps = new FootstepTracker();
  const soundToggle = document.querySelector('#sound-toggle');
  function toggleSound() {
    sounds.setEnabled(!sounds.enabled);
    soundToggle.setAttribute('aria-pressed', String(!sounds.enabled));
    soundToggle.setAttribute('aria-label', sounds.enabled ? 'Mute sound' : 'Unmute sound');
    soundToggle.innerHTML = `Sound ${sounds.enabled ? 'on' : 'off'} <kbd>M</kbd>`;
  }
  soundToggle.addEventListener('click', toggleSound);
  const atlas = createTextureAtlas();
  const chunkRenderer = new ChunkRenderer(scene, world, {
    solid: new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, shadowSide: THREE.FrontSide }),
    water: new THREE.MeshPhongMaterial({ map: atlas, transparent: true, opacity: 0.68, depthWrite: false, shininess: 80, specular: '#42626c', side: THREE.DoubleSide }),
    glass: new THREE.MeshPhongMaterial({ map: atlas, transparent: true, opacity: 0.75, depthWrite: false, shininess: 90, specular: '#4c7382', side: THREE.DoubleSide }),
    lantern: new THREE.MeshLambertMaterial({ map: atlas, emissive: '#ffc170', emissiveMap: createLanternEmissiveMap(), emissiveIntensity: 1 }),
    flowers: new THREE.MeshLambertMaterial({ vertexColors: true }),
  }, () => { renderer.shadowMap.needsUpdate = true; }, cause => {
    error.hidden = false; error.textContent = cause.message;
  });
  const terrain = chunkRenderer.groups.solid, glass = chunkRenderer.groups.glass, lanterns = chunkRenderer.groups.lantern, flowers = chunkRenderer.groups.flowers;
  for (const slot of document.querySelectorAll('.slot')) {
    const block = Number(slot.dataset.block);
    const icon = slot.querySelector('.block-icon');
    if (isFlower(block)) { icon.style.backgroundImage = flowerPreview(block); continue; }
    icon.style.backgroundImage = tilePreview(atlas, faceTile(block, 0));
    icon.style.setProperty('--top-texture', tilePreview(atlas, faceTile(block, 1)));
  }

  const outlineBox = new THREE.BoxGeometry(1, 1, 1);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(outlineBox), new THREE.LineBasicMaterial({ color: '#fff9dd' }));
  outlineBox.dispose();
  outline.visible = false;
  scene.add(outline);

  const controls = new PointerLockControls(camera, canvas);
  const diagnostics = new PerformanceOverlay(() => ({
    mode: history.mode, context: `${history.mode === 'single' ? 'Single player' : history.mode === 'multiplayer' ? 'Multiplayer' : 'Menu'}${history.mode ? controls.isLocked ? ' · playing' : ' · paused' : ''}`,
    render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    chunks: { loaded: world.chunks.size, meshed: chunkRenderer.chunks.size, queued: chunkRenderer.dirty.size },
    mesh: chunkRenderer.jobs.stats('mesh'), generate: history.mode === 'single' ? history.backend?.jobs.stats('generate') : null,
    viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: renderer.getPixelRatio() },
  }));
  controls.pointerSpeed = 0.65;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.05;
  const keys = new Set();
  const raycaster = new THREE.Raycaster();
  raycaster.far = 6;
  const center = new THREE.Vector2();
  const crosshair = document.querySelector('#crosshair');
  const hint = document.querySelector('#play-hint');
  const toast = document.querySelector('#toast');
  const movementHint = document.querySelector('#movement-hint');
  const modeIndicator = document.querySelector('#mode-indicator');
  const timeToggle = document.querySelector('#time-toggle');
  const timeLabel = document.querySelector('#time-label');
  timeToggle.addEventListener('click', () => void history.request('time', { action: 'hold' }));
  let selected = 1;
  let target = null;
  let toastTimer;
  let jumpQueued = false;
  let hasPlayed = false;

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  function select(block) {
    selected = block;
    if (isFlower(block)) {
      const slot = document.querySelector('[data-flower]');
      slot.dataset.block = block;
      slot.setAttribute('aria-label', `${BLOCK_NAMES[block]}, key R to change flower`);
      slot.querySelector('.block-icon').style.backgroundImage = flowerPreview(block);
    }
    for (const slot of document.querySelectorAll('.slot')) {
      const active = Number(slot.dataset.block) === selected;
      slot.classList.toggle('selected', active);
      slot.setAttribute('aria-pressed', String(active));
    }
    document.querySelector('#selected-caption').textContent = `${BLOCK_NAMES[selected].toUpperCase()} SELECTED`;
  }

  function cycleFlower() {
    const block = isFlower(selected) ? FLOWER_TYPES[(FLOWER_TYPES.indexOf(selected) + 1) % FLOWER_TYPES.length]
      : Number(document.querySelector('[data-flower]').dataset.block);
    select(block);
    if (controls.isLocked) notify(`${BLOCK_NAMES[block]} · R to change flower`);
  }

  function clearInput() {
    keys.clear();
    jumpQueued = false;
    accumulator = 0;
    footsteps.reset();
    sounds.stop();
    clearTimeout(toastTimer);
    toast.classList.remove('visible');
  }

  function updateMode() {
    modeIndicator.hidden = !player.flying;
    movementHint.textContent = player.flying ? 'Space up · C down · Shift faster' : 'Shift to sprint';
  }

  play.addEventListener('click', () => {
    if (!history.ready) return;
    error.hidden = true;
    void sounds.resume();
    // Do not request raw mouse input: standard pointer lock also works in Safari.
    try {
      const request = canvas.requestPointerLock();
      request?.catch?.(() => showPointerError());
    } catch {
      showPointerError();
    }
  });

  function showPointerError() {
    error.hidden = false;
    error.textContent = 'Mouse capture was blocked. Click the play button to try again, or open the game directly in Safari or Chrome.';
  }
  document.addEventListener('pointerlockerror', showPointerError);
  controls.addEventListener('lock', () => {
    diagnostics.reset();
    clearInput();
    error.hidden = true;
    hasPlayed = true;
    menu.hidden = true;
    crosshair.hidden = false;
    hint.hidden = false;
    document.body.classList.add('playing');
    play.blur();
    queueMicrotask(() => history.sendPose());
  });
  controls.addEventListener('unlock', () => {
    diagnostics.reset();
    clearInput();
    menu.hidden = false;
    crosshair.hidden = true;
    hint.hidden = true;
    outline.visible = false;
    document.body.classList.remove('playing');
    queueMicrotask(() => history.sendPose());
    if (!history.backend?.saveError) void history.flush();
    if (hasPlayed) {
      document.querySelector('#menu-title').textContent = 'Take your time.';
      document.querySelector('#menu-description').textContent = currentWorldDescription;
      play.innerHTML = 'Keep playing <span aria-hidden="true">↗</span>';
    }
  });
  window.addEventListener('blur', () => {
    clearInput();
    if (controls.isLocked) controls.unlock();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInput();
      if (controls.isLocked) controls.unlock();
      if (!history.backend?.saveError) void history.flush();
    }
  });
  window.addEventListener('pagehide', () => { if (!history.backend?.saveError) void history.flush(); });

  document.addEventListener('keydown', (event) => {
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.code === 'KeyP' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault(); diagnostics.setEnabled(!diagnostics.enabled); return;
    }
    if (['KeyT', 'KeyN'].includes(event.code) && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void history.request('time', { action: event.code === 'KeyT' ? 'hold' : 'next' });
      return;
    }
    if (event.code === 'KeyM' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      toggleSound();
      return;
    }
    if (/^Digit[0-9]$/.test(event.code)) select(BUILD_BLOCKS[event.code === 'Digit0' ? 9 : Number(event.code.slice(-1)) - 1]);
    if (event.code === 'KeyL' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      select(LANTERN);
      return;
    }
    if (event.code === 'KeyB' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      select(SLAB);
      return;
    }
    if (event.code === 'KeyR' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) cycleFlower();
      return;
    }
    if (!controls.isLocked) return;
    if (['KeyZ', 'KeyY'].includes(event.code) && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) replayEdit(event.code === 'KeyY' || event.shiftKey);
      return;
    }
    if (event.code === 'KeyQ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) useDoor();
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyV', 'KeyF', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat && !player.flying) jumpQueued = true;
    if (event.code === 'KeyV' && !event.repeat) {
      player.flying = !player.flying;
      player.vy = 0;
      player.grounded = false;
      jumpQueued = false;
      footsteps.reset();
      sounds.stop();
      updateMode();
      notify(player.flying ? 'Flying · Space to rise, C to descend' : 'Walking mode');
    }
    if (event.code === 'KeyF' && !event.repeat) editBlock(true);
    if (event.code === 'KeyE' && !event.repeat) {
      updateTarget();
      if (target) {
        const block = buildBlock(world.get(target.x, target.y, target.z));
        select(block);
        notify(`${BLOCK_NAMES[block]} selected`);
      } else notify('Look at a nearby block to pick its material.');
    }
  });
  document.addEventListener('keyup', (event) => keys.delete(event.code));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('mousedown', (event) => {
    if (!controls.isLocked) return;
    if (event.button === 0 || event.button === 2) {
      event.preventDefault();
      editBlock(event.button === 2 || event.ctrlKey);
    }
  });
  document.querySelectorAll('.slot').forEach((slot) => slot.addEventListener('click', () => {
    if (slot.hasAttribute('data-flower') && isFlower(selected)) cycleFlower();
    else select(Number(slot.dataset.block));
  }));

  function updateTarget() {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(center, camera);
    const hit = raycaster.intersectObjects([terrain, glass, lanterns, flowers], true)[0];
    target = null;
    outline.visible = false;
    if (!hit) return;
    const inside = hit.point.clone().addScaledVector(hit.face.normal, -0.001);
    const x = Math.floor(inside.x);
    const y = Math.floor(inside.y);
    const z = Math.floor(inside.z);
    if (!world.get(x, y, z)) return;
    const block = world.get(x, y, z);
    target = { x, y, z, normal: hit.face.normal, point: hit.point, distance: hit.distance };
    const door = world.doorAt(x, y, z);
    const b = blockBounds(block, x, door ? door.y : y, z);
    if (door) b.maxY++;
    outline.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    outline.scale.set(b.maxX - b.minX + 0.008, b.maxY - b.minY + 0.008, b.maxZ - b.minZ + 0.008);
    outline.visible = controls.isLocked;
  }

  async function useDoor() {
    updateTarget();
    let door = target && world.doorAt(target.x, target.y, target.z);
    let nearest = target?.distance ?? raycaster.far;
    // The open frame remains usable even when the thin panel has swung aside.
    if (!door) {
      const box = new THREE.Box3(), point = new THREE.Vector3();
      for (const candidate of world.doors()) {
        if (!candidate.open) continue;
        box.min.set(candidate.x, candidate.y, candidate.z);
        box.max.set(candidate.x + 1, candidate.y + 2, candidate.z + 1);
        const hit = raycaster.ray.intersectBox(box, point);
        const distance = box.containsPoint(raycaster.ray.origin) ? 0 : hit ? point.distanceTo(raycaster.ray.origin) : Infinity;
        if (distance <= nearest) { door = candidate; nearest = distance; }
      }
    }
    if (!door) { notify('Look at a nearby door to open or close it.'); return; }
    const result = await history.toggleDoor(door.x, door.y, door.z);
    if (!result.ok) { editError(result); return; }
    notify(door.open ? 'Door closed' : 'Door opened');
  }

  async function editBlock(place) {
    if (!history.ready) return;
    updateTarget();
    if (!target) return;
    let { x, y, z } = target;
    let nextBlock;
    if (place) {
      const replacingFlower = isFlower(world.get(x, y, z));
      if (selected === SLAB) {
        const placement = slabPlacement(world, target);
        if (!placement) return;
        const { x, y, z, block } = placement;
        if (!world.contains(x, y, z)) { notify('You’ve reached the build limit.'); return; }
        const result = await history.edit(x, y, z, block);
        if (!result.ok) editError(result);
        return;
      }
      if (!replacingFlower) {
        x += Math.round(target.normal.x);
        y += Math.round(target.normal.y);
        z += Math.round(target.normal.z);
      }
      if (!world.contains(x, y, z)) {
        notify(y >= HEIGHT ? 'That’s the build height limit.' : 'You’ve reached the edge of this little world.');
        return;
      }
      if (selected === DOOR) {
        if (!replacingFlower && target.normal.y < 0.5) { notify('Place a door on a full-height surface.'); return; }
        const facing = (Math.round(-camera.rotation.y / (Math.PI / 2)) % 4 + 4) % 4;
        const result = await history.placeDoor(x, y, z, facing);
        if (!result.ok) {
          editError(result, 'A door needs a full-height surface and two clear blocks above it.');
          return;
        }
        return;
      }
      if (selected === LANTERN) {
        if (!replacingFlower && target.normal.y < 0.5) { notify('Place a lantern on a full-height surface.'); return; }
        const result = await history.placeLantern(x, y, z);
        if (!result.ok) {
          editError(result, 'A lantern needs a full-height surface with clear space above it.');
          return;
        }
        return;
      }
      if (isFlower(selected)) {
        if (!replacingFlower && target.normal.y < 0.5) { notify('Plant flowers on top of grass or dirt.'); return; }
        const result = await history.placeFlower(x, y, z, selected);
        if (!result.ok) editError(result, 'Flowers need dry grass or dirt with clear space above.');
        return;
      }
      if (isSolid(world.get(x, y, z)) || overlapsBlock(player, x, y, z, selected)) return;
      nextBlock = selected;
    } else {
      if (y === 0) {
        notify('The bottom layer keeps the world together.');
        return;
      }
      nextBlock = 0;
    }
    const result = await history.edit(x, y, z, nextBlock);
    if (!result.ok) editError(result);
  }

  function editError(result, fallback = 'That edit could not be applied.') {
    notify({ blocked: 'That space is occupied by a player. Move clear, then try again.',
      changed: 'Someone changed that block. This action cannot overwrite their edit.',
      storage: 'Your latest changes could not be saved. Retry saving or export a backup from the menu.',
      disconnected: 'Waiting for the host to reconnect…', busy: 'Let the current edits finish, then try again.', reach: 'That block is out of reach.' }[result.reason] || fallback);
  }

  async function replayEdit(redo) {
    const result = await (redo ? history.redo() : history.undo());
    if (!result.ok) {
      if (result.reason === 'empty') notify(`Nothing to ${redo ? 'redo' : 'undo'} yet.`);
      else editError(result);
      return;
    }
    notify(redo ? 'Redid last action' : 'Undid last action');
  }

  function finishEdit(change, normal, changes = [change]) {
    const { from, to } = change;
    if (changes.every(c => isDoor(c.from) && isDoor(c.to))) {
      if (controls.isLocked) sounds.play(DOOR, doorState(to).open ? 'open' : 'close');
    }
    else {
      const placing = isSolid(to) || isFlower(to);
      if (controls.isLocked) sounds.play(placing ? to : from, placing ? 'place' : 'break');
      for (const c of changes) if ((!isSolid(c.to) && !isFlower(c.to)) && (isSolid(c.from) || isFlower(c.from))) particles.burst(c.x, c.y, c.z, c.from, normal);
    }
    rebuildMeshes(changes);
  }

  function rebuildMeshes(changes = null) {
    if (!changes) { chunkRenderer.reset(); lanternLighting.sync(world); }
    else {
      const keys = [...new Set(changes.map(c => world.keyAt(c.x, c.z)))];
      for (const key of keys) chunkRenderer.mark(key);
      lanternLighting.sync(world, keys);
    }
    renderer.shadowMap.needsUpdate = true;
    updateTarget();
  }

  function syncCamera() {
    camera.position.set(player.x, player.y + EYE_HEIGHT, player.z);
    camera.updateMatrixWorld();
  }
  syncCamera();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let previous = performance.now();
  let accumulator = 0;
  let avatarShadowElapsed = 0;
  const fixedStep = 1 / 120;
  renderer.setAnimationLoop((now) => {
    const frameStarted = performance.now();
    const elapsed = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    if (controls.isLocked && history.ready) {
      accumulator += elapsed;
      while (accumulator >= fixedStep) {
        const before = { ...player };
        stepPlayer(player, world, {
          forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
          strafe: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
          yaw: camera.rotation.y,
          jump: jumpQueued,
          sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
          rise: Number(keys.has('Space')) - Number(keys.has('KeyC')),
        }, fixedStep);
        if (footsteps.update(before, player)) {
          const x = Math.floor(player.x), z = Math.floor(player.z);
          const wet = world.get(x, Math.floor(player.y + 0.1), z) === WATER;
          const block = wet ? WATER : world.get(x, Math.floor(player.y - 0.05), z);
          sounds.play(block, 'step');
        }
        jumpQueued = false;
        accumulator -= fixedStep;
      }
      if (player.y < -15) {
        Object.assign(player, spawnPlayer(world));
        updateMode();
        notify('Back on solid ground.');
      }
      syncCamera();
      updateTarget();
      particles.update(elapsed, world);
    }
    history.update(elapsed);
    if (history.mode) chunkRenderer.update(player);
    play.disabled = !history.ready || !chunkRenderer.readyAt(player);
    timeToggle.disabled = !history.ready;
    if (history.ready && !chunkRenderer.readyAt(player)) connection.textContent = 'Preparing nearby terrain…';
    else if (history.ready && connection.textContent === 'Preparing nearby terrain…') connection.textContent = history.mode === 'single' ? 'Single player · Private world' : 'Connected';
    const coordinates = document.querySelector('#coordinates');
    coordinates.hidden = !history.mode;
    if (history.mode) coordinates.textContent = `X ${Math.floor(player.x)} · Z ${Math.floor(player.z)}`;
    avatarShadowElapsed += elapsed;
    if (otherPlayers.update(elapsed) && avatarShadowElapsed >= 0.2) {
      renderer.shadowMap.needsUpdate = true;
      avatarShadowElapsed = 0;
    }
    sky.clock.phase = history.phase();
    sky.clock.held = history.clock.held;
    const skyState = sky.update(history.clock.running ? elapsed : 0, camera);
    lanternLighting.update(controls.isLocked ? elapsed : 0, camera.position, skyState.daylight);
    const label = `${skyState.label} · ${sky.clock.held ? 'held' : 'cycling'}`;
    if (timeLabel.textContent !== label) {
      timeLabel.textContent = label;
      timeToggle.setAttribute('aria-pressed', String(sky.clock.held));
      timeToggle.setAttribute('aria-label', sky.clock.held ? 'Resume time of day' : 'Hold time of day');
    }
    document.body.classList.toggle('night', skyState.daylight < 0.3);
    renderer.info.reset();
    renderer.render(scene, camera);
    diagnostics.frame(frameStarted, performance.now());
  });

  const nameInput = document.querySelector('#player-name');
  const connection = document.querySelector('#network-status');
  const joinLink = document.querySelector('#join-link');
  const chooser = document.querySelector('#world-chooser');
  const inviteRow = document.querySelector('#invite-row');
  const leaveButton = document.querySelector('#leave-world');
  const saveRow = document.querySelector('#save-row');
  const saveStatus = document.querySelector('#save-status');
  const saveNow = document.querySelector('#save-now');
  const exportWorld = document.querySelector('#export-world');
  let currentWorldDescription = 'Wander the woods. Break a block. Build something.';
  const retryButton = document.querySelector('#retry-connection');
  try { nameInput.value = localStorage.getItem('blockfield-name') || ''; } catch { /* Names are optional. */ }
  history.pose = () => ({ x: player.x, y: player.y, z: player.z, yaw: camera.rotation.y, pitch: camera.rotation.x,
    active: controls.isLocked, flying: player.flying });
  history.callbacks = {
    status(text) {
      connection.textContent = text;
      play.disabled = true;
      retryButton.hidden = !history.blocked;
      document.querySelector('#player-count').textContent = 'connecting';
    },
    welcome(message) {
      Object.assign(player, message.self, { vy: 0, grounded: false });
      camera.rotation.set(message.self.pitch, message.self.yaw, 0, 'YXZ');
      updateMode(); clearInput(); syncCamera(); rebuildMeshes();
      error.hidden = true;
      nameInput.value = message.self.name;
      currentWorldDescription = `${message.worldName} · Seed: ${message.world.seed}`;
      document.querySelector('#menu-description').textContent = currentWorldDescription;
      select(1);
      play.disabled = true;
      retryButton.hidden = true;
      saveNow.hidden = exportWorld.hidden = history.mode !== 'single';
      saveNow.disabled = false;
      if (history.mode !== 'single') {
        saveStatus.dataset.state = 'saved';
        saveStatus.textContent = message.persistence ? 'Server autosaves to disk' : 'This host has saving disabled';
        document.querySelector('#world-footnote').textContent = message.persistence ? 'Shared world · Saved on the host' : 'Shared world · Temporary host';
      }
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      joinLink.value = `${local ? message.urls[0] || location.origin + '/' : location.origin + '/'}?join=1`;
    },
    players(players) {
      if (otherPlayers.sync(players, history.selfId)) renderer.shadowMap.needsUpdate = true;
      const text = history.mode === 'single' ? 'Single player · Private world' : `${players.length} / 8 players · Connected`;
      if (connection.textContent !== text) connection.textContent = text;
      document.querySelector('#player-count').textContent = history.mode === 'single' ? 'single player' : `${players.length} / 8 players`;
    },
    clock(clock) {
      if (Math.abs(clock.phase - sky.clock.phase) > 0.01 || clock.held !== sky.clock.held) sky.forceShadow = true;
    },
    saving(status) {
      saveStatus.dataset.state = status.state;
      saveStatus.textContent = status.state === 'error' ? `Not saved: ${status.message}` : status.message;
      saveNow.disabled = status.state === 'saving';
      saveNow.textContent = status.state === 'error' ? 'Retry saving' : 'Save now';
      if (status.state === 'error' && controls.isLocked) controls.unlock();
    },
    chunks(keys) {
      for (const key of keys) chunkRenderer.mark(key);
      lanternLighting.sync(world, keys);
    },
    edit(message) { finishEdit(message.changes[0], undefined, message.changes); },
    disconnected() {
      play.disabled = true;
      if (controls.isLocked) controls.unlock();
      clearInput();
      if (otherPlayers.sync([], history.selfId)) renderer.shadowMap.needsUpdate = true;
    },
  };
  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim().slice(0, 20) || 'Builder';
    history.name = name;
    if (history.backend) history.backend.name = name;
    try { localStorage.setItem('blockfield-name', name); } catch { /* Keep playing without storage. */ }
    if (history.ready) void history.request('name', { name });
  });
  retryButton.addEventListener('click', () => history.connect(nameInput.value));
  document.querySelector('#copy-link').addEventListener('click', async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(joinLink.value);
      else { joinLink.focus(); joinLink.select(); if (!document.execCommand('copy')) throw new Error('Select link'); }
      document.querySelector('#copy-link').textContent = 'Copied!';
      setTimeout(() => { document.querySelector('#copy-link').textContent = 'Copy'; }, 1600);
    } catch { joinLink.focus(); joinLink.select(); notify('Select and copy the Wi-Fi link.'); }
  });
  function openSession(mode) {
    diagnostics.reset();
    chooser.hidden = true; play.hidden = false; leaveButton.hidden = false;
    inviteRow.hidden = mode !== 'multiplayer';
    document.querySelector('#world-footnote').textContent = mode === 'single'
      ? 'Private world · Autosaved in this browser'
      : 'Shared world · Hosted by the server';
    saveRow.hidden = false;
    saveNow.hidden = exportWorld.hidden = mode !== 'single';
    error.hidden = true;
  }
  async function localWorld(action) {
    openSession('single');
    try { await action(); }
    catch (cause) { showChooser(); error.hidden = false; error.textContent = saveMessage(cause); }
  }
  document.querySelector('#create-world').addEventListener('click', () => {
    void navigator.storage?.persist?.().catch(() => {});
    const seed = document.querySelector('#world-seed').value.trim() || crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    void localWorld(() => history.create(nameInput.value, document.querySelector('#world-name').value.trim() || 'My world', seed));
  });
  document.querySelector('#join-server').addEventListener('click', () => {
    try {
      const url = serverURL(document.querySelector('#server-address').value);
      if (url.origin !== location.origin) { url.searchParams.set('name', nameInput.value.slice(0, 20)); location.assign(url); return; }
      openSession('multiplayer'); history.connect(nameInput.value);
    } catch (cause) { error.hidden = false; error.textContent = cause.message; }
  });
  function showChooser() {
    diagnostics.reset();
    history.disconnect(); chunkRenderer.reset(); world.chunks.clear(); lanternLighting.sync(world);
    otherPlayers.sync([], null); clearInput();
    chooser.hidden = false; play.hidden = true; leaveButton.hidden = true; inviteRow.hidden = true;
    saveRow.hidden = true;
    connection.textContent = 'Choose single player or multiplayer';
    document.querySelector('#player-count').textContent = 'choose a world';
    document.querySelector('#menu-title').innerHTML = 'Make a little<br />space of your own.';
    document.querySelector('#menu-description').textContent = 'Wander the woods. Break a block. Build something.';
    document.querySelector('#world-footnote').textContent = 'A world of your own, or one shared with friends';
    play.innerHTML = 'Let’s play <span aria-hidden="true">↗</span>'; hasPlayed = false;
    window.history.replaceState({}, '', location.pathname);
    void refreshSavedWorlds();
  }
  leaveButton.addEventListener('click', async () => {
    leaveButton.disabled = true;
    try { if (await history.flush()) showChooser(); }
    finally { leaveButton.disabled = false; }
  });
  saveNow.addEventListener('click', async () => { if (await history.flush()) notify('World saved'); });

  function download(save) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(save)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `${save.name.replace(/[^\w -]/g, '_').slice(0, 40) || 'Blockfield'}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  exportWorld.addEventListener('click', () => { const save = history.snapshot(); if (save) download(save); });
  async function refreshSavedWorlds() {
    const list = document.querySelector('#saved-worlds');
    try {
      const saves = await browserSaves.list();
      list.replaceChildren();
      if (!saves.length) { list.textContent = 'Your saved worlds will appear here.'; return; }
      for (const save of saves) {
        const row = document.createElement('div'); row.className = 'saved-world'; row.dataset.worldId = save.id;
        const title = document.createElement('span'); title.textContent = save.name || 'Saved world';
        title.title = `Seed: ${save.world?.seed || 'unknown'}`;
        const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = 'Open';
        resume.setAttribute('aria-label', `Open ${save.name || 'saved world'}`);
        resume.addEventListener('click', () => void localWorld(() => history.resume(nameInput.value, save.id)));
        const backup = document.createElement('button'); backup.type = 'button'; backup.textContent = 'Export';
        backup.setAttribute('aria-label', `Export ${save.name || 'saved world'}`);
        backup.addEventListener('click', async () => { try { download(await browserSaves.load(save.id)); } catch (cause) { error.hidden = false; error.textContent = saveMessage(cause); } });
        row.append(title, resume, backup); list.append(row);
      }
    } catch (cause) { list.textContent = saveMessage(cause); }
  }
  const importFile = document.querySelector('#import-file');
  document.querySelector('#import-world').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0]; if (!file) return;
    try {
      if (file.size > MAX_SAVE_BYTES) throw new Error('That world file is too large.');
      const save = validateSave(JSON.parse(await file.text()));
      await browserSaves.save({ ...save, id: newWorldId(), name: `${save.name.slice(0, 29)} (imported)`, createdAt: Date.now(), updatedAt: Date.now(), saveRevision: 0 }, 0);
      await refreshSavedWorlds(); error.hidden = true; notify('World imported');
    } catch (cause) { error.hidden = false; error.textContent = saveMessage(cause); }
    finally { importFile.value = ''; }
  });
  void refreshSavedWorlds();
  document.querySelector('#server-address').value = location.origin;
  const query = new URLSearchParams(location.search);
  if (query.has('name')) nameInput.value = query.get('name').slice(0, 20);
  if (query.get('join') === '1') { openSession('multiplayer'); history.connect(nameInput.value); }
}
