import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EFFECT_FILES, soundRecipe, cueRecipe } from '../src/audio-catalog.js';
import { MUSIC_TRACKS } from '../src/music.js';
import { MATERIALS } from '../src/inventory.js';
import { createGameServer, audioByteRange } from '../server.js';
import { recordedPCM } from './support/audio.js';

const root = new URL('../public/', import.meta.url);

test('all bundled recordings have verified provenance, hashes, sensible levels and supported encoding', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/audio/manifest.json', import.meta.url)));
  const used = [...EFFECT_FILES, ...Object.values(MUSIC_TRACKS)];
  assert.equal(new Set(used).size, used.length);
  for (const file of used) {
    const entry = manifest.files[file.replace('/audio/', '')]; assert.ok(entry, file);
    const bytes = await readFile(new URL(`.${file}`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, file);
    assert.ok(manifest.sources[entry.source].license); assert.match(entry.sourceSha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.duration > .05 && entry.duration < 120); assert.ok(entry.peak > .02 && entry.peak < .9);
    if (file.endsWith('.wav')) {
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      const pcm = recordedPCM(file);
      assert.ok(pcm.some(value => Math.abs(value) > .2)); assert.equal(pcm.at(-1), 0);
    } else { assert.ok(bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 255); assert.ok(entry.page.includes('scottbuckley.com.au')); }
  }
  for (const item of MATERIALS) for (const action of ['step', 'place', 'break', 'hit', 'repair']) for (let variant = 0; variant < 8; variant++) {
    for (const layer of soundRecipe(item.id, action, variant)) assert.ok(EFFECT_FILES.includes(layer.file));
  }
  for (const kind of ['step', 'alert', 'notice', 'search', 'pursuit', 'pressure', 'breath', 'retreat']) for (let v = 0; v < 8; v++) {
    for (const layer of cueRecipe(kind, v)) assert.ok(EFFECT_FILES.includes(layer.file));
  }
});

test('audio byte ranges handle open ends, suffixes, clipping, and invalid requests', () => {
  assert.deepEqual(audioByteRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(audioByteRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(audioByteRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(audioByteRange('bytes=900-2000', 1000), { start: 900, end: 999 });
  for (const header of ['bytes=-0', 'bytes=-', 'bytes=1000-', 'bytes=100-1', 'bytes=0-1,3-4', 'bytes=9007199254740999-', 'wat']) assert.equal(audioByteRange(header, 1000), null);
});

test('production serves bundled music and effects with streaming ranges and credits', async t => {
  // npm test works before a build; the build verification runs this test again.
  try { await stat(new URL('../dist/audio/music/day.mp3', import.meta.url)); } catch { t.skip('Run npm run build to test production assets'); return; }
  const game = await createGameServer({ host: '127.0.0.1', port: 0 });
  t.after(() => game.close());
  const base = `http://127.0.0.1:${game.server.address().port}`;
  const music = await fetch(`${base}/audio/music/day.mp3`, { headers: { Range: 'bytes=0-255' } });
  assert.equal(music.status, 206); assert.equal(music.headers.get('content-type'), 'audio/mpeg');
  assert.match(music.headers.get('content-range'), /^bytes 0-255\//); assert.equal((await music.arrayBuffer()).byteLength, 256);
  const wav = await fetch(`${base}${EFFECT_FILES[0]}`, { method: 'HEAD' });
  assert.equal(wav.status, 200); assert.equal(wav.headers.get('content-type'), 'audio/wav'); assert.equal(wav.headers.get('accept-ranges'), 'bytes');
  const invalid = await fetch(`${base}/audio/music/day.mp3`, { headers: { Range: 'bytes=999999999-' } }); assert.equal(invalid.status, 416);
  const credits = await fetch(`${base}/audio/CREDITS.txt`); assert.equal(credits.status, 200); assert.match(await credits.text(), /Scott Buckley/);
});
