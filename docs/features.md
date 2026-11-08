# Current features

Blockfield has one **Horror** mode: an ongoing cooperative world with finite gathering, renewable supplies, crafting, construction, repairs, and fuelled ward protection. The Listener investigates, pursues, causes recoverable knockdowns, and damages unprotected doors and braced timber blocks. Teammate rescue and automatic solo recovery keep the same world running.

## Worlds and settlement

- Seeded 512 × 512 worlds, 24 blocks high, with hills, lakes, trees, and flowers.
- New worlds begin near a damaged woodland cabin with stone brick supports, braced timber walls, glazing, a ward lantern, an empty shared chest, and openings to repair.
- Three nearby salvage landmarks provide renewable supplies: a woodcutter’s camp, wayside camp, and old quarry. Their coordinates appear in the game menu. Existing worlds retain their layouts; create a new world for these landmarks.
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

Start empty. Break blocks to create items at their original location; walk close after a 0.9-second delay to collect them. Logs and stone take three hits, at least 0.3 seconds apart, and show damage between strikes. A full inventory leaves items on the ground; a full ground-item pool refuses further harvesting without losing blocks. Spend supplies when building. Inventory has 27 backpack slots plus nine hotbar slots, with stacks of up to 64. Left-click moves stacks; right-click splits or places one; Shift-click moves between backpack and hotbar. Hover a slot and press 1–9 to swap with a hotbar slot.

Craft with a **3×3 grid and result slot**. Place ingredients manually or click a recipe in the recipe book to fill the grid. Shift-click a recipe to fill the maximum batches. Click the result to pick it up; Shift-click crafts all available batches into inventory. Shapes accept horizontal mirrors and any position that fits. Missing recipes show a faint layout guide in the grid after returning the previous ingredients to inventory. Clear grid returns ingredients; leaving them in the grid saves them across closing, reloads, and reconnects.

| Ingredients | Result |
| --- | --- |
| 1 wood | 4 wooden planks |
| 4 stone | 4 bricks |
| 2 sand | 1 glass |
| 6 wooden planks | 1 wooden door |
| 3 wooden planks | 6 wooden slabs |
| 4 stone + 1 wood + 1 glass | 1 lantern |
| 8 stone + 2 wood + 2 glass | 1 ward lantern |
| 4 stone | 4 stone bricks |
| 4 wooden planks + 1 wooden peg | 2 braced timber blocks |
| 8 wooden planks | 1 wooden chest |
| 6 braced timber blocks | 1 braced wooden door |
| 1 leaves | 1 sapling |
| 2 wooden planks | 4 wooden pegs |
| 1 wood + 1 stone | 2 charcoal |
| 2 stone + 2 wooden planks | 1 reusable stone hammer |

Grass, dirt, stone, wood, leaves, sand, wooden planks, bricks, glass, wooden doors, lanterns, ward lanterns, wooden slabs, stone bricks, braced timber blocks, chests, braced wooden doors, and three flower varieties are available. Doors open/close, slabs merge into wooden planks, and lantern light respects opaque walls and closed doors. Construction validates support, player clearance, available supplies, and conflicting edits before changing blocks.

Drop items with Q / Shift+Q or the inventory Drop buttons. Nearby players can collect them after 1.5 simulation seconds for manually dropped stacks, or 0.9 seconds for harvested items. Items fall to the nearest loaded supporting surface, including slabs, and fall again when that support is removed. Collection plays a short rising two-note cue and briefly highlights any hotbar icons that receive items. Drops persist without timed despawn; at most 256 stacks can be on the ground.

### Shared storage

Chests face the player when placed, snapping to the nearest of four horizontal directions so they can sit against any wall. Their orientation persists across chunk reloads and saves. Aim at a chest and press E, right-click, or use the touch Use button. Each chest has 27 shared slots, with 64 items per stack. Click a stack to transfer it between your inventory and the chest; right-click transfers one. Transfers combine matching stacks before filling empty slots and leave any excess in the source. Everyone sees confirmed changes, and stale simultaneous requests refresh without moving supplies twice. Empty a chest before dismantling it.

Chest contents save with player supplies in shared and private worlds, including exports and imports. The world keeps running while a chest is open. Currently, up to 4,096 chests can have storage records.

### Stronger construction

