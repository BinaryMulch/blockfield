# Current features

Blockfield has one **Horror** mode: an ongoing cooperative world with finite gathering, renewable supplies, crafting, construction, repairs, and fuelled ward protection. The Listener investigates, pursues, causes recoverable knockdowns, and damages unprotected doors and reinforced panels. Teammate rescue and automatic solo recovery keep the same world running.

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

Strike repeatedly with Break/left-click, at least 0.3 simulation seconds apart. Remaining strength is shared and saved; it does not reset when players disconnect or the server restarts. Opening a security door preserves its strength. The final strike returns one block (one item for a complete door), provided your inventory has room. A door still depends on its floor support. Reinforced pieces seal shelter using the same cached enclosure checks as other solid blocks; closed security doors isolate rooms. The Listener uses this same damage and repair system when pressuring unprotected doors and reinforced panels; its final strike does not return a material item.

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

The Listener has two cooperating AI layers. A saved **tension director** controls encounter pacing and permission to escalate; the creature chooses actions using its own sound/sight memory. Both run authoritatively in private worlds and on the shared host. The starting grace remains 90 simulation seconds, with active encounters restricted to night.

### Tension director

The director progresses through **Quiet → Unease → Pressure → Peak → Release**, with transitions driven by conditions and bounded durations:

| Phase | Behavior and transition |
| --- | --- |
| Quiet | Actual rest after the creature leaves, lasting 45–65 simulation seconds. Fresh loud activity can begin unease after this rest. After another minute of quiet, an exposed group can receive a distant presence without a fabricated sound or sighting. |
| Unease | A safe offscreen arrival and investigation/listening. An established presence can progress after four seconds; failure to find a safe arrival ends the attempt after 15 seconds. |
| Pressure | Shadow, investigate, search, or pressure an appropriate unprotected barrier. Confirmed sight within 14 blocks can escalate after three seconds. This phase has a 30-second cap. |
| Peak | Brief pursuit opportunities with a 14-second maximum. High group pressure or depleted allowance ends the peak sooner. |
| Release | Withdraw while the current encounter finishes. Quiet/rest starts only after the creature has actually left. A knockdown immediately enters release for the group. |

Each encounter has **20 allowance points**. A pursuit burst costs four; a successful structural strike costs two. Structural pressure is capped at **six successful strikes per encounter**, and can end earlier. The director tracks pressure per player from proximity during an encounter, bursts, structural strikes, and knockdowns; the most pressured connected teammate governs relief. These are gameplay measurements, not a measurement of human fear. Recent targeting discourages selecting the same person again, while commitment prevents switching targets during a reach attempt. No age, microphone, or camera information is used.

Director state includes its phase/deadlines, allowance, strike count, bounded recent player records, recent phase reasons, and a world-seeded random sequence. It is saved with the Listener and freezes offline. Recovery grace, powered wards, physical contact rules, and collision always override scored decisions.

### Evidence, choices, and movement

Breaking, building, repairing, gathering salvage, and sprinting produce authoritative noise; walking is quieter. Failed actions, idle motion, inventory selection, and opening menus do not create gameplay noise. Muting audio does not affect hearing. The creature retains up to eight sound/sight facts. Sight confidence decays over 18 seconds and sound over 22; replaying the same sound does not refresh its age. A sighting stores a location and observed direction, not continuous access to a hidden player's pose.

| Creature state | Decision and behavior |
| --- | --- |
| Listen | Pause and assess uncertain or absent evidence. An ambient arrival receives no invented target. |
| Investigate | Approach a remembered sound; fresh audible activity can update it. |
| Shadow | Maintain a vantage roughly 8–10 blocks around a visible player, with quiet discovery/breath cues. This state cannot cause contact. |
| Search | Check a bounded set of plausible locations around the last evidence and observed travel direction. Checked locations are remembered; silence allows confidence to expire. |
| Pursue (`stalk` in saved/network state) | Requires director permission and current or very recent visual evidence. A distinct breath/quickening-step cue warns for **1.2 seconds**, followed by up to **five seconds at 5.4 blocks/second**. Between bursts it moves at 2.6; sprinting players move at 7.5. A five-second interval separates burst opportunities. |
| Pressure barrier | Compare a loaded detour with the estimated cost of breaking an unprotected nearby door/panel. Prefer the shorter practical route; only permitted structural strikes spend allowance. |
| Reach | A sub-action of pursuit: within 1.25 blocks and 1.2 blocks vertically, require physical clearance and a 0.9-second interruptible reach after the pursuit warning. |
| Withdraw | Daylight, wards, recovery, expired evidence, encounter/pressure limits, or repeated route failures cause withdrawal. It seeks another retreat position if watched or stuck. It retires only after the eight-second withdrawal period and outside every player's conservative view. |

Forbidden actions are removed before utility scoring. Eligible actions receive contextual scores, a small seeded preference, current-action preference, and a minimum commitment of 1.5 seconds while still eligible. Urgent safety conditions interrupt immediately. The entire active encounter is capped at 75 seconds before withdrawal.

