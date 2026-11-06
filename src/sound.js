import { WATER, isSupport, blockBounds } from './world.js';
import { loadedBlock, soundTransmission } from './perception.js';
import { canPlaySound, canPlayCue, synthesizeSound, synthesizeCue } from './foley.js';
export { synthesizeSound, synthesizeCue } from './foley.js';

export const SOUND_DISTANCE = 32;
export const LISTENER_SOUND_DISTANCE = 48;
export const MAX_SOUND_VOICES = 16;
export const MAX_SOUND_BUFFERS = 72;
export function soundGain(source, listener) {
  if (!source || !listener) return 0;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  if (!Number.isFinite(distance) || distance >= SOUND_DISTANCE) return 0;
  return Math.min(1, (SOUND_DISTANCE - distance) / (SOUND_DISTANCE - 2)) ** 2;
}
export function soundPan(source, listener) {
  const dx = source.x - listener.x, dz = source.z - listener.z, length = Math.hypot(dx, dz);
  if (!length) return 0;
  const yaw = listener.yaw || 0;
  return Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length));
}
export class FootstepTracker {
  distance = 0;

  reset() {
    this.distance = 0;
  }

  update(before, after) {
    if (!after.grounded) {
      this.reset();
      return false;
    }
    if (!before.grounded) {
      this.reset();
      return before.vy < -3;
    }
    this.distance += Math.hypot(after.x - before.x, after.z - before.z);
    if (this.distance < 1.7) return false;
    this.distance %= 1.7;
    return true;
  }
}

function inWater(player, world) {
  const x = Math.floor(player.x), z = Math.floor(player.z);
  // Match the rendered 0.88-block surface, so walking beside a bank stays dry.
  const feet = player.y + 0.1, y = Math.floor(feet);
  return world.get(x, y, z) === WATER && (feet < y + 0.88 || world.get(x, y + 1, z) === WATER);
}

export class WaterSoundTracker {
  wet = false;
  distance = 0;
  cooldown = 0;

  reset() { this.wet = false; this.distance = 0; this.cooldown = 0; }

  update(before, after, world, dt) {
    this.wet = inWater(after, world);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (after.flying || !this.wet) { this.distance = 0; return null; }
    if (!inWater(before, world)) {
      this.distance = 0;
      if (this.cooldown > 0) return null;
      this.cooldown = 0.22;
      return 'splash';
    }
    this.distance += Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    if (this.distance < 1.7 || this.cooldown > 0) return null;
    this.distance %= 1.7;
    this.cooldown = 0.45;
    return 'swim';
  }
}

export class GameSounds {
  enabled = true;
  context = null;
  master = null;
  buffers = new Map();
  active = new Set();
  nextVariant = 0;
  listener = null;
  world = null;
  remoteSteps = new Map();

