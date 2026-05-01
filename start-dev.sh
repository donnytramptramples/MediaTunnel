#!/bin/bash
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"

# Ensure yt-dlp is available
if [ ! -f "$HOME/bin/yt-dlp" ]; then
  echo "[setup] Downloading yt-dlp..."
  mkdir -p "$HOME/bin"
  curl -sL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o "$HOME/bin/yt-dlp"
  chmod +x "$HOME/bin/yt-dlp"
  echo "[setup] yt-dlp $(\"$HOME/bin/yt-dlp\" --version) ready"
fi

# Start backend on port 10000 (matches Vite proxy config)
PORT=10000 node server.js &
BACKEND_PID=$!

# Start Vite dev server on port 5000
npx vite --port 5000 --host 0.0.0.0

# If vite exits, kill the backend
kill $BACKEND_PID 2>/dev/null
