"""Rebuild bundled audio with ffmpeg from the credited downloads (not needed to play)."""
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/prepare-audio.py SOURCE_DIRECTORY (see docs/audio.md)')
SOURCE = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/audio'
(OUT / 'sfx').mkdir(parents=True, exist_ok=True)
(OUT / 'music').mkdir(parents=True, exist_ok=True)
manifest = {'version': 1, 'sources': {
    'rubberduck': {'author': 'rubberduck', 'page': 'https://opengameart.org/content/100-cc0-sfx-2', 'download': 'https://opengameart.org/sites/default/files/sfx_100_v2.zip', 'license': 'CC0-1.0'},
    'owlish': {'author': 'OwlishMedia (owlstorm)', 'page': 'https://opengameart.org/content/sound-effects-pack', 'download': 'https://opengameart.org/sites/default/files/Owlish%20Media%20Sound%20Effects.zip', 'license': 'CC0-1.0'},
    'qubodup': {'author': 'Iwan Gabovitch (qubodup)', 'page': 'https://opengameart.org/content/door-open-door-close-set', 'download': 'https://opengameart.org/sites/default/files/qubodup-DoorSet.7z', 'license': 'CC0-1.0'},
    'buckley': {'author': 'Scott Buckley', 'page': 'https://www.scottbuckley.com.au/library/', 'license': 'CC-BY-4.0'},
    'blockfield': {'author': 'Blockfield', 'license': 'CC0-1.0'},
}, 'files': {}}

def run(args):
    return subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True, capture_output=True).stdout