| Material | Dismantling hits |
| --- | --- |
| Ordinary blocks and wooden doors | 1 |
| Stone bricks and empty chests | 2 |
| Braced timber | 4 |
| Braced wooden doors | 5 |

Strike repeatedly with Break/left-click, at least 0.3 simulation seconds apart. Remaining strength is shared and saved; it does not reset when players disconnect or the server restarts. Opening a braced wooden door preserves its strength. The final strike returns one block (one item for a complete door), provided your inventory has room. A door still depends on its floor support. Reinforced pieces seal shelter using the same cached enclosure checks as other solid blocks; closed braced wooden doors isolate rooms. The Listener uses this same damage and repair system when pressuring unprotected doors and braced timber blocks; its final strike does not return a material item.

### Visible structural damage

Damaged structures display three stages of wear according to the fraction of strength lost. Stone bricks develop cracks and chipped edges; braced timber, chests, and braced wooden doors develop grain splits and splinters. Four stable pattern variations per material family prevent every block looking identical. Door patterns cover both halves and follow the panel when it opens or changes facing. Repairs restore the clean surface. Cracks are visual; actual block destruction creates a shelter breach.

Select the stone hammer and aim at a reinforced piece to see its remaining strength and a small meter. Damage is synchronized on hits, repairs, and chunk loading, so it remains visible after rejoining, restarting, or returning to an area in shared and private worlds.

Wear uses a shared atlas of 32×32 masks blended by the existing solid-terrain shader. Its packed attribute adds three bytes per solid vertex. Hits and repairs update only the corresponding vertex ranges without rebuilding terrain or adding draw calls; a door shares one damage anchor across both halves. Masks are generated once, and damage changes compose with the existing voxel lighting. Client damage records are retained only for loaded terrain; the host indexes records by chunk for snapshots.

### Renewable resources and upkeep

Craft saplings from harvested leaves, then plant them on grass or dirt. Each growth stage takes one game day (eight simulation minutes); after three stages a sapling becomes a tree with four wood blocks and a renewable canopy. Use a sapling to inspect its stage and any obstruction. Growth waits for players, building clearance, build height, or nearby terrain loading. It preserves existing blocks. Removing a sapling or its soil returns one sapling and cancels its timer.

Use a marked salvage crate to gather a bundle of **2 wooden pegs, 4 stone, and 2 sand**. Each site holds at most four bundles and replenishes one bundle per game day. These are shared reserves: gathering spends stock atomically, and a full inventory leaves the stock intact. Supply crates are fixed landmarks, and replenishment changes their reserves without resetting surrounding terrain or player builds.

Select a stone hammer and press E/right-click or touch Use on damaged stone bricks, braced timber, chests, or braced wooden doors. One stone repairs stone bricks; one wooden plank repairs braced timber, chests, and braced wooden doors. A repair restores full strength without dismantling the structure or opening a hole. The tool remains available for reuse. There is no passive deterioration of buildings.

Use a ward lantern to manage its power. One piece of charcoal adds **one game day** of charge; capacity is **three days (24 simulation minutes)**. The starting lantern is full, while newly placed ward lanterns need fuel. Lit ward lanterns consume charge continuously, including in unsealed rooms and unloaded areas. Switching one off preserves its remaining charge and disables protection. Breaking/replacing a ward lantern returns the lantern with no stored charge. A piece of charcoal is accepted only when there is room for its charge. The HUD and lantern inspection show low power during the last game day of charge. Lanterns remain fuel free.

Growth deadlines, stock replenishment, and charge all use saved simulation time, freezing when everyone disconnects. Growth deadlines continue while terrain is unloaded; growth applies once the required chunks are available. Wards and stock use elapsed-time arithmetic instead of per-device tick loops. An indexed queue processes at most four due plant events per update, with at most 2,048 planted saplings, 2,048 ward records, and 32 supply points per world. Generators, shared electrical distribution, food, and hunger are later milestones.

### Classic Minecraft visuals

