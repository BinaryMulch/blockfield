import { GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, DOOR, LANTERN, WARD_LANTERN, CONCRETE, REINFORCED_PANEL, STORAGE_CABINET, SALVAGE_CRATE, SECURITY_DOOR, SLAB, RED_FLOWER, SAPLING, SCRAP, BIOFUEL, REPAIR_TOOL, isFlower, buildBlock } from './world.js';

// Broadband body and friction layers, with irregular material transients.
// No oscillators, musical pitches, note sequences, or pitched status chimes.
const soil = { bodyCutoff: 170, grainCutoff: 3600, body: 1.7, grain: .45, decay: 1 };
const wood = { bodyCutoff: 240, grainCutoff: 2400, body: 1.8, grain: .3, decay: 1 };
const stone = { bodyCutoff: 115, grainCutoff: 5400, body: 2.0, grain: .5, decay: 1.06 };
const metal = { bodyCutoff: 290, grainCutoff: 6500, body: 1.4, grain: .48, decay: 1.1 };
const foliage = { bodyCutoff: 310, grainCutoff: 5200, body: .35, grain: .8, decay: .9 };
const profiles = {
  [GRASS]: soil, [DIRT]: { ...soil, grainCutoff: 2900 }, [SAND]: { ...soil, body: 1, grain: .65 },
  [STONE]: stone, [BRICKS]: { ...stone, grainCutoff: 4300 }, [CONCRETE]: { ...stone, bodyCutoff: 95 },
  [WOOD]: wood, [PLANKS]: { ...wood, bodyCutoff: 320 }, [SLAB]: { ...wood, body: 1.3 }, [DOOR]: { ...wood, grain: .45 },
  [LEAVES]: foliage, [RED_FLOWER]: { ...foliage, body: .15 }, [SAPLING]: { ...foliage, grainCutoff: 3900 },
  [GLASS]: { bodyCutoff: 650, grainCutoff: 10500, body: .5, grain: .9, decay: .95 },
  [WATER]: { bodyCutoff: 230, grainCutoff: 2800, body: 1.2, grain: .65, decay: 1 },
  [REINFORCED_PANEL]: metal, [SECURITY_DOOR]: { ...metal, bodyCutoff: 180, body: 2 },
  [SALVAGE_CRATE]: { ...metal, bodyCutoff: 350 },
  [STORAGE_CABINET]: { ...metal, bodyCutoff: 380 }, [SCRAP]: { ...metal, bodyCutoff: 480 },
  [BIOFUEL]: { ...metal, grain: .22 }, [REPAIR_TOOL]: { ...metal, bodyCutoff: 550 },
  [LANTERN]: { ...metal, body: .8, decay: .95 }, [WARD_LANTERN]: { ...metal, bodyCutoff: 160, grain: .3 },
};
const actions = {
  step: { duration: .24, volume: .65, beats: [0, .13], bodyDecay: .035, gritDecay: .09 },
  place: { duration: .32, volume: .65, beats: [0, .17, .32], bodyDecay: .04, gritDecay: .075 },
  break: { duration: .55, volume: .62, beats: [0, .12, .26, .42], bodyDecay: .035, gritDecay: .08 },
  hit: { duration: .28, volume: .57, beats: [0, .14], bodyDecay: .045, gritDecay: .075 },
  repair: { duration: .5, volume: .48, beats: [0, .18, .37], bodyDecay: .025, gritDecay: .065 },
  open: { duration: .72, volume: .45, beats: [0, .18, .43], bodyDecay: .018, gritDecay: .05, friction: .65 },
  close: { duration: .38, volume: .58, beats: [0, .16, .3], bodyDecay: .04, gritDecay: .06, friction: .15 },
  splash: { duration: .75, volume: .66, beats: [0, .11, .25], bodyDecay: .065, gritDecay: .10, friction: .3 },
  swim: { duration: .4, volume: .025, beats: [0, .2], bodyDecay: .065, gritDecay: .08, friction: .3 },
  ward_on: { duration: .8, volume: .2, beats: [0, .075], bodyDecay: .012, gritDecay: .03, friction: .5 },
  ward_off: { duration: .65, volume: .18, beats: [0, .13], bodyDecay: .015, gritDecay: .045, friction: .25 },
};
const cues = {
  step: { ...actions.step, duration: .42, volume: .52, beats: [0, .19, .36], friction: .18 },
  alert: { ...actions.open, duration: 1.1, volume: .24, beats: [.03, .2, .41], friction: .8 },
  breath: { ...actions.swim, duration: 1.25, volume: .22, beats: [.02, .26], friction: 1.1 },
  notice: { ...actions.open, duration: .8, volume: .22, beats: [.02, .48], friction: .65 },
  search: { ...actions.open, duration: 1.35, volume: .18, beats: [.02, .36, .7], friction: .6 },
  pursuit: { ...actions.step, duration: 1.1, volume: .3, beats: [.03, .3, .58], bodyDecay: .055, friction: .55 },
  pressure: { ...actions.open, duration: .95, volume: .26, beats: [.02, .14, .65], friction: 1 },
  retreat: { ...actions.break, duration: .85, volume: .28, beats: [.02, .19, .38], friction: .5 },
};
const normalized = block => isFlower(block) ? RED_FLOWER : buildBlock(block);
export const canPlaySound = (block, action) => Object.hasOwn(profiles, normalized(block)) && Object.hasOwn(actions, action);
export const canPlayCue = kind => Object.hasOwn(cues, kind);

