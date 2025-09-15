#!/bin/bash

# RecipeBox Electron Setup Script
echo "🍳 Setting up RecipeBox Electron..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js (v18 or higher) first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Build the app
echo "🔨 Building the application..."
npm run build:electron

if [ $? -ne 0 ]; then
    echo "❌ Failed to build the application"
    exit 1
fi

echo "✅ Application built successfully"

echo ""
echo "🎉 Setup complete! You can now:"
echo "   • Run in development: npm run electron-dev"
echo "   • Build for macOS: npm run dist:mac"
echo "   • Build for other platforms: npm run dist:win or npm run dist:linux"
echo ""
