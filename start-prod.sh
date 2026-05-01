#!/bin/bash
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"

# Ensure yt-dlp is available
if [ ! -f "$HOME/bin/yt-dlp" ]; then
  echo "[setup] Downloading yt-dlp..."
  mkdir -p "$HOME/bin"
  curl -sL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o "$HOME/bin/yt-dlp"
  chmod +x "$HOME/bin/yt-dlp"
  echo "[setup] yt-dlp $("$HOME/bin/yt-dlp" --version) ready"
else
  echo "[setup] yt-dlp already installed"
fi

exec PORT=5000 node server.js