function render(profile, effect, seed, sampleRate, variant) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isInteger(variant) || variant < 0 || variant > 15) throw new RangeError('Invalid sound parameters');
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const duration = effect.duration * profile.decay, samples = new Float32Array(Math.ceil(duration * sampleRate));
  const bodyFilter = 1 - Math.exp(-2 * Math.PI * profile.bodyCutoff * (.92 + random() * .16) / sampleRate);
  const grainFilter = 1 - Math.exp(-2 * Math.PI * profile.grainCutoff / sampleRate);
  const beats = effect.beats.map((fraction, i) => ({ at: (fraction + (i ? random() * .025 : 0)) * duration, weight: i ? .3 + random() * .35 : 1 }));
  let body = 0, grain = 0, motion = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, progress = t / duration, white = random() * 2 - 1;
    body += bodyFilter * (white - body); grain += grainFilter * (white - grain);
    motion += .002 * (random() - motion);
    let weight = 0, texture = 0;
    for (const beat of beats) {
      const age = (t - beat.at) / duration;
      if (age < 0) continue;
      const attack = Math.min(1, age / .012);
      weight += attack * Math.exp(-age / effect.bodyDecay) * beat.weight;
      texture += attack * Math.exp(-age / effect.gritDecay) * beat.weight;
    }
    const friction = (effect.friction || 0) * Math.min(1, progress / .08) * Math.exp(-Math.max(0, progress - .25) / .09) * (.35 + motion);
    const tail = Math.min(1, Math.max(0, (duration - t) / .018));
    const value = (body * profile.body * 3 * weight + (grain - body) * profile.grain * (texture + friction)) * effect.volume * tail;
    samples[i] = value / (1 + Math.abs(value));
  }
  samples[0] = samples[samples.length - 1] = 0;
  return samples;
}

export function synthesizeSound(block, action, sampleRate, variant = 0) {
  block = normalized(block);
  if (!canPlaySound(block, action)) throw new RangeError('Invalid sound parameters');
  return render(profiles[block], actions[action], block * 19081 + Object.keys(actions).indexOf(action) * 7919 + variant * 313 + 1, sampleRate, variant);
}

export function synthesizeCue(kind, sampleRate, variant = 0) {
  if (!canPlayCue(kind)) throw new RangeError('Invalid cue');
  const profile = kind === 'step' ? { ...soil, bodyCutoff: 85, body: 2.3, grainCutoff: 2500 }
    : { ...foliage, bodyCutoff: 120, grainCutoff: kind === 'breath' ? 1600 : 3400, body: .8, decay: 1 };
  return render(profile, cues[kind], 81371 + Object.keys(cues).indexOf(kind) * 17389 + variant * 313, sampleRate, variant);
}
