# Run Blockfield on a Linux VM or a Mac

The same Node.js server runs on both platforms. It serves the browser game and multiplayer WebSocket connection on one TCP port, **6200** by default. Players can create a private browser world or join the host's shared world from the start screen.

## Prebuilt server package (no build tools needed on the VM)

On your Mac, from the project folder:

```sh
npm run package:server
```

Copy `release/blockfield-server.tar.gz` to the VM using your usual file transfer. On the VM, with Node.js 24 LTS (or Node.js 22.12+) and npm installed:

```sh
tar -xzf blockfield-server.tar.gz
cd blockfield-server
npm ci --omit=dev
npm start
```

Open `http://VM-IP:6200/` on your Mac. The VM needs a reachable network address: use bridged networking or forward TCP 6200 if it uses NAT. Allow that port through the VM's firewall for your local network if needed. No graphics card, display server, or browser is needed on the VM.

The package contains the already-built frontend, including its terrain worker. Install dependencies on the VM rather than copying your Mac's `node_modules` directory. If you copy the full source instead of the prebuilt package, use `npm ci`, `npm run build`, then `npm start`.

Choose a shared-world name, terrain seed, and port using environment variables:

```sh
WORLD_NAME="Family world" WORLD_SEED="our-forest" DATA_DIR=/path/to/world-data PORT=6200 npm start
```

`HOST` defaults to `0.0.0.0`. Set it to a specific interface address if desired. `DATA_DIR` defaults to `data/` next to `server.js`; use an absolute path outside the extracted program folder to keep saves separate from software updates. `WORLD_SEED` and `WORLD_NAME` apply only when that folder has no saved world. Existing saves always restore their own seed and name. Use a different data directory for a separate world.

New server worlds default to `gather` for limited inventories and simple crafting. Set `GAME_MODE=creative` to create a world with unlimited supplies. Like the seed, the mode is saved with the world and only applies to a new data directory; existing worlds keep their saved mode (older worlds are Creative). For example, after building:

```sh
GAME_MODE=gather DATA_DIR=./data/gather PORT=6201 npm start
```

Each Gather player's stacks, backpack, hotbar layout, and selection save on the server with the world. An anonymous browser token reconnects that player to their supplies; it stays in the browser's website data. Player names do not grant access to inventories. Back up the complete server save directory to retain all players' supplies. Refresh clients after updating because multiplayer now uses protocol 4. Older Gather material counters migrate into the new 36-slot inventory on load, with all owned quantities retained.

**Saving is enabled.** Shared worlds are saved to `world.json` and `world.json.bak` inside the data directory. Building edits and time-control changes are flushed to disk before clients receive success. The clock is checkpointed every five seconds; clean shutdown makes a final checkpoint. Worlds restore after process or machine restarts. Active chunk caches are regenerated on demand.

Private worlds save to IndexedDB in each player's browser and appear in its saved-world library. They do not occupy server disk space. The same browser and site address are required to see that library; use Export/Import to move worlds to another browser or address. Personal player positions and time are saved; undo/redo history is not carried across reopening.

## Keep the native server running with systemd

The included service assumes the package is installed in `/opt/blockfield` and the `node` executable is `/usr/bin/node`. Check `command -v node` and adjust `ExecStart` if necessary. A typical installation after extracting the package is:

```sh
sudo useradd --system --user-group --home-dir /opt/blockfield --shell /usr/sbin/nologin blockfield
sudo mkdir -p /opt/blockfield
sudo cp -R . /opt/blockfield/
cd /opt/blockfield
sudo npm ci --omit=dev
sudo chown -R blockfield:blockfield /opt/blockfield
sudo cp deploy/blockfield.env.example /etc/blockfield.env
sudo cp deploy/blockfield.service /etc/systemd/system/blockfield.service
sudo systemctl daemon-reload
sudo systemctl enable --now blockfield
```

Edit `/etc/blockfield.env` before starting if you want a different seed or name. On a system where the `blockfield` user already exists, skip `useradd`. Run the copy command from the extracted package directory, not from inside `/opt/blockfield` itself.

Useful commands:

```sh
sudo systemctl status blockfield
sudo journalctl -u blockfield -f
sudo systemctl stop blockfield
```

`deploy/blockfield.service` runs as an unprivileged user and restarts on failure. Its `StateDirectory=blockfield` creates a writable `/var/lib/blockfield` directory, and `DATA_DIR` points there. Saves remain separate from the application files in `/opt/blockfield`. If migrating an existing world, stop the service, copy `world.json` and its backup into `/var/lib/blockfield`, and ensure the `blockfield` user owns them before restarting. See the [systemd service documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) for adapting it to your distribution.

## Docker alternative (full source checkout)

The repository includes a multi-stage `Dockerfile` and `compose.yaml`. They use the [official Node.js image](https://hub.docker.com/_/node/) and run the server as its unprivileged `node` user. Docker is optional; the prebuilt Node package above works without it.

From the source folder on the VM:

```sh
docker compose up --build -d
docker compose logs -f
```

Compose exposes port 6200. Optional variables can be supplied in a `.env` file next to `compose.yaml`:

```dotenv
BLOCKFIELD_PORT=6200
WORLD_NAME=Family world
WORLD_SEED=our-forest
GAME_MODE=gather
```

Stop it with `docker compose down`. The `blockfield-data` named volume keeps saves at `/app/data` across container rebuilds and restarts. Ordinary `down` preserves the volume; `docker compose down -v` deletes it and its saved world. `restart: unless-stopped` keeps the server running. The prebuilt tarball is for native Node hosting; use the full source folder for Docker builds.

## Backups, restoration, and upgrades

Stop the host and copy its data directory somewhere safe before upgrading. Copy saves separately from the application package; do not discard or overwrite the data folder when extracting a new server release. To move a world between your Mac and VM, stop both hosts, copy `world.json` and `world.json.bak` to the destination data directory, then start the destination host. Do not copy the `.world.lock` or `.world.reclaim` files.

The host writes through a temporary file and atomic rename. If `world.json` is damaged it tries the valid `.bak` checkpoint and logs recovery. If both files are damaged or incompatible it refuses to start rather than generate a new world over them. Preserve both files when diagnosing recovery. A previous backup may be one checkpoint behind the main save.

A data directory has one writer. Normal shutdown removes `.world.lock`; a lock belonging to a dead process is reclaimed on restart. If a lock is unreadable or refers to a live process, the host stops. A `.world.reclaim` file briefly guards recovery; a crash during recovery can leave it behind. Only remove stale lock or recovery files manually after verifying no host is using that data directory.

For Docker backups, stop the container, copy or back up its named volume, then restart it. A bind-mounted data directory is also possible, but it must be writable by the image's `node` user (UID 1000).

## Health and joining

`GET /healthz` returns `ok`, current player count, active chunk count, whether disk saving is enabled, and the last saved timestamp. It returns HTTP 503 if saving fails. Fix full disks or permissions and restart the host; unsaved edits are not acknowledged or broadcast. `GET /api/session` returns world metadata and available local join addresses. The app serves no project source files in production mode.

Players can press **P** for performance stats. `GET /api/performance` supplies process CPU (100% = one logical core), process memory, event-loop activity, server tick/checkpoint timings, player count, and loaded chunks. It does not expose world contents, filesystem paths, or environment settings. CPU covers the whole Node process, including Vite in development; use `npm start` for production comparisons. The panel polls only while open and the tab is visible. See the README for metric definitions and browser limitations.

Open the root URL to choose single player or multiplayer. An invite ending in `/?join=1` joins that host directly. You can enter a different server address on the start screen; the browser navigates to that host so assets and multiplayer use the same origin. If you later place the app behind HTTPS, the browser automatically uses secure WebSockets; the reverse proxy must forward WebSocket upgrades and preserve the Host header.

iPhone/iPad players use the same URL. Touch controls are chosen automatically and do not request mouse capture. Choose a world and tap Play, then use the movement stick and drag the world to look. When hosting on a Mac, phones must use the Mac's LAN address rather than `localhost`, and be on a network that can reach it.

This remains a cooperative game for a trusted local network, with eight multiplayer slots and no accounts. It is not configured as a public internet service.
