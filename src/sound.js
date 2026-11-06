import { GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, DOOR, LANTERN, WARD_LANTERN, CONCRETE, REINFORCED_PANEL, STORAGE_CABINET, SECURITY_DOOR, SLAB, RED_FLOWER, SAPLING, SCRAP, BIOFUEL, REPAIR_TOOL, isFlower, buildBlock } from './world.js';

const MATERIALS = {
  [SAPLING]: { tone: 260, cutoff: 1300, noise: .8, ring: .1, decay: .6 },
  [SCRAP]: { tone: 220, cutoff: 2000, noise: .2, ring: .7, decay: .6 },
  [BIOFUEL]: { tone: 200, cutoff: 1600, noise: .2, ring: .4, decay: .5 },
  [REPAIR_TOOL]: { tone: 270, cutoff: 2400, noise: .2, ring: .7, decay: .6 },
  [CONCRETE]: { tone: 95, cutoff: 700, noise: .8, ring: .1, decay: .7 },
  [REINFORCED_PANEL]: { tone: 170, cutoff: 1800, noise: .3, ring: .7, decay: .8 },
  [STORAGE_CABINET]: { tone: 210, cutoff: 2100, noise: .25, ring: .7, decay: .75 },
  [SECURITY_DOOR]: { tone: 150, cutoff: 1500, noise: .25, ring: .7, decay: .9 },
  [GRASS]: { tone: 115, cutoff: 1800, noise: 0.8, ring: 0.28, decay: 1 },
  [DIRT]: { tone: 85, cutoff: 1100, noise: 0.7, ring: 0.4, decay: 0.9 },
  [STONE]: { tone: 510, cutoff: 4800, noise: 0.4, ring: 0.55, decay: 0.65 },
  [WOOD]: { tone: 185, cutoff: 1400, noise: 0.3, ring: 0.7, decay: 0.85 },
  [LEAVES]: { tone: 290, cutoff: 3600, noise: 0.95, ring: 0.08, decay: 1.2 },
  [SAND]: { tone: 72, cutoff: 2000, noise: 0.85, ring: 0.2, decay: 0.95 },
  [WATER]: { tone: 155, cutoff: 2800, noise: 0.85, ring: 0.22, decay: 1.2 },
  [PLANKS]: { tone: 260, cutoff: 1800, noise: 0.25, ring: 0.65, decay: 0.7 },
  [BRICKS]: { tone: 360, cutoff: 3500, noise: 0.45, ring: 0.45, decay: 0.75 },
  [GLASS]: { tone: 1300, cutoff: 6200, noise: 0.25, ring: 0.45, decay: 0.8 },
  [DOOR]: { tone: 210, cutoff: 1300, noise: 0.3, ring: 0.6, decay: 0.9 },
  [LANTERN]: { tone: 620, cutoff: 3100, noise: 0.15, ring: 0.6, decay: 0.65 },
  [WARD_LANTERN]: { tone: 740, cutoff: 3600, noise: 0.05, ring: 0.8, decay: 1 },
  [SLAB]: { tone: 285, cutoff: 1950, noise: 0.25, ring: 0.65, decay: 0.65 },
  [RED_FLOWER]: { tone: 380, cutoff: 2500, noise: 0.65, ring: 0.12, decay: 0.6 },
};
const ACTIONS = {
  step: { duration: 0.14, volume: 0.38, pitch: 0.8, seed: 1 },
  place: { duration: 0.16, volume: 0.6, pitch: 0.95, seed: 2 },
  break: { duration: 0.25, volume: 0.65, pitch: 1.15, seed: 3 },
  open: { duration: 0.2, volume: 0.45, pitch: 0.85, seed: 4 },
  close: { duration: 0.16, volume: 0.5, pitch: 1.05, seed: 5 },
  splash: { duration: 0.48, volume: 0.8, pitch: 0.75, seed: 6 },
  swim: { duration: 0.22, volume: 0.1, pitch: 0.6, seed: 7 },
  ward_on: { duration: .65, volume: .24, pitch: 1.1, seed: 8 },
  ward_off: { duration: .5, volume: .22, pitch: .65, seed: 9 },
};