def record(name, path, source, original, changes, source_path=None, **extra):
    pcm = array.array('f', run(['-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', '44100', '-']))
    manifest['files'][name] = {'source': source, 'original': original, 'changes': changes,
        'sourceSha256': hashlib.sha256((source_path or SOURCE / original).read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'duration': round(len(pcm) / 44100, 4),
        'peak': round(max(abs(v) for v in pcm), 5), 'rms': round((sum(v*v for v in pcm)/len(pcm))**.5, 5), **extra}

def effect(name, source, original, start=0, length=2.5):
    # Remove recording lead-in, keep natural tails, normalize peaks, and soften edits.
    raw = run(['-ss', str(start), '-i', str(SOURCE / original), '-t', str(length), '-af',
        'highpass=f=55,silenceremove=start_periods=1:start_duration=0.005:start_threshold=-48dB', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'])
    pcm = array.array('f', raw)
    # Trim only trailing silence; preserve quiet creaks and breaths inside each recording.
    last = next((i for i in range(len(pcm)-1, -1, -1) if abs(pcm[i]) > .0008), len(pcm)-1)
    pcm = pcm[:min(len(pcm), last + 900)]
    peak = max(abs(v) for v in pcm)
    for i in range(len(pcm)):
        fade = min(1, i / 100, (len(pcm)-1-i) / 660)
        pcm[i] = pcm[i] / max(.0001, peak) * .79 * max(0, fade)
    path = OUT / f'sfx/{name}.wav'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-i', '-', '-c:a', 'pcm_s16le', '-map_metadata', '-1', str(path)], input=pcm.tobytes(), check=True)
    record(f'sfx/{name}.wav', path, source, original, f'Mono 44.1kHz PCM; high-pass 55Hz; trim from {start}s, max {length}s; peak -2dBFS; 2ms attack / 15ms release')

def pickup():
    # Personal feedback: two rounded, rising notes above the footstep register.
    # Author offline so playback uses the same cached, muteable sample path as foley.
    rate, duration = 44100, .18
    pcm = array.array('h')
    for i in range(round(rate * duration)):
        t, value = i / rate, 0
        for start, length, frequency, rise, gain in [(0, .095, 880, 220, .54), (.065, .115, 1320, 330, .62)]:
            age = t - start
            if 0 <= age < length:
                phase = 2 * math.pi * (frequency * age + rise * age * age / (2 * length))
                envelope = min(1, age / .003) * math.exp(-age / .035) * min(1, (length - age) / .018)
                value += gain * envelope * (math.sin(phase) + .16 * math.sin(phase * 2))
        pcm.append(round(value * 32767))
    pcm[-1] = 0
    path = OUT / 'sfx/pickup.wav'
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())
    record('sfx/pickup.wav', path, 'blockfield', 'scripts/prepare-audio.py',
        'Original two-note rising pickup cue; 180ms; 880–1650Hz fundamentals; rounded attack and decay; mono 44.1kHz PCM',
        source_path=Path(__file__).resolve())

pickup()

for i in range(1, 5):
    effect(f'grass-step-{i}', 'owlish', f'owlish/Footsteps/{"gassy" if i == 1 else "grassy"}-footstep{i}.wav', length=1)
    effect(f'hard-step-{i}', 'owlish', f'owlish/Footsteps/hard-footstep{i}.wav', length=1)
for category, count in [('footstep_wood',4), ('footstep_wet',3), ('wood',3), ('wood_hit',3), ('stones',3), ('glass',3), ('metal',3), ('metal_hit',2), ('switch',2), ('door',5)]:
    for i in range(1, count+1):
        effect(f'{category.replace("_", "-")}-{i}', 'rubberduck', f'materials/sfx100v2_{category}_{i:02d}.ogg')
for i in range(1, 4):
    effect(f'cloth-{i}', 'owlish', f'owlish/Cloth, Rustle/{["320138__owlstorm__blanket-movement-2.wav", "320141__owlstorm__blanket-movement-3.wav", "320142__owlstorm__blanket-movement-4.wav"][i-1]}', length=1.8)
    effect(f'scrape-{i}', 'owlish', f'owlish/Impacts/scrape{i}.wav', length=1.5)
for i, start in enumerate([.4, 5.4, 10.4],1):
    effect(f'breath-{i}', 'owlish', 'owlish/Human/breath-male.wav', start=start, length=2)
effect('sharp-breath', 'owlish', 'owlish/Human/freakedbreath.wav', length=1.8)
for action in ['Open','Close']:
    for i in range(1,3):
        effect(f'wood-door-{action.lower()}-{i}', 'qubodup', f'doors/qubodup-DoorSet/flac/qubodup-Door{action}{i:02d}.flac', length=3)

for name, original, title, page, start, length in [
    ('day', 'reverie.mp3', 'Reverie', 'reverie', 12, 110),
    ('night', 'the-old-ones.mp3', 'The Old Ones', 'the-old-ones', 25, 100),
    ('tension', 'the-encounter.mp3', 'The Encounter', 'the-encounter', 30, 85),
]:
    # Body followed by a 5s tail/head crossfade. The loop ends where its body begins.
    filters = f'[0:a]atrim=start={start}:duration={length},asetpts=PTS-STARTPTS,loudnorm=I=-20:TP=-3:LRA=9,aresample=44100,asplit=3[b][t][h];' \
        f'[b]atrim=start=5:end={length-5},asetpts=PTS-STARTPTS[body];' \
        f'[t]atrim=start={length-5},asetpts=PTS-STARTPTS[tail];[h]atrim=end=5,asetpts=PTS-STARTPTS[head];' \
        f'[tail][head]acrossfade=d=5:c1=tri:c2=tri[join];[body][join]concat=n=2:v=0:a=1,afade=t=in:d=0.01,afade=t=out:st={length-5-.01}:d=0.01[out]'
    path=OUT / f'music/{name}.mp3'
    run(['-i', str(SOURCE / original), '-filter_complex', filters, '-map', '[out]', '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', '-map_metadata', '-1', str(path)])
    record(f'music/{name}.mp3', path, 'buckley', original, f'Excerpt {start}–{start+length}s; five-second loop crossfade; 10ms edge fades; -20 LUFS normalization; stereo MP3 160kbps', title=title, page=f'https://www.scottbuckley.com.au/library/{page}/')
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Prepared {len(manifest["files"])} assets in {OUT}')
