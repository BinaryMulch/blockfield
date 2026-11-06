# Current features

Blockfield has one **Horror** mode: an ongoing cooperative world with finite gathering, renewable supplies, crafting, construction, repairs, and fuelled ward protection. The first Listener can investigate, stalk, and retreat. Player injury, rescue, and creature-driven structural damage are not implemented yet.

## Worlds and settlement

- Seeded 512 × 512 worlds, 24 blocks high, with hills, lakes, trees, and flowers.
- New worlds begin near a damaged modern maintenance outpost with concrete supports, reinforced steel panels, glazing, a ward emitter, an empty shared cabinet, and openings to repair.
- Three nearby salvage landmarks provide renewable supplies: a maintenance yard, roadside station, and abandoned worksite. Their coordinates appear in the game menu. Existing worlds retain their layouts; create a new world for these landmarks.
- Cabin blocks can be gathered, repaired, replaced, and extended normally. Repairs persist across chunk reloads and server restarts.
- Private browser worlds with searchable saves, JSON export/import, and per-world deletion.
- Shared multiplayer worlds for up to eight players, with names, avatars, a connected-player list, and reconnect support.
- Walking, jumping, sprinting, and half-block step climbing.
- No flight, unlimited-material mode, undo/redo, or manual time controls.

## Survival time

- An eight-minute day/night cycle with a persistent day count and elapsed simulation seconds.
- The server advances while anyone is connected, including players in menus or inventory.
- The last disconnect freezes the simulation and checkpoints the world.
- Reconnecting or restarting the host resumes saved time without offline catchup.
- Private worlds run while open, including menus; use Save & leave to close and pause them. Browsers may suspend background tabs.
- Item pickup delays use simulation time, so they also pause offline.

## Supplies and construction

Start empty. Break blocks to collect them and spend supplies when building. Inventory has 27 backpack slots plus nine hotbar slots, with stacks of up to 64. Left-click moves stacks; right-click splits or places one; Shift-click moves between backpack and hotbar. Hover a slot and press 1–9 to swap with a hotbar slot.

Choose a recipe, then click Make:

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
| 2 scrap metal + 2 wood cladding | 1 reusable repair tool |

Grass, dirt, stone, wood, leaves, sand, wood cladding, pavers, glass, service doors, utility lights, ward emitters, wooden slabs, concrete, reinforced panels, cabinets, security doors, and three flower varieties are available. Doors open/close, slabs merge into wood cladding, and lantern light respects opaque walls and closed doors. Construction validates support, player clearance, available supplies, and conflicting edits before changing blocks.

Drop items with Q / Shift+Q or the inventory Drop buttons. Nearby players can collect them after 1.5 simulation seconds. Drops persist without timed despawn; at most 256 stacks can be on the ground.

### Shared storage

Cabinets face the player when placed, snapping to the nearest of four horizontal directions so they can sit against any wall. Their orientation persists across chunk reloads and saves. Aim at a cabinet and press E, right-click, or use the touch Use button. Each cabinet has 27 shared slots, with 64 items per stack. Click a stack to transfer it between your inventory and the cabinet; right-click transfers one. Transfers combine matching stacks before filling empty slots and leave any excess in the source. Everyone sees confirmed changes, and stale simultaneous requests refresh without moving supplies twice. Empty a cabinet before dismantling it.

Cabinet contents save with player supplies in shared and private worlds, including exports and imports. The world keeps running while a cabinet is open. Currently, up to 4,096 cabinets can have storage records.

### Stronger construction

| Material | Dismantling hits |
| --- | --- |
| Ordinary blocks and service doors | 1 |
| Concrete and empty cabinets | 2 |
| Reinforced panels | 4 |
| Security doors | 5 |

Strike repeatedly with Break/left-click, at least 0.3 simulation seconds apart. Remaining strength is shared and saved; it does not reset when players disconnect or the server restarts. Opening a security door preserves its strength. The final strike returns one block (one item for a complete door), provided your inventory has room. A door still depends on its floor support. Reinforced pieces seal shelter using the same cached enclosure checks as other solid blocks; closed security doors isolate rooms. Creature-driven structural damage is future work.

### Visible structural damage

Damaged structures display three stages of wear according to the fraction of strength lost. Concrete develops cracks and chipped edges, reinforced panels show scratches and dent marks, and cabinets/security doors show scuffed surfaces and creased seams. Four stable pattern variations per material family prevent every block looking identical. Door patterns cover both halves and follow the panel when it opens or changes facing. Repairs restore the clean surface. Cracks are visual; actual block destruction creates a shelter breach.