export const SOUND_DISTANCE = 32;

// Keep nearby interactions clear, then fade to silence in every direction.
export function soundGain(source, listener) {
  if (!source || !listener) return 0;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  if (!Number.isFinite(distance) || distance >= SOUND_DISTANCE) return 0;
  return Math.min(1, (SOUND_DISTANCE - distance) / (SOUND_DISTANCE - 2)) ** 2;
}

// Short, repeatable PCM effects: filtered crunch plus a material-specific impact.
export function synthesizeSound(block, action, sampleRate, variant = 0) {
  block = isFlower(block) ? RED_FLOWER : buildBlock(block);
  const material = MATERIALS[block];
  const effect = ACTIONS[action];
  if (!material || !effect || !Number.isFinite(sampleRate) || sampleRate < 8000) throw new RangeError('Invalid sound parameters');
  const duration = effect.duration * material.decay;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const frequency = material.tone * effect.pitch * (1 + (variant - 1) * 0.045);
  const swimming = block === WATER && action === 'swim';
  const filter = 1 - Math.exp(-2 * Math.PI * (swimming ? 850 : material.cutoff) / sampleRate);
  let seed = block * 1009 + effect.seed * 7919 + variant * 127;
  let filtered = 0;
  for (let i = 0; i < samples.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const white = (seed >>> 0) / 2147483648 - 1;
    filtered += filter * (white - filtered);
    const time = i / sampleRate;
    const attack = Math.min(1, time / (swimming ? 0.025 : 0.003));
    const release = Math.max(0, Math.min(1, (duration - time) / 0.012));
    const envelope = attack * release * Math.exp(-time / (duration * 0.25));
    const phase = 2 * Math.PI * frequency * (time + 0.025 * (1 - Math.exp(-time / 0.025)));
    const impact = Math.sin(phase) * 0.8 + Math.sin(phase * 2.1) * 0.2;
    const crumble = action === 'break' ? 0.8 + 0.2 * Math.sin(time * 230) : 1;
    // Water uses a wash of noise with descending bubbles instead of a hard impact.
    const watery = block === WATER && (action === 'splash' || action === 'swim');
    const bubbles = Math.sin(2 * Math.PI * (420 * time - 240 * time * time)) * (0.5 + 0.5 * Math.sin(time * 65));
    samples[i] = (watery ? filtered * 0.9 + bubbles * (swimming ? 0.015 : 0.18) : filtered * material.noise * crumble + impact * material.ring) * envelope * effect.volume;
  }
  return samples;
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

  async resume() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.context.destination);
      }
      if (this.context.state !== 'running') await this.context.resume();
    } catch {
      // Sound is optional if the browser cannot provide an audio device.
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.45 : 0;
    if (enabled) void this.resume();
    else this.stop();
  }

  playAt(block, action, source, listener) {
    this.play(block, action, soundGain(source, listener));
  }

  play(block, action, volume = 1) {
    block = isFlower(block) ? RED_FLOWER : buildBlock(block);
    if (!this.enabled || !this.master || this.context?.state !== 'running' || !MATERIALS[block] || !ACTIONS[action] || !Number.isFinite(volume) || volume <= 0) return;
    const variant = this.nextVariant++ % 3;
    const key = `${block}:${action}:${variant}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const samples = synthesizeSound(block, action, this.context.sampleRate, variant);
      buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(key, buffer);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = Math.min(1, volume);
    source.connect(gain);
    gain.connect(this.master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.active.delete(source);
    };
    this.active.add(source);
    source.start();
  }

  stop() {
    for (const source of this.active) source.stop();
    this.active.clear();
  }
}