  async resume() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext(); this.master = this.context.createGain(); this.master.gain.value = .34;
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = -16; compressor.knee.value = 12; compressor.ratio.value = 5; compressor.attack.value = .006; compressor.release.value = .2;
        this.master.connect(compressor); compressor.connect(this.context.destination);
      }
      if (this.context.state !== 'running') await this.context.resume();
    } catch { /* Optional audio never prevents playing. */ }
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? .34 : 0;
    if (enabled) void this.resume(); else this.stop();
  }
  setListener(listener, world) { this.listener = listener; this.world = world; }
  position(source, listener = this.listener, range = SOUND_DISTANCE) {
    listener = listener ? { ...listener, yaw: listener.yaw ?? this.listener?.yaw ?? 0 } : null;
    const distance = source && listener ? Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z) : Infinity;
    const gain = range === SOUND_DISTANCE ? soundGain(source, listener) : Math.max(0, Math.min(1, (range - distance) / (range - 2))) ** 1.4;
    if (!gain) return { gain: 0, pan: 0, cutoff: 14000 };
    const transmission = this.world ? soundTransmission(this.world, source, listener) : { gain: 1, cutoff: 14000 };
    return { gain: gain * transmission.gain, pan: soundPan(source, listener), cutoff: transmission.cutoff };
  }
  trackPlayers(players, selfId) {
    const ids = new Set();
    for (const p of players.slice(0, 8)) {
      if (p.id === selfId) continue;
      ids.add(p.id); const previous = this.remoteSteps.get(p.id), moved = previous ? Math.hypot(p.x - previous.x, p.z - previous.z) : 0;
      const record = { x: p.x, y: p.y, z: p.z, distance: previous?.distance || 0 };
      if (!previous || !p.active || moved > 3 || Math.abs(p.y - previous.y) > 1.25 || !this.world) record.distance = 0;
      else {
        const x = Math.floor(p.x), z = Math.floor(p.z), y = Math.floor(p.y - .05), floor = loadedBlock(this.world, x, y, z);
        const wet = loadedBlock(this.world, x, Math.floor(p.y + .1), z) === WATER;
        if (wet || floor !== undefined && isSupport(floor) && Math.abs(blockBounds(floor, x, y, z).maxY - p.y) < .22) {
          record.distance += moved;
          if (record.distance >= 1.7) { record.distance %= 1.7; const position = this.position({ x: p.x, y: p.y + .1, z: p.z }); this.play(wet ? WATER : floor, wet ? 'swim' : 'step', position.gain * .65, position); }
        } else record.distance = 0;
      }
      this.remoteSteps.set(p.id, record);
    }
    for (const id of this.remoteSteps.keys()) if (!ids.has(id)) this.remoteSteps.delete(id);
  }
  playAt(block, action, source, listener) { const position = this.position(source, listener); this.play(block, action, position.gain, position); }
  play(block, action, volume = 1, position = {}) {
    if (!canPlaySound(block, action)) return;
    const variant = this.nextVariant++ % 4;
    this.emit(`${block}:${action}:${variant}`, () => synthesizeSound(block, action, this.context.sampleRate, variant), volume, position);
  }
  cuePosition(source, listener) { return this.position(source, listener, LISTENER_SOUND_DISTANCE); }
  playCueAt(kind, source, listener) {
    if (!canPlayCue(kind)) return 0;
    const position = this.cuePosition(source, listener), variant = this.nextVariant++ % 4;
    this.emit(`listener:${kind}:${variant}`, () => synthesizeCue(kind, this.context.sampleRate, variant), position.gain, position, true);
    return position.gain;
  }
  emit(key, samples, volume, { pan = 0, cutoff = 14000 } = {}, priority = false) {
    if (!this.enabled || !this.master || this.context?.state !== 'running' || !Number.isFinite(volume) || volume <= 0) return;
    if (this.active.size >= MAX_SOUND_VOICES) { if (!priority) return; const oldest = this.active.values().next().value; this.active.delete(oldest); oldest.stop(); }
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const pcm = samples(); buffer = this.context.createBuffer(1, pcm.length, this.context.sampleRate); buffer.copyToChannel(pcm, 0);
      if (this.buffers.size >= MAX_SOUND_BUFFERS) this.buffers.delete(this.buffers.keys().next().value);
    } else this.buffers.delete(key);
    this.buffers.set(key, buffer);
    const source = this.context.createBufferSource(), gain = this.context.createGain(), nodes = [gain];
    source.buffer = buffer; gain.gain.value = Math.min(1, volume); source.connect(gain);
    let last = gain;
    if (this.context.createStereoPanner) { const node = this.context.createStereoPanner(); node.pan.value = pan; last.connect(node); last = node; nodes.push(node); }
    if (cutoff < 14000 && this.context.createBiquadFilter) { const node = this.context.createBiquadFilter(); node.type = 'lowpass'; node.frequency.value = cutoff; last.connect(node); last = node; nodes.push(node); }
    last.connect(this.master);
    source.onended = () => { source.disconnect(); for (const node of nodes) node.disconnect(); this.active.delete(source); };
    this.active.add(source); source.start();
  }
  stop() { for (const source of [...this.active]) source.stop(); this.active.clear(); }
}
