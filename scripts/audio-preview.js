import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { GRASS, WOOD, CONCRETE, REINFORCED_PANEL, SECURITY_DOOR, WATER, WARD_LANTERN } from '../src/world.js';
import { synthesizeSound, synthesizeCue } from '../src/foley.js';

const rate = 44100, directory = resolve(process.argv[2] || 'release/audio');
await mkdir(directory, { recursive: true });
const material = [
  ['Grass footsteps', GRASS, 'step'], ['Wood placement', WOOD, 'place'], ['Concrete fracture', CONCRETE, 'break'],
  ['Steel impact', REINFORCED_PANEL, 'hit'], ['Repair work', REINFORCED_PANEL, 'repair'],
  ['Security door opening', SECURITY_DOOR, 'open'], ['Security door closing', SECURITY_DOOR, 'close'],
  ['Water entry', WATER, 'splash'], ['Quiet wading', WATER, 'swim'], ['Ward relay on', WARD_LANTERN, 'ward_on'], ['Ward relay off', WARD_LANTERN, 'ward_off'],
].map(([label, block, action]) => [label, synthesizeSound(block, action, rate, 1)]);
const creature = ['alert', 'notice', 'search', 'pursuit', 'pressure', 'step', 'breath', 'retreat'].map(kind => [`Listener ${kind}`, synthesizeCue(kind, rate, 1)]);
let notes = '# Audio auditions\n\nIsolated procedural foley, with half a second between effects. No distance attenuation or world occlusion is applied. In-game mixing is quieter.\n';
for (const [name, samples] of [['materials', material], ['listener', creature]]) {
  const count = samples.reduce((sum, [, pcm]) => sum + pcm.length + rate / 2, 0), data = Buffer.alloc(count * 2), header = Buffer.alloc(44);
  let offset = 0; notes += `\n## ${name}.wav\n\n`;
  for (const [label, pcm] of samples) {
    notes += `- ${(offset / rate).toFixed(2)}s: ${label}\n`;
    for (const value of pcm) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), offset++ * 2);
    offset += rate / 2;
  }
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  await writeFile(join(directory, `${name}.wav`), Buffer.concat([header, data]));
}
await writeFile(join(directory, 'README.md'), notes);
console.log(`Audio previews written to ${directory}`);
