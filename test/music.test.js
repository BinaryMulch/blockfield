import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveMusic, musicMood, MUSIC_RELEASE_SECONDS } from '../src/music.js';
import { readAudioSettings, writeAudioSettings, DEFAULT_AUDIO_SETTINGS } from '../src/audio-settings.js';

function rig(createMedia) {
  const media = [], events = [];
  const context = { currentTime: 0, state: 'running',
    createMediaElementSource: element => ({ connect() {}, element }),
    createGain: () => ({ connect() {}, gain: { value: 0, cancelScheduledValues(at) { events.push(['cancel', at]); }, setValueAtTime(value, at) { events.push(['set', value, at]); }, linearRampToValueAtTime(value, at) { events.push(['ramp', value, at]); } } }),
  };
  const music = new AdaptiveMusic(context, {}, { createMedia: () => {
    const element = createMedia?.() || { paused: true, currentTime: 0, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
    media.push(element); return element;
  } });
  const player = { x: 0, y: 1, z: 0 }, creature = { state: 'stalk', x: 10, y: 1, z: 0 };
  return { music, media, events, context, state: { active: true, phase: .2, player, creature: null }, creature };
}

test('score follows local day/night, presence, and proximity hysteresis without revealing distant encounters', () => {
  const player = { x: 0, y: 1, z: 0 }, creature = { x: 15, y: 1, z: 0, state: 'search' };
  assert.equal(musicMood(.2, null, player), 'day');
  assert.equal(musicMood(.7, null, player), 'night');
  assert.equal(musicMood(.7, { ...creature, state: 'dormant' }, player), 'night');
  assert.equal(musicMood(.2, creature, player), 'tension');
  assert.equal(musicMood(.7, { ...creature, x: 80, state: 'stalk' }, player), 'night');
  assert.equal(musicMood(.7, { ...creature, x: 31 }, player), 'night');
  assert.equal(musicMood(.7, { ...creature, x: 31 }, player, 'tension'), 'tension');
  assert.equal(musicMood(.7, { ...creature, x: NaN }, player), 'night');
});

test('crossfades reverse smoothly, reuse at most three streaming decks and retain tension briefly after danger', async () => {
  const { music, state, creature, context, media } = rig();
  music.update(state); await Promise.resolve(); assert.equal(music.target, 'day');
  context.currentTime = 2; music.update({ ...state, creature }); await Promise.resolve();
  assert.equal(music.target, 'tension'); assert.equal(media.length, 2);
  const day = music.decks.get('day'); assert.ok(Math.abs(day.from - .08) < 1e-9); assert.equal(day.to, 0);
  context.currentTime += 1; music.update({ ...state, phase: .7 }); assert.equal(music.target, 'tension');
  context.currentTime += MUSIC_RELEASE_SECONDS + 1; music.update({ ...state, phase: .7 }); await Promise.resolve();
  assert.equal(music.target, 'night'); assert.equal(media.length, 3);
  context.currentTime += 3; music.update(state); await Promise.resolve();
  assert.equal(music.target, 'day'); assert.ok(day.to > 0);
  for (let i = 0; i < 30; i++) { context.currentTime += 15; music.update({ ...state, phase: i % 2 ? .7 : .2, creature: i % 3 ? null : creature }); }
  assert.equal(media.length, 3);
});

test('finished fades pause inactive tracks, cue ducking recovers, and music leaves headroom during pursuit', async () => {
  const { music, state, creature, context } = rig();
  music.update(state); await Promise.resolve();
  context.currentTime = 8; music.update({ ...state, creature }); await Promise.resolve();
  const deck = music.decks.get('tension'), full = deck.to;
  assert.ok(full < .5);
  music.duck(); music.update({ ...state, creature }); assert.equal(deck.to, full * .5);
  context.currentTime = 11; music.update({ ...state, creature }); assert.equal(deck.to, full);
  assert.equal(music.decks.get('day').media.paused, true);
});

test('master mute, independent music mute, zero volume, hidden tabs, disconnect and new worlds stop playback', async () => {
  const { music, state, context, media } = rig();
  music.unlock(); await Promise.resolve(); assert.ok(media.every(element => element.paused));
  music.update(state); await Promise.resolve(); assert.equal(media[0].paused, false);
  music.update({ ...state, active: false }); assert.ok(media.every(element => element.paused));
  music.setEnabled(false); music.update(state); assert.equal(music.target, null);
  music.setEnabled(true); music.setVolume(0); music.update(state); assert.equal(music.target, null);
  music.setVolume(.4); music.update(state); await Promise.resolve(); assert.equal(music.target, 'day');
  media[0].currentTime = 15; music.reset(); assert.equal(media[0].currentTime, 0);
  context.state = 'suspended'; music.update(state); assert.ok(media.every(element => element.paused));
});

test('rejected media playback is contained and retried after a cooldown or a fresh gesture', async () => {
  let calls = 0;
  const { music, state, context } = rig(() => ({ paused: true, play() { calls++; return Promise.reject(new Error('NotAllowedError')); }, pause() {} }));
  music.update(state); await Promise.resolve(); assert.equal(calls, 1);
  for (let i = 0; i < 60; i++) music.update(state);
  assert.equal(calls, 1);
  context.currentTime = 6; music.update(state); await Promise.resolve(); assert.equal(calls, 2);
  music.unlock(); await Promise.resolve(); assert.equal(calls, 5);
});

test('a play promise resolving after leave cannot restart music', async () => {
  let finish;
  const { music, state, media } = rig(() => ({ paused: true, play() { this.paused = false; return new Promise(resolve => { finish = resolve; }); }, pause() { this.paused = true; } }));
  music.update(state); music.stop(); finish(); await Promise.resolve();
  assert.ok(media.every(element => element.paused));
});

test('audio preferences survive reloads, validate volumes, and tolerate blocked storage', () => {
  assert.deepEqual(readAudioSettings(null), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(readAudioSettings({ getItem() { throw new Error('blocked'); } }), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(readAudioSettings({ getItem: () => '{broken' }), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(readAudioSettings({ getItem: () => JSON.stringify({ effects: 8, music: -2, enabled: false, musicEnabled: false }) }), { enabled: false, effects: 1, music: 0, musicEnabled: false });
  let stored;
  writeAudioSettings({ setItem(key, value) { stored = value; } }, { enabled: true, musicEnabled: false, effectsVolume: .6, musicVolume: .2 });
  assert.deepEqual(readAudioSettings({ getItem: () => stored }), { enabled: true, musicEnabled: false, effects: .6, music: .2 });
  assert.doesNotThrow(() => writeAudioSettings({ setItem() { throw new Error('blocked'); } }, {}));
});
