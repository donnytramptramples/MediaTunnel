#!/bin/bash
# Find node from Replit environment
NODE_PATH=$(available-pid2-node-paths 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo "")
if [ -n "$NODE_PATH" ]; then
  export PATH="$NODE_PATH:$PATH"
fi
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"

# Rebuild native modules for the Node.js version currently running
npm rebuild better-sqlite3 --silent 2>/dev/null || true

# Start the backend API on port 10000 (vite proxies to this port)
PORT=10000 node server.js &
BACKEND_PID=$!

# Start the Vite dev server on port 5000
npx vite --port 5000 --host 0.0.0.0

# If vite exits, kill the backend too
kill $BACKEND_PID 2>/dev/null
