# Blockfield

A browser-based cooperative survival horror game for family and friends. Gather resources, repair an abandoned modern outpost, and build a settlement that lasts across sessions. There is one game mode: **Horror**.

The current build provides a persistent world, finite supplies, a modern starter outpost, shared storage, reinforced construction, a survival clock, 32×32 material textures, and authoritative shelter/ward protection. Renewable trees, capped salvage supplies, structural repairs, and biomass-powered wards support ongoing play. The Listener investigates noise, pursues exposed players, causes recoverable knockdowns, and pressures unprotected doors and reinforced panels. Teammates can help each other up; solo play has automatic recovery. Help and fallback recovery can stand a player up in otherwise clear water with the normal immunity; dry outpost return points remain preferred. Failed return searches retry once per simulation second. Automatic return points use actual full-block and lower/upper slab surfaces with standing clearance. Help prompts share the host’s physical clearance rules, and downed players retain look control with their position frozen.

## Play on your Mac

Use Node.js 24 and npm. Double-click **Play Blockfield.command**, or run:

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:6200/`. Choose **Single Player** for a private browser world or **Multiplayer** for the host's shared world. Other players on your network join at `http://HOST-IP:6200/`; `?join=1` joins multiplayer directly. Up to eight players can share a world.

For development, use `npm run dev`. The server and browser game use one TCP port, 6200 by default. See [setup and Linux updates](docs/setup.md) and the [advanced deployment guide](deploy/LINUX.md).

## Begin at the outpost

New worlds place a damaged modern maintenance outpost near spawn: concrete floor and supports, reinforced steel wall/roof panels, glazing, a cyan ward emitter, and an empty shared cabinet. A missing entrance door and holes in the wall and roof provide the first repair projects. You start empty-handed; gather resources nearby, craft materials, and repair or expand the outpost. All its blocks use the normal gathering and construction rules.

Procedural 32×32 textures provide fine material detail. Painted wood cladding, concrete pavers, steel doors, cool utility lights, and a slate/teal interface establish a contemporary woodland setting. Existing worlds retain their building shapes and receive the updated textures; create a new world for the modern starter layout.

The cabin is placed once as saved edits over the existing seeded terrain. It does not respawn when chunks reload, a player reconnects, or the host restarts. Existing worlds keep their terrain and structures and receive no automatic cabin overlay.

Worlds are 512 × 512 blocks with a 24-block build height, forests, hills, still lakes, and flowers. Nearby terrain streams as you explore; unloaded terrain does not let players fall through it. There is no victory condition or run reset.

## Persistent time

The eight-minute day/night cycle continues while at least one player is **connected**, including players in menus or inventory. The HUD shows the current day and time of day. The host owns the shared phase, day count, and elapsed simulation seconds.

When the last player disconnects, the clock stops and the server checkpoints the paused state. The next connection resumes it without advancing for the time spent offline. Server restarts also resume saved simulation time without offline catchup. Drops use simulation time for their 1.5-second pickup delay.

A private world runs while it is open, including in menus; **Save & leave** closes it and pauses its simulation. Private simulation updates depend on the browser running the tab. Closing or suspending the browser does not run a background server for that private world.

Flying, player-controlled time skipping/holding, and undo/redo are unavailable. Multiplayer rejects those commands; flight flags are cleared from incoming and restored player poses. The movement system remains designed for trusted cooperative play, rather than competitive anti-cheat.

## Gathering, inventory, and crafting

Break blocks to collect them and spend owned items when building. Inventory has 27 backpack slots and nine hotbar slots, with up to 64 items per stack. If a break would exceed inventory capacity, it is refused without losing the block or its supported fixtures.

Open inventory with **I**. Left-click moves, combines, or swaps stacks; right-click takes half or places one. Shift-click transfers between backpack and hotbar. Hover a slot and press 1–9 to swap it with a hotbar slot. Closing inventory returns held items to their source. There are no unlimited supplies.

Choose a recipe and click **Make**:

| Ingredients | Result |
| --- | --- |
| 1 wood | 4 wood cladding |
| 4 stone | 4 pavers |
| 2 sand | 1 glass |
| 6 wood cladding | 1 service door |
| 3 wood cladding | 6 wooden slabs |
| 4 stone + 1 wood + 1 glass | 1 utility light |
| 8 stone + 2 wood + 2 glass | 1 ward emitter |
| 4 stone + 1 sand | 4 concrete |
| 4 concrete + 1 scrap metal | 2 reinforced panels |
| 4 reinforced panels + 2 wood cladding | 1 storage cabinet |
| 6 reinforced panels + 1 glass | 1 security door |
| 1 leaves | 1 sapling |
| 1 wood | 2 biomass cartridges |
| 2 scrap metal + 2 wood cladding | 1 repair tool |

Press **Q** to drop one item or **Shift+Q** for the selected stack. Inventory has **Drop one** and **Drop stack** buttons for held items or the selected hotbar slot. Walk close to collect items after the pickup delay; other players can collect them too. Drops persist without timed despawn, with a limit of 256 dropped stacks.

Doors open and close and require support and two clear cells. Wooden slabs support half-height steps and can merge into wood cladding. Utility light respects opaque walls, closed doors, and the solid half of slabs. Utility lights provide light; ward emitters additionally activate protection in enclosed rooms.

## Shared storage and stronger construction

Aim at a cabinet and press **E**, right-click, or touch **Use**. Cabinets face the player when placed, snapping to the nearest of four horizontal directions. Each cabinet has 27 shared slots. Click a stack to transfer it; right-click transfers one. Transfers merge stacks and move only what fits. Cabinet revisions reject stale simultaneous withdrawals. Empty the cabinet before dismantling it. Contents persist with player supplies in shared saves and private exports/imports.

Concrete and cabinets take two dismantling hits, reinforced panels four, and security doors five. Ordinary blocks take one. Allow 0.3 simulation seconds between strikes; feedback reports remaining strength. Partial damage persists, and toggling a security door preserves it. Closed security doors seal rooms like service doors. Removing a door's floor support still removes the door. Select a repair tool and use a damaged piece to restore full strength: one stone for concrete, or one scrap for panels, cabinets, and security doors. The tool is reusable; buildings have no passive deterioration. Damage appears as progressive concrete cracks, panel scratches/dent marks, and cabinet/door wear. Repairs restore the clean appearance; aiming with a repair tool shows exact remaining strength. The Listener can damage unprotected doors and reinforced panels on a three-second cadence, using the same persistent strength and repair system.

## Renewable resources and upkeep

Harvest leaves and craft saplings. Plant them on grass or dirt; a tree matures after three game days (24 simulation minutes), growing through three visible stages. It waits for clear space, players to move, and required terrain to load. Growth never overwrites a building. A grown tree provides four wood blocks and leaves for more saplings.

New worlds include a maintenance yard, roadside station, and worksite. Their coordinates are listed in the game menu. Use a marked supply crate to collect 2 scrap, 4 stone, and 2 sand per bundle. Each site holds four bundles and replenishes one per game day. Supplies are shared, with no terrain or building resets. Start a new world to get the authored sites.