Select the repair tool and aim at a reinforced piece to see its remaining strength and a small meter. Damage is synchronized on hits, repairs, and chunk loading, so it remains visible after rejoining, restarting, or returning to an area in shared and private worlds.

Wear uses a shared atlas of 32×32 masks blended by the existing solid-terrain shader. Its packed attribute adds three bytes per solid vertex. Hits and repairs update only the corresponding vertex ranges without rebuilding terrain or adding draw calls; a door shares one damage anchor across both halves. Masks are generated once, and damage changes compose with the existing voxel lighting. Client damage records are retained only for loaded terrain; the host indexes records by chunk for snapshots.

### Renewable resources and upkeep

Craft saplings from harvested leaves, then plant them on grass or dirt. Each growth stage takes one game day (eight simulation minutes); after three stages a sapling becomes a tree with four wood blocks and a renewable canopy. Use a sapling to inspect its stage and any obstruction. Growth waits for players, building clearance, build height, or nearby terrain loading. It preserves existing blocks. Removing a sapling or its soil returns one sapling and cancels its timer.

Use a marked salvage crate to gather a bundle of **2 scrap, 4 stone, and 2 sand**. Each site holds at most four bundles and replenishes one bundle per game day. These are shared reserves: gathering spends stock atomically, and a full inventory leaves the stock intact. Supply crates are fixed landmarks, and replenishment changes their reserves without resetting surrounding terrain or player builds.

Select a repair tool and press E/right-click or touch Use on damaged concrete, panels, cabinets, or security doors. One stone repairs concrete; one scrap repairs the other reinforced pieces. A repair restores full strength without dismantling the structure or opening a hole. The tool remains available for reuse. There is no passive deterioration of buildings.

Use a ward emitter to manage its power. One biomass cartridge adds **one game day** of charge; capacity is **three days (24 simulation minutes)**. The starting emitter is full, while newly placed emitters need fuel. Powered-on emitters consume charge continuously, including in unsealed rooms and unloaded areas. Switching one off preserves its remaining charge and disables protection. Breaking/replacing an emitter returns the device with no stored charge. A full cartridge is accepted only when there is room for its charge. The HUD and emitter inspection show low power during the last game day of charge. Utility lights remain fuel free.

Growth deadlines, stock replenishment, and charge all use saved simulation time, freezing when everyone disconnects. Growth deadlines continue while terrain is unloaded; growth applies once the required chunks are available. Wards and stock use elapsed-time arithmetic instead of per-device tick loops. An indexed queue processes at most four due plant events per update, with at most 2,048 planted saplings, 2,048 ward records, and 32 supply points per world. Generators, shared electrical distribution, food, and hunger are later milestones.

### Modern visual direction

Materials use procedural 32×32 textures, including fine concrete pores, panel seams and fasteners, steel cabinet doors, and contemporary service/security doors. Wood planks appear as painted cladding, bricks as concrete pavers, and lanterns as utility lights; the cyan ward is named **Ward emitter**. The flat-roof outpost and slate/teal interface establish a contemporary woodland setting. Terrain remains voxel based. Existing structures retain their shapes and use the updated textures; start a new world to see the modern starter outpost.

## Shelter protection

A powered, charged ward emitter automatically protects its enclosed room. Complete the floor, walls, roof, and closed doors; glass seals windows. Leaves, water, open doors, flowers, saplings, lanterns, and either slab half do not seal openings. Utility lights provide light only. Wards need full-height support and biomass fuel. Running out of charge or switching off revokes protection immediately, including for cached rooms; refuelling restores it when enclosure is verified.

The HUD shows Exposed, Shelter enclosed (needs a ward or power), Protected, or Checking shelter (verification or terrain loading). A complete green mark around a ward means active; a broken amber mark means inactive. Aim at it or use E/right-click to inspect and manage it. A quiet mechanical cue marks gaining/losing protection, with equivalent text feedback. Edits invalidate affected protection immediately. The HUD shows Checking during verification, then reports the new result; repairs restore protection once confirmed.

Player-built rooms work like the starter cabin, including large open houses. Open interior doorways join protection zones; closed interior doors isolate them, so each separate zone needs a ward. A closed door can preserve protection on one side of an exterior breach. Large zones are checked over multiple updates, with one shared work budget for everyone and bounded caches. Exhausting a work allowance never declares a room exposed: it stays Checking until verified. If the working cache is full, close doors to separate smaller zones. The host computes multiplayer state, while private worlds use the same rules. Checks never load extra terrain, and unloaded terrain never grants protection. Unrelated edits keep cached results; only affected terrain sections are rebuilt. Wards and repairs persist; active/inactive results are recalculated after loading. Existing worlds and cabins are not overwritten, so older cabins may require a crafted ward.