Materials use classic procedural 16×16 textures. Grass and leaves are green, planks and ordinary doors are warm wood, bricks are red clay, and lanterns glow amber. Stone bricks, braced timber blocks, chests, braced wooden doors, and supplies use matching coarse pixel textures; the ward lantern remains visually distinct with a green rune. Menus use the earlier woodland colors, and inventory slots have gray beveled borders. Saplings, wooden pegs, charcoal, and stone hammers have distinct cutout pixel silhouettes. Item icons show the actual pixel texture as a flat square with a thin border throughout inventory, hotbar, and shared storage. Existing worlds receive the restored visuals automatically and retain their structures and survival progress. Existing buildings retain their shapes. The old material IDs now represent stone bricks, braced timber, wooden chests and doors; old scrap and fuel stacks become wooden pegs and charcoal without losing counts.

## Shelter protection

A powered, charged ward lantern automatically protects its enclosed room. Complete the floor, walls, roof, and closed doors; glass seals windows. Leaves, water, open doors, flowers, saplings, lanterns, and either slab half do not seal openings. Lanterns provide light only. Wards need full-height support and charcoal. Running out of charge or switching off revokes protection immediately, including for cached rooms; refuelling restores it when enclosure is verified.

The HUD shows Exposed, Shelter enclosed (needs a ward or power), Protected, or Checking shelter (verification or terrain loading). A complete green mark around a ward means active; a broken amber mark means inactive. Aim at it or use E/right-click to inspect and manage it. A quiet mechanical cue marks gaining/losing protection, with equivalent text feedback. Edits invalidate affected protection immediately. The HUD shows Checking during verification, then reports the new result; repairs restore protection once confirmed.

Player-built rooms work like the starter cabin, including large open houses. Open interior doorways join protection zones; closed interior doors isolate them, so each separate zone needs a ward. A closed door can preserve protection on one side of an exterior breach. Large zones are checked over multiple updates, with one shared work budget for everyone and bounded caches. Exhausting a work allowance never declares a room exposed: it stays Checking until verified. If the working cache is full, close doors to separate smaller zones. The host computes multiplayer state, while private worlds use the same rules. Checks never load extra terrain, and unloaded terrain never grants protection. Unrelated edits keep cached results; only affected terrain sections are rebuilt. Wards and repairs persist; active/inactive results are recalculated after loading. Existing worlds and cabins are not overwritten, so older cabins may require a crafted ward.

## The Listener

The Listener has two cooperating AI layers. A saved **tension director** controls encounter pacing and permission to escalate; the creature chooses actions using its own sound/sight memory. Both run authoritatively in private worlds and on the shared host. The starting grace remains 90 simulation seconds, with active encounters restricted to night.

### Tension director

The director progresses through **Quiet → Unease → Pressure → Peak → Release**, with transitions driven by conditions and bounded durations:

| Phase | Behavior and transition |
| --- | --- |
| Quiet | Actual rest after the creature leaves, lasting 45–65 simulation seconds. This timer can begin and elapse during daylight or recovery immunity; those conditions still prevent new encounters. Fresh loud activity can begin unease after this rest. After another minute of quiet, an exposed group can receive a distant presence without a fabricated sound or sighting. |
| Unease | A safe offscreen arrival and investigation/listening. An established presence can progress after four seconds; failure to find a safe arrival ends the attempt after 15 seconds. |
| Pressure | Shadow, investigate, search, or pressure an appropriate unprotected barrier. Confirmed sight within 14 blocks can escalate after three seconds. This phase has a 30-second cap. |
| Peak | Brief pursuit opportunities with a 14-second maximum. High group pressure or depleted allowance ends the peak sooner. |
| Release | Withdraw while the current encounter finishes. Quiet/rest starts only after the creature has actually left. A knockdown immediately enters release for the group. |

Each encounter has **28 allowance points**. A pursuit burst costs four; a successful structural strike costs two. Structural pressure is capped at **12 successful strikes per encounter**, and can end earlier. The director tracks pressure per player from proximity during an encounter, bursts, structural strikes, and knockdowns; the most pressured connected teammate governs relief. These are gameplay measurements, not a measurement of human fear. Recent targeting discourages selecting the same person again, with recency measured from the latest attention rather than the first sighting; commitment prevents switching targets during a reach attempt. No age, microphone, or camera information is used.

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

