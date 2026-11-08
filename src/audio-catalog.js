import { GRASS, DIRT, STONE, WOOD, LEAVES, SAND, WATER, PLANKS, BRICKS, GLASS, DOOR, LANTERN, WARD_LANTERN, STONE_BRICKS, BRACED_TIMBER, WOODEN_CHEST, SALVAGE_CRATE, BRACED_DOOR, SLAB, RED_FLOWER, SAPLING, WOODEN_PEGS, CHARCOAL, STONE_HAMMER, isFlower, buildBlock } from './world.js';

const files = (name, count) => Array.from({ length: count }, (_, i) => `/audio/sfx/${name}-${i + 1}.wav`);
const sets = {
  grass: files('grass-step', 4), hard: files('hard-step', 4), woodStep: files('footstep-wood', 4), wet: files('footstep-wet', 3),
  wood: files('wood', 3), woodHit: files('wood-hit', 3), stone: files('stones', 3), glass: files('glass', 3),
  metal: files('metal', 3), metalHit: files('metal-hit', 2), cloth: files('cloth', 3), scrape: files('scrape', 3),
  breath: files('breath', 3), switch: files('switch', 2), door: files('door', 5),
  woodOpen: files('wood-door-open', 2), woodClose: files('wood-door-close', 2),
};
export const EFFECT_FILES = Object.freeze([...new Set(['/audio/sfx/pickup.wav', ...Object.values(sets).flat(), '/audio/sfx/sharp-breath.wav'])]);
const family = new Map([
  ...[GRASS, DIRT, SAND].map(id => [id, 'soil']), ...[STONE, BRICKS, STONE_BRICKS, CHARCOAL, STONE_HAMMER].map(id => [id, 'stone']),
  ...[WOOD, PLANKS, SLAB, DOOR, SALVAGE_CRATE, BRACED_TIMBER, WOODEN_CHEST, BRACED_DOOR, WOODEN_PEGS].map(id => [id, 'wood']),
  ...[LEAVES, RED_FLOWER, SAPLING].map(id => [id, 'foliage']),
  ...[LANTERN, WARD_LANTERN].map(id => [id, 'metal']),
  [GLASS, 'glass'], [WATER, 'water'],
]);
const normalized = block => isFlower(block) ? RED_FLOWER : buildBlock(block);
const sample = (set, variant, gain = 1, delay = 0, rate = 1) => ({ file: sets[set][variant % sets[set].length], gain, delay, rate });

// Every layer is a recording. Small rate changes avoid machine-like repetition;
// these are physical material sounds, without synthesized notes or chimes.
export function soundRecipe(block, action, variant = 0) {
  block = normalized(block);
  const type = family.get(block), v = Number.isFinite(variant) ? Math.abs(Math.trunc(variant)) : 0;
  if (!type) return [];
  if (action === 'ward_on' || action === 'ward_off') return block === WARD_LANTERN ? [sample('switch', action === 'ward_on' ? 0 : 1, .3)] : [];
  if (action === 'open' || action === 'close') {
    if (block === DOOR) return [sample('woodClose', v + Number(action === 'open'), .6, 0, action === 'open' ? 1.06 : 1)];
    if (block === BRACED_DOOR || block === WOODEN_CHEST) return [sample('woodClose', v + Number(action === 'open'), .55, 0, action === 'open' ? .96 : .9), sample('woodHit', v, .18, .08)];
    return [];
  }
  if (action === 'swim' || action === 'splash') return type === 'water'
    ? [sample('wet', v, action === 'swim' ? .09 : .6), ...(action === 'splash' ? [sample('wet', v + 1, .28, .07, .9)] : [])] : [];
  if (action === 'step') {
    const set = { soil: 'grass', stone: 'hard', wood: 'woodStep', foliage: 'grass', metal: 'metalHit', glass: 'hard', water: 'wet' }[type];
    return [sample(set, v, type === 'water' ? .09 : type === 'metal' ? .22 : .52, 0, .98 + v % 3 * .02)];
  }
  const set = { soil: 'grass', stone: 'stone', wood: 'woodHit', foliage: 'cloth', metal: 'metalHit', glass: 'glass', water: 'wet' }[type];
  if (type === 'foliage' && ['place', 'hit', 'break', 'repair'].includes(action)) return [{ ...sample('cloth', v, action === 'break' ? .3 : .22), duration: action === 'hit' ? .12 : .18 }];
  if (action === 'place') return [sample(set, v, type === 'foliage' ? .22 : type === 'glass' ? .18 : .52)];
  if (action === 'hit') return [sample(set, v, .58)];
  if (action === 'repair') return [sample(type === 'wood' ? 'woodHit' : 'stone', v, .38), sample(type === 'wood' ? 'woodHit' : 'stone', v + 1, .26, .16), sample('scrape', v, .16, .24)];
  if (action === 'break') return [sample(type === 'wood' ? 'wood' : type === 'metal' ? 'metal' : set, v, type === 'foliage' ? .3 : .75),
    ...(['wood', 'stone', 'metal'].includes(type) ? [sample(set, v + 1, .25, .085)] : [])];
  return [];
}

export function cueRecipe(kind, variant = 0) {
  const v = Number.isFinite(variant) ? Math.abs(Math.trunc(variant)) : 0;
  switch (kind) {
    case 'step': return [sample('hard', v, .65, 0, .88), sample('cloth', v, .12, .025)];
    case 'alert': return [sample('cloth', v, .55, 0, .9)];
    case 'notice': return [sample('cloth', v + 1, .5)];
    case 'search': return [sample('cloth', v + 2, .35), sample('hard', v, .28, .18, .9)];
    case 'pursuit': return [{ file: '/audio/sfx/sharp-breath.wav', gain: .45, delay: 0, rate: .95 }, sample('cloth', v, .25, .1)];
    case 'pressure': return [{ ...sample('scrape', v, .88, 0, .78), duration: .8 }, { ...sample('woodHit', v, .85, .025, .7), duration: .5 }, { ...sample('breath', v, .3, .12, .85), duration: .65 }];
    case 'breath': return [sample('breath', v, .48, 0, .92)];
    case 'retreat': return [sample('grass', v, .45), sample('cloth', v + 1, .25, .12)];
    default: return [];
  }
}

export function pickupRecipe(variant = 0) {
  const v = Number.isFinite(variant) ? Math.abs(Math.trunc(variant)) : 0;
  return [{ file: '/audio/sfx/pickup.wav', gain: .95, delay: 0, rate: 1 + v % 3 * .025, duration: .18 }];
}
