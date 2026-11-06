import { HEIGHT, buildBlock, isBlock, isCabinet, SAPLING, WARD_LANTERN, SALVAGE_CRATE } from './world.js';
import { CHUNK_SIZE, WORLD_SIZE, GENERATOR_VERSION } from './generation.js';
import { validInventory, GAME_MODES } from './inventory.js';
import { validDrops } from './drops.js';
import { GAME_MODE, validHorrorState } from './horror.js';
import { validInfrastructure } from './infrastructure.js';
import { validUpkeep } from './upkeep.js';

export const SAVE_VERSION = 5;
export const SAVE_FORMAT = 'blockfield-world';
export const MAX_SAVE_BYTES = 128 * 1024 * 1024;
export const validPlayerToken = token => typeof token === 'string' && /^[a-f0-9-]{32,80}$/i.test(token);
export class SaveError extends Error {
  constructor(message, code = 'SAVE_INVALID') { super(message); this.name = 'SaveError'; this.code = code; }
}

export function newWorldId() {
  return [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16).padStart(8, '0')).join('-');
}

export function validateSave(save) {
  if (!save || typeof save !== 'object' || save.format !== SAVE_FORMAT || ![1, 2, 3, 4, SAVE_VERSION].includes(save.version)) {
    throw new SaveError('This world uses an unsupported save format. Its data has not been changed.', 'SAVE_INCOMPATIBLE');
  }
  const metadata = save.world;
  if (!metadata || metadata.generator !== GENERATOR_VERSION || metadata.size !== WORLD_SIZE || metadata.height !== HEIGHT || metadata.chunkSize !== CHUNK_SIZE) {
    throw new SaveError('This world needs a different terrain generator or game version. Its data has not been changed.', 'SAVE_INCOMPATIBLE');
  }
  if (typeof save.id !== 'string' || !/^[\w-]{1,80}$/.test(save.id) || typeof save.name !== 'string' || !save.name.trim() || save.name.length > 40
    || typeof metadata.seed !== 'string' || metadata.seed.length > 80 || !Number.isFinite(save.createdAt) || !Number.isFinite(save.updatedAt)
    || !save.clock || !Number.isFinite(save.clock.phase) || save.clock.phase < 0 || save.clock.phase >= 1 || typeof save.clock.held !== 'boolean'
    || !Array.isArray(save.edits) || save.edits.length > (WORLD_SIZE / CHUNK_SIZE) ** 2) throw new SaveError('The world save is incomplete or damaged.');
  const seen = new Set();
  for (const entry of save.edits) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new SaveError('The world contains invalid chunk edits.');
    const [key, cells] = entry;
    if (typeof key !== 'string' || !/^\d+,\d+$/.test(key) || seen.has(key)) throw new SaveError('The world contains invalid chunk coordinates.');
    seen.add(key);
    const [cx, cz] = key.split(',').map(Number);
    if (cx >= WORLD_SIZE / CHUNK_SIZE || cz >= WORLD_SIZE / CHUNK_SIZE || `${cx},${cz}` !== key || !Array.isArray(cells) || cells.length > CHUNK_SIZE * CHUNK_SIZE * HEIGHT) throw new SaveError('The world contains out-of-bounds chunk data.');
    const indices = new Set();
    for (const cell of cells) {
      if (!Array.isArray(cell) || cell.length !== 2) throw new SaveError('The world contains invalid block edits.');
      const [index, block] = cell;
      if (!Number.isInteger(index) || index < CHUNK_SIZE * CHUNK_SIZE || index >= CHUNK_SIZE * CHUNK_SIZE * HEIGHT || indices.has(index) || !isBlock(block)) throw new SaveError('The world contains invalid block edits.');
      indices.add(index);
    }
  }
  if (save.player && !validPose(save.player, metadata.size)) throw new SaveError('The saved player position is invalid.');
  if (save.gameMode !== undefined && ![...GAME_MODES, 'creative', 'gather'].includes(save.gameMode)) throw new SaveError('This world uses an unsupported game mode.', 'SAVE_INCOMPATIBLE');
  if (save.gameMode === GAME_MODE && save.horror?.version !== undefined && save.horror.version !== 1) throw new SaveError('This survival world needs a newer game version. Its data has not been changed.', 'SAVE_INCOMPATIBLE');
  if (save.gameMode === GAME_MODE && (!Number.isFinite(save.clock.elapsedSeconds) || save.clock.elapsedSeconds < 0 || save.clock.elapsedSeconds > Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(save.clock.day) || save.clock.day < 1 || save.clock.held || !validHorrorState(save.horror, metadata.size))) throw new SaveError('The saved survival state is invalid.');
  if (save.inventory?.version !== undefined && ![1, 2, 3].includes(save.inventory.version)) throw new SaveError('This hotbar needs a newer game version. Its data has not been changed.', 'SAVE_INCOMPATIBLE');
  if (save.inventory !== undefined && !validInventory(save.inventory)) throw new SaveError('The saved hotbar is invalid.');
  if (['gather', GAME_MODE].includes(save.gameMode) && save.inventory && save.inventory.version === 1) throw new SaveError('The saved supplies are invalid.');
  if (save.inventory?.mode === 'gather' && !['gather', GAME_MODE].includes(save.gameMode)) throw new SaveError('The saved supplies do not match this world mode.');
  if (save.profiles !== undefined) {
    if (!Array.isArray(save.profiles) || save.profiles.length > 10000) throw new SaveError('The saved player supplies are invalid.');
    const tokens = new Set();
    for (const entry of save.profiles) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validPlayerToken(entry[0]) || tokens.has(entry[0]) || !validInventory(entry[1]) || entry[1].mode !== 'gather') throw new SaveError('The saved player supplies are invalid.');
      tokens.add(entry[0]);
    }
  }
  if (save.saveRevision !== undefined && (!Number.isSafeInteger(save.saveRevision) || save.saveRevision < 0)) throw new SaveError('The saved world revision is invalid.');
  if (save.drops !== undefined && (!['gather', GAME_MODE].includes(save.gameMode) || !validDrops(save.drops, metadata.size))) throw new SaveError('The saved dropped items are invalid.');
  if (!validInfrastructure(save.containers, save.construction, metadata.size)) throw new SaveError('The saved storage or construction is invalid.');
  const edits = new Map(save.edits), attachedChunks = new Map();
  const editedBlock = c => {
    const key = `${Math.floor(c.x / CHUNK_SIZE)},${Math.floor(c.z / CHUNK_SIZE)}`;
    // Index only chunks with stored supplies or damage, without copying every
    // edited cell in the world on each save checkpoint.
    if (!attachedChunks.has(key)) attachedChunks.set(key, new Map(edits.get(key) || []));
    return attachedChunks.get(key).get(c.x % CHUNK_SIZE + c.z % CHUNK_SIZE * CHUNK_SIZE + c.y * CHUNK_SIZE * CHUNK_SIZE);
  };
  if ((save.containers || []).some(c => !isCabinet(editedBlock(c))) || (save.construction || []).some(d => buildBlock(editedBlock(d)) !== d.block)) throw new SaveError('Stored supplies or damage do not match the world blocks.');
  if (save.upkeep?.version !== undefined && save.upkeep.version !== 1) throw new SaveError('This upkeep state needs a newer game version.', 'SAVE_INCOMPATIBLE');
  if (!validUpkeep(save.upkeep, metadata.size, save.clock.elapsedSeconds ?? 0)) throw new SaveError('The saved resource upkeep is invalid.');
  if (save.upkeep && (save.upkeep.plants.some(p => editedBlock(p) !== SAPLING + p.stage) || save.upkeep.wards.some(p => editedBlock(p) !== WARD_LANTERN) || save.upkeep.salvage.some(p => editedBlock(p) !== SALVAGE_CRATE))) throw new SaveError('Saved upkeep does not match world blocks.');
  return save;
}