Spawn positions are at least 15 horizontal blocks from **every** connected player, including downed and recovering teammates. They require loaded, supported clearance, a completed route to the sound area at its actual height or to an eligible unprotected door/panel on the approach, verified absence of ward protection, and placement outside all players' conservative 140-degree view cones. Visibility checks test head, torso, feet, and both body edges individually against the conservative view cone, so a visible extremity prevents removal even at steep camera angles. The body-edge samples prevent a narrow post from hiding the center line while a visible side of the raincoat pops into or out of view. Downed observers use the same 0.65-block camera height as the client and their current look direction. Unknown visibility cannot justify an on-screen arrival/removal. A short partial route cannot authorize arrival, including in enclosed foliage pockets or on an inaccessible floor. Arrival anchors prioritize viable exposed-player activity before loudness; protected/checking sound locations and recovering sources cannot monopolize new attempts while another teammate is exposed. A pending anchor is discarded if it becomes ineligible. Exposed work outside a ward can still draw an arrival from a protected worker when no exposed teammate takes priority. These rules only select new encounters; an existing creature still hears the complete physical noise stream. Loud indoor activity can justify arrival outside an unwarded closed house when a complete walking approach reaches a pressure-eligible boundary; it does not authorize walking through that boundary. Boundary eligibility uses the same adjacent-room protection checks as live pressure and is rechecked before arrival. Candidate rings include nearer offscreen positions that can hear a wall-muffled sound, while maintaining the 15-block minimum from everyone. Observer distance/visibility are checked while a multi-update route proof is pending and again when it finishes; a newly visible or too-close candidate cancels immediately without spending the remaining route work. No active creature teleports. A visible withdrawing creature keeps moving toward an escape rather than fading in front of a player.

Movement supports full blocks, lower/upper slabs, open two-block doors, and crouching under low ceilings. Close pursuit targets still trigger pathfinding when a height difference or solid corner prevents contact, so proximity alone cannot strand the actor. Walls and closed doors block movement; foliage blocks sight and glass permits sight while obstructing contact. Contact and rescue use physical clearance through every solid shape, including foliage and lanterns, independently of sound/sight transmission. Unknown shelter pauses entry without being treated as confirmed ward protection. Construction rejects placing a solid block or closing an occupied door frame over an active Listener before spending supplies or mutating either door half. Tree maturation similarly waits for clear space instead of growing through it. Dormant actors do not reserve world space. Removing support makes an active actor fall, using a footprint sweep of at most nine vertical cells per column per update, shared with its normal read budget. Falls land on actual block/slab surfaces and cancel reaching and structural pressure until grounded; unknown ground pauses the fall without generating terrain. Saving mid-fall preserves the position and resumes falling from rest after loading. Each movement update carries its remaining travel distance through waypoints while following each corner separately. Checks at most 0.2 blocks apart stop movement at thin swung door panels, new obstructions, and ward boundaries. If a sweep stops partway under a low ceiling, the Listener retains the required crouch pose, including while shelter verification is pending or its read budget is exhausted. Three periods of three seconds without useful movement mark failed goals and ultimately cause withdrawal; construction/streaming changes invalidate unfinished proofs and failed-goal assumptions where relevant. A completed walking detour is retained across unrelated edits/streaming and checked at each movement step; a changed target or physical/protection obstruction cancels it. Investigation can reconstruct a complete approach across bounded updates after save/reload instead of getting stuck on the nearest wall. Pursuit, shadow, search, and withdrawal also retain a bounded query when a short partial route stalls, allowing them to find a walking detour out of larger enclosures. These modes require an actual walking exit; only investigation can end its approach at a pressure-eligible boundary. Repeated escape scoring preserves a completed withdrawal route when its destination is unchanged.

The director performs normal updates at most once per simulation second, with immediate knockdown relief. Actor/perception checks normally run five times per simulation second, with at most one execution per update call. Movement and gravity use actual time accumulated since the previous executed check, capped at one second; missed checks are not replayed. Delayed or irregular updates therefore do not silently reduce travel speed while encounter timers continue. Each actor update shares a maximum of 96 expanded navigation nodes, 4,096 navigation block reads, and a 2 ms route-search target. A spatial decision examines at most 12 candidate positions, followed by bounded navigation. An unfinished spawn proof or resumed walking query retains its frontier across at most 12 actor updates, with a total limit of 768 expanded nodes and a three-second expiry. Barrier-goal queries during these searches share the same navigation block-read budget; ordinary detour comparisons still require a full walking route and never treat a barrier as passable. Section revisions invalidate guarded queries when relevant terrain is edited, unloaded, or replaced; unrelated construction preserves progress. Withdrawal queries, which can leave ward zones, conservatively invalidate on any terrain revision. Unfinished proofs are transient and revalidated after loading a save. Movement follows at most eight waypoint segments per update, sharing the same block-read limit. Each observer visibility check uses at most five body samples, and individual perception traces visit at most 96 cells. Search history is capped at 12 checked positions and eight failed goals; the noise ring holds 32 events, and director player history holds 64 records. These AI queries never generate terrain. Shelter connectivity remains the existing separate, bounded enclosure system.

