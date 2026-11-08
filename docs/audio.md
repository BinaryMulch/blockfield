# Audio assets and authoring

The game ships 54 mono PCM sound effects and three stereo MP3 music loops in `public/audio` (about 9.4 MB total). Vite copies this directory to `dist/audio`; the server release includes it in `dist`. Playback has no external audio-service dependency and needs no authoring tools.

## Credits and provenance

[Full credits](../public/audio/CREDITS.txt) are also available from Options → Music & sound credits. Effects come from rubberduck's **100 CC0 SFX #2**, OwlishMedia's **Sound Effects Pack**, and qubodup's **Door Open, Door Close Set**. Scott Buckley's **Reverie**, **The Old Ones**, and **The Encounter** provide the three music states under CC BY 4.0.

`public/audio/manifest.json` records creator/source pages, original filenames, source hashes, changes, output hashes, durations, peaks and RMS levels. Attribution travels with the files. Gameplay videos using the music should include the composer, track titles, website and license in their descriptions, as requested on the composer's source pages.

## Rebuild the assets

Requires Python 3, ffmpeg (including libmp3lame), ZIP extraction, and a 7z-capable extractor. Download URLs appear in the manifest and credits. Keep the full original downloads outside the repository; only selected edited assets are shipped.

Prepare a source directory with this structure:

```text
SOURCE_DIRECTORY/
  materials/                    # extracted sfx_100_v2.zip
    sfx100v2_footstep_wood_01.ogg
    ...
  owlish/                       # extracted Owlish Media Sound Effects.zip
    Footsteps/
    Human/
    Cloth, Rustle/
    Impacts/
    ...
  doors/                        # extracted qubodup-DoorSet.7z
    qubodup-DoorSet/flac/
  reverie.mp3
  the-old-ones.mp3
  the-encounter.mp3
```

Run from the repository:

```sh
python3 scripts/prepare-audio.py SOURCE_DIRECTORY
npm run build
npm test
```

Effects are high-pass filtered at 55 Hz, trimmed, peak balanced, and given short attack/release edges. They remain 44.1 kHz, 16-bit mono PCM. Music uses selected 85–110 second passages, five-second tail/head loop crossfades with 10ms anti-click edges, -20 LUFS loudness balancing, and 160 kbps stereo MP3 encoding. Every exported asset is decoded for duration and level verification when the manifest is written.

## Listening previews

```sh
node scripts/audio-preview.js
```

Requires ffmpeg to decode the music preview. Produces `release/audio/materials.wav`, `listener.wav`, `music-transitions.wav`, and a timestamp guide. These previews use the same effect recipes and default gains as the game, without spatial attenuation or wall filtering. The music preview demonstrates four-second crossfades through day, night, and threat excerpts; the live game uses 1.8-second threat entry, seven-second state changes, proximity hysteresis and ten-second tension release. Preview files are ignored by Git.

Automated tests cover recording hashes and PCM integrity, material mappings, spatial playback, cache/voice limits, delayed decoding, offline failures, music changes, interrupted fades, ducking, mute, storage failures, playback rejection, and production streaming responses. Final tone and relative-level decisions should also be evaluated while playing on headphones and speakers.

Plant placement and breaking use 180 ms clipped rustles; plant hits use 120 ms, with a 25 ms fade at the end. Door opening shares the wooden closing/latch recordings with a small pitch/variant change. Each Listener barrier strike adds louder, priority thumps, slowed scraping and breathing at the barrier location. The preview script respects these playback limits.

Item pickup uses an original 180 ms rising two-note cue, authored offline by `prepare-audio.py`. Its 880–1650 Hz fundamentals separate it from footsteps; soft edges keep it brief without a sharp click. It is preloaded first, plays through the effects volume and mute controls, and is included in the material audition.
