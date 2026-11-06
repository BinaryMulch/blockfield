# Current features

## Worlds and multiplayer

- Seeded **512 × 512** worlds, 24 blocks high, with hills, lakes, trees, and flowers.
- Nearby chunks load as you explore; distant chunks unload.
- Private single-player worlds with a saved-world picker and JSON export/import.
- Shared multiplayer worlds for **up to eight players**, with avatars, names, and reconnect support.
- Walking, jumping, sprinting, flying, and half-block step climbing.
- Shared day/night cycle, sunlight/shadows, moon, stars, and time controls.

## Building and inventory

- **Gather (default):** start empty, collect blocks by breaking them, and spend items when placing them.
- **Creative:** unlimited building supplies and a searchable material palette.
- Gather inventory has **27 backpack slots + 9 hotbar slots**, with up to **64 items per stack**. Multiple stacks of the same material are allowed.
- Left-click moves, combines, or swaps stacks. Right-click takes half or places one. Shift-click transfers between backpack and hotbar. Hover or focus a slot and press 1–9 to swap with a hotbar slot.
- Closing inventory returns held items to their source slot. Multiplayer stores each player's Gather stacks and layout on the server.
- Grass, dirt, stone, wood, leaves, sand, planks, bricks, glass, doors, lanterns, wooden slabs, and three flower varieties.
- Doors open/close; slabs can merge into planks; lantern light is blocked by opaque walls and closed doors.
- Undo/redo covers block edits and fixtures. Gather undo/redo also transfers the corresponding supplies; unavailable items or conflicting edits prevent the action.
- Procedural pixel textures, placement/breaking sounds, footsteps, and block particles.

Choose a recipe in inventory, then click **Make**:

| Ingredients | Result |
| --- | --- |
| 1 wood | 4 planks |
| 4 stone | 4 bricks |
| 2 sand | 1 glass |
| 6 planks | 1 door |
| 3 planks | 6 wooden slabs |
| 4 stone + 1 wood + 1 glass | 1 lantern |

## Desktop controls

| Action | Control |
| --- | --- |
| Move / look | WASD / mouse |
| Sprint / jump | Hold Shift / Space |
| Fly / rise / descend | V / Space / C |
| Break / place | Left-click / F or right-click |
| Select hotbar / inventory | 1–9 / I |
| Pick an owned material / use door | E / Q |
| Quick-select door / lantern / slab / flowers | 0 / L / B / R |
| Undo / redo | Z / Shift+Z or Y |
| Pause / release mouse | Escape |
| Hold time / skip to next time of day | T / N |
| Mute sound / performance stats | M / P |

Gather picking and quick selection only use items you own. In Creative they can assign unlimited materials. I returns from inventory to play when opened during play; Escape returns to the pause menu.

## Graphics and saves

- FPS limits: **30, 60, or 120**. Render resolution: **50%, 75%, or 100%**. Desktop defaults: 60 FPS / 100%.
- Performance panel includes FPS, frame timings, rendering/worker statistics, and host CPU/RAM. Reports can be exported.
- Shared world edits, crafting, inventory transfers, and manual time changes save before success is confirmed. The advancing clock saves every five seconds; clean shutdown makes a final save.
- Private worlds save in browser IndexedDB. Building/inventory changes save immediately; position and time checkpoint about every five seconds, and pausing/leaving also saves.
- Older Gather material counters migrate to stack inventories. Existing worlds retain their mode; older worlds remain Creative.

## Current scope

This is a cooperative sandbox for trusted family/friend play. There are no accounts, combat, health, hunger, mobs, or dropped-item pickups. Water is still, and worlds have finite boundaries. Undo/redo history resets after reopening/reconnecting. Keep the same browser profile and site address to retain access to private worlds and your multiplayer inventory identity.