Wood makes biomass cartridges for ward power; scrap supports reinforced construction and repairs. Inspect a ward, supply point, or sapling with E/right-click or touch Use. All timers freeze when everyone disconnects, persist across restarts, and use bounded scheduled work. Generator networks and food systems are future work. See [features](docs/features.md#renewable-resources-and-upkeep) for tuning and limits.

## Shelter and wards

Repair a roof, floor, walls, and door to form an enclosed room, then place a **ward emitter** inside on a full-height support. Powered emitters need biomass fuel. One cartridge adds one game day (eight simulation minutes), up to three days. Use an emitter to refuel it or switch it off to preserve charge. New emitters start empty; the starter emitter is full. New cabins contain an inactive ward until their openings are repaired. Existing cabins are never overwritten; craft and place a ward if your cabin has an ordinary utility light.

Full blocks (including glass) and both halves of closed doors seal rooms. Leaves, water, flowers, lanterns, open doors, and either slab half do not seal openings. A player must fit inside the enclosed space. There is no fixed room-volume or width limit. Open interior doorways connect rooms into one protection zone; closed interior doors separate zones, each needing its own ward. A closed door can keep an exterior breach on one side from exposing a protected room on the other.

The HUD distinguishes **Exposed**, **Shelter enclosed · Add a ward emitter**, **Protected · Ward active**, and **Checking shelter** while enclosure checks run or terrain loads. Ward sources have a complete green mark when active and a broken amber mark when inactive. Aim at a ward or interact with E/right-click to inspect it. A quiet relay/air cue signals entering or losing protection; sound can be muted. An edit immediately invalidates an affected zone’s old result. It shows Checking while being verified, then becomes Protected, Sheltered, or Exposed. Repairing the enclosure restores protection after verification.

The multiplayer host decides protection from blocks, not client brightness or supplied status flags. Private sessions use the same incremental enclosure checker. Unloaded chunks cannot count as walls, and checks never generate or load extra terrain. Large houses can take several updates to verify. Checks reuse unaffected terrain sections and cached zone results. If the bounded working cache is exhausted, the result remains Checking; closing interior doors reduces the working area. Streaming, relevant edits, and restart trigger verification as needed. Only actual ward blocks and construction are saved; derived protection is never trusted from a save. The Listener uses this authoritative protection state to block contact, entry, and pressure on protected boundary pieces.

## Controls

| Action | Control |
| --- | --- |
| Move / look | WASD / mouse |
| Sprint / jump | Hold Shift / Space |
| Break / place | Left-click / F; right-click places or interacts |
| Interact with a door | E / right-click |
| Inventory / select hotbar | I / scroll wheel or 1–9 |
| Select an owned material | Middle-click |
| Select door / lantern / ward / slab / flowers | 0 / L / Shift+L / B / R |
| Drop one / drop stack | Q / Shift+Q |
| Open or close menu | Escape |
| Mute / performance diagnostics | M / P |

Touch controls provide movement, looking, Jump, Sprint, Break, Place, Use, Drop, and Menu. Open **Menu → Inventory** for crafting and stack transfers. Opening menus stops your movement, not the shared world clock.

Settings include mouse/touch controls, sound, FPS limits of 30/60/120, render resolution of 50%/75%/100%, and fog. Performance diagnostics include rendering, terrain/lighting workers, and host CPU/RAM; reports can be exported.

## Saves and existing worlds

Shared saves use `data/world.json` and `data/world.json.bak` by default. World edits, inventory actions, crafting, and drops checkpoint before success is acknowledged. Time checkpoints every five seconds while occupied, on the last disconnect, and on clean shutdown. An abrupt process loss may lose up to the latest time checkpoint, while acknowledged edits and supplies remain durable.

Shared inventories belong to anonymous browser tokens, not display names. Keep the same browser profile, website data, and server address to retain access to your supplies. Accounts remain [deferred](docs/player-identity.md).

Private saves live in browser IndexedDB. Use **Export backup / Import Backup** to move them between browsers or addresses. Keep server and private backups separately.

Legacy Gather and Creative saves are read and migrated to Horror on opening. Terrain, builds, world identity, and owned Gather quantities/layouts are retained. Legacy Creative hotbars represent unlimited access rather than owned items, so become empty finite inventories. Held time resumes normally, flight is disabled, and old worlds receive no cabin overlay. Legacy mode names are supported for save migration only; `GAME_MODE` no longer selects a game mode.

Before restoring or copying server saves, stop the host. Preserve the complete data directory. Only one host may write to a directory at a time. Unknown future save formats are rejected without replacing them with older data.

## The Listener and sound

At night, after an initial 90-second grace period, loud work or sprinting can draw one Listener from at least 15 blocks away. Arrival selection prioritizes viable activity from exposed teammates, so louder protected activity cannot monopolize attempts elsewhere. Existing creatures still hear physical noises, and exposed work outside a ward can draw a presence even if its worker is protected. A tension director controls Quiet, Unease, Pressure, Peak, and Release phases. The creature uses utility scoring and remembered sounds/sightings to listen, investigate, shadow, search, pursue, pressure a barrier, or withdraw. Quiet play can make its evidence expire. Pursuit includes a distinct **1.2-second warning**, then up to **five seconds at 5.4 blocks/second**; between bursts it moves at 2.6, while players sprint at 7.5. Within 1.25 blocks it reaches for 0.9 seconds before contact; stepping away cancels the attempt. Contact requires clear physical space through every solid shape, including glass, foliage, and lanterns. Powered, enclosed ward zones prevent contact and protect their boundary doors and panels. Dawn, an encounter timeout, confirmed ward protection, or a successful touch makes it retreat.

A touch causes a non-graphic knockdown: a lowered viewpoint, darkened edges, and a visible downed pose for teammates. Movement and supply/build actions stop while down. Hold **H** within 2.5 blocks of a teammate for **three seconds**, or hold the on-screen help button on touch devices, to get them up in place. Rescue cannot pass through walls or glazing. A downed player returns to clear ground at the starting outpost after **30 seconds**; solo players and groups with nobody standing return after **eight seconds**. Supplies are kept, and recovery grants **20 seconds** of immunity. If the return area is completely obstructed, clear space at the downed position is used instead.

Closed service doors take one pressure hit, reinforced panels four, and security doors five. The Listener pauses for **three seconds per hit** against a nearby barrier on its route. Reinforced pieces show the existing progressive wear and can be repaired between hits. Breaking a door removes both halves; breaching a panel wall requires clearing both body-height blocks. Pressure is limited to **six successful strikes per encounter** and shares a 20-point allowance with pursuit bursts. A usable shorter detour can be preferred over destruction. Pressure never awards resources or targets cabinets and salvage sites. Unverified shelter checks also suspend pressure until protection is known. Exact first-hit traces at two body heights prevent pressure from skipping a grazing glass corner, fixture, or swung door panel to damage something behind it.

Director phase, allowance, player pressure/targeting history, world-seeded randomness, evidence memory, search progress, position, and timers persist across saves and freeze when everyone disconnects. A knockdown immediately triggers group relief. Rest lasts **45–65 seconds after the creature actually leaves**, including time during daylight or recovery immunity. Arrivals require at least 15 blocks of separation from everyone and a completed offscreen route to the sound area at the correct height, or to an eligible unprotected door/panel blocking the approach; a watched creature withdraws physically before retiring. Visibility checks test head, torso, feet, and both body edges individually against the view cone and use a downed observer’s actual camera height and current look direction. Shared and private worlds use the same rules. Movement uses existing loaded terrain, bounded navigation, and collision checks. Spawn verification can continue across bounded updates; partial paths do not permit spawning. Candidate distances account for wall-muffled hearing while preserving the 15-block minimum. A verified approach stays in use until its destination changes or actual collision/protection blocks it; investigation reconstructs the approach after loading a save. Pursuit, shadowing, searching, and withdrawal also resume bounded route searches if a short partial route stalls at a wall; watched withdrawal keeps a complete detour when escape scoring returns the same destination. Movement uses the elapsed simulation time between executed updates, capped at one second per update without replaying missed checks, and carries its distance through waypoints. Intermediate collision checks prevent cutting corners or crossing thin door panels. Close pursuit targets still trigger pathfinding when a ledge or solid corner prevents contact. Construction, door closing, and tree maturation cannot embed an active creature; rejected construction leaves supplies and door halves unchanged. It crouches through open two-block doorways and under low branches. Interrupted movement preserves the required crouch pose when the creature has already entered beneath a low ceiling. Removing its support makes it fall onto the next solid surface, including slabs; it cannot reach or pressure a structure while falling, and unknown ground waits for normal terrain streaming. Unverified enclosure checks pause entry; only confirmed ward protection causes ward-driven retreat. Press P for director phase/reason, remaining allowance, group pressure, utility decision, evidence age/confidence, and navigation/query counters. A dark raincoat silhouette, spatial cloth/footfall/breath cues, and equivalent directional captions communicate its presence. Joining or resuming does not replay old cues. Menus keep the simulation running. Private edit checkpoints pause the occupied clock and AI together, matching host checkpoint behavior; slow storage cannot silently consume warnings, evidence, or recovery timers.

Material sounds now use layered broadband impacts, friction, grit, and mechanical clicks. Footsteps, fractures, doors, repairs, water, and ward transitions have four variations without the former pitched sine-wave impacts. Other players' footsteps are spatial too. Walls, thin doors, and slabs muffle positional effects; stereo direction follows the camera. A compressor restrains overlapping effects, with at most 16 voices and 72 cached samples. Muting audio preserves visual captions and has no effect on the Listener's hearing.

To audition the isolated effects, run `node scripts/audio-preview.js`. It writes `release/audio/materials.wav`, `listener.wav`, and a timestamp guide. These files are ignored by Git and are louder than their distance-attenuated in-game mix.

## Development

```sh
npm test
npm run test:soak
npm run build
npm run dev
npm run package:server
```

`test:soak` runs three world seeds for one simulated hour each, without a browser or live server. It mixes player physics, construction, doors, ward power/fuel, tree growth, knockdowns, teammate help, automatic recovery, six reloads per seed, and offline pauses. Assertions check collision clearance, contact/strike timing, supplies, saved state, and bounded AI/shelter/upkeep work. Set `BLOCKFIELD_SOAK_SECONDS` to 600–86400 to change the duration per seed. The normal test suite includes a shorter mixed-session run.

- `src/director.js`: persistent tension pacing, per-player pressure/target recency, action allowances, and seeded randomness.
- `src/listener-memory.js` and `src/listener-decisions.js`: bounded evidence/search memory, hard eligibility, utility scoring, and commitment.
- `src/listener-navigation.js`: bounded resumable route verification and partial movement routes, with section-based invalidation for unfinished spawn checks.
- `src/listener.js` and `src/perception.js`: creature state execution, honest perception, bounded spatial queries/navigation, pursuit bursts, and loaded-terrain traces.
- `src/encounters.js` and `src/listener-pressure.js`: profile-bound knockdowns, rescue progress, occupied-time recovery and immunity, bounded recovery placement, and paced structural pressure through existing atomic edits.
- `src/listener-renderer.js`: lit creature silhouette and sequence-based cues, with no replay on joining.
- `src/foley.js` and `src/sound.js`: layered noise-based material effects, spatial stereo, wall muffling, cue playback, and bounded voices/sample caching.
- `src/horror.js`: single-mode rules, starter-cabin overlay, and versioned Horror world metadata.
- `src/upkeep.js` and `src/upkeep-ui.js`: indexed plant timers, elapsed-time ward charge and salvage reserves, atomic fuel/repair/gathering commands, and inspection controls.
- `src/clock.js`: elapsed simulation time, day count, phase, and saved clock snapshots shared by local and hosted sessions.
- `server/room.js` and `server.js`: authoritative inventories/edits, connected-player clock rules, WebSocket protocol 15, persistence, and disconnect checkpoints.
- `src/session.js`: private simulation, browser save checkpoints, and session switching.
- `src/saves.js`: save format 8 with strict validation and migration of earlier worlds; `server/disk-saves.js` handles atomic replacement, backups, and writer locking.
- `src/infrastructure.js` and `src/storage-ui.js`: authoritative cabinet transfers, revisions, shared structural strength, and cabinet controls. Cabinet contents and damaged structures have separate bounded maps (4,096 records each), with no per-frame structural scans.
- `src/damage.js`: shared 32×32 wear masks and shader blending, packed damage attributes, and per-block vertex-range updates. Chunk snapshots carry persisted damage; hits and repairs update the affected ranges without extra meshes, draw calls, or remeshing.
- `src/textures.js`: deterministic 32×32 material tiles in a padded 256×512 atlas; the existing chunk meshes and draw groups are reused.
- `src/inventory.js`: finite material stacks, recipes, owned-material selection, and legacy inventory decoding. The `gather` inventory format tag is retained for save compatibility; it is not a playable mode.
- `src/generation.js` and `src/chunks.js`: unchanged generator version 1, bounded chunk caches, and retained sparse edits.
- `src/history.js`: shared atomic block/support transactions; undo/redo methods remain internal and are not exposed as gameplay commands.
- `src/shelter.js` and `src/ward-renderer.js`: incremental section connectivity, cached protection zones, and client-only status markers. Labels are built for 16 × 16 × 4 terrain sections, then connected by a graph search. Each simulation shares one allowance across all players: at most 4,096 work steps per update, with a 2 ms elapsed-time target checked every 16 steps, at most once per 100 ms. Queries enqueue work and never run a per-player flood fill. Caches are bounded to 512 sections and 64 zones; queues and stale component references are also bounded. Per-section revisions preserve unrelated cached results, and a direct opening to the sky proves outdoor exposure without searching the whole outdoors. Ward positions are indexed when blocks change or chunks arrive, rather than rediscovered by scanning terrain on every HUD update.
- `src/world.js`, `src/terrain.js`, `src/lantern-field.js`: block geometry, collision, chunk meshing, and bounded voxel lighting.

Encounter state follows saved simulation time, including offline pause. Hosted knockdowns, recovery, and structural pressure checkpoint before publication. Reconnecting keeps a downed state and remaining recovery time; it does not discard supplies.
