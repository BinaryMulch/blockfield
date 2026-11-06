# Setup and everyday use

Use **Node.js 24**, npm, and Git. On Linux, nvm is suitable for the terminal workflow; see its [installation instructions](https://github.com/nvm-sh/nvm#installing-and-updating). Confirm `node --version` reports `v24.x.x` and `npm --version` works.

## First start: Mac or Linux

Run in a terminal:

```sh
git clone https://github.com/BinaryMulch/blockfield.git
cd blockfield
npm ci
npm run build
npm start
```

Open `http://localhost:6200/` on the host, or `http://VM-IP:6200/` from another computer. Replace `VM-IP` with the VM's address. Allow TCP 6200 through the VM firewall for your home network; the Mac must be able to reach the VM.

Choose **Single player** for a private browser world or **Multiplayer** for the server's shared world. `http://VM-IP:6200/?join=1` joins multiplayer directly. New worlds default to Gather.

Keep the terminal open while hosting manually. **Ctrl+C** saves and stops the server. For local development, `npm run dev` serves live code changes. On a Mac, the included **Play Blockfield.command** launcher also starts development hosting.

## Simple updates

Stop a manually running server with Ctrl+C, then run from the project folder:

```sh
git pull --ff-only
npm ci
npm run build
npm start
```

The build step is required after pulling frontend changes. Refresh players' browsers after updating. Keep your existing `data/` directory; it is ignored by Git. `npm test` runs the game/server tests.

## Start automatically on Linux

The following matches the current family VM: **root**, repository at **`/root/blockfield`**, and Node installed through **nvm**. The separate [advanced guide](../deploy/LINUX.md) covers an unprivileged `/opt/blockfield` installation instead.

Stop any manual server with Ctrl+C. Run `command -v node` in the VM terminal to find the full Node executable path. Open the service file:

```sh
nano /etc/systemd/system/blockfield.service
```

Paste **only this configuration** into the file. The Node path below matches the current `v24.22.2` installation; replace it with the output of `command -v node` if different. Use literal absolute paths in this file, not shell expressions such as `$(pwd)` or an `EOF` line.

```ini
[Unit]
Description=Blockfield game server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/blockfield
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=6200
Environment=DATA_DIR=/root/blockfield/data
ExecStart=/root/.nvm/versions/node/v24.22.2/bin/node /root/blockfield/server.js --production
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Save in nano with **Ctrl+O**, Enter, then **Ctrl+X**. Run in the terminal:

```sh
systemctl daemon-reload
systemctl enable --now blockfield
systemctl status blockfield --no-pager -l
```

Status should show **active (running)**. The service starts after reboot and keeps running after you disconnect. View logs with `journalctl -u blockfield -f` (Ctrl+C exits the log viewer).

Update a service-managed server with:

```sh
cd /root/blockfield
systemctl stop blockfield
git pull --ff-only
npm ci
npm run build
systemctl start blockfield
systemctl status blockfield --no-pager -l
```

Use `systemctl stop blockfield` to stop it, and `systemctl restart blockfield` to restart it. Do not also run `npm start` while the service is using port 6200. If the Node executable path changes, update `ExecStart`, run `systemctl daemon-reload`, then restart the service.

## Saves, backups, and settings

- Default shared saves: `data/world.json` and `data/world.json.bak` inside the project. `.bak` holds the previous checkpoint.
- Before backing up or restoring the data folder, stop the server. Copy the folder somewhere separate, then start the server again.
- Single-player saves stay in each browser, not on the VM. Use **Export backup / Import world backup** to move them between browsers or site addresses.
- Shared Gather inventories are tied to an anonymous identity in the browser's website data. Display names do not identify inventories; clearing website data can lose access to those items.
- Check `http://VM-IP:6200/healthz` for server/save health; it should report `"ok": true`.

Settings are environment variables. For manual starts, prefix `npm start` with them; for systemd, add `Environment=...` lines and reload/restart the service.

| Variable | Default / purpose |
| --- | --- |
| `PORT` | `6200` |
| `HOST` | `0.0.0.0` (listen on network interfaces) |
| `DATA_DIR` | Project's `data/` folder; a different directory creates a separate shared world |
| `WORLD_NAME` | `Blockfield Together` |
| `WORLD_SEED` | `Blockfield` |
| `GAME_MODE` | `gather`; choose `creative` for unlimited supplies |

Name, seed, and mode initialize **new** server worlds only. Existing saves restore their own settings. One server may write to a given save directory at a time. No automatic release/update pipeline is required.

### Set the game mode on the VM

For the root-based VM installation above, edit `/etc/systemd/system/blockfield.service` directly. This setup does not load `/etc/blockfield.env`; that file belongs to the separate advanced installation.

Under `[Service]`, add:

```ini
Environment=GAME_MODE=gather
```

To create a separate Gather world, replace the existing `DATA_DIR` line with a new directory:

```ini
Environment=DATA_DIR=/root/blockfield/data-gather
```

The previous world stays in `/root/blockfield/data`. Changing `GAME_MODE` alone does not convert an existing saved world. Apply service-file changes with:

```sh
systemctl daemon-reload
systemctl restart blockfield
```