Spawn positions are at least 15 horizontal blocks from **every** connected player, including downed and recovering teammates. They require loaded, supported clearance, a usable initial route, verified absence of ward protection, and placement outside all players' conservative 140-degree view cones. Visibility checks include head, torso, and feet; unknown visibility cannot justify an on-screen arrival/removal. No active creature teleports. A visible withdrawing creature keeps moving toward an escape rather than fading in front of a player.

Movement supports full blocks, lower/upper slabs, open two-block doors, and crouching under low ceilings. Walls and closed doors block movement; foliage blocks sight and glass permits sight while obstructing contact. Unknown shelter pauses entry without being treated as confirmed ward protection. Three periods of three seconds without useful movement mark failed goals and ultimately cause withdrawal; construction/streaming changes invalidate cached routes and failed-goal assumptions.

The director performs normal updates at most once per simulation second, with immediate knockdown relief. Actor/perception updates run at most five times per second. Each actor update shares a maximum of 96 expanded navigation nodes, 4,096 navigation block reads, and a 2 ms route-search target. A spatial decision examines at most 12 candidate positions, followed by bounded navigation. Individual perception traces visit at most 96 cells. Search history is capped at 12 checked positions and eight failed goals; the noise ring holds 32 events, and director player history holds 64 records. These AI queries never generate terrain. Shelter connectivity remains the existing separate, bounded enclosure system.

Press **P** for director phase/reason, remaining allowance, group pressure, actor decision, evidence age/confidence, and navigation/spatial-work counters. Diagnostics and performance exports omit profile tokens and remembered coordinates. Discovery, search, pursuit preparation, barrier preparation, and withdrawal have distinct restrained positional foley with equivalent directional captions. Joining or returning from menus does not replay old cues. Menus keep the simulation running.

### Knockdown, rescue, and recovery

Downed players keep all supplies. Their camera lowers and the edges darken gently, with no gore, flashing, or loud attack sting. Teammates see a downed avatar. Movement and build/supply actions are blocked by the host while down; menus do not stop the recovery timer.

Hold **H** within 2.5 blocks of a downed teammate for **three seconds** to help them up in place. Touch devices show a hold-to-help button. Rescue requires physical line of contact, including glass obstruction. Progress resets after a half-second interruption, moving out of reach, losing clearance, or disconnecting; repeated packets cannot accelerate it. The strongest individual rescue progress is shown rather than stacking multiple helpers.

If no one helps, automatic recovery returns the player to clear ground near the starter outpost after **30 simulation seconds**. Solo players and groups with nobody standing recover in **eight seconds**. Placement searches a bounded patch without removing construction and avoids other players. If the starter patch is blocked, clear space at the downed position is the fallback. Both rescue and automatic recovery grant **20 seconds** of immunity to prevent immediate repeat knockdowns. The Listener also withdraws after contact and retains its normal encounter cooldown.

Downed states, recovery deadlines, and immunity are saved per anonymous player profile (or private-world player). Rejoining does not clear them. Host movement rejects downed poses and stale poses sent before a recovery correction. All timers freeze when nobody is connected. Hosted state changes checkpoint before being published; browser save errors freeze private encounters for retry.

### Structural pressure

A closed door or reinforced panel directly blocking the nearby route attracts a **three-second preparation per hit**. Pressure checks a short segment at two body heights rather than scanning a building. It also requires convincing evidence, director permission, and remaining encounter allowance; a shorter usable detour can avoid destruction. Service doors take one hit, panels four, and security doors five. Damage uses the existing saved strength, shader wear, positional impact sounds, and repair costs. Door halves break together; panel walls need both body-height blocks cleared before passage. The Listener never awards resources for destruction, damages cabinets, or attacks arbitrary distant structures.

A powered enclosed ward protects players and boundary doors/panels on either side. Closed interior doors still split zones, so a room without its own powered ward can remain vulnerable. Pressure pauses while enclosure status is unresolved. Unpowered barriers delay the Listener and can be repaired between hits; they eventually fail if left unprotected.

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
| Help a nearby downed teammate | Hold H for three seconds |
| Mute / performance stats | M / P |

Touch shows a hold-to-help button near a downed teammate. It also has a movement stick, drag-to-look, Jump, Sprint, Break, Place, Use, Drop, and Menu. Open Menu → Inventory to craft and move stacks. Menus release your controls while the world keeps running. Tab navigation remains disabled; click text fields to type.

## Saves and migration

Shared edits, cabinet contents, structural damage, and supplies save before success is confirmed. The active clock checkpoints every five seconds, on the last disconnect, and on clean shutdown. Private worlds use browser IndexedDB and checkpoint time/position roughly every five seconds, plus saving on menu entry and leaving.

Old Gather and Creative worlds migrate to Horror when opened. Existing terrain and structures remain intact; no cabin is stamped over an old world. Gather quantities and layouts are retained, including older counter inventories. Creative hotbars become empty finite supplies because unlimited access did not represent owned items. The old held-clock setting is cleared. Keep your browser's anonymous player identity to retain access to multiplayer inventory.

The account and inventory recovery proposal remains [deferred](player-identity.md).
