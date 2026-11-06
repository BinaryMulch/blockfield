# Blockfield

A voxel sandbox with private single-player worlds and up to eight players on a shared server. Explore seeded 512 × 512 worlds, streamed in 16 × 16 chunks. Built with JavaScript, Three.js, Node.js, and Vite. Play in Safari or Chrome; host on macOS or Linux.

## Play on your Mac

Double-click **Play Blockfield.command** in Finder. It starts the local server and opens the game in your default browser. Keep its Terminal window open while playing; press **Control+C** there to stop the server.

You need Node.js 22.12+ (or Node.js 24+). Dependencies are already installed in this workspace. On a fresh copy, the launcher installs them automatically; that first installation needs internet access. The game itself uses no external assets or services.

Alternatively, run these commands from this folder:

```sh
npm install
npm run dev
```

Open the local URL printed in Terminal. Choose **Single player** to create a named world with an optional seed, or choose **Multiplayer** to join this host or another server. Once nearby terrain is ready, click **Let's play** to capture the mouse. If mouse capture is blocked inside an embedded browser, open that URL directly in Safari or Chrome.

## Choose a world

**Single player:** enter a world name and optionally a seed, then click **Create a new world**. A blank seed creates a random landscape. Terrain generation, building, time, and history run privately in your browser; it does not occupy a multiplayer slot or modify the host's world. The same seed produces the same natural terrain. Escape opens the menu, where **Save & leave** returns to the start screen. Created worlds appear in the saved-world list with an **Open** button. Creating another world adds a separate save.

**Multiplayer:** enter a Mac or Linux server address, such as `http://192.168.1.42:5173`, and click **Join multiplayer**. The browser opens that host's game and joins its world. The default address joins the server currently serving the page. An invite link ending in `/?join=1` joins directly.

Worlds now save automatically. Private worlds use IndexedDB in the browser; the host writes shared worlds to its local disk. Saves contain the seed, changed blocks, world name, and time of day. Private saves also retain player position, look direction, and flying mode. Untouched terrain is regenerated; unloaded chunks and meshes are not written to saves.

For private worlds, edits are saved immediately, movement and time are checkpointed about every five seconds, and pausing or **Save & leave** flushes the current state. **Save now** saves explicitly. **Export backup** downloads a JSON world file; **Import world backup** adds a separate copy to the library. Browser saves are specific to the browser profile and site address (scheme, hostname, and port). For example, `localhost:5173`, `127.0.0.1:5173`, and a VM address have separate libraries. Export/import moves worlds between them. Clearing website data or using a temporary/private browser profile can remove local saves, so keep exported backups of important worlds.

The save indicator reports saving and errors. A storage-full error stops further building, keeps unsaved work in memory, and offers retry/export. **Save & leave** stays in the world if saving fails. Opening the same world in another tab detects conflicting writes instead of silently overwriting them. Undo/redo history is session-only; saved buildings persist, but history starts fresh when reopening.

## Play together on Wi-Fi

1. On the host Mac, double-click **Play Blockfield.command** or run `npm run dev`.
2. In the game menu, choose **Multiplayer**, enter your name, and copy the **Invite link**. The same join address is printed in Terminal, for example `http://192.168.1.42:5173/?join=1`.
3. Friends on the same Wi-Fi open that link in Safari or Chrome, enter their names, and click **Let's play**. They do not need Node.js or the project files.

Keep the host Mac awake and its Terminal window open. If macOS asks whether Node can accept incoming connections, allow it. Friends need the host’s network address rather than `localhost`, which refers to their own computers. If the link cannot connect, check that everyone is on the main Wi-Fi network; guest networks may prevent devices from reaching each other. A changed Wi-Fi address means copying the new link from the host's menu.

Everyone shares blocks, doors, flowers, lanterns, and time of day. Colored avatars and name labels show the other players; up to eight can join. Newcomers receive the current world, including earlier changes. Reloading rejoins that world. If the connection drops, the game pauses your controls and tries to reconnect. Rejoining starts you near spawn with a fresh personal undo history.

The host saves shared worlds to `data/world.json` next to `server.js`, with the previous valid checkpoint at `data/world.json.bak`. Accepted building edits and time-control changes reach disk before success is broadcast. The advancing clock is checkpointed every five seconds, and clean shutdown writes a final checkpoint. Restarting restores the saved seed, name, edits, and time. Generated chunks still unload when unused. This version is intended for friends on a trusted local network and has no accounts or internet hosting setup.

## Host on a Linux VM

Build a portable package with `npm run package:server`. Copy `release/blockfield-server.tar.gz` to the VM, extract it, run `npm ci --omit=dev`, then `npm start`. The same package runs on your Mac. Use Node.js 24 LTS or Node.js 22.12+.

[Linux deployment instructions](deploy/LINUX.md) include the exact commands, world name/seed configuration, a systemd service, and an optional Docker Compose setup. The server needs only Node.js and a reachable TCP port; rendering and terrain meshing happen in players' browsers.

## Server save files and backups

Set `DATA_DIR` to choose the local save folder on either macOS or Linux:

```sh
DATA_DIR=/path/to/my-world npm start
```

Each data directory contains one shared world. On the first start, `WORLD_SEED` and `WORLD_NAME` initialize it; later starts restore the saved world and do not replace it when those environment variables change. To create a separate server world, use a new data directory. Stop the host before copying its save folder to another machine or restoring a backup. Save files are not included in newly built server packages.

Writes use a temporary file, disk flush, and atomic replacement, plus a previous-file backup. If the main file is damaged, the host can recover the valid backup and reports recovery in its log. A backup may be one checkpoint behind. If both files are unreadable, or the save needs an unsupported game/generator version, startup stops and preserves the files. A lock prevents two hosts writing to the same directory. If the disk becomes unwritable during play, the host stops accepting edits and reports an unhealthy status; fix the storage problem and restart from the last valid save.

The included systemd service stores data in `/var/lib/blockfield`. Docker Compose uses a persistent named volume mounted at `/app/data`. Keep that directory or volume when upgrading the server. See [Linux deployment instructions](deploy/LINUX.md) for details.

## Controls

| Action | Control |
| --- | --- |
| Move | W / A / S / D |
| Sprint | Hold either Shift key while moving |
| Toggle flying | V |
| Ascend / descend while flying | Hold Space / C |
| Look | Mouse / trackpad |
| Jump | Space |
| Break the highlighted block | Left-click |
| Place a block against the highlighted face | F, right-click, or Control-click |
| Choose grass / dirt / stone / wood / leaves / sand / planks / bricks | 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 |
| Choose glass / a door | 9 / 0 |
| Choose a lantern | L |
| Choose a wooden slab | B |
| Choose flowers / cycle red, yellow, and daisies | R, or click the Flowers slot again |
| Open / close a door | Q |
| Select the material of the highlighted block | E |
| Mute / unmute sound | M, or the Sound button |
| Show / hide performance stats | P, or the Performance button |
| Hold / resume time of day | T, or the time button |
| Skip to the next time of day | N |
| Undo a block edit | Z, Command+Z, or Control+Z |
| Redo a block edit | Shift+Z, Command+Shift+Z, or Y |
| Pause and release the mouse | Escape |

The world is 512 × 512 blocks—64 times the previous horizontal area—with seeded hills, lakes, scattered trees, a build height of 24 blocks, and an indestructible bottom layer. Tree trunks and leaves can be broken and placed just like other blocks. There is a clearing around spawn. Walking speed is 4.5 blocks per second; sprinting raises that to 7.5, with no stamina meter. You can reach blocks up to six units away. Walking off the edge returns you to the spawn point. There is no inventory, crafting, or combat.

Low terrain forms still lakes with sandy beds and banks. Water is transparent, slows walking, and produces splashing footsteps. You can select the sand beneath the water with E, place blocks over it, or fill it in. Water stays still and does not flow or refill excavated areas. Sand stays where you place it. Flying preserves block collision; release the movement keys to hover, hold Shift to fly faster, and press V again to return to gravity. The flight ceiling is 12 blocks above the build limit.

An eight-minute day/night cycle brings moving sunlight and shadows, warm sunsets, a square moon, and stars. Nights stay bright enough for building. Multiplayer players see the same time; private worlds have their own clock. The clock advances while at least one player is playing; it pauses when everyone is in the menu or disconnected. T holds or resumes time for everyone, and N jumps through day, sunset, night, and sunrise. The menu's time button also controls the shared clock.

Planks and bricks are textured building blocks with their own sounds, available directly from the hotbar. Breaking blocks produces brief, material-colored chips. Each player has their own undo/redo history for the last 128 actions, including water replaced by building blocks and door interactions. Making a new edit clears that player's redo history. An action cannot overwrite another player's later edit, even if they replaced it with the same material. Placing, closing doors, or restoring blocks cannot overlap any player's body. Blocked history stays available so you can move clear and try again. History shortcuts work while playing; reloading or reconnecting starts a new personal history.

Glass is solid but transparent, with a faint blue tint, visible borders, and small highlights. Doors need a solid support and two clear cells of height. Aim at the top of a floor block and place one with F; its hinge orientation follows your viewing direction. Q opens or closes a nearby door, including when you aim through an open frame. Doors have thin collision panels that turn with the door; a swing that would overlap you is refused. Picking either half selects a new door. Breaking either half removes the whole door, and removing its support removes it too. Placement, interaction, breaking, and support removal undo/redo as complete actions, without leaving half a door.

Lanterns have a small metal frame, a handle, and glowing amber panes. Select one with L, then aim at the top of a solid block and press F or right-click to place it. They work on floors and tables; doors and other lanterns cannot support them. Their warm light is stronger at night. E picks a lantern, and left-click breaks it. Removing its support removes the lantern as part of the same undoable action. Placement, breaking, and undo/redo also update its light.

Wooden slabs are half-height planks for steps, porches, and roofs. Select them with B. Placing on a top face makes a lower slab; placing against an underside makes an upper slab. On a side face, aim at its lower or upper half. Place another slab on the exposed middle face to combine both halves into a full plank block. Walking and sprinting automatically climb rises of half a block when there is room overhead; jumping and flying retain their normal collision. E picks either half as a slab, and undo/redo restores its exact shape, including merges. Doors and lanterns can stand on upper slabs or merged planks; lower slabs need to be filled first.

Red flowers, yellow flowers, and white daisies grow in scattered patches on grass. R selects flowers; pressing it again cycles the three varieties. The Flowers hotbar slot shows the current color and also cycles when clicked again. Aim at the top of grass or dirt and press F or right-click to plant. E picks the exact variety you see, and left-click removes it. Flowers do not block walking or flying. Planting another color replaces the current flower, and building over one replaces it with your chosen block. Removing or replacing its soil removes the flower as part of the same undoable action. Undo/redo restores flowers and their colors. Flowers stay where planted and do not spread.

## Performance stats

Press **P** or click **Performance** to show the diagnostics panel. It works in single player, multiplayer, and the menu. Press Escape to use **Reset frames**, **Export report**, or the close button; P also works while playing. Export downloads a JSON report you can keep when comparing builds or send along with a performance problem.

- **FPS, frame average/p95, worst frame, and graph:** the latest 240 visible frame intervals, without the gameplay simulation's time clamp. Lower frame times are better; 16.7 ms corresponds to 60 FPS and 33.3 ms to 30 FPS. p95 means 95% of sampled frames took that long or less. Sampling resets when toggling the panel, changing worlds, entering/leaving play, or hiding/showing the tab. Paused-menu frames are labeled separately from playing frames; FPS can be capped by the display/browser.
- **Main work:** elapsed time inside the animation callback, including game updates and WebGL command submission. It excludes time spent waiting between frames, asynchronous workers, and diagnostics display updates. It is not whole-browser CPU usage or GPU execution time.
- **Render and chunk counts:** last-frame draw calls/triangles (including shadow passes), allocated renderer geometries/textures, loaded chunk data, meshed chunks, and the dirty-mesh queue. Geometry/texture counts are not GPU memory in bytes.
- **Workers:** average execution and complete round-trip times for the latest 60 mesh/terrain jobs, plus pending-job counts. Round trip includes queueing, transfer, and main-thread delivery. Private terrain runs in a browser worker; multiplayer terrain runs on the host. Worker samples cover the current worker's lifetime, so mesh samples may span worlds.
- **Browser heap:** a browser-provided JavaScript heap estimate where available. This is not total browser RAM or GPU memory, and worker/shared-heap coverage varies. Safari and browsers without this API show **Unavailable**. Browsers do not expose reliable total CPU or GPU utilization to the game. See [MDN's memory API limitations](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory).
- **Host:** actual Node process CPU sampled about once a second, RAM (RSS), event-loop active percentage, recent server-tick work p95, last disk-checkpoint time, players/chunks, and HTTP request round trip. CPU uses one-core normalization: 100% equals one logical core, and native multithreaded activity can exceed that. Event-loop activity is distinct from CPU use. Development includes Vite overhead; use a production build for comparisons. In single player these host numbers describe the server serving the page, while the private simulation runs in the browser. HTTP round trip includes request handling and is not WebSocket ping.

The panel updates twice a second and polls `/api/performance` about every two seconds while visible. It stops polling and collecting frame samples when closed or the tab is hidden. Sample buffers stay bounded; lightweight worker/server counters remain available. Missing host metrics show **Host metrics unavailable** and retry automatically. Reports include the host sample timestamps; stats remain local to the game and its host.

## Development

```sh
npm test        # Physics, building, streaming, save recovery, and network tests
npm run build  # Production files in dist/
npm start      # Host the production build on the LAN (default port 5173)
npm run dev    # Host with Vite for local development
npm run package:server # Build release/blockfield-server.tar.gz
```

`src/saves.js` defines the versioned sparse save format and validates it before loading. `server/disk-saves.js` performs atomic disk checkpoints, backup recovery, and writer locking. `src/browser-saves.js` uses strict IndexedDB write transactions, checks save revisions across tabs, and maintains a small metadata store so the world picker does not load every world’s edits into memory.

`server.js` serves the game and a WebSocket endpoint from the same port, listening on local network interfaces. `server/room.js` owns the shared world, clock, player roster, and per-player histories. It validates expected block state, reach, support rules, and all players' placement clearance before broadcasting an edit. Cell lineage prevents undo from overwriting another player's later changes. The server limits player count and message size/rate, checks browser origins, and removes disconnected peers. The port can be changed with `PORT=5174 npm run dev`.

`src/multiplayer.js` receives world metadata on joining, then nearby chunk snapshots and per-chunk revisioned edits. The host sends up to four new chunks per tick after the initial neighborhood, and subscriptions follow each player independently. A player exploring elsewhere does not force other browsers to load that terrain. Local movement runs at 120 Hz and sends poses up to 20 times per second. `src/players.js` interpolates remote avatars from the host's ten roster updates per second. Movement stays responsive locally; this is a cooperative LAN game rather than a server-simulated competitive game.

`src/chunks.js` stores only loaded 16 × 16 × 24 chunk columns, with sparse retained edits and revisions. Browsers render a radius of three chunks (up to 49 columns), prefetch data within four (81 columns), and unload beyond five. The private generator has at most two jobs in flight; the host retains the union of its players' neighborhoods. The edit store grows with building, while generated chunk and mesh caches remain bounded.

`src/generation.js` generates terrain, water, global tree anchors, and flowers deterministically from a seed. Trees can cross chunk boundaries without depending on generation order. `src/world-worker.js` handles private terrain generation and mesh building off the main thread. `src/chunk-renderer.js` builds one chunk at a time, prioritizes nearby chunks, checks neighbor data, rejects stale worker results, and disposes unloaded geometry. Block edits dirty their chunk and its immediate neighbors; they never rebuild the entire world. Collision waits at missing terrain rather than falling through it. Lantern searches scan loaded chunk data, and directional shadows follow the player.

`src/session.js` provides the single-player controller and switches between private and multiplayer sessions. Private cold-history operations can temporarily regenerate an evicted chunk to apply undo/redo. `src/world.js` contains shared block definitions, shapes, and collision physics, plus a small dense world used by the physics fixtures. `src/terrain.js` builds solid, water, glass, lantern, and flower meshes, with flat face normals for lighting. `src/main.js` handles rendering, input, and block editing. `src/clock.js` supplies the shared clock rules, while `src/sky.js` renders sky colors, celestial bodies, and ambient/sun/moon lighting. One 2048 × 2048 shadow map covers the whole world, refreshing up to five times per second as time advances and whenever a block changes. Held time reuses it. Chunk meshes are rebuilt when their data or a neighboring boundary changes.

`src/textures.js` generates sixteen 16 × 16 pixel textures, including glass, the two door halves, and lantern panes and caps. They share one small texture atlas with replicated borders to prevent color bleeding. Nearest-neighbor magnification keeps nearby pixels crisp; mipmaps reduce distant shimmer. The hotbar uses the same textures. Water and glass use separate transparent meshes; glass does not hide the opaque faces behind it. Door geometry and collision share the same panel bounds. Everything is generated locally, with no image downloads.

`src/lanterns.js` reuses eight point lights for the lanterns nearest the player, each with an eight-block range. All placed lanterns retain their glowing panes, including those beyond the light pool. These local lights do not use extra shadow maps. A separate emissive mask keeps the panes glowing while preserving the dark metal frame.

`src/history.js` validates every cell of an action before applying reversible edits, including door-pair, support, foundation, and player-collision checks. Door variants encode orientation, open/closed state, and upper/lower half directly in the voxel IDs. `src/particles.js` uses one instanced mesh and a fixed pool of 192 reusable chips, sampling their colors from the block textures. Particles shrink away after a short burst, stop on solid geometry, and freeze with the pause menu.

`src/slabs.js` chooses slab placement and merging from the picked face and hit height. Both slab variants reuse the plank texture at its original pixel scale. Terrain meshing checks whether a neighboring shape covers an entire face, preserving visible surfaces beside half blocks. Slab rendering, selection outlines, placement clearance, and movement use the same bounds.

Flowers use small colored boxes for stems, leaves, petals, and centers in one shared mesh. Their hotbar previews are generated locally, without enlarging the texture atlas. Deterministic patches are added after ponds and trees, keeping the spawn area clear. Flowers are non-solid, remain ray-pickable, and do not raise the terrain surface used by spawning. Breaking them creates a small petal-colored burst and a soft sound.

`src/sound.js` synthesizes short material-specific footsteps, breaking sounds, and placement sounds through Web Audio. Audio starts after clicking Play. Footsteps follow actual distance traveled on the ground, so sprinting produces a faster cadence and pushing against a wall stays quiet. Jumping is quiet until landing. Pausing stops active sounds; M or the Sound button mutes them. Sound buffers are reused, with no audio downloads or microphone access.
