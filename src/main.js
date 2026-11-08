import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { HEIGHT, WATER, DOOR, LANTERN, WARD_LANTERN, SLAB, RED_FLOWER, FLOWER_TYPES, EYE_HEIGHT, SALVAGE_CRATE, STONE_HAMMER, CHARCOAL, isBlock, isSapling, isPlant, isSolid, isDoor, isCabinet, isLantern, isFlower, doorState, buildBlock, blockBounds, overlapsBlock, spawnPlayer, stepPlayer } from './world.js';
import { ChunkWorld } from './chunks.js';
import { ChunkRenderer } from './chunk-renderer.js';
import { createTextureAtlas, createLanternEmissiveMap } from './textures.js';
import { FootstepTracker, WaterSoundTracker, GameSounds } from './sound.js';
import { readAudioSettings, writeAudioSettings } from './audio-settings.js';
import { WorldSky } from './sky.js';
import { GameSession, serverURL } from './session.js';
import { browserSaves, saveMessage } from './browser-saves.js';
import { validateSave, newWorldId, MAX_SAVE_BYTES } from './saves.js';
import { OtherPlayers } from './players.js';
import { BlockParticles } from './particles.js';
import { LanternLighting } from './lanterns.js';
import { slabPlacement } from './slabs.js';
import { PerformanceOverlay } from './performance.js';
import { DirectorDebugView } from './director-ui.js';
import { TouchControls } from './touch.js';
import { GraphicsSettings } from './graphics.js';
import { Inventory, MATERIALS, STACK_LIMIT, validInventory } from './inventory.js';
import { InventoryView } from './inventory-ui.js';
import { renderHotbarSlots, fitHotbarLabels, highlightHotbarPickup } from './hotbar-ui.js';
import { StorageView } from './storage-ui.js';
import { UpkeepView, upkeepFailure } from './upkeep-ui.js';
import { strength, isRepairable } from './infrastructure.js';
import { applyDamageMaterial } from './damage.js';
import { ListenerRenderer } from './listener-renderer.js';
import { DOWNED_EYE_HEIGHT, rescueInReach } from './encounters.js';
import { MenuScreens } from './menu.js';
import { HotbarScroll, disableUIFocus, INVENTORY_KEY, DROP_KEY, hotbarArrowDirection } from './input.js';
import { DropRenderer } from './drop-renderer.js';
import { PICKUP_RADIUS } from './drops.js';
import { WardRenderer, shelterDescription, wardDescription } from './ward-renderer.js';
import './style.css';

const menu = document.querySelector('#menu');
const play = document.querySelector('#play');
const error = document.querySelector('#error');
const BLOCK_NAMES = Object.fromEntries(MATERIALS.map(item => [item.id, item.name]));
BLOCK_NAMES[WATER] = 'Water';
BLOCK_NAMES[SALVAGE_CRATE] = 'Salvage supply point';
disableUIFocus(document);

try {
  start();
} catch (cause) {
  console.error(cause);
  error.hidden = false;
  error.textContent = 'The 3D world could not start. Try a current version of Safari or Chrome with hardware acceleration enabled.';
  play.disabled = true;
}

