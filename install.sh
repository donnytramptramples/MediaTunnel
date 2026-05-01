#!/bin/bash

echo "🚀 Setting up YouTube Client & Downloader..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python not found. Installing..."
    sudo apt-get install -y python3 python3-pip
fi

# Check for FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ FFmpeg not found. Installing..."
    sudo apt-get install -y ffmpeg
fi

# Install yt-dlp
echo "📦 Installing yt-dlp..."
sudo pip3 install -U yt-dlp

# Install Node dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Build frontend
echo "🔨 Building frontend..."
npm run build

echo "✅ Setup complete! Run 'npm start' to launch the server."