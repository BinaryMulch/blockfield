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

Choose **Gather** for finite supplies or **Creative** for unlimited blocks. New private and server worlds default to Gather. Existing saved worlds keep their mode; older worlds remain Creative. A world's mode is retained in its save and exported backups. To create a Creative server world, set `GAME_MODE=creative` with a new data directory.

**Multiplayer:** enter a Mac or Linux server address, such as `http://192.168.1.42:6200`, and click **Join multiplayer**. The browser opens that host's game and joins its world. The default address joins the server currently serving the page. An invite link ending in `/?join=1` joins directly.

Worlds now save automatically. Private worlds use IndexedDB in the browser; the host writes shared worlds to its local disk. Saves contain the seed, changed blocks, world name, and time of day. Private saves also retain player position, look direction, flying mode, and your hotbar. Untouched terrain is regenerated; unloaded chunks and meshes are not written to saves.

For private worlds, edits are saved immediately, movement and time are checkpointed about every five seconds, and pausing or **Save & leave** flushes the current state. **Save now** saves explicitly. **Export backup** downloads a JSON world file; **Import world backup** adds a separate copy to the library. Browser saves are specific to the browser profile and site address (scheme, hostname, and port). For example, `localhost:6200`, `127.0.0.1:6200`, and a VM address have separate libraries. Export/import moves worlds between them. Clearing website data or using a temporary/private browser profile can remove local saves, so keep exported backups of important worlds.

The save indicator reports saving and errors. A storage-full error stops further building, keeps unsaved work in memory, and offers retry/export. **Save & leave** stays in the world if saving fails. Opening the same world in another tab detects conflicting writes instead of silently overwriting them. Undo/redo history is session-only; saved buildings persist, but history starts fresh when reopening.

## Play together on Wi-Fi

1. On the host Mac, double-click **Play Blockfield.command** or run `npm run dev`.
2. In the game menu, choose **Multiplayer**, enter your name, and copy the **Invite link**. The same join address is printed in Terminal, for example `http://192.168.1.42:6200/?join=1`.
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

**iPhone, iPad, and touchscreens:** Touch controls are selected automatically. Choose a world, then tap **Let's play**; no mouse-capture permission is needed. You can also choose **Touch** in the menu's **Controls** selector. Use the left stick to move and drag the world to look. Aim the center crosshair, then tap **Break**, **Place**, or **Use door**. **Jump** jumps; **Fly** switches flying on/off, with **Up** and **Down** held to change altitude. **Sprint** toggles faster movement. **Undo** reverses the last edit. Swipe the hotbar sideways for more blocks; tap the selected flower slot again to cycle varieties. Use **Inventory** in the pause menu to edit your hotbar. **Pause** opens the menu and saves private worlds. Landscape orientation offers more room, and both orientations respect screen safe areas.

To open the game on your phone while the Mac hosts it, use the Mac's Wi-Fi address printed in Terminal, such as `http://192.168.1.42:6200/`. Keep both devices on the same Wi-Fi, keep the Mac awake, and allow incoming connections if macOS asks. `localhost` on an iPhone refers to the phone itself. A deployed HTTPS domain also works. Desktop players can select **Mouse & keyboard** for mouse capture and the controls below.

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
| Select a hotbar slot | 1–9, or click its slot |
| Open / return from creative inventory | I, or Inventory in the pause menu |
| Choose a door | 0 |
| Choose a lantern | L |
| Choose a wooden slab | B |
| Choose flowers / cycle red, yellow, and daisies | R, or click the selected flower slot again |
| Open / close a door | Q |
| Select the material of the highlighted block | E |
| Mute / unmute sound | M, or the Sound button |
| Show / hide performance stats | P, or the Performance button |
| Hold / resume time of day | T, or the time button |
| Skip to the next time of day | N |
| Undo a block edit | Z, Command+Z, or Control+Z |
| Redo a block edit | Shift+Z, Command+Shift+Z, or Y |
| Pause and release the mouse | Escape |

The creative inventory offers unlimited supplies of all 15 buildable blocks and flowers. Press **I**, choose one of nine hotbar slots, then click a block to put it there. Search by name or use **Reset hotbar** to restore the starting materials: grass, dirt, stone, wood, leaves, sand, planks, bricks, and glass. Opening inventory pauses your controls and releases the mouse. **I** or **Back to game** resumes if you opened it while playing; **Escape** or the close button returns to the pause menu. Search fields accept typing normally.

**Gather inventory:** start with an empty nine-slot hotbar and a 27-slot backpack. Each slot holds a stack of up to 64 items; the same material can occupy several stacks. Breaking a block collects it immediately, filling matching stacks before empty slots. Building spends one item from the selected hotbar stack. Empty hotbar slots cannot place blocks. If there is no room for everything a break would collect, the entire break is refused, keeping the block and its supported fixtures in the world. Grass drops grass; doors drop one item for both halves; a merged pair of slabs drops a full plank. Flying and the existing building controls remain available in Gather.

Press **I** to open the stack grid. The backpack's three rows sit above the separate hotbar. Stack quantities appear in the bottom-right corner; hover or focus a stack to see its name.

| Inventory action | Control |
| --- | --- |
| Pick up / place a whole stack | Left-click a slot |
| Pick up half, rounded up | Right-click a stack |
| Place one held item | Right-click an empty or matching slot |
| Combine matching stacks | Left-click a matching stack, up to 64 |
| Swap different items | Left-click a different stack while holding a whole stack |
| Move between backpack and hotbar | Shift-click |
| Swap a hovered or focused slot with a hotbar slot | 1–9 |
| Return held items and close inventory | I to resume, Escape to pause |

Closing inventory returns any held remainder to its source slot. Picking up items in the panel is a pending move; each completed transfer saves atomically, so closing, reloading, disconnecting, or a failed transfer cannot drop items between slots. Item stacks stay inside inventory; there are no dropped-item entities. Old Gather saves migrate their collected supplies into real stacks without duplicating repeated hotbar references.

The **Crafting** recipe buttons show the ingredients required and how many you own. Choose a recipe, then **Make**. Ingredients may come from any inventory slot; outputs merge into matching stacks or use empty slots. Held items must be put down before crafting. These simple recipes run immediately:

| Ingredients | Result |
| --- | --- |
| 1 wood | 4 planks |
| 4 stone | 4 bricks |
| 2 sand | 1 glass |
| 6 planks | 1 door |
| 3 planks | 6 wooden slabs |
| 4 stone + 1 wood + 1 glass | 1 lantern |

Gather undo/redo also transfers the matching items: undoing a placement refunds it, and undoing a break spends the collected item to restore the block. If you have already used those supplies, undo waits until you have enough again. Crafting is not part of block undo/redo. Failed edits and recipes do not spend supplies. Stacks and world changes save together in private browser saves and shared server checkpoints.

Multiplayer Gather inventories are checked and stored on the host, separately for each browser's anonymous player identity. The browser retains that identity; the server saves the complete backpack, hotbar, and selection. Rejoining or restarting the host restores the same stacks and layout. Keep that browser profile's website data to retain access to your items. Another browser/profile starts empty. Only one tab may use the same Gather identity in a world at a time. If settings storage is blocked, the identity lasts for the current visit. Names are display labels and do not identify inventories.

**E** picks the block you are looking at. In Gather it selects a matching hotbar stack or swaps an owned stack from the backpack into the selected hotbar slot. Uncollected materials cannot be picked. In Creative it selects an existing matching slot or assigns the material to the current slot. The quick keys **0**, **L**, **B**, and **R** follow the same ownership rules; Gather flower cycling only uses varieties you own. Private worlds save hotbar changes automatically and include them in exported backups. Creative multiplayer hotbars are personal to your browser profile and site address, saved separately for each shared world; restarting the same server world retains that layout. Other players have their own hotbars. If browser settings storage is unavailable, Creative multiplayer hotbar changes last for the current visit.

The world is 512 × 512 blocks—64 times the previous horizontal area—with seeded hills, lakes, scattered trees, a build height of 24 blocks, and an indestructible bottom layer. Tree trunks and leaves can be broken and placed just like other blocks. There is a clearing around spawn. Walking speed is 4.5 blocks per second; sprinting raises that to 7.5, with no stamina meter. You can reach blocks up to six units away. Walking off the edge returns you to the spawn point. There is no combat, health, or hunger.

Low terrain forms still lakes with sandy beds and banks. Water is transparent, slows walking, and produces splashing footsteps. You can select the sand beneath the water with E, place blocks over it, or fill it in. Water stays still and does not flow or refill excavated areas. Sand stays where you place it. Flying preserves block collision; release the movement keys to hover, hold Shift to fly faster, and press V again to return to gravity. The flight ceiling is 12 blocks above the build limit.

An eight-minute day/night cycle brings moving sunlight and shadows, warm sunsets, a square moon, and stars. Nights stay bright enough for building. Multiplayer players see the same time; private worlds have their own clock. The clock advances while at least one player is playing; it pauses when everyone is in the menu or disconnected. T holds or resumes time for everyone, and N jumps through day, sunset, night, and sunrise. The menu's time button also controls the shared clock.

Planks and bricks are textured building blocks with their own sounds, available directly from the hotbar. Breaking blocks produces brief, material-colored chips. Each player has their own undo/redo history for the last 128 actions, including water replaced by building blocks and door interactions. Making a new edit clears that player's redo history. An action cannot overwrite another player's later edit, even if they replaced it with the same material. Placing, closing doors, or restoring blocks cannot overlap any player's body. Blocked history stays available so you can move clear and try again. History shortcuts work while playing; reloading or reconnecting starts a new personal history.

Glass is solid but transparent, with a faint blue tint, visible borders, and small highlights. Doors need a solid support and two clear cells of height. Aim at the top of a floor block and place one with F; its hinge orientation follows your viewing direction. Q opens or closes a nearby door, including when you aim through an open frame. Doors have thin collision panels that turn with the door; a swing that would overlap you is refused. Picking either half selects a new door. Breaking either half removes the whole door, and removing its support removes it too. Placement, interaction, breaking, and support removal undo/redo as complete actions, without leaving half a door.

Lanterns have a small metal frame, a handle, and glowing amber panes. Select one with L, then aim at the top of a solid block and press F or right-click to place it. They work on floors and tables; doors and other lanterns cannot support them. Their warm light is stronger at night. Solid opaque blocks and closed doors stop lantern light: fully enclosing a lantern does not brighten surfaces outside its box. Glass, water, flowers, and open doors transmit light. Slabs allow light through their free half and block travel through their solid half. Light spreads through connected openings and around corners with an eight-block path range, in a Minecraft-style approximation rather than sharp object shadows. The game's ambient/daylight brightness still applies. E picks a lantern, and left-click breaks it. Removing its support removes the lantern as part of the same undoable action. Placement, breaking, undo/redo, doors, streamed chunks, and reopening saves update the cached lighting.

Wooden slabs are half-height planks for steps, porches, and roofs. Select them with B. Placing on a top face makes a lower slab; placing against an underside makes an upper slab. On a side face, aim at its lower or upper half. Place another slab on the exposed middle face to combine both halves into a full plank block. Walking and sprinting automatically climb rises of half a block when there is room overhead; jumping and flying retain their normal collision. E picks either half as a slab, and undo/redo restores its exact shape, including merges. Doors and lanterns can stand on upper slabs or merged planks; lower slabs need to be filled first.

Red flowers, yellow flowers, and white daisies grow in scattered patches on grass. R selects flowers; pressing it again cycles the three varieties. The selected flower's hotbar slot shows its variety and also cycles when clicked again. Each variety is also available in inventory. Aim at the top of grass or dirt and press F or right-click to plant. E picks the exact variety you see, and left-click removes it. Flowers do not block walking or flying. Planting another color replaces the current flower, and building over one replaces it with your chosen block. Removing or replacing its soil removes the flower as part of the same undoable action. Undo/redo restores flowers and their colors. Flowers stay where planted and do not spread.

## Graphics settings

The start/pause menu's **Graphics** section offers an **FPS limit** of 30, 60, or 120 and **Render resolution** of 50%, 75%, or 100%. Desktop defaults are 60 FPS / 100%; devices with a coarse primary pointer (phones and tablets) default to 30 FPS / 75%. Your choices apply immediately and are saved for this browser and site address. If settings storage is blocked, they still work for the current visit.

The FPS limit skips drawing frames while physics, input, workers, and networking continue on their existing schedule. It applies in both play and menus; the display/browser may impose a lower rate. Resolution scales both dimensions of the 3D drawing buffer relative to the existing device-pixel-ratio limit of 2. At 50%, the buffer has one quarter as many pixels as at 100%. Text, buttons, touch targets, and camera framing keep their screen size. Settings are reapplied on resize/rotation. Shadows, lighting, terrain, and view distance are unchanged. These settings reduce rendering work; they do not enforce a particular GPU utilization or temperature.

The Performance panel and exported reports include the FPS cap, resolution scale, and actual drawing-buffer dimensions. To reduce GPU work, try 30 FPS and 50% or 75% resolution.

## Performance stats

Press **P** or click **Performance** to show the diagnostics panel. It works in single player, multiplayer, and the menu. Press Escape to use **Reset frames**, **Export report**, or the close button; P also works while playing. Export downloads a JSON report you can keep when comparing builds or send along with a performance problem.

- **FPS, frame average/p95, worst frame, and graph:** the latest 240 rendered-frame intervals, excluding animation callbacks skipped by the FPS limit, without the gameplay simulation's time clamp. Lower frame times are better; 16.7 ms corresponds to 60 FPS and 33.3 ms to 30 FPS. p95 means 95% of sampled frames took that long or less. Sampling resets when toggling the panel, changing worlds or graphics settings, resizing, entering/leaving play, or hiding/showing the tab. Paused-menu frames are labeled separately from playing frames; the FPS limit and display/browser can cap the rate.
- **Main work:** elapsed time inside the latest 240 animation callbacks, including game updates and any WebGL command submission. Callbacks skipped by the render cap are included. It excludes time spent waiting between callbacks, asynchronous workers, and diagnostics display updates. It is not whole-browser CPU usage or GPU execution time.
- **Render and chunk counts:** last-frame draw calls/triangles (including shadow passes), allocated renderer geometries/textures, loaded chunk data, meshed chunks, and the dirty-mesh queue. Geometry/texture counts are not GPU memory in bytes.
- **Workers:** average execution and complete round-trip times for the latest 60 mesh/terrain jobs, plus pending-job counts. Round trip includes queueing, transfer, and main-thread delivery. Private terrain runs in a browser worker; multiplayer terrain runs on the host. Worker samples cover the current worker's lifetime, so mesh samples may span worlds.
- **Light bake / lamps / jobs:** average lantern-light worker time, lantern sources within the local light field, and queued/in-flight lighting jobs. The exported report also records field bytes and lighting round-trip time. Idle lighting reuses the cached result.
- **Browser heap:** a browser-provided JavaScript heap estimate where available. This is not total browser RAM or GPU memory, and worker/shared-heap coverage varies. Safari and browsers without this API show **Unavailable**. Browsers do not expose reliable total CPU or GPU utilization to the game. See [MDN's memory API limitations](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory).
- **Host:** actual Node process CPU sampled about once a second, RAM (RSS), event-loop active percentage, recent server-tick work p95, last disk-checkpoint time, players/chunks, and HTTP request round trip. CPU uses one-core normalization: 100% equals one logical core, and native multithreaded activity can exceed that. Event-loop activity is distinct from CPU use. Development includes Vite overhead; use a production build for comparisons. In single player these host numbers describe the server serving the page, while the private simulation runs in the browser. HTTP round trip includes request handling and is not WebSocket ping.

The panel updates twice a second and polls `/api/performance` about every two seconds while visible. It stops polling and collecting frame samples when closed or the tab is hidden. Sample buffers stay bounded; lightweight worker/server counters remain available. Missing host metrics show **Host metrics unavailable** and retry automatically. Reports include the host sample timestamps; stats remain local to the game and its host.

## Development

```sh
npm test        # Physics, building, streaming, save recovery, and network tests
npm run build  # Production files in dist/
npm start      # Host the production build on the LAN (default port 6200)
npm run dev    # Host with Vite for local development
npm run package:server # Build release/blockfield-server.tar.gz
```

`src/saves.js` defines the versioned sparse save format and validates it before loading. `server/disk-saves.js` performs atomic disk checkpoints, backup recovery, and writer locking. `src/browser-saves.js` uses strict IndexedDB write transactions, checks save revisions across tabs, and maintains a small metadata store so the world picker does not load every world’s edits into memory.

`src/inventory.js` defines the material palette, nine-slot hotbar, finite stack accounting, recipes, and versioned inventory validation. `src/inventory-ui.js` renders the searchable native dialog with quantities, recipes, keyboard focus containment, and cached procedural icons. Creative layouts use inventory version 1; Gather stacks use version 3. Version-2 Gather counters migrate on load, and optional fields in version-1 world saves keep older Creative worlds compatible. `EditHistory.apply` validates inventory transfers before applying any world cells, including support transactions and undo/redo. Multiplayer stores Creative layouts locally against the persistent world ID and Gather stacks/layouts on disk against private browser tokens. Protocol 4 sends inventories only to their owner after checkpointing. Transfer commands validate source/destination snapshots, indices, quantities, and capacity; clients cannot replace inventory contents. The visual held stack remains reserved in its source until an atomic transfer commits.

`server.js` serves the game and a WebSocket endpoint from the same port, listening on local network interfaces. `server/room.js` owns the shared world, clock, player roster, and per-player histories. It validates expected block state, reach, support rules, and all players' placement clearance before broadcasting an edit. Cell lineage prevents undo from overwriting another player's later changes. The server limits player count and message size/rate, checks browser origins, and removes disconnected peers. The port can be changed with `PORT=6201 npm run dev`.

`src/multiplayer.js` receives world metadata on joining, then nearby chunk snapshots and per-chunk revisioned edits. The host sends up to four new chunks per tick after the initial neighborhood, and subscriptions follow each player independently. A player exploring elsewhere does not force other browsers to load that terrain. Local movement runs at 120 Hz and sends poses up to 20 times per second. `src/players.js` interpolates remote avatars from the host's ten roster updates per second. Movement stays responsive locally; this is a cooperative LAN game rather than a server-simulated competitive game.

`src/chunks.js` stores only loaded 16 × 16 × 24 chunk columns, with sparse retained edits and revisions. Browsers render a radius of three chunks (up to 49 columns), prefetch data within four (81 columns), and unload beyond five. The private generator has at most two jobs in flight; the host retains the union of its players' neighborhoods. The edit store grows with building, while generated chunk and mesh caches remain bounded.

`src/generation.js` generates terrain, water, global tree anchors, and flowers deterministically from a seed. Trees can cross chunk boundaries without depending on generation order. `src/world-worker.js` handles private terrain generation and mesh building off the main thread. `src/chunk-renderer.js` builds one chunk at a time, prioritizes nearby chunks, checks neighbor data, rejects stale worker results, and disposes unloaded geometry. Block edits dirty their chunk and its immediate neighbors; they never rebuild the entire world. Collision waits at missing terrain rather than falling through it. Lantern searches scan loaded chunk data, and directional shadows follow the player.

`src/session.js` provides the single-player controller and switches between private and multiplayer sessions. Private cold-history operations can temporarily regenerate an evicted chunk to apply undo/redo. `src/world.js` contains shared block definitions, shapes, and collision physics, plus a small dense world used by the physics fixtures. `src/terrain.js` builds solid, water, glass, lantern, and flower meshes, with flat face normals for lighting. `src/main.js` handles rendering, input, and block editing. `src/clock.js` supplies the shared clock rules, while `src/sky.js` renders sky colors, celestial bodies, and ambient/sun/moon lighting. One 2048 × 2048 shadow map covers the whole world, refreshing up to five times per second as time advances and whenever a block changes. Held time reuses it. Chunk meshes are rebuilt when their data or a neighboring boundary changes.

`src/textures.js` generates sixteen 16 × 16 pixel textures, including glass, the two door halves, and lantern panes and caps. They share one small texture atlas with replicated borders to prevent color bleeding. Nearest-neighbor magnification keeps nearby pixels crisp; mipmaps reduce distant shimmer. The hotbar uses the same textures. Water and glass use separate transparent meshes; glass does not hide the opaque faces behind it. Door geometry and collision share the same panel bounds. Everything is generated locally, with no image downloads.

`src/lantern-field.js` propagates strongest-path block light through a bounded local grid. Opaque blocks and closed doors block propagation; transparent blocks and open doors pass it, and slabs have directional half-cell passages. Unknown/unloaded chunk data stays closed, and the grid includes air above the build ceiling. `src/lanterns.js` lazily starts a background worker when local lanterns need lighting, rejects stale results after edits/world switches, and uploads one nearest-filtered 3D byte texture (at most 144 × 32 × 144 cells, 648 KiB). Terrain, doors, water/glass, flowers, remote avatars, and instanced block particles sample this shared field; opaque faces sample the outward neighboring voxel to light thin door/slab surfaces. Nearest-cell sampling avoids blending light through solid walls. There are no per-lantern point lights or extra shadow-map renders. The field is reused while idle and rebuilt after relevant data changes or crossing chunk boundaries; night/day changes only adjust its strength. All local lanterns contribute without an eight-light selection cap. A separate emissive mask keeps panes glowing while preserving the dark metal frame. Lighting is derived from blocks, so existing server and browser save formats are unchanged.

`src/history.js` validates every cell of an action before applying reversible edits, including door-pair, support, foundation, and player-collision checks. Door variants encode orientation, open/closed state, and upper/lower half directly in the voxel IDs. `src/particles.js` uses one instanced mesh and a fixed pool of 192 reusable chips, sampling their colors from the block textures. Particles shrink away after a short burst, stop on solid geometry, and freeze with the pause menu.

`src/slabs.js` chooses slab placement and merging from the picked face and hit height. Both slab variants reuse the plank texture at its original pixel scale. Terrain meshing checks whether a neighboring shape covers an entire face, preserving visible surfaces beside half blocks. Slab rendering, selection outlines, placement clearance, and movement use the same bounds.

Flowers use small colored boxes for stems, leaves, petals, and centers in one shared mesh. Their hotbar previews are generated locally, without enlarging the texture atlas. Deterministic patches are added after ponds and trees, keeping the spawn area clear. Flowers are non-solid, remain ray-pickable, and do not raise the terrain surface used by spawning. Breaking them creates a small petal-colored burst and a soft sound.

`src/sound.js` synthesizes short material-specific footsteps, breaking sounds, and placement sounds through Web Audio. Audio starts after clicking Play. Footsteps follow actual distance traveled on the ground, so sprinting produces a faster cadence and pushing against a wall stays quiet. Jumping is quiet until landing. Pausing stops active sounds; M or the Sound button mutes them. Sound buffers are reused, with no audio downloads or microphone access.