function start() {
  const screens = new MenuScreens(menu);
  const canvas = document.querySelector('#game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Reuse shadow maps between block edits and timed sky updates.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const wardRenderer = new WardRenderer(scene);
  scene.background = new THREE.Color('#bfdce5');
  scene.fog = new THREE.Fog('#bfdce5');
  const graphics = new GraphicsSettings(renderer, scene.fog);

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
  const listenerRenderer = new ListenerRenderer(scene, material => lanternLighting.applyMaterial(material));
  const footsteps = new FootstepTracker();
  const waterSounds = new WaterSoundTracker();
  const hotbarScroll = new HotbarScroll();
  const soundToggle = document.querySelector('#sound-toggle');
  const effectsVolume = document.querySelector('#effects-volume');
  const musicVolume = document.querySelector('#music-volume');
  const musicEnabled = document.querySelector('#music-enabled');
  let audioStorage;
  try { audioStorage = localStorage; } catch { /* Browser storage is optional. */ }
  const audioPreferences = readAudioSettings(audioStorage);
  sounds.enabled = audioPreferences.enabled;
  sounds.effectsVolume = audioPreferences.effects;
  sounds.musicEnabled = audioPreferences.musicEnabled;
  sounds.musicVolume = audioPreferences.music;
  function syncAudioControls() {
    soundToggle.setAttribute('aria-pressed', String(!sounds.enabled));
    soundToggle.setAttribute('aria-label', sounds.enabled ? 'Mute all audio' : 'Unmute all audio');
    soundToggle.innerHTML = `Sound ${sounds.enabled ? 'on' : 'off'} <kbd>M</kbd>`;
    effectsVolume.value = String(Math.round(sounds.effectsVolume * 100));
    musicVolume.value = String(Math.round(sounds.musicVolume * 100));
    document.querySelector('#effects-volume-value').value = `${effectsVolume.value}%`;
    document.querySelector('#music-volume-value').value = `${musicVolume.value}%`;
    musicEnabled.checked = sounds.musicEnabled;
  }
  function toggleSound() {
    sounds.setEnabled(!sounds.enabled); syncAudioControls(); writeAudioSettings(audioStorage, sounds);
  }
  soundToggle.addEventListener('click', toggleSound);
  effectsVolume.addEventListener('input', () => {
    sounds.setEffectsVolume(Number(effectsVolume.value) / 100); syncAudioControls(); writeAudioSettings(audioStorage, sounds);
    void sounds.resume();
  });
  musicVolume.addEventListener('input', () => {
    sounds.setMusicVolume(Number(musicVolume.value) / 100); syncAudioControls(); writeAudioSettings(audioStorage, sounds);
    void sounds.resume();
  });
  musicEnabled.addEventListener('change', () => {
    sounds.setMusicEnabled(musicEnabled.checked); syncAudioControls(); writeAudioSettings(audioStorage, sounds);
  });
  syncAudioControls();
  const atlas = createTextureAtlas();
  const chunkRenderer = new ChunkRenderer(scene, world, {
    solid: new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, shadowSide: THREE.FrontSide }),
    water: new THREE.MeshPhongMaterial({ map: atlas, transparent: true, opacity: 0.68, depthWrite: false, shininess: 80, specular: '#42626c', side: THREE.DoubleSide }),
    glass: new THREE.MeshPhongMaterial({ map: atlas, transparent: true, opacity: 0.75, depthWrite: false, shininess: 90, specular: '#4c7382', side: THREE.DoubleSide }),
    lantern: new THREE.MeshLambertMaterial({ map: atlas, emissive: '#ffffff', emissiveMap: createLanternEmissiveMap(), emissiveIntensity: 1 }),
    flowers: new THREE.MeshLambertMaterial({ vertexColors: true }),
  }, () => { renderer.shadowMap.needsUpdate = true; }, cause => {
    error.hidden = false; error.textContent = cause.message;
  });
  const terrain = chunkRenderer.groups.solid, glass = chunkRenderer.groups.glass, lanterns = chunkRenderer.groups.lantern, flowers = chunkRenderer.groups.flowers;
  for (const [mode, material] of Object.entries(chunkRenderer.materials)) {
    // Reach the air beside thin doors/slabs, without crossing a full voxel wall.
    lanternLighting.applyMaterial(material, { surfaceOffset: mode === 'solid' ? 0.99 : 0.02 });
  }

  applyDamageMaterial(chunkRenderer.materials.solid);

  const outlineBox = new THREE.BoxGeometry(1, 1, 1);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(outlineBox), new THREE.LineBasicMaterial({ color: '#fff9dd' }));
  outlineBox.dispose();
  outline.visible = false;
  scene.add(outline);

  const controls = new PointerLockControls(camera, canvas);
  let playing = false;
  let encounter = { state: 'ready', revision: 0, immuneUntil: 0 }, encounterPlayers = [];
  let rescueHeld = false, rescueTarget = null, rescueSent = null, rescueElapsed = 0, rescuePending = false;
  const isDowned = () => encounter.state === 'downed';
  const eyeHeight = () => isDowned() ? DOWNED_EYE_HEIGHT : EYE_HEIGHT;
  let inventoryOpen = false;
  let inventoryReturnToPlay = false;
  let expectedPointerUnlock = false;
  let pointerCaptureWanted = false;
  let optionalPointerCapture = false;
  let captureAfterEscape = false;
  const touch = new TouchControls(canvas, camera, {
    jump() { if (!player.flying) jumpQueued = true; },
    pause: pauseGame,
    action(action) {
      if (!playing || isDowned()) return;
      if (action === 'break' || action === 'place') void editBlock(action === 'place');
      else if (action === 'use') void useDoor();
      else if (action === 'drop') void dropItem();
    },
  });
  touch.onModeChange = pauseGame;
  const diagnostics = new PerformanceOverlay(() => ({
    mode: history.mode, context: `${history.mode === 'single' ? 'Single player' : history.mode === 'multiplayer' ? 'Multiplayer' : 'Menu'}${history.mode ? playing ? ' · playing' : ' · paused' : ''}`,
    render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    chunks: { loaded: world.chunks.size, meshed: chunkRenderer.chunks.size, queued: chunkRenderer.dirty.size },
    mesh: chunkRenderer.jobs.stats('mesh'), generate: history.mode === 'single' ? history.backend?.jobs.stats('generate') : null,
    lighting: { jobs: lanternLighting.jobs?.stats('light'), sources: lanternLighting.sourceCount,
      fieldBytes: lanternLighting.uniforms.lanternField.value.image.data.byteLength },
    viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: renderer.getPixelRatio() },
    listener: history.mode === 'single' ? history.backend?.listener?.diagnostics() : null,
    graphics: graphics.snapshot(),
  }));
  const directorDebug = new DirectorDebugView(() => ({ mode: history.mode, listener: history.mode === 'single' ? history.backend?.listener?.diagnostics() : null }));
  graphics.onChange = () => diagnostics.reset();
  controls.pointerSpeed = 0.65;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.05;
  const keys = new Set();
  const raycaster = new THREE.Raycaster();
  raycaster.far = 6;
  const center = new THREE.Vector2();
  const crosshair = document.querySelector('#crosshair');
  const toast = document.querySelector('#toast');
  const timeLabel = document.querySelector('#time-label');
  const survivalStatus = document.querySelector('#survival-status');
  const shelterStatus = document.querySelector('#shelter-status');
  const wardHint = document.querySelector('#ward-hint');
  const listenerCue = document.querySelector('#listener-cue');
  const encounterStatus = document.querySelector('#encounter-status');
  const rescueButton = document.querySelector('#rescue-button');
  rescueButton.addEventListener('pointerdown', event => { if (!playing || isDowned()) return; event.preventDefault(); rescueHeld = true; rescueButton.setPointerCapture(event.pointerId); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rescueButton.addEventListener(type, () => { rescueHeld = false; });
  let cueUntil = 0, lastStepCaption = 0;
  const strengthHint = document.querySelector('#structure-strength');
  const strengthLabel = document.querySelector('#strength-label');
  const strengthMeter = document.querySelector('#strength-meter');
  let shelter = null;
  let confirmedProtection = null;
  function receiveShelter(next) {
    if (!next) return;
    const protectedNow = next.state === 'protected';
    if (playing && confirmedProtection !== null && next.state !== 'checking' && confirmedProtection !== protectedNow) {
      sounds.play(WARD_LANTERN, next.state === 'protected' ? 'ward_on' : 'ward_off');
      notify(next.state === 'protected' ? 'Ward protection active' : 'You are no longer protected');
    }
    if (next.state !== 'checking') confirmedProtection = protectedNow;
    shelter = next;
    shelterStatus.textContent = shelterDescription(next); shelterStatus.dataset.state = next.state;
    wardRenderer.sync(next.wards);
  }
  const inventory = new Inventory();
  const droppedItems = new DropRenderer(scene, atlas, material => lanternLighting.applyMaterial(material));
  history.inventory = () => inventory.snapshot();
  let selected = inventory.block;
  let target = null;
  let toastTimer;
  let jumpQueued = false;
  let hasPlayed = false;
  const inventoryButton = document.querySelector('#inventory-toggle');
  const hotbar = document.querySelector('#hotbar');
  new ResizeObserver(() => fitHotbarLabels(hotbar)).observe(hotbar);
  const inventoryView = new InventoryView(inventory, atlas, {
    action(args) { return history.request('inventory', args); },
    drop(args) { return history.request('drop', args); },
    close: closeInventory,
    escape() { closeInventory(true, { fromEscape: true }); },
  });
  const storageView = new StorageView(inventory, inventoryView, args => history.request('storage', args), closeInventory);
  const upkeepView = new UpkeepView((method, args) => history.request(method, args), closeInventory);
  inventoryButton.addEventListener('click', openInventory);
  renderHotbar();

  let dropping = false;
  async function dropItem(wholeStack = false) {
    if (dropping || !history.ready) return;
    const source = inventory.selected, stack = inventory.stacks[source];
    if (!stack) { notify('This hotbar slot is empty.'); return; }
    dropping = true;
    try {
      const result = await history.request('drop', { source, amount: wholeStack ? stack.count : 1, expectedSource: { ...stack } });
      if (!result.ok) notify(dropFailure(result.reason));
    } finally { dropping = false; }
  }

  function dropFailure(reason) {
    return { changed: 'That stack changed. Try dropping it again.', drops_full: 'There are too many dropped stacks. Pick some up first.',
      blocked: 'Move into an open space to drop items.', storage: 'Could not save the dropped item.', disconnected: 'Waiting for the host to reconnect…' }[reason] || 'Could not drop that item. Try again.';
  }

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  function select(block) {
    const index = inventory.hotbar.indexOf(block);
    if (index >= 0) { if (inventory.select(index)) inventoryChanged(); }
    else if (inventory.count(block)) void history.request('inventory', { action: 'pick', block });
    else notify(`Collect ${BLOCK_NAMES[block] || 'this material'} first.`);
  }

  function renderHotbar() {
    selected = inventory.block;
    renderHotbarSlots(hotbar, inventory, block => inventoryView.icon(block));
  }

  function inventoryChanged() {
    renderHotbar(); inventoryView.render();
    if (!history.ready) return;
    void history.request('inventory', { action: 'select', index: inventory.selected });
  }

  function loadInventory(message) {
    inventory.restore(message.inventory); renderHotbar(); inventoryView.render(); storageView.render();
  }

  function openInventory() {
    if (!history.ready || inventoryOpen || isDowned()) return;
    inventoryReturnToPlay = playing; inventoryOpen = true;
    pauseGame(); menu.hidden = true; inventoryView.open(inventoryReturnToPlay);
  }

  function closeInventory(resume = false, { fromEscape = false } = {}) {
    if (!inventoryOpen) return;
    const returnToPlay = resume && (inventoryReturnToPlay || fromEscape);
    inventoryOpen = false; inventoryReturnToPlay = false;
    inventoryView.close(); storageView.close(); upkeepView.close();
    if (returnToPlay && history.ready && !play.disabled) {
      if (fromEscape) resumeFromEscape();
      else { menu.hidden = false; requestPlay(); }
    } else {
      menu.hidden = false;
    }
  }

  function cycleFlower() {
    const flowers = FLOWER_TYPES.filter(block => inventory.count(block));
    if (!flowers.length) { notify('Collect some flowers first.'); return; }
    select(flowers[(flowers.indexOf(selected) + 1) % flowers.length]);
  }

  function clearInput() {
    keys.clear();
    rescueHeld = false;
    touch.reset();
    jumpQueued = false;
    accumulator = 0;
    footsteps.reset();
    waterSounds.reset();
    hotbarScroll.reset();
    sounds.stop();
    clearTimeout(toastTimer);
    toast.classList.remove('visible');
  }

  function requestPlay({ optionalCapture = false } = {}) {
    if (!history.ready) return;
    captureAfterEscape = false;
    error.hidden = true;
    void sounds.resume();
    if (touch.enabled) { setPlaying(true); return; }
    pointerCaptureWanted = true;
    optionalPointerCapture = optionalCapture;
    if (optionalCapture) setPlaying(true);
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
    if (optionalPointerCapture || playing) return;
    error.hidden = false;
    error.textContent = 'Mouse capture is unavailable. Choose Touch under Controls, or try Play again with a supported mouse browser.';
  }
  document.addEventListener('pointerlockerror', showPointerError);
  function setPlaying(active) {
    if (!active) pointerCaptureWanted = false;
    if (playing === active) return;
    playing = active;
    diagnostics.reset();
    clearInput();
    error.hidden = true;
    touch.setActive(active);
    menu.hidden = active || inventoryOpen;
    crosshair.hidden = !active;
    document.body.classList.toggle('playing', active);
    if (active) {
      hasPlayed = true;
      play.blur();
    } else {
      outline.visible = false;
      if (screens.inWorld) screens.show('pause');
      if (!history.backend?.saveError) void history.flush();
      if (hasPlayed) {
        screens.describeWorld(currentWorldDescription);
        play.innerHTML = 'Keep playing <span aria-hidden="true">↗</span>';
      }
    }
    queueMicrotask(() => history.sendPose());
  }
  function pauseGame() {
    setPlaying(false);
    if (document.pointerLockElement === canvas && !expectedPointerUnlock) {
      expectedPointerUnlock = true;
      controls.unlock();
    }
  }
  controls.addEventListener('lock', () => {
    expectedPointerUnlock = false;
    if (!pointerCaptureWanted || inventoryOpen || !history.ready) {
      expectedPointerUnlock = true;
      controls.unlock(); return;
    }
    setPlaying(true);
  });
  controls.addEventListener('unlock', () => {
    // Releasing the mouse for inventory is asynchronous. A late notification
    // must not reopen the pause menu after inventory has already been closed.
    if (expectedPointerUnlock) { expectedPointerUnlock = false; return; }
    if (!playing || !controls.isLocked) return;
    setPlaying(false);
  });
  function resumeFromEscape() {
    pointerCaptureWanted = true;
    setPlaying(true);
    // Escape is also the browser's unlock gesture. Wait until it is released
    // before trying to capture the mouse, and never gate closing a menu on it.
    captureAfterEscape = true;
  }
  window.addEventListener('blur', () => {
    sounds.music?.stop();
    captureAfterEscape = false;
    inventoryReturnToPlay = false;
    if (inventoryOpen) inventoryView.back.textContent = 'Back to menu';
    clearInput();
    pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      sounds.music?.stop();
      captureAfterEscape = false;
      inventoryReturnToPlay = false;
      if (inventoryOpen) inventoryView.back.textContent = 'Back to menu';
      clearInput();
      pauseGame();
      if (!history.backend?.saveError) void history.flush();
    }
  });
  window.addEventListener('pagehide', () => { sounds.stop(); sounds.music?.stop(); if (!history.backend?.saveError) void history.flush(); });

  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const modified = event.metaKey || event.ctrlKey || event.altKey;
    if (!typing && event.code === 'KeyO' && !event.repeat && !modified) { event.preventDefault(); directorDebug.setEnabled(!directorDebug.enabled); return; }
    if (event.code === 'Escape') {
      event.preventDefault();
      // The browser can consume Escape keyup when releasing pointer lock.
      // Rely on repeat instead of a held-key flag that could survive that press.
      if (event.repeat) return;
      if (inventoryOpen) { closeInventory(true, { fromEscape: true }); return; }
      if (diagnostics.enabled) diagnostics.setEnabled(false);
      if (playing) pauseGame();
      else if (history.ready && !play.disabled) resumeFromEscape();
      else screens.goBack();
      return;
    }
    if (inventoryOpen) {
      if (!typing && !modified && !event.repeat && event.code === INVENTORY_KEY) { event.preventDefault(); closeInventory(true); return; }
      if (storageView.dialog.open || upkeepView.dialog.open) return;
      if (!typing && !modified && !event.repeat) {
        if (/^Digit[1-9]$/.test(event.code)) { event.preventDefault(); const index = Number(event.code.slice(-1)) - 1; if (!inventoryView.hotbarKey(index) && inventory.select(index)) inventoryChanged(); }
        else if (hotbarArrowDirection(event.code)) { event.preventDefault(); stepHotbar(hotbarArrowDirection(event.code)); }
      }
      return;
    }
    if (typing) return;
    if (event.code === INVENTORY_KEY && !modified) { event.preventDefault(); if (!event.repeat) void interactOrInventory(); return; }
    if (event.code === 'KeyP' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault(); diagnostics.setEnabled(!diagnostics.enabled); return;
    }
    if (event.code === 'KeyM' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      toggleSound();
      return;
    }
    if (!playing || isDowned()) return;
    if (event.code === 'KeyH' && !modified) { event.preventDefault(); keys.add(event.code); return; }
    if (event.code === DROP_KEY && !modified) {
      event.preventDefault(); if (!event.repeat) void dropItem(event.shiftKey); return;
    }
    if (hotbarArrowDirection(event.code) && !modified) { event.preventDefault(); stepHotbar(hotbarArrowDirection(event.code)); return; }
    if (/^Digit[1-9]$/.test(event.code) && !event.repeat && !modified) {
      event.preventDefault(); if (inventory.select(Number(event.code.slice(-1)) - 1)) inventoryChanged(); return;
    }
    if (event.code === 'Digit0' && !event.repeat && !modified) { event.preventDefault(); select(DOOR); return; }
    if (event.code === 'KeyL' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      select(event.shiftKey ? WARD_LANTERN : LANTERN);
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
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat && !player.flying) jumpQueued = true;
    if (event.code === 'KeyF' && !event.repeat) editBlock(true);
  });
  function pickBlock() {
    updateTarget();
    if (target) {
      const block = buildBlock(world.get(target.x, target.y, target.z));
      if (!inventory.count(block)) notify(`Collect ${BLOCK_NAMES[block]} first.`);
      else { select(block); notify(`${BLOCK_NAMES[block]} selected`); }
    } else notify('Look at a nearby block to pick its material.');
  }

  document.addEventListener('keyup', (event) => {
    keys.delete(event.code);
    if (event.code !== 'Escape') return;
    const capture = captureAfterEscape && playing;
    captureAfterEscape = false;
    if (capture) requestPlay({ optionalCapture: true });
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('mousedown', (event) => {
    if (!playing || touch.enabled || isDowned()) return;
    if (document.pointerLockElement !== canvas) {
      event.preventDefault(); requestPlay({ optionalCapture: true }); return;
    }
    if (event.button === 1) { event.preventDefault(); pickBlock(); }
    else if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
      event.preventDefault(); void interactOrPlace();
    } else if (event.button === 0) {
      event.preventDefault(); void editBlock(false);
    }
  });
  document.addEventListener('wheel', event => {
    if (!playing || inventoryOpen || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const direction = hotbarScroll.update(event, performance.now());
    if (direction) stepHotbar(direction);
  }, { passive: false });
  function stepHotbar(direction) {
    if (inventory.select((inventory.selected + direction + inventory.hotbar.length) % inventory.hotbar.length)) inventoryChanged();
  }
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

  function interactionTarget() {
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
    return door;
  }

  async function interactOrPlace() {
    if (isDowned()) return;
    if (selected === STONE_HAMMER && target && isRepairable(world.get(target.x, target.y, target.z))) { await repairTarget(); return; }
    const door = interactionTarget();
    if (door) await useDoor(door);
    else if (target && (world.get(target.x, target.y, target.z) === WARD_LANTERN || world.get(target.x, target.y, target.z) === SALVAGE_CRATE || isSapling(world.get(target.x, target.y, target.z)))) await openUpkeep();
    else if (target && isCabinet(world.get(target.x, target.y, target.z))) await openStorage();
    else await editBlock(true);
  }

  async function interactOrInventory() {
    if (!playing) { openInventory(); return; }
    if (isDowned()) return;
    const door = interactionTarget(), block = target && world.get(target.x, target.y, target.z);
    if (door || target && (isCabinet(block) || block === WARD_LANTERN || block === SALVAGE_CRATE || isSapling(block)
      || selected === STONE_HAMMER && isRepairable(block))) await useDoor(door);
    else openInventory();
  }

  let openingStorage = false;
  async function openStorage() {
    if (!target || inventoryOpen || openingStorage) return;
    const backend = history.backend, position = { x: target.x, y: target.y, z: target.z };
    openingStorage = true;
    try {
      const result = await history.request('openStorage', position);
      if (history.backend !== backend || !history.ready) return;
      if (!result.ok) { editError(result); return; }
      if (!playing || inventoryOpen || !isCabinet(world.get(position.x, position.y, position.z))) return;
      inventoryReturnToPlay = playing; inventoryOpen = true;
      pauseGame(); menu.hidden = true; storageView.open(result.storage);
    } finally { openingStorage = false; }
  }

  let openingUpkeep = false;
  async function openUpkeep() {
    if (!target || inventoryOpen || openingUpkeep) return;
    const backend = history.backend, p = { x: target.x, y: target.y, z: target.z };
    openingUpkeep = true;
    try {
      const result = await history.request('inspectUpkeep', p);
      if (history.backend !== backend || !history.ready) return;
      if (!result.ok) { notify(upkeepFailure(result.reason)); return; }
      if (!playing || inventoryOpen) return;
      inventoryReturnToPlay = playing; inventoryOpen = true; pauseGame(); menu.hidden = true; upkeepView.open(result.info);
    } finally { openingUpkeep = false; }
  }
  async function repairTarget() {
    const result = await history.request('repair', { x: target.x, y: target.y, z: target.z });
    notify(result.ok ? result.message : upkeepFailure(result.reason));
  }

  async function useDoor(door = interactionTarget()) {
    if (isDowned()) return;
    if (selected === STONE_HAMMER && target && isRepairable(world.get(target.x, target.y, target.z))) { await repairTarget(); return; }
    if (!door) {
      if (target && (world.get(target.x, target.y, target.z) === WARD_LANTERN || world.get(target.x, target.y, target.z) === SALVAGE_CRATE || isSapling(world.get(target.x, target.y, target.z)))) await openUpkeep();
      else if (target && isCabinet(world.get(target.x, target.y, target.z))) await openStorage();
      else notify('Look at a door, chest, ward, sapling, or supply point to interact.');
      return;
    }
    const result = await history.toggleDoor(door.x, door.y, door.z);
    if (!result.ok) { editError(result); return; }
  }

  async function editBlock(place) {
    if (!history.ready || isDowned()) return;
    updateTarget();
    if (!target) return;
    let { x, y, z } = target;
    let nextBlock;
    if (place) {
      if (!selected) { notify('Choose a block in your hotbar. Open inventory with E to move one there.'); return; }
      if (!isBlock(selected)) { notify(selected === STONE_HAMMER ? 'Use this tool on a damaged structure with E / Use.' : selected === CHARCOAL ? 'Use a ward lantern to load charcoal.' : 'Use wooden pegs to craft braced timber.'); return; }
      const replacingFlower = isPlant(world.get(x, y, z));
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
      if (isDoor(selected)) {
        if (!replacingFlower && target.normal.y < 0.5) { notify('Place a door on a full-height surface.'); return; }
        const facing = (Math.round(-camera.rotation.y / (Math.PI / 2)) % 4 + 4) % 4;
        const result = await history.placeDoor(x, y, z, facing, selected);
        if (!result.ok) {
          editError(result, 'A door needs a full-height surface and two clear blocks above it.');
          return;
        }
        return;
      }
      if (isLantern(selected)) {
        if (!replacingFlower && target.normal.y < 0.5) { notify('Place a lantern on a full-height surface.'); return; }
        const result = await history.placeLantern(x, y, z, selected);
        if (!result.ok) {
          editError(result, 'A lantern needs a full-height surface with clear space above it.');
          return;
        }
        return;
      }
      if (isSapling(selected)) {
        const result = await history.edit(x, y, z, selected);
        if (!result.ok) editError(result, 'Plant saplings on grass or dirt with clear space above.');
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
    if (!result.ok && result.reason !== 'cooldown') editError(result);
    else if (result.remaining) notify(`Block strength: ${result.remaining} hits remaining`);
  }

  function editError(result, fallback = 'That edit could not be applied.') {
    notify({ creature: 'The Listener is in that space. Wait until it moves clear.', downed: 'You are down. Wait for help or automatic recovery.', blocked: 'That space is occupied by a player. Move clear, then try again.',
      changed: 'Someone changed that block. This action cannot overwrite their edit.',
      storage_not_empty: 'Empty this chest before dismantling it.',
      landmark: 'This is a fixed salvage supply point. Use it to gather supplies.',
      capacity: 'This world has reached its storage or construction tracking limit.',
      cooldown: 'Wait a moment before striking again.',
      storage: 'Your latest changes could not be saved. Retry saving or export a backup from the menu.',
      supplies: 'You don’t have enough of that material. Break blocks to collect more.',
      inventory_full: 'Your inventory is full. Make room before collecting more.',
      disconnected: 'Waiting for the host to reconnect…', busy: 'Let the current edits finish, then try again.', reach: 'That block is out of reach.' }[result.reason] || fallback);
  }

  function finishEdit(change, normal, changes = [change], actor) {
    const { from, to } = change;
    const chest = storageView.storage;
    if (chest && changes.some(c => c.x === chest.x && c.y === chest.y && c.z === chest.z && !isCabinet(c.to))) { closeInventory(false); notify('The chest was dismantled.'); }
    const position = { x: change.x + 0.5, y: change.y + 0.5, z: change.z + 0.5 };
    const listener = { x: player.x, y: player.y + eyeHeight(), z: player.z };
    if (changes.every(c => isDoor(c.from) && isDoor(c.to))) {
      if (playing) sounds.playAt(buildBlock(to), doorState(to).open ? 'open' : 'close', position, listener);
    }
    else {
      const placing = isSolid(to) || isPlant(to);
      if (playing) {
        if (actor === 'listener') sounds.playListenerImpact(from, 'break', position, listener);
        else sounds.playAt(placing ? to : from, placing ? 'place' : 'break', position, listener);
      }
      for (const c of changes) if ((!isSolid(c.to) && !isPlant(c.to)) && (isSolid(c.from) || isPlant(c.from))) particles.burst(c.x, c.y, c.z, c.from, normal);
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

  function receiveEncounter(next, initial = false) {
    if (!next) return;
    const changed = encounter.revision !== next.revision, wasDown = isDowned();
    encounter = next;
    if (next.position && (changed && !initial || isDowned())) {
      Object.assign(player, next.position, { vy: 0, grounded: false });
      if (changed) { clearInput(); renderer.shadowMap.needsUpdate = true; syncCamera(); }
    }
    document.body.classList.toggle('downed', isDowned());
    if (isDowned() && !wasDown) {
      closeInventory(false);
      notify('The Listener caught you. Your supplies are safe.');
    } else if (!isDowned() && wasDown) notify('Back on your feet. You have a brief recovery grace period.');
  }

  function updateEncounter(seconds) {
    const now = history.mode === 'single' ? history.clock.elapsedSeconds : history.backend?.elapsedSeconds?.() ?? history.clock.elapsedSeconds ?? 0;
    encounterStatus.hidden = !history.ready || (!isDowned() && encounter.immuneUntil <= now);
    if (!encounterStatus.hidden) encounterStatus.textContent = isDowned()
      ? `You are down · A teammate can hold H nearby to help (${Math.round((encounter.rescueProgress || 0) * 100)}%). Automatic return in ${Math.max(0, Math.ceil(encounter.recoveryAt - now))}s. Supplies kept.`
      : `Recovering · The Listener cannot touch you for ${Math.ceil(encounter.immuneUntil - now)}s`;
    rescueTarget = null;
    if (playing && history.ready && !isDowned()) for (const candidate of encounterPlayers) {
      if (candidate.id === history.selfId || candidate.encounter?.state !== 'downed') continue;
      const distance = Math.hypot(candidate.x - player.x, candidate.z - player.z);
      if (rescueTarget && distance >= rescueTarget.distance) continue;
      if (rescueInReach(world, player, candidate)) rescueTarget = { ...candidate, distance };
    }
    rescueButton.hidden = !rescueTarget;
    if (rescueTarget) rescueButton.textContent = `Hold ${touch.enabled ? 'to help' : 'H to help'} ${rescueTarget.name} · ${Math.round((rescueTarget.encounter.rescueProgress || 0) * 100)}%`;
    const targetId = rescueTarget && (keys.has('KeyH') || rescueHeld) ? rescueTarget.id : null;
    rescueElapsed += seconds;
    if (!rescuePending && history.ready && (targetId ? rescueElapsed >= .2 : rescueSent !== null)) {
      rescuePending = true; rescueElapsed = 0; rescueSent = targetId;
      void history.request('rescue', { targetId }).finally(() => { rescuePending = false; });
    }
    if (!rescueTarget) rescueHeld = false;
  }

  function syncCamera() {
    camera.position.set(player.x, player.y + eyeHeight(), player.z);
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
  let pickupElapsed = 0, pickingUp = false;
  const fixedStep = 1 / 120;
  renderer.setAnimationLoop((now) => {
    const frameStarted = performance.now();
    const simulationElapsed = Math.max(0, (now - previous) / 1000);
    const elapsed = Math.min(simulationElapsed, 0.1);
    sounds.setListener({ x: player.x, y: player.y + eyeHeight(), z: player.z, yaw: camera.rotation.y }, world);
    listenerCue.hidden = !playing || now >= cueUntil;
    upkeepView.update(elapsed);
    previous = now;
    if (playing && history.ready) {
      accumulator += elapsed;
      while (!isDowned() && accumulator >= fixedStep) {
        const before = { ...player };
        stepPlayer(player, world, {
          forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + touch.forward,
          strafe: Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.strafe,
          yaw: camera.rotation.y,
          jump: jumpQueued,
          sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.sprint,
        }, fixedStep);
        const waterAction = waterSounds.update(before, player, world, fixedStep);
        if (waterAction) sounds.play(WATER, waterAction);
        if (waterSounds.wet) footsteps.reset();
        else if (footsteps.update(before, player)) {
          const x = Math.floor(player.x), z = Math.floor(player.z);
          const block = world.get(x, Math.floor(player.y - 0.05), z);
          sounds.play(block, 'step', keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.sprint ? .9 : .65);
        }
        jumpQueued = false;
        accumulator -= fixedStep;
      }
      if (isDowned()) { accumulator = 0; player.vy = 0; }
      if (!isDowned() && player.y < -15) {
        Object.assign(player, spawnPlayer(world));
        notify('Back on solid ground.');
      }
      syncCamera();
      updateTarget();
      if (isDowned()) outline.visible = false;
      particles.update(elapsed, world);
    }
    // Do not replay a long gap after the browser suspends a private world.
    history.update(Math.min(simulationElapsed, 1));
    updateEncounter(elapsed);
    droppedItems.update(history.clock.running ? elapsed : 0, world);
    pickupElapsed += elapsed;
    if (playing && history.ready && !isDowned() && !pickingUp && pickupElapsed >= 0.25) {
      pickupElapsed = 0;
      // The host owns pickup delays on the persistent simulation clock.
      if (droppedItems.items.some(item => Math.hypot(item.x - player.x, item.z - player.z) <= PICKUP_RADIUS && Math.abs(item.y - player.y) < 2
        && inventory.stacks.some(stack => !stack || stack.block === item.block && stack.count < STACK_LIMIT))) {
        pickingUp = true;
        void history.request('pickup').then(result => {
          if (!result.ok || !result.picked) return;
          if (playing) sounds.playPickup();
          highlightHotbarPickup(hotbar, result.hotbarSlots || []);
        }).finally(() => { pickingUp = false; });
      }
    }
    if (history.mode) chunkRenderer.update(player);
    play.disabled = !history.ready || !chunkRenderer.readyAt(player);
    inventoryButton.disabled = !history.ready;
    if (history.ready && !chunkRenderer.readyAt(player)) setConnectionStatus('Preparing nearby terrain…');
    else if (history.ready && connection.textContent === 'Preparing nearby terrain…') setConnectionStatus(history.mode === 'single' ? 'Single player · Private world' : '');
    const coordinates = document.querySelector('#coordinates');
    coordinates.hidden = !history.mode;
    if (history.mode) coordinates.textContent = `X ${Math.floor(player.x)} · Y ${Math.floor(player.y)} · Z ${Math.floor(player.z)}`;
    avatarShadowElapsed += elapsed;
    const listenerMoved = listenerRenderer.update(elapsed, world, player);
    if ((otherPlayers.update(elapsed) || listenerMoved) && avatarShadowElapsed >= 0.2) {
      renderer.shadowMap.needsUpdate = true;
      avatarShadowElapsed = 0;
    }
    sky.clock.phase = history.phase();
    sky.clock.held = history.clock.held;
    const skyState = sky.update(history.clock.running ? elapsed : 0, camera);
    sounds.updateMusic({ phase: sky.clock.phase, creature: listenerRenderer.snapshot, player, downed: isDowned(),
      active: !!history.mode && history.ready && !document.hidden && document.hasFocus() });
    lanternLighting.update(playing ? elapsed : 0, camera.position, skyState.daylight);
    const clock = history.clock;
    const label = history.mode ? `Day ${clock.day || 1} · ${skyState.label} · ${clock.running ? 'World running' : 'World paused'}` : 'Horror · Gather, repair, endure';
    if (timeLabel.textContent !== label) timeLabel.textContent = label;
    survivalStatus.hidden = !history.mode;
    if (history.mode) survivalStatus.textContent = `Day ${clock.day || 1} · ${skyState.label}`;
    shelterStatus.hidden = !history.mode;
    const aimedBlock = target ? world.get(target.x, target.y, target.z) : 0;
    const upkeepTarget = aimedBlock === WARD_LANTERN || aimedBlock === SALVAGE_CRATE || isSapling(aimedBlock);
    wardHint.hidden = !playing || !target || (!upkeepTarget && !isCabinet(aimedBlock) && !(selected === STONE_HAMMER && isRepairable(aimedBlock)));
    if (!wardHint.hidden) wardHint.textContent = selected === STONE_HAMMER && isRepairable(aimedBlock) ? 'E / Use to repair · Uses stone for masonry, planks for wood' : isCabinet(aimedBlock) ? 'Shared storage · E / Use to open' : aimedBlock === SALVAGE_CRATE ? 'Salvage supply point · E / Use to gather' : isSapling(aimedBlock) ? 'Sapling · E / Use to inspect growth' : `${wardDescription(shelter?.wards.find(ward => ward.x === target.x && ward.y === target.y && ward.z === target.z))} · E / Use to manage fuel`;
    strengthHint.hidden = !playing || !history.ready || !target || selected !== STONE_HAMMER || strength(aimedBlock) <= 1;
    if (!strengthHint.hidden) {
      const max = strength(aimedBlock), remaining = chunkRenderer.damage.remaining(target.x, target.y, target.z, aimedBlock);
      const label = `${BLOCK_NAMES[buildBlock(aimedBlock)]} · ${remaining}/${max} strength`;
      if (strengthLabel.textContent !== label) strengthLabel.textContent = label;
      strengthMeter.max = max; strengthMeter.value = remaining;
      strengthMeter.setAttribute('aria-label', label);
      strengthHint.dataset.damaged = String(remaining < max);
    }
    wardRenderer.update(now / 1000);
    document.body.classList.toggle('night', skyState.daylight < 0.3);
    const rendered = graphics.limiter.allow(now);
    if (rendered) {
      renderer.info.reset();
      renderer.render(scene, camera);
    }
    diagnostics.frame(frameStarted, performance.now(), rendered);
    directorDebug.frame(performance.now());
  });

  const nameInput = document.querySelector('#player-name');
  const connection = document.querySelector('#network-status');
  const sessionMode = document.querySelector('#session-mode');
  const sessionModeLabel = document.querySelector('#session-mode-label');
  const sessionModeValue = document.querySelector('#session-mode-value');
  const connectedPlayers = document.querySelector('#connected-players');
  const connectedPlayerList = document.querySelector('#connected-player-list');
  const connectedPlayerCount = document.querySelector('#connected-player-count');
  const connectedPlayersStatus = document.querySelector('#connected-players-status');
  let playerCapacity = 8;
  let playerListSignature = '';
  const leaveButton = document.querySelector('#leave-world');
  const saveRow = document.querySelector('#save-row');
  const saveStatus = document.querySelector('#save-status');
  const saveNow = document.querySelector('#save-now');
  const exportWorld = document.querySelector('#export-world');
  let currentWorldDescription = 'Gather supplies. Repair your shelter. Endure the night.';
  const retryButton = document.querySelector('#retry-connection');
  function setConnectionStatus(text) {
    connection.textContent = text;
    connection.hidden = !text;
  }
  try { nameInput.value = localStorage.getItem('blockfield-name') || ''; } catch { /* Names are optional. */ }
  history.pose = () => ({ x: player.x, y: player.y, z: player.z, yaw: camera.rotation.y, pitch: camera.rotation.x,
    active: playing && !isDowned(), flying: player.flying, encounterRevision: encounter.revision });
  history.callbacks = {
    storage(saved) { storageView.sync(saved); },
    constructionChunk({ key, damage }) { chunkRenderer.damage.setChunk(key, damage); },
    construction(damage, { by } = {}) {
      chunkRenderer.damage.set(damage);
      if (playing) {
        const position = { x: damage.x + .5, y: damage.y + .5, z: damage.z + .5 };
        if (by === 'listener') sounds.playListenerImpact(damage.block, 'hit', position, camera.position);
        else sounds.playAt(damage.block, damage.remaining === strength(damage.block) ? 'repair' : 'hit', position, camera.position);
      }
    },
    listener(state) {
      const cues = listenerRenderer.sync(state);
      for (const event of cues) {
        if (!playing) continue;
        const ear = { x: player.x, y: player.y + eyeHeight(), z: player.z, yaw: camera.rotation.y };
        const position = sounds.cuePosition(event.source, ear);
        if (position.gain < .025) continue;
        sounds.playCueAt(event.kind, event.source, ear);
        const now = performance.now();
        if (event.kind === 'step' && (cues.some(cue => cue.kind !== 'step') || now - lastStepCaption < 4500)) continue;
        if (event.kind === 'step') lastStepCaption = now;
        const behind = (event.source.x - ear.x) * -Math.sin(ear.yaw) + (event.source.z - ear.z) * -Math.cos(ear.yaw) < 0;
        const direction = position.pan < -.35 ? 'to the left' : position.pan > .35 ? 'to the right' : behind ? 'behind you' : 'nearby';
        listenerCue.textContent = state.winding ? 'The Listener is reaching. Back away.' : `${{ alert: 'Fabric dragging', notice: 'A sudden rustle', search: 'Slow, searching steps', pursuit: 'A sharp breath, then quickening steps', pressure: 'Scraping against a barrier', breath: 'An uneven breath', retreat: 'Brush receding', step: 'A heavy footfall' }[event.kind]} ${direction}`;
        cueUntil = now + 3500;
      }
    },
    upkeep(info) { upkeepView.sync(info); },
    shelter: receiveShelter,
    drops(items) { droppedItems.sync(items); },
    supplies(saved) {
      if (!validInventory(saved) || saved.mode !== 'gather') return;
      inventory.restore({ ...saved, selected: inventory.selected }); renderHotbar(); inventoryView.render(); storageView.render();
    },
    status(text) {
      setConnectionStatus(text);
      play.disabled = true;
      retryButton.hidden = !history.blocked;
      document.querySelector('#player-count').textContent = 'connecting';
      if (history.mode === 'multiplayer') renderConnectedPlayers([], history.blocked ? 'Not connected.' : 'Connecting…');
    },
    welcome(message) {
      encounter = { state: 'ready', revision: -1, immuneUntil: 0 }; encounterPlayers = message.players || [];
      rescueSent = null; rescueElapsed = 0; rescueHeld = false;
      sounds.stop(); sounds.music?.reset();
      chunkRenderer.damage.clear(); listenerRenderer.sync(null); sounds.remoteSteps.clear(); cueUntil = 0;
      droppedItems.sync([]);
      Object.assign(player, message.self, { vy: 0, grounded: false, flying: false });
      receiveEncounter(message.self.encounter, true);
      camera.rotation.set(message.self.pitch, message.self.yaw, 0, 'YXZ');
      clearInput(); syncCamera(); rebuildMeshes();
      error.hidden = true;
      nameInput.value = message.self.name;
      currentWorldDescription = `${message.worldName} · Horror · Seed: ${message.world.seed}`;
      screens.describeWorld(currentWorldDescription);
      sessionMode.dataset.mode = message.gameMode;
      sessionModeValue.textContent = 'Horror · Gather, repair, endure';
      loadInventory(message);
      document.querySelector('[data-touch="drop"]').hidden = false;
      play.disabled = true;
      retryButton.hidden = true;
      saveNow.hidden = exportWorld.hidden = history.mode !== 'single';
      saveNow.disabled = false;
      if (history.mode !== 'single') {
        setConnectionStatus('');
        saveStatus.dataset.state = 'saved';
        saveStatus.textContent = message.persistence ? '' : 'This host has saving disabled';
        saveRow.hidden = !!message.persistence;
        document.querySelector('#world-footnote').textContent = message.persistence ? 'Shared world · Saved on the host' : 'Shared world · Temporary host';
      }
      playerCapacity = message.maxPlayers || 8;
    },
    players(players) {
      encounterPlayers = players;
      receiveEncounter(players.find(p => p.id === history.selfId)?.encounter);
      if (playing) sounds.trackPlayers(players, history.selfId); else sounds.remoteSteps.clear();
      if (otherPlayers.sync(players, history.selfId)) renderer.shadowMap.needsUpdate = true;
      if (history.mode === 'multiplayer') renderConnectedPlayers(players);
      if (history.mode === 'single') setConnectionStatus('Single player · Private world');
      document.querySelector('#player-count').textContent = history.mode === 'single' ? 'single player' : `${players.length} / ${playerCapacity} players`;
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
    edit(message) { chunkRenderer.damage.edited(message.changes); if (message.method === 'growth') rebuildMeshes(message.changes); else finishEdit(message.changes[0], undefined, message.changes, message.by); },
    disconnected() {
      sounds.music?.reset();
      listenerRenderer.sync(null); cueUntil = 0; encounterPlayers = []; rescueTarget = null;
      shelter = null; confirmedProtection = null; wardRenderer.sync(); shelterStatus.textContent = 'Protection unavailable · Reconnecting'; shelterStatus.dataset.state = 'checking';
      renderConnectedPlayers([], 'Not connected.');
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
  function renderConnectedPlayers(players, status = '') {
    const sorted = [...players].sort((a, b) => Number(b.id === history.selfId) - Number(a.id === history.selfId) || a.name.localeCompare(b.name));
    const signature = JSON.stringify([history.selfId, playerCapacity, status, sorted.map(p => [p.id, p.name, p.color])]);
    // Player positions arrive several times per second; names only need to be
    // redrawn when the roster changes.
    if (signature === playerListSignature) return;
    playerListSignature = signature;
    connectedPlayerCount.textContent = `${sorted.length} / ${playerCapacity}`;
    connectedPlayersStatus.hidden = !status;
    connectedPlayersStatus.textContent = status;
    connectedPlayerList.replaceChildren();
    for (const player of sorted) {
      const row = document.createElement('li'); row.dataset.playerId = player.id;
      const color = document.createElement('span'); color.className = 'connected-player-color'; color.style.backgroundColor = player.color; color.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'connected-player-name'; name.textContent = player.name;
      row.append(color, name);
      if (player.id === history.selfId) {
        const you = document.createElement('span'); you.className = 'connected-player-you'; you.textContent = 'You'; row.append(you);
      }
      connectedPlayerList.append(row);
    }
  }
  function openSession(mode) {
    droppedItems.sync([]); shelter = null; confirmedProtection = null; wardRenderer.sync();
    shelterStatus.textContent = 'Checking shelter'; shelterStatus.dataset.state = 'checking';
    closeInventory(false);
    pauseGame();
    diagnostics.reset();
    screens.setSession(true);
    sessionModeLabel.textContent = mode === 'multiplayer' ? 'Server mode' : 'World mode';
    sessionModeValue.textContent = mode === 'multiplayer' ? 'Checking server…' : 'Loading world…';
    delete sessionMode.dataset.mode;
    play.hidden = false; leaveButton.hidden = false;
    inventoryButton.hidden = false; inventoryButton.disabled = true;
    menu.classList.toggle('multiplayer-session', mode === 'multiplayer');
    connectedPlayers.hidden = mode !== 'multiplayer';
    playerCapacity = 8; renderConnectedPlayers([], 'Connecting…');
    document.querySelector('#world-footnote').textContent = mode === 'single'
      ? 'Private world · Autosaved in this browser'
      : 'Shared world · Hosted by the server';
    saveRow.hidden = mode !== 'single';
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
      const url = serverURL(document.querySelector('#server-address').value, location.origin, document.querySelector('#server-port').value);
      if (url.origin !== location.origin) { url.searchParams.set('name', nameInput.value.slice(0, 20)); location.assign(url); return; }
      openSession('multiplayer'); history.connect(nameInput.value);
    } catch (cause) { error.hidden = false; error.textContent = cause.message; }
  });
  function showChooser() {
    sounds.music?.reset();
    droppedItems.sync([]); shelter = null; confirmedProtection = null; wardRenderer.sync();
    shelterStatus.textContent = 'Checking shelter'; shelterStatus.dataset.state = 'checking';
    closeInventory(false);
    pauseGame();
    diagnostics.reset();
    history.disconnect(); listenerRenderer.sync(null); cueUntil = 0; chunkRenderer.reset(); chunkRenderer.damage.clear(); world.chunks.clear(); lanternLighting.sync(world);
    otherPlayers.sync([], null); clearInput();
    screens.setSession(false);
    play.hidden = true; leaveButton.hidden = true;
    menu.classList.remove('multiplayer-session'); connectedPlayers.hidden = true;
    renderConnectedPlayers([]);
    inventoryButton.hidden = true; inventoryButton.disabled = true;
    saveRow.hidden = true;
    setConnectionStatus('');
    document.querySelector('#player-count').textContent = 'choose a world';
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
  const worldList = document.querySelector('#saved-worlds');
  const worldSearch = document.querySelector('#world-search');
  const worldCount = document.querySelector('#world-count');
  let savedWorlds = [];
  worldSearch.addEventListener('input', renderSavedWorlds);
  screens.onChange = screen => { if (screen === 'single') void refreshSavedWorlds(); };

  function renderSavedWorlds() {
    const list = worldList;
    const query = worldSearch.value.trim().toLocaleLowerCase();
    const saves = savedWorlds.filter(save => `${save.name} ${save.world?.seed || ''}`.toLocaleLowerCase().includes(query));
    worldCount.textContent = query ? `${saves.length} of ${savedWorlds.length} worlds` : `${savedWorlds.length} ${savedWorlds.length === 1 ? 'world' : 'worlds'} · Most recently saved first`;
    list.replaceChildren();
    if (!saves.length) {
      const empty = document.createElement('p'); empty.className = 'world-list-empty';
      empty.textContent = savedWorlds.length ? 'No worlds match your search. Try another name or seed.' : 'No worlds yet. Create your first world or import a backup to get started.';
      list.append(empty); return;
    }
    for (const save of saves) {
      const row = document.createElement('div'); row.className = 'saved-world'; row.dataset.worldId = save.id;
      const info = document.createElement('div'); info.className = 'saved-world-info';
      const title = document.createElement('strong'); title.className = 'saved-world-title'; title.textContent = save.name || 'Saved world';
      const details = document.createElement('span'); details.className = 'saved-world-details';
      details.textContent = `${save.gameMode === 'horror' ? 'Horror' : 'Continue in Horror'} · Saved ${new Date(save.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
      const seed = document.createElement('span'); seed.className = 'saved-world-seed'; seed.textContent = `Seed: ${save.world?.seed || 'unknown'}`;
      info.append(title, details, seed);
      const actions = document.createElement('div'); actions.className = 'saved-world-actions';
      const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = 'Open';
      resume.setAttribute('aria-label', `Open ${save.name || 'saved world'}`);
      resume.addEventListener('click', () => void localWorld(() => history.resume(nameInput.value, save.id)));
      const backup = document.createElement('button'); backup.type = 'button'; backup.textContent = 'Export';
      backup.setAttribute('aria-label', `Export ${save.name || 'saved world'}`);
      backup.addEventListener('click', async () => { try { download(await browserSaves.load(save.id)); } catch (cause) { error.hidden = false; error.textContent = saveMessage(cause); } });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-world'; remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${save.name || 'saved world'}`);
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Delete “${save.name || 'Saved world'}”?\n\nThis permanently removes the world from this browser. Export a backup first if you want to keep it.`)) return;
        resume.disabled = backup.disabled = remove.disabled = true;
        remove.textContent = 'Deleting…';
        try {
          await browserSaves.remove(save.id, save.saveRevision);
          await refreshSavedWorlds(); error.hidden = true;
          notify(`Deleted “${save.name || 'Saved world'}”.`);
        } catch (cause) {
          if (cause.code === 'SAVE_CONFLICT') await refreshSavedWorlds();
          error.hidden = false; error.textContent = saveMessage(cause);
        } finally {
          resume.disabled = backup.disabled = remove.disabled = false;
          remove.textContent = 'Delete';
        }
      });
      actions.append(resume, backup, remove); row.append(info, actions); list.append(row);
    }
  }

  async function refreshSavedWorlds() {
    try {
      savedWorlds = await browserSaves.list();
      renderSavedWorlds();
    } catch (cause) { worldCount.textContent = 'Saves unavailable'; worldList.textContent = saveMessage(cause); }
  }
  const importFile = document.querySelector('#import-file');
  document.querySelector('#import-world').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0]; if (!file) return;
    try {
      if (file.size > MAX_SAVE_BYTES) throw new Error('That world file is too large.');
      const save = validateSave(JSON.parse(await file.text()));
      await browserSaves.save({ ...save, id: newWorldId(), name: `${save.name.slice(0, 29)} (imported)`, createdAt: Date.now(), updatedAt: Date.now(), saveRevision: 0 }, 0);
      worldSearch.value = ''; worldList.scrollTop = 0;
      await refreshSavedWorlds(); error.hidden = true; notify('World imported');
    } catch (cause) { error.hidden = false; error.textContent = saveMessage(cause); }
    finally { importFile.value = ''; }
  });
  void refreshSavedWorlds();
  document.querySelector('#server-address').value = location.hostname;
  document.querySelector('#server-port').value = location.port || (location.protocol === 'https:' ? '443' : '80');
  const query = new URLSearchParams(location.search);
  if (query.has('name')) nameInput.value = query.get('name').slice(0, 20);
  if (query.get('join') === '1') { openSession('multiplayer'); history.connect(nameInput.value); }
}