// Migration never stamps a cabin over a player's existing builds. Legacy
// Creative hotbars have no owned quantities, so become empty finite supplies.
export function migrateSave(value, now = Date.now()) {
  validateSave(value);
  const save = structuredClone(value);
  save.version = SAVE_VERSION;
  if (save.gameMode === GAME_MODE) return save;
  save.gameMode = GAME_MODE;
  save.horror = { version: 1, cabin: null };
  save.clock = { phase: save.clock.phase, held: false, elapsedSeconds: 0, day: 1 };
  if (save.inventory?.version === 1) save.inventory = { version: 3, mode: 'gather', stacks: Array(36).fill(null), selected: save.inventory.selected };
  if (save.player) save.player.flying = false;
  for (const drop of save.drops || []) drop.readyAt = Math.min(1500, Math.max(0, drop.readyAt - now));
  return validateSave(save);
}

export function validPose(pose, size = WORLD_SIZE) {
  return pose && ['x', 'y', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(pose[key]))
    && pose.x >= 0 && pose.x < size && pose.z >= 0 && pose.z < size && pose.y >= 0 && pose.y <= HEIGHT + 12
    && Math.abs(pose.pitch) <= Math.PI / 2 + 0.01 && typeof pose.flying === 'boolean';
}

export function captureSave({ world, id, name, createdAt, clock, player, inventory, gameMode = GAME_MODE, profiles, drops, containers, construction, upkeep, horror = { version: 1, cabin: null } }) {
  const save = { format: SAVE_FORMAT, version: SAVE_VERSION, id, name: name.trim().slice(0, 40) || 'My world', createdAt,
    updatedAt: Date.now(), world: world.metadata(), clock: { phase: clock.phase, held: gameMode === GAME_MODE ? false : clock.held,
      elapsedSeconds: clock.elapsedSeconds ?? 0, day: clock.day ?? 1 },
    edits: [...world.edits].map(([key, cells]) => [key, [...cells]]), gameMode };
  if (gameMode === GAME_MODE) save.horror = structuredClone(horror);
  if (player) {
    const pose = { x: player.x, y: player.y, z: player.z, yaw: player.yaw % (Math.PI * 2), pitch: player.pitch, flying: gameMode !== GAME_MODE && player.flying === true };
    if (validPose(pose, world.size)) save.player = pose;
  }
  if (inventory) {
    if (!validInventory(inventory)) throw new SaveError('The saved hotbar is invalid.');
    save.inventory = structuredClone(inventory);
  }
  if (profiles) save.profiles = profiles.map(([token, inventory]) => [token, structuredClone(inventory)]);
  if (drops) save.drops = structuredClone(drops);
  if (containers) save.containers = structuredClone(containers);
  if (upkeep) save.upkeep = structuredClone(upkeep);
  if (construction) save.construction = structuredClone(construction);
  return validateSave(save);
}

export function restoreEdits(world, save) {
  validateSave(save);
  world.edits = new Map(save.edits.map(([key, cells]) => [key, new Map(cells)]));
  world.chunks.clear(); world.revisions.clear(); world.serial++;
  world.shelterRevisions = new Map(); world.wardChunks.clear();
}