Press **O** for a dedicated AI director window with live phase history, target/barrier coordinates, permissions, action scores and attack timing. The **P** performance panel also shows director phase/reason, remaining allowance, group pressure, actor decision, evidence age/confidence, and navigation/spatial-work counters. Diagnostics and performance exports omit profile tokens. The dedicated debug window includes the Listener position, target and active barrier coordinates. Discovery, search, pursuit preparation, barrier preparation, and withdrawal have distinct restrained positional foley with equivalent directional captions. Joining or returning from menus does not replay old cues. Menus keep the simulation running. During private edit checkpoints, the occupied clock and encounter AI pause together, matching the shared host. Upkeep does not mutate the world while an encounter checkpoint is pending. Slow checkpoint writes therefore cannot consume pursuit warnings, evidence lifetimes, or recovery timers while the actor is suspended.

### Knockdown, rescue, and recovery

Downed players keep all supplies. Their camera lowers and the edges darken gently, with no gore, flashing, or loud attack sting. Teammates see a downed avatar. Movement and build/supply actions are blocked by the host while down; menus do not stop the recovery timer.

Hold **H** within 2.5 blocks of a downed teammate for **three seconds** to help them up in place. Touch devices show a hold-to-help button. Rescue requires physical line of contact through every solid shape, including glass, foliage, and lanterns. The client help prompt and host validation share this same range/height/clearance check, so an obstructed teammate does not receive a misleading help prompt. Progress resets after a half-second interruption, moving out of reach, losing clearance, or disconnecting; repeated packets cannot accelerate it. The strongest individual rescue progress is shown rather than stacking multiple helpers.

If no one helps, automatic recovery returns the player to clear ground near the starter outpost after **30 simulation seconds**. Solo players and groups with nobody standing recover in **eight seconds**. Placement searches a bounded patch without removing construction and avoids other players. Full blocks and lower/upper slabs use their actual surface height, with standing body clearance; a slab-floored outpost remains a valid return point even when recovery in place is unsafe, such as in water. If the starter patch is blocked, clear space at the downed position is the fallback. Water alone does not block teammate help or this in-place fallback, so a player can stand up with immunity and swim clear; dry outpost return points are still preferred. Unknown terrain or solid overlap still prevents standing. Failed automatic return checks retry once per simulation second instead of rescanning a blocked patch every frame; retry entries are discarded on recovery or disconnect and are rebuilt after loading. Both rescue and automatic recovery grant **20 seconds** of immunity to prevent immediate repeat knockdowns. The Listener also withdraws after contact and retains its normal encounter cooldown.

Downed states, recovery deadlines, and immunity are saved per anonymous player profile (or private-world player). Rejoining does not clear them. The host rejects downed position changes and stale poses sent before a recovery correction, while accepting current-revision look updates at the frozen position. Downed players remain inactive even if a pose packet claims activity. All timers freeze when nobody is connected. Hosted state changes checkpoint before being published; browser save errors freeze private encounters for retry.

### Structural pressure

A closed door or braced timber block directly blocking the nearby route attracts a **1.1-second preparation per hit**. Pressure uses exact first-hit voxel traces along a segment of at most 1.7 blocks at two body heights, rather than scanning a building. The nearest solid shape governs eligibility, so grazing glass, lanterns, and thin swung door panels block pressure on material behind them. Search-time pressure queries use the same traces and shared navigation read budget. It also requires convincing evidence, director permission, and remaining encounter allowance; a shorter usable detour can avoid destruction. Wooden doors take one hit, braced timber four, and braced wooden doors five. Damage uses the existing saved strength, shader wear, louder positional thumps, dragging scrapes and breath layers on every Listener strike, and repair costs. Door halves break together; timber walls need both body-height blocks cleared before passage. The Listener never awards resources for destruction, damages chests, or attacks arbitrary distant structures.

