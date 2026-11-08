import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { GRASS, WOOD, LEAVES, SAPLING, STONE_BRICKS, BRACED_TIMBER, BRACED_DOOR, WATER, WARD_LANTERN } from '../src/world.js';
import { soundRecipe, cueRecipe, pickupRecipe } from '../src/audio-catalog.js';

const rate = 44100, directory = resolve(process.argv[2] || 'release/audio');
await mkdir(directory, { recursive: true });
const decoded = new Map();
async function samples(file) {
  if (decoded.has(file)) return decoded.get(file);
  const wav = await readFile(new URL(`../public${file}`, import.meta.url));
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') {
      pcm = new Float32Array(size / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = wav.readInt16LE(offset + 8 + i * 2) / 32768;
      break;
    }
    offset += 8 + size + size % 2;
  }
  if (!pcm) throw new Error(`Invalid WAV: ${file}`);
  decoded.set(file, pcm); return pcm;
}
async function render(recipe) {
  const layers = await Promise.all(recipe.map(async layer => ({ ...layer, pcm: await samples(layer.file) })));
  const length = layer => Math.min(layer.pcm.length / layer.rate, (layer.duration ?? Infinity) * rate);
  const count = Math.max(...layers.map(layer => Math.ceil(layer.delay * rate + length(layer))));
  const mix = new Float32Array(count);
  for (const layer of layers) {
    const start = Math.round(layer.delay * rate);
    for (let i = 0; i < length(layer); i++) {
      const position = i * layer.rate, lo = Math.floor(position), t = position - lo;
      const fade = layer.duration ? Math.min(1, (length(layer) - i) / (rate * .025)) : 1;
      mix[start + i] += (layer.pcm[lo] * (1 - t) + (layer.pcm[lo + 1] || 0) * t) * layer.gain * .8 * .8 * fade;
    }
  }
  return mix;
}
const material = await Promise.all([
  ['Grass footsteps', GRASS, 'step'], ['Wood placement', WOOD, 'place'], ['Stone brick fracture', STONE_BRICKS, 'break'],
  ['Short leaf rustle', LEAVES, 'break'], ['Short sapling rustle', SAPLING, 'place'],
  ['Timber impact', BRACED_TIMBER, 'hit'], ['Repair work', BRACED_TIMBER, 'repair'],
  ['Braced wooden door opening', BRACED_DOOR, 'open'], ['Braced wooden door closing', BRACED_DOOR, 'close'],
  ['Water entry', WATER, 'splash'], ['Quiet wading', WATER, 'swim'], ['Ward lit', WARD_LANTERN, 'ward_on'], ['Ward extinguished', WARD_LANTERN, 'ward_off'],
].map(async ([label, block, action]) => [label, await render(soundRecipe(block, action, 1))]));
material.push(['Item pickup', await render(pickupRecipe())]);
const creature = await Promise.all(['alert', 'notice', 'search', 'pursuit', 'pressure', 'step', 'breath', 'retreat'].map(async kind => [`Listener ${kind}`, await render(cueRecipe(kind, 1))]));
let notes = '# Audio auditions\n\nBundled recordings at default game effect levels, with half a second between effects. No distance attenuation or world occlusion is applied.\n\nMusic: Scott Buckley, CC BY 4.0, https://www.scottbuckley.com.au. Effects: rubberduck, OwlishMedia, qubodup, CC0. See public/audio/CREDITS.txt for full attribution.\n';
async function wave(name, pcm) {
  const data = Buffer.alloc(pcm.length * 2), header = Buffer.alloc(44);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), i * 2);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  await writeFile(join(directory, `${name}.wav`), Buffer.concat([header, data]));
}
for (const [name, clips] of [['materials', material], ['listener', creature]]) {
  const pcm = new Float32Array(clips.reduce((sum, [, clip]) => sum + clip.length + rate / 2, 0));
  let offset = 0; notes += `\n## ${name}.wav\n\n`;
  for (const [label, clip] of clips) { notes += `- ${(offset / rate).toFixed(2)}s: ${label}\n`; pcm.set(clip, offset); offset += clip.length + rate / 2; }
  await wave(name, pcm);
}
// ffmpeg is an authoring tool only; the shipped game needs no external tools.
const soundtrack = new Float32Array(rate * 52);
for (const [index, mood] of ['day', 'night', 'tension'].entries()) {
  const file = new URL(`../public/audio/music/${mood}.mp3`, import.meta.url);
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', file.pathname, '-t', '20', '-f', 'f32le', '-ac', '1', '-ar', String(rate), '-'], { maxBuffer: rate * 20 * 4 + 1024 });
  const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  for (let i = 0; i < pcm.length; i++) {
    const fade = Math.min(1, i / (rate * 4), (pcm.length - 1 - i) / (rate * 4));
    soundtrack[index * rate * 16 + i] += pcm[i] * fade * .35 * .8;
  }
}
await wave('music-transitions', soundtrack);
notes += '\n## music-transitions.wav\n\nIllustrative four-second crossfades: 0s daytime (Reverie), 16s night (The Old Ones), 32s threat (The Encounter). The game reacts live, using faster threat entry and slower release.\n';
await writeFile(join(directory, 'README.md'), notes);
console.log(`Audio previews written to ${directory}`);
