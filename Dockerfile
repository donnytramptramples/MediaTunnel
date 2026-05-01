FROM node:22-slim

# Install system dependencies, Puppeteer libs, and Docker CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    build-essential \
    docker.io \
    # The following are required for Puppeteer/Chrome to run in slim images:
    libgbm1 libasound2 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Download yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
# Increased timeout for npm ci to prevent hanging on slower networks
RUN npm ci --include=dev --network-timeout=100000

COPY . .
RUN npm run build

RUN npm prune --production

EXPOSE 8080

ENV NODE_ENV=production

CMD ["node", "server.js"]
