import { readFileSync } from 'node:fs';
import { EFFECT_FILES } from '../../src/audio-catalog.js';

export function primeRecordedSounds(sound) {
  for (const file of EFFECT_FILES) sound.buffers.set(file, { file, duration: 1 });
}
export function recordedPCM(file) {
  const wav = readFileSync(new URL(`../../public${file}`, import.meta.url));
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected PCM WAV');
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(offset + 8 + i * 2) / 32768;
      return samples;
    }
    offset += 8 + size + size % 2;
  }
  throw new Error('Missing waveform');
}