A powered enclosed ward protects players and boundary doors/panels on either side. Closed interior doors still split zones, so a room without its own powered ward can remain vulnerable. Pressure pauses while enclosure status is unresolved. Unpowered barriers delay the Listener and can be repaired between hits; they eventually fail if left unprotected.

## Sound design

Effects use bundled CC0 recordings: grass, hard and wooden footsteps, wet footfalls, wood/stone movement and impacts, glass, metal, actual door movements, switches, cloth rustles, scrapes, and breathing. Recipes layer appropriate samples with small playback-rate variations, short fade edges and balanced levels. Doors and chests use wooden door recordings and wood impacts. Braced timber uses wood footsteps and strikes; stone bricks use hard footsteps and stone impacts. Breaking construction layers impact and debris; repairs use short tool strikes and a scrape. Wading remains much quieter than water-entry splashes. No MIDI notes, oscillators, or procedural noise effects are used.

Spatial audio pans with camera yaw and fades with distance. Its listener and cue/caption calculations use the actual lowered camera height while downed. Material interactions stop at 32 blocks, while restrained Listener cues have a 48-block fade. Exact voxel traces muffle sound through full walls, thin door panels, and slab geometry without loading chunks. Other players' grounded footsteps are audible nearby. Playback is capped at 16 concurrent voices and a 72-buffer cache, with four background sample decodes at a time and compression to restrain combined peaks. Late loads do not replay old movements or cues. Mute stops playback and preserves captions.

The score uses Scott Buckley's **Reverie** during the day, **The Old Ones** at night, and **The Encounter** near the Listener. The nearby threshold is 28 blocks; an existing tension mix remains until the creature is beyond 36 blocks, followed by ten seconds of release. A distant creature pursuing another player does not select tension music. Entry fades over 1.8 seconds; calm/night transitions take seven seconds. Pursuit increases the mix slightly, and audible creature cues temporarily duck music. Downed players hear a reduced music level. Three reusable streaming decks bound music memory and reuse playback positions across transitions. Loop excerpts have edited tail/head crossfades.

Options has independent music/effects levels and a music switch; settings persist in the browser. M mutes all audio. Music plays in in-world menus, stops on hidden/unfocused tabs or disconnected sessions, and resets for another world. Files are bundled in the production build and served locally with audio MIME types and byte-range streaming. Playback is unlocked by a user gesture, and missing/blocked audio never stops gameplay.

The in-game **Music & sound credits** and [audio credits](../public/audio/CREDITS.txt) identify each creator and license. Music is CC BY 4.0; effects are CC0. [Audio authoring](audio.md) covers provenance, rebuilding, and previews.

## Controls

| Action | Control |
| --- | --- |
| Move / look | WASD / mouse |
| Sprint / jump | Shift / Space |
| Break / place | Left-click / F; right-click places or interacts |
| Interact | E / right-click |
| Inventory / hotbar | E / arrow keys, scroll wheel, or 1–9 |
| Drop one / stack | Q / Shift+Q |
| Pick an owned material | Middle-click |
| Select wooden door / lantern / ward / slab / flowers | 0 / L / Shift+L / B / R |
| Menu | Escape |
| Help a nearby downed teammate | Hold H for three seconds |
| Mute / performance stats / AI director debug | M / P / O |

Touch shows a hold-to-help button near a downed teammate. It also has a movement stick, drag-to-look, Jump, Sprint, Break, Place, Use, Drop, and Menu. Open Menu → Inventory to craft and move stacks. Menus release your controls while the world keeps running. Tab navigation remains disabled; click text fields to type.

## Saves and migration

Shared edits, chest contents, structural damage, and supplies save before success is confirmed. The active clock checkpoints every five seconds, on the last disconnect, and on clean shutdown. Private worlds use browser IndexedDB and checkpoint time/position roughly every five seconds, plus saving on menu entry and leaving.

Old Gather and Creative worlds migrate to Horror when opened. Existing terrain and structures remain intact; no cabin is stamped over an old world. Gather quantities and layouts are retained, including older counter inventories. Creative hotbars become empty finite supplies because unlimited access did not represent owned items. The old held-clock setting is cleared. Keep your browser's anonymous player identity to retain access to multiplayer inventory.

The account and inventory recovery proposal remains [deferred](player-identity.md).
