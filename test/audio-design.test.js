import test from 'node:test';
import assert from 'node:assert/strict';
import { World, STONE, GRASS, WOOD, CONCRETE, REINFORCED_PANEL, SECURITY_DOOR, WARD_LANTERN, WATER } from '../src/world.js';
import { GameSounds, soundPan, synthesizeSound, synthesizeCue, MAX_SOUND_VOICES, MAX_SOUND_BUFFERS } from '../src/sound.js';

const energy = pcm => pcm.reduce((n, v) => n + v * v, 0);
function audio() {
  const sound = new GameSounds(), sources = [], nodes = [];
  const node = type => { const n = { type, gain: {}, pan: {}, frequency: {}, connect(target) { this.target = target; }, disconnect() { this.disconnected = true; } }; nodes.push(n); return n; };
  sound.master = node('master');
  sound.context = { state: 'running', sampleRate: 16000,
    createBuffer: () => ({ copyToChannel() {} }), createGain: () => node('gain'), createStereoPanner: () => node('pan'), createBiquadFilter: () => node('filter'),
    createBufferSource() { const n = node('source'); n.start = () => {}; n.stop = () => { n.onended(); }; sources.push(n); return n; },
  };
  return { sound, sources, nodes };
}

test('foley has noise-based material character without sustained periodic note tails', () => {
  for (const block of [GRASS, WOOD, CONCRETE, REINFORCED_PANEL, SECURITY_DOOR]) {
    const pcm = synthesizeSound(block, 'break', 16000);
    let maximum = 0;
    for (let lag = 80; lag <= 320; lag += 11) {
      let cross = 0, a = 0, b = 0;
      for (let i = lag; i < pcm.length; i++) { cross += pcm[i] * pcm[i - lag]; a += pcm[i] ** 2; b += pcm[i - lag] ** 2; }
      maximum = Math.max(maximum, Math.abs(cross) / Math.sqrt(a * b));
    }
    assert.ok(maximum < .35, 'a repeating pitched tail should not dominate the material sound');
  }
  assert.notDeepEqual(synthesizeSound(CONCRETE, 'hit', 16000), synthesizeSound(REINFORCED_PANEL, 'hit', 16000));
  assert.notDeepEqual(synthesizeSound(WOOD, 'break', 16000, 0), synthesizeSound(WOOD, 'break', 16000, 1));
});

test('Listener cues are distinct, restrained, repeatable, bounded, and smoothly released', () => {
  const signatures = new Set();
  for (const kind of ['step', 'alert', 'breath', 'retreat']) {
    const pcm = synthesizeCue(kind, 16000); assert.deepEqual(pcm, synthesizeCue(kind, 16000));
    assert.equal(pcm[0], 0); assert.equal(pcm.at(-1), 0);
    assert.ok(pcm.every(v => Number.isFinite(v) && Math.abs(v) < .65));
    assert.ok(energy(pcm) > .01); assert.ok(energy(pcm.slice(Math.floor(pcm.length * .8))) < energy(pcm) * .02);
    signatures.add(Buffer.from(pcm.buffer).toString('base64'));
  }
  assert.equal(signatures.size, 4);
  assert.throws(() => synthesizeCue('unknown', 16000), RangeError);
  assert.ok(Math.sqrt(energy(synthesizeSound(WARD_LANTERN, 'ward_on', 16000)) / 16000) < .02, 'ward transitions are quiet mechanical cues');
});

test('stereo direction follows camera yaw and walls attenuate and filter spatial sound', () => {
  assert.equal(soundPan({ x: 10, z: 0 }, { x: 0, z: 0, yaw: 0 }), 1);
  assert.equal(soundPan({ x: -10, z: 0 }, { x: 0, z: 0, yaw: 0 }), -1);
  assert.ok(soundPan({ x: 0, z: -10 }, { x: 0, z: 0, yaw: Math.PI / 2 }) > .99);
  const { sound, nodes } = audio(), world = new World({ generate: false });
  const ear = { x: 5.5, y: 2.5, z: 5.5, yaw: 0 }, source = { x: 9.5, y: 2.5, z: 5.5 };
  sound.setListener(ear, world); const clear = sound.position(source);
  world.set(7, 2, 5, STONE); const muffled = sound.position(source);
  assert.ok(muffled.gain < clear.gain); assert.equal(muffled.cutoff, 850);
  sound.playAt(CONCRETE, 'break', source, ear);
  assert.ok(nodes.some(n => n.type === 'pan' && n.pan.value > .99)); assert.ok(nodes.some(n => n.type === 'lowpass' && n.frequency.value === 850));
  sound.stop(); assert.equal(sound.active.size, 0); assert.ok(nodes.filter(n => n.type !== 'master').every(n => n.disconnected));
});

test('voices and sample caches stay bounded during repeated construction and creature cues', () => {
  const { sound } = audio();
  for (let i = 0; i < 100; i++) sound.play(STONE, 'break'); assert.equal(sound.active.size, MAX_SOUND_VOICES);
  sound.playCueAt('alert', { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 0 }); assert.equal(sound.active.size, MAX_SOUND_VOICES);
  sound.stop();
  const blocks = [GRASS, STONE, WOOD, CONCRETE, REINFORCED_PANEL, SECURITY_DOOR, WATER];
  for (let repeat = 0; repeat < 4; repeat++) for (const block of blocks) for (const action of ['step', 'place', 'break', 'hit', 'repair', 'open', 'close']) { sound.play(block, action); sound.stop(); }
  assert.equal(sound.buffers.size, MAX_SOUND_BUFFERS);
});

test('mute allocates no audio while audibility remains available for equivalent captions', () => {
  const { sound, sources } = audio(); sound.setEnabled(false);
  const p = { x: 12, y: 2, z: 12 };
  assert.ok(sound.playCueAt('breath', p, { ...p, x: 14 }) > 0); assert.equal(sources.length, 0);
  sound.play(CONCRETE, 'hit'); assert.equal(sources.length, 0);
});

test('remote footsteps follow actual travel and ignore self, idle motion, and teleports', () => {
  const { sound, sources } = audio(), world = new World({ generate: false });
  for (let x = 0; x < 20; x++) world.set(x, 0, 5, GRASS);
  sound.setListener({ x: 5.5, y: 2.6, z: 5.5 }, world);
  const p = { id: 'other', x: 8.5, y: 1.01, z: 5.5, active: true };
  sound.trackPlayers([p], 'self'); sound.trackPlayers([p], 'self'); assert.equal(sources.length, 0);
  sound.trackPlayers([{ ...p, x: 10.3 }], 'self'); assert.equal(sources.length, 1);
  sound.trackPlayers([{ ...p, x: 18.5 }], 'self'); assert.equal(sources.length, 1);
  sound.trackPlayers([{ ...p, id: 'self' }], 'self'); assert.equal(sound.remoteSteps.size, 0); sound.stop();
});
