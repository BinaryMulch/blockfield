#!/bin/zsh
set -e
cd -- "${0:A:h}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print 'Install Node.js 22.12+ from https://nodejs.org, then open this launcher again.'
  read '?Press Return to close.'
  exit 1
fi

if [[ ! -d node_modules/ws || ! -d node_modules/vite || ! -d node_modules/three ]]; then
  npm ci
fi

print 'Hosting Blockfield. Friends can join using the Wi-Fi link shown below.'
print 'Keep this window open and your Mac awake while you play together.'
print 'Press Control+C here to stop the game server.'
npm run dev -- --open
