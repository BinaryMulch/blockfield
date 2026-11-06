# Player identity and inventory recovery

**Status: Deferred at the user's request on November 6, 2026.** Keep the current guest identity system for now. This proposal records future work; account implementation is not scheduled.

The goal is to let a player recover the same multiplayer inventory after clearing browser data, changing browsers, or moving to another device, while keeping inventory ownership independent of display names.

## Current behavior

Gather inventories are stored on the server, keyed by a random secret `playerToken`. The browser keeps that token in local storage under `blockfield-player-token` and sends it when joining. The host saves inventory profiles with the world. Two players with the same display name have separate inventories when their tokens differ, and simultaneous connections using the same Gather token are refused.

The connection ID changes each time someone joins; it does not determine inventory ownership. The persistent token does. Anyone possessing that token can claim its inventory, so it must remain secret.

Clearing website data, switching browsers, or using a different site address can leave the player without the token. The inventory remains on the server, but there is no automatic recovery. Creative supplies are unlimited, and Creative hotbar layouts are currently saved locally in the browser.

## Proposed account design

- Assign each player account a permanent, server-generated UUID. Display names remain changeable and do not grant inventory access.
- Require sign-in to establish ownership. Username and password sign-in is the baseline proposal; passkeys remain an option. Store password hashes using a suitable password hashing algorithm, such as Argon2id.
- Associate each Gather inventory with the account UUID and world ID. The server derives ownership from the authenticated connection rather than accepting an arbitrary inventory owner from the client.
- Use an expiring session cookie with `HttpOnly`, `Secure`, and an explicit `SameSite` policy over HTTPS. Clearing browser data signs the player out; signing in restores access to the same account and inventory.
- Provide recovery codes stored securely by the player, with hashes retained on the server. Define code replacement and account recovery before rollout.
- Back up account records, credentials, inventory ownership, and world data together so recovery preserves their associations.

## Migrating existing inventories

Allow an authenticated account to claim its existing guest inventory by proving possession of the current token. Transfer ownership atomically, preserve every stack, and prevent the token from claiming that inventory again after migration. Resolve existing account inventory conflicts explicitly rather than silently merging or overwriting items.

A player who has already lost the token cannot prove ownership through a display name. Any host-assisted recovery needs a separate verification policy. Preserve existing guest profiles while the migration and guest-access policy are decided.

## Open decisions

- Password sign-in, passkeys, or both; whether accounts need email addresses.
- Registration and host-assisted recovery rules for a family or friends server.
- HTTPS and certificate setup for the existing LAN address and port workflow.
- Whether guest play remains available and whether Creative hotbar layouts should sync to accounts.

## Acceptance checks for future implementation

Verify that matching or changed display names cannot transfer inventory ownership; clearing site data followed by sign-in restores the same items; another device can access the same account; invalid credentials or a public account UUID cannot claim an inventory; guest migration preserves items without duplication; and server restart and backup restoration preserve account-to-world inventory ownership.

## Security references

- [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
