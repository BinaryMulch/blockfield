import { HEIGHT, isBlock } from './world.js';
import { CHUNK_SIZE, WORLD_SIZE, GENERATOR_VERSION } from './generation.js';
import { validInventory, GAME_MODES } from './inventory.js';

export const SAVE_VERSION = 1;
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
  if (!save || typeof save !== 'object' || save.format !== SAVE_FORMAT || save.version !== SAVE_VERSION) {
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
  if (save.gameMode !== undefined && !GAME_MODES.includes(save.gameMode)) throw new SaveError('This world uses an unsupported game mode.', 'SAVE_INCOMPATIBLE');
  if (save.inventory?.version !== undefined && ![1, 2, 3].includes(save.inventory.version)) throw new SaveError('This hotbar needs a newer game version. Its data has not been changed.', 'SAVE_INCOMPATIBLE');
  if (save.inventory !== undefined && !validInventory(save.inventory)) throw new SaveError('The saved hotbar is invalid.');
  if (save.gameMode === 'gather' && save.inventory && save.inventory.version === 1) throw new SaveError('The saved supplies are invalid.');
  if (save.inventory?.mode === 'gather' && save.gameMode !== 'gather') throw new SaveError('The saved supplies do not match this world mode.');
  if (save.profiles !== undefined) {
    if (!Array.isArray(save.profiles) || save.profiles.length > 10000) throw new SaveError('The saved player supplies are invalid.');
    const tokens = new Set();
    for (const entry of save.profiles) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validPlayerToken(entry[0]) || tokens.has(entry[0]) || !validInventory(entry[1]) || entry[1].mode !== 'gather') throw new SaveError('The saved player supplies are invalid.');
      tokens.add(entry[0]);
    }
  }
  if (save.saveRevision !== undefined && (!Number.isSafeInteger(save.saveRevision) || save.saveRevision < 0)) throw new SaveError('The saved world revision is invalid.');
  return save;
}

export function validPose(pose, size = WORLD_SIZE) {
  return pose && ['x', 'y', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(pose[key]))
    && pose.x >= 0 && pose.x < size && pose.z >= 0 && pose.z < size && pose.y >= 0 && pose.y <= HEIGHT + 12
    && Math.abs(pose.pitch) <= Math.PI / 2 + 0.01 && typeof pose.flying === 'boolean';
}

export function captureSave({ world, id, name, createdAt, clock, player, inventory, gameMode = 'creative', profiles }) {
  const save = { format: SAVE_FORMAT, version: SAVE_VERSION, id, name: name.trim().slice(0, 40) || 'My world', createdAt,
    updatedAt: Date.now(), world: world.metadata(), clock: { phase: clock.phase, held: clock.held },
    edits: [...world.edits].map(([key, cells]) => [key, [...cells]]), gameMode };
  if (player) {
    const pose = { x: player.x, y: player.y, z: player.z, yaw: player.yaw % (Math.PI * 2), pitch: player.pitch, flying: player.flying === true };
    if (validPose(pose, world.size)) save.player = pose;
  }
  if (inventory) {
    if (!validInventory(inventory)) throw new SaveError('The saved hotbar is invalid.');
    save.inventory = structuredClone(inventory);
  }
  if (profiles) save.profiles = profiles.map(([token, inventory]) => [token, structuredClone(inventory)]);
  return validateSave(save);
}

export function restoreEdits(world, save) {
  validateSave(save);
  world.edits = new Map(save.edits.map(([key, cells]) => [key, new Map(cells)]));
  world.chunks.clear(); world.revisions.clear(); world.serial++;
}
