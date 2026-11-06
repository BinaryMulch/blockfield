import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { HEIGHT, WATER, DOOR, LANTERN, SLAB, RED_FLOWER, FLOWER_TYPES, EYE_HEIGHT, isSolid, isDoor, isFlower, doorState, buildBlock, blockBounds, overlapsBlock, spawnPlayer, stepPlayer } from './world.js';
import { ChunkWorld } from './chunks.js';
import { ChunkRenderer } from './chunk-renderer.js';
import { createTextureAtlas, createLanternEmissiveMap } from './textures.js';
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
import { TouchControls } from './touch.js';
import { GraphicsSettings } from './graphics.js';
import { Inventory, CREATIVE_ITEMS, validInventory } from './inventory.js';
import { InventoryView } from './inventory-ui.js';
import './style.css';

const menu = document.querySelector('#menu');
const play = document.querySelector('#play');
const error = document.querySelector('#error');
const BLOCK_NAMES = Object.fromEntries(CREATIVE_ITEMS.map(item => [item.id, item.name]));
BLOCK_NAMES[WATER] = 'Water';

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
  const graphics = new GraphicsSettings(renderer);
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
  const lanternLighting = new LanternLighting(scene, world, { onError: cause => { error.hidden = false; error.textContent = `Lantern lighting: ${cause.message}`; } });
  const player = spawnPlayer(world);
  const history = new GameSession(world);
  const particles = new BlockParticles(scene);
  lanternLighting.applyMaterial(particles.mesh.material);
  otherPlayers.prepareMaterial = material => lanternLighting.applyMaterial(material);
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
  for (const [mode, material] of Object.entries(chunkRenderer.materials)) {
    // Reach the air beside thin doors/slabs, without crossing a full voxel wall.
    lanternLighting.applyMaterial(material, { surfaceOffset: mode === 'solid' ? 0.99 : 0.02 });
  }

  const outlineBox = new THREE.BoxGeometry(1, 1, 1);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(outlineBox), new THREE.LineBasicMaterial({ color: '#fff9dd' }));
  outlineBox.dispose();
  outline.visible = false;
  scene.add(outline);

  const controls = new PointerLockControls(camera, canvas);
  let playing = false;
  let inventoryOpen = false;
  let inventoryReturnToPlay = false;
  let inventoryProfile = null;
  const touch = new TouchControls(canvas, camera, {
    jump() { if (!player.flying) jumpQueued = true; },
    pause: pauseGame,
    action(action) {
      if (!playing) return;
      if (action === 'break' || action === 'place') void editBlock(action === 'place');
      else if (action === 'fly') toggleFlight();
      else if (action === 'use') void useDoor();
      else if (action === 'undo') void replayEdit(false);
    },
  });
  touch.onModeChange = () => { pauseGame(); updateMode(); };
  const diagnostics = new PerformanceOverlay(() => ({
    mode: history.mode, context: `${history.mode === 'single' ? 'Single player' : history.mode === 'multiplayer' ? 'Multiplayer' : 'Menu'}${history.mode ? playing ? ' · playing' : ' · paused' : ''}`,
    render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    chunks: { loaded: world.chunks.size, meshed: chunkRenderer.chunks.size, queued: chunkRenderer.dirty.size },
    mesh: chunkRenderer.jobs.stats('mesh'), generate: history.mode === 'single' ? history.backend?.jobs.stats('generate') : null,
    lighting: { jobs: lanternLighting.jobs?.stats('light'), sources: lanternLighting.sourceCount,
      fieldBytes: lanternLighting.uniforms.lanternField.value.image.data.byteLength },
    viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: renderer.getPixelRatio() },
    graphics: graphics.snapshot(),
  }));
  graphics.onChange = () => diagnostics.reset();
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
  const inventory = new Inventory();
  history.inventory = () => inventory.snapshot();
  let selected = inventory.block;
  let target = null;
  let toastTimer;
  let jumpQueued = false;
  let hasPlayed = false;
  const inventoryButton = document.querySelector('#inventory-toggle');
  const hotbar = document.querySelector('#hotbar');
  const inventoryView = new InventoryView(inventory, atlas, {
    select(index) { if (inventory.select(index)) inventoryChanged(); },
    assign(block) { if (inventory.assign(block)) inventoryChanged(); },
    reset() { if (inventory.reset()) inventoryChanged(); },
    action(args) { return history.request('inventory', args); },
    craft(block) { return history.request('craft', { block }); },
    close: closeInventory,
  });
  inventoryButton.addEventListener('click', openInventory);
  renderHotbar();

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  function select(block) {
    if (inventory.mode === 'gather') {
      const index = inventory.hotbar.indexOf(block);
      if (index >= 0) { if (inventory.select(index)) inventoryChanged(); }
      else if (inventory.count(block)) void history.request('inventory', { action: 'pick', block });
      else notify(`Collect ${BLOCK_NAMES[block] || 'this material'} first.`);
    } else if (inventory.pick(block)) inventoryChanged();
  }

  function renderHotbar() {
    selected = inventory.block; hotbar.replaceChildren();
    inventory.hotbar.forEach((block, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'slot';
      button.dataset.slot = index; button.dataset.block = block;
      const count = inventory.slotCount(index), quantity = Number.isFinite(count) ? String(count) : '∞';
      button.setAttribute('aria-label', `${BLOCK_NAMES[block] || 'Empty'}, slot ${index + 1}, ${Number.isFinite(count) ? count + ' collected' : 'unlimited'}`);
      button.setAttribute('aria-pressed', String(index === inventory.selected)); button.classList.toggle('selected', index === inventory.selected);
      button.classList.toggle('depleted', count === 0);
      const key = document.createElement('span'); key.className = 'slot-key'; key.textContent = index + 1;
      const supply = document.createElement('span'); supply.className = 'slot-supply'; supply.textContent = quantity; supply.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.textContent = BLOCK_NAMES[block] || 'Empty';
      button.append(key); if (block) button.append(supply, inventoryView.icon(block)); button.append(name); hotbar.append(button);
    });
    document.querySelector('#selected-caption').textContent = `${(BLOCK_NAMES[selected] || 'EMPTY SLOT').toUpperCase()}${inventory.mode === 'gather' && selected ? ` · ${inventory.slotCount(inventory.selected)} LEFT` : ''} · I INVENTORY`;
  }

  function inventoryChanged() {
    renderHotbar(); inventoryView.render();
    if (!history.ready) return;
    if (inventory.mode === 'gather') { void history.request('inventory', { action: 'select', index: inventory.selected }); return; }
    if (history.mode === 'single') void history.flush();
    else if (inventoryProfile) {
      try { localStorage.setItem(inventoryProfile, JSON.stringify(inventory.snapshot())); }
      catch { inventoryView.status.textContent = 'Hotbar applied for this visit. Browser settings storage is unavailable.'; }
    }
  }

  function loadInventory(message) {
    inventoryProfile = history.mode === 'multiplayer' && message.gameMode !== 'gather' ? `blockfield-hotbar:${message.worldId || message.world.seed + ':' + message.worldName}` : null;
    let saved = message.inventory;
    if (inventoryProfile) {
      try { saved = JSON.parse(localStorage.getItem(inventoryProfile)); } catch { saved = null; }
    }
    if (inventoryProfile) saved = validInventory(saved) && saved.version === 1 ? saved : null;
    inventory.restore(saved); renderHotbar(); inventoryView.render();
  }

  function openInventory() {
    if (!history.ready || inventoryOpen) return;
    inventoryReturnToPlay = playing; inventoryOpen = true;
    pauseGame(); menu.hidden = true; inventoryView.open(inventoryReturnToPlay);
  }

  function closeInventory(resume = false) {
    if (!inventoryOpen) return;
    const returnToPlay = resume && inventoryReturnToPlay;
    inventoryOpen = false; inventoryReturnToPlay = false;
    inventoryView.close(); menu.hidden = false;
    play.focus({ preventScroll: true });
    if (returnToPlay && !play.disabled) requestPlay();
  }

  function cycleFlower() {
    if (inventory.mode === 'gather') {
      const flowers = FLOWER_TYPES.filter(block => inventory.count(block));
      if (!flowers.length) { notify('Collect some flowers first.'); return; }
      select(flowers[(flowers.indexOf(selected) + 1) % flowers.length]); return;
    }
    const block = isFlower(selected) ? FLOWER_TYPES[(FLOWER_TYPES.indexOf(selected) + 1) % FLOWER_TYPES.length]
      : inventory.hotbar.find(isFlower) || RED_FLOWER;
    select(block);
    if (playing) notify(`${BLOCK_NAMES[block]} · ${touch.enabled ? 'Tap this slot to change flower' : 'R to change flower'}`);
  }

  function clearInput() {
    keys.clear();
    touch.reset();
    jumpQueued = false;
    accumulator = 0;
    footsteps.reset();
    sounds.stop();
    clearTimeout(toastTimer);
    toast.classList.remove('visible');
  }

  function updateMode() {
    modeIndicator.hidden = !player.flying;
    touch.setFlying(player.flying);
    movementHint.textContent = player.flying ? 'Space up · C down · Shift faster' : 'Shift to sprint';
  }

  function requestPlay() {
    if (!history.ready) return;
    error.hidden = true;
    void sounds.resume();
    if (touch.enabled) { setPlaying(true); return; }
    // Desktop mouse input uses pointer lock; touch play does not need it.
    try {
      const request = canvas.requestPointerLock();
      request?.catch?.(() => showPointerError());
    } catch {
      showPointerError();
    }
  }
  play.addEventListener('click', requestPlay);

  function showPointerError() {
    error.hidden = false;
    error.textContent = 'Mouse capture is unavailable. Choose Touch under Controls, or try Play again with a supported mouse browser.';
  }
  document.addEventListener('pointerlockerror', showPointerError);
  function setPlaying(active) {
    if (playing === active) return;
    playing = active;
    diagnostics.reset();
    clearInput();
    error.hidden = true;
    touch.setActive(active);
    menu.hidden = active || inventoryOpen;
    crosshair.hidden = !active;
    hint.hidden = !active || touch.enabled;
    document.body.classList.toggle('playing', active);
    if (active) {
      hasPlayed = true;
      play.blur();
    } else {
      outline.visible = false;
      if (!history.backend?.saveError) void history.flush();
      if (hasPlayed) {
        document.querySelector('#menu-title').textContent = 'Take your time.';
        document.querySelector('#menu-description').textContent = currentWorldDescription;
        play.innerHTML = 'Keep playing <span aria-hidden="true">↗</span>';
      }
    }
    queueMicrotask(() => history.sendPose());
  }
  function pauseGame() {
    setPlaying(false);
    if (document.pointerLockElement === canvas) controls.unlock();
  }
  controls.addEventListener('lock', () => {
    if (inventoryOpen || !history.ready) { controls.unlock(); return; }
    setPlaying(true);
  });
  controls.addEventListener('unlock', () => setPlaying(false));
  window.addEventListener('blur', () => {
    inventoryReturnToPlay = false;
    if (inventoryOpen) inventoryView.back.textContent = 'Back to menu';
    clearInput();
    pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      inventoryReturnToPlay = false;
      if (inventoryOpen) inventoryView.back.textContent = 'Back to menu';
      clearInput();
      pauseGame();
      if (!history.backend?.saveError) void history.flush();
    }
  });
  window.addEventListener('pagehide', () => { if (!history.backend?.saveError) void history.flush(); });

  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const modified = event.metaKey || event.ctrlKey || event.altKey;
    if (inventoryOpen) {
      if (event.code === 'Escape') { event.preventDefault(); closeInventory(false); return; }
      if (!typing && !modified && !event.repeat) {
        if (event.code === 'KeyI') { event.preventDefault(); closeInventory(true); }
        else if (/^Digit[1-9]$/.test(event.code)) { event.preventDefault(); const index = Number(event.code.slice(-1)) - 1; if (!inventoryView.hotbarKey(index) && inventory.select(index)) inventoryChanged(); }
      }
      return;
    }
    if (typing) return;
    if (event.code === 'KeyI' && !event.repeat && !modified) { event.preventDefault(); openInventory(); return; }
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
    if (/^Digit[1-9]$/.test(event.code) && !event.repeat && !modified) {
      event.preventDefault(); if (inventory.select(Number(event.code.slice(-1)) - 1)) inventoryChanged(); return;
    }
    if (event.code === 'Digit0' && !event.repeat && !modified) { event.preventDefault(); select(DOOR); return; }
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
    if (!playing) return;
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
    if (event.code === 'Escape') pauseGame();
    if (event.code === 'KeyV' && !event.repeat) toggleFlight();
    if (event.code === 'KeyF' && !event.repeat) editBlock(true);
    if (event.code === 'KeyE' && !event.repeat) {
      updateTarget();
      if (target) {
        const block = buildBlock(world.get(target.x, target.y, target.z));
        if (inventory.mode === 'gather' && !inventory.count(block)) notify(`Collect ${BLOCK_NAMES[block]} first.`);
        else { select(block); notify(`${BLOCK_NAMES[block]} selected`); }
      } else notify('Look at a nearby block to pick its material.');
    }
  });
  function toggleFlight() {
    player.flying = !player.flying;
    player.vy = 0; player.grounded = false; jumpQueued = false;
    touch.reset(); footsteps.reset(); sounds.stop(); updateMode();
    notify(player.flying ? touch.enabled ? 'Flying · Hold Up or Down' : 'Flying · Space to rise, C to descend' : 'Walking mode');
  }
  document.addEventListener('keyup', (event) => keys.delete(event.code));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('mousedown', (event) => {
    if (!playing || touch.enabled) return;
    if (event.button === 0 || event.button === 2) {
      event.preventDefault();
      editBlock(event.button === 2 || event.ctrlKey);
    }
  });
  hotbar.addEventListener('click', event => {
    const slot = event.target.closest('[data-slot]'); if (!slot) return;
    const index = Number(slot.dataset.slot);
    if (index === inventory.selected && isFlower(selected)) cycleFlower();
    else if (inventory.select(index)) inventoryChanged();
  });

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
    outline.visible = playing;
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
      if (!selected) { notify('Choose a block in your hotbar. Open inventory with I to move one there.'); return; }
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
      supplies: 'You don’t have enough of that material. Break blocks to collect more.',
      inventory_full: 'Your inventory is full. Make room before collecting more.',
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
      if (playing) sounds.play(DOOR, doorState(to).open ? 'open' : 'close');
    }
    else {
      const placing = isSolid(to) || isFlower(to);
      if (playing) sounds.play(placing ? to : from, placing ? 'place' : 'break');
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
    graphics.resize();
    diagnostics.reset();
  });

  let previous = performance.now();
  let accumulator = 0;
  let avatarShadowElapsed = 0;
  const fixedStep = 1 / 120;
  renderer.setAnimationLoop((now) => {
    const frameStarted = performance.now();
    const elapsed = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    if (playing && history.ready) {
      accumulator += elapsed;
      while (accumulator >= fixedStep) {
        const before = { ...player };
        stepPlayer(player, world, {
          forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touch.forward,
          strafe: Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.strafe,
          yaw: camera.rotation.y,
          jump: jumpQueued,
          sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.sprint,
          rise: Number(keys.has('Space')) - Number(keys.has('KeyC')) + touch.rise,
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
    inventoryButton.disabled = !history.ready;
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
    lanternLighting.update(playing ? elapsed : 0, camera.position, skyState.daylight);
    const label = `${skyState.label} · ${sky.clock.held ? 'held' : 'cycling'}`;
    if (timeLabel.textContent !== label) {
      timeLabel.textContent = label;
      timeToggle.setAttribute('aria-pressed', String(sky.clock.held));
      timeToggle.setAttribute('aria-label', sky.clock.held ? 'Resume time of day' : 'Hold time of day');
    }
    document.body.classList.toggle('night', skyState.daylight < 0.3);
    const rendered = graphics.limiter.allow(now);
    if (rendered) {
      renderer.info.reset();
      renderer.render(scene, camera);
    }
    diagnostics.frame(frameStarted, performance.now(), rendered);
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
    active: playing, flying: player.flying });
  history.callbacks = {
    supplies(saved) {
      if (!validInventory(saved) || saved.mode !== 'gather') return;
      inventory.restore({ ...saved, selected: inventory.selected }); renderHotbar(); inventoryView.render();
    },
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
      currentWorldDescription = `${message.worldName} · ${message.gameMode === 'gather' ? 'Gather' : 'Creative'} · Seed: ${message.world.seed}`;
      document.querySelector('#menu-description').textContent = currentWorldDescription;
      loadInventory(message);
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
      if (status.state === 'error') { closeInventory(false); pauseGame(); }
    },
    chunks(keys) {
      for (const key of keys) chunkRenderer.mark(key);
      lanternLighting.sync(world, keys);
    },
    edit(message) { finishEdit(message.changes[0], undefined, message.changes); },
    disconnected() {
      closeInventory(false);
      play.disabled = true;
      pauseGame();
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
    closeInventory(false); inventoryProfile = null;
    pauseGame();
    diagnostics.reset();
    chooser.hidden = true; play.hidden = false; leaveButton.hidden = false;
    inventoryButton.hidden = false; inventoryButton.disabled = true;
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
    void localWorld(() => history.create(nameInput.value, document.querySelector('#world-name').value.trim() || 'My world', seed, document.querySelector('#world-mode').value));
  });
  document.querySelector('#join-server').addEventListener('click', () => {
    try {
      const url = serverURL(document.querySelector('#server-address').value);
      if (url.origin !== location.origin) { url.searchParams.set('name', nameInput.value.slice(0, 20)); location.assign(url); return; }
      openSession('multiplayer'); history.connect(nameInput.value);
    } catch (cause) { error.hidden = false; error.textContent = cause.message; }
  });
  function showChooser() {
    closeInventory(false); inventoryProfile = null;
    pauseGame();
    diagnostics.reset();
    history.disconnect(); chunkRenderer.reset(); world.chunks.clear(); lanternLighting.sync(world);
    otherPlayers.sync([], null); clearInput();
    chooser.hidden = false; play.hidden = true; leaveButton.hidden = true; inviteRow.hidden = true;
    inventoryButton.hidden = true; inventoryButton.disabled = true;
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
        title.title = `${save.gameMode === 'gather' ? 'Gather' : 'Creative'} · Seed: ${save.world?.seed || 'unknown'}`;
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
