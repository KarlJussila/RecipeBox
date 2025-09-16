#!/bin/bash

# Icon creation script for RecipeBox Electron
echo "🎨 Creating icons for RecipeBox Electron..."

# Check if iconutil is available (macOS only)
if ! command -v iconutil &> /dev/null; then
    echo "❌ iconutil not found. This script requires macOS."
    exit 1
fi

# Check if the source icon exists
if [ ! -f "assets/icon.png" ]; then
    echo "❌ Source icon not found: assets/icon.png"
    exit 1
fi

# Create iconset directory
mkdir -p assets/icon.iconset

# Create different sizes for the iconset
echo "📐 Creating icon sizes..."

# 16x16
sips -z 16 16 assets/icon.png --out assets/icon.iconset/icon_16x16.png
sips -z 32 32 assets/icon.png --out assets/icon.iconset/icon_16x16@2x.png

# 32x32
sips -z 32 32 assets/icon.png --out assets/icon.iconset/icon_32x32.png
sips -z 64 64 assets/icon.png --out assets/icon.iconset/icon_32x32@2x.png

# 128x128
sips -z 128 128 assets/icon.png --out assets/icon.iconset/icon_128x128.png
sips -z 256 256 assets/icon.png --out assets/icon.iconset/icon_128x128@2x.png

# 256x256
sips -z 256 256 assets/icon.png --out assets/icon.iconset/icon_256x256.png
sips -z 512 512 assets/icon.png --out assets/icon.iconset/icon_256x256@2x.png

# 512x512
sips -z 512 512 assets/icon.png --out assets/icon.iconset/icon_512x512.png
sips -z 1024 1024 assets/icon.png --out assets/icon.iconset/icon_512x512@2x.png

# Create the .icns file
echo "🔨 Creating .icns file..."
iconutil -c icns assets/icon.iconset -o assets/icon.icns

# Clean up iconset directory
rm -rf assets/icon.iconset

# Create .ico file for Windows
echo "🔨 Creating .ico file for Windows..."
sips -s format ico assets/icon.png --out assets/icon.ico

echo "✅ Icons created successfully!"
echo "   • assets/icon.icns (macOS)"
echo "   • assets/icon.ico (Windows)"
echo "   • assets/icon.png (Linux)"
