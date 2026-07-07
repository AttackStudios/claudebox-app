#!/bin/bash
# ClaudeBox launcher — double-click me!
# Starts the ClaudeBox platform on your local network (or just opens the game if
# it's already running) and prints the address friends can join from.

cd "$(dirname "$0")"

PORT="${PORT:-8787}"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"
URL_LOCAL="http://localhost:${PORT}"
URL_LAN="http://${LAN_IP}:${PORT}"

banner() {
  echo ""
  echo "  =============================================="
  echo "    ClaudeBox is up!"
  echo ""
  echo "    Play on this computer:  ${URL_LOCAL}"
  echo "    Friends on your WiFi:   ${URL_LAN}"
  echo "  =============================================="
  echo ""
}

# Already running? Just open the game.
if curl -sf -m 2 "${URL_LOCAL}/health" >/dev/null 2>&1; then
  echo "ClaudeBox is already running."
  banner
  open "${URL_LOCAL}" 2>/dev/null || true
  exit 0
fi

# First run: install dependencies.
if [ ! -d node_modules ]; then
  echo "First run — installing dependencies (one time only)..."
  npm install || { echo "npm install failed. Is Node.js installed?"; read -n 1 -s -r -p "Press any key to close..."; exit 1; }
fi

echo "Starting ClaudeBox on port ${PORT}..."
PORT="${PORT}" nohup node server/index.js >> server.log 2>&1 &
SERVER_PID=$!

# Wait for it to come up (max ~10s).
for i in $(seq 1 40); do
  if curl -sf -m 1 "${URL_LOCAL}/health" >/dev/null 2>&1; then
    banner
    open "${URL_LOCAL}" 2>/dev/null || true
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server failed to start. Last log lines:"
    tail -20 server.log
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
  fi
  sleep 0.25
done

echo "Server did not respond in time. Check server.log."
tail -20 server.log
exit 1