## The Listener

One Listener can be drawn by loud activity at night (the Night portion of the shared clock), after a 90-second starting grace period. Breaking, building, repairing, gathering salvage, and sprinting produce authoritative noise. Walking is much quieter. Failed actions, idle motion, inventory selection, and opening menus do not produce gameplay noise. Switching off audio changes playback only; the Listener's hearing is simulated independently.

It appears on checked, loaded ground at least 15 blocks from every player, investigates recent noise, then stalks visible exposed players while keeping approximately five blocks of distance. Walls and closed doors obstruct perception and movement. Foliage blocks sight; glass permits sight while muffling sound. It approaches remembered positions when sight is lost and gives up after losing interest. Powered ward protection or unresolved shelter verification keeps it cautious; if enclosed with a powered ward, it retreats. Dawn or a 75-second encounter limit also triggers retreat, followed by a 45-second cooldown. A trapped retreating creature fades out over its final two seconds. It currently causes no player injury or building damage.

Behavior is shared by all connected players and persists across restarts, without offline catchup. Existing saves receive a dormant Listener. Navigation runs at most five times per second for one creature, with up to 96 expanded nodes and 4,096 navigation block reads per update and a 2 ms route-search target. Perception traces visit at most 96 cells; the noise queue holds at most 32 events. Checks never generate terrain. Footstep noise is derived from actual observed travel, including sprint speed and ground/water contact, with teleports and idle motion suppressed.

The model is a lit, faceless raincoat silhouette. Cloth drag, heavy steps, uneven breathing, and receding brush provide restrained positional cues. Directional captions provide equivalent feedback when muted; captions reflect audible cues rather than revealing an exact position. Rejoining or returning from a menu does not replay a burst of old cues. Menus and inventory keep the world and encounters running.

## Sound design

All material effects use layered noise-based body impacts, friction, grit, and irregular transients. Concrete has a low fracture and debris layer, steel has a short impact and rattle, doors have latch/friction sounds, water has a soft wash, and ward transitions use quiet relay/air textures. Four stable variants reduce repetition. These effects are procedural foley, with no musical oscillators or note-based status sounds.

Spatial audio pans with camera yaw and fades with distance. Material interactions stop at 32 blocks, while restrained Listener cues have a 48-block fade. Exact voxel traces muffle sound through full walls, thin door panels, and slab geometry without loading chunks. Other players' grounded footsteps are audible nearby. Playback is capped at 16 concurrent voices and a 72-buffer cache, with compression to restrain combined peaks. Mute stops playback and preserves captions.

Generate isolated audition clips with `node scripts/audio-preview.js`; the timestamp guide is in `release/audio/README.md` alongside `materials.wav` and `listener.wav`.

## Controls

| Action | Control |
| --- | --- |
| Move / look | WASD / mouse |
| Sprint / jump | Shift / Space |
| Break / place | Left-click / F; right-click places or interacts |
| Interact | E / right-click |
| Inventory / hotbar | I / scroll wheel or 1–9 |
| Drop one / stack | Q / Shift+Q |
| Pick an owned material | Middle-click |
| Select service door / utility light / ward / slab / flowers | 0 / L / Shift+L / B / R |
| Menu | Escape |
| Mute / performance stats | M / P |

Touch has a movement stick, drag-to-look, Jump, Sprint, Break, Place, Use, Drop, and Menu. Open Menu → Inventory to craft and move stacks. Menus release your controls while the world keeps running. Tab navigation remains disabled; click text fields to type.

## Saves and migration

Shared edits, cabinet contents, structural damage, and supplies save before success is confirmed. The active clock checkpoints every five seconds, on the last disconnect, and on clean shutdown. Private worlds use browser IndexedDB and checkpoint time/position roughly every five seconds, plus saving on menu entry and leaving.

Old Gather and Creative worlds migrate to Horror when opened. Existing terrain and structures remain intact; no cabin is stamped over an old world. Gather quantities and layouts are retained, including older counter inventories. Creative hotbars become empty finite supplies because unlimited access did not represent owned items. The old held-clock setting is cleared. Keep your browser's anonymous player identity to retain access to multiplayer inventory.

The account and inventory recovery proposal remains [deferred](player-identity.md).
