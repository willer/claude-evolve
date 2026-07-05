#!/usr/bin/env bash
# Render assets/icon.svg -> assets/icon.png (1024) and assets/icon.icns with a
# TRANSPARENT background. The SVG draws a rounded panel on a transparent canvas;
# earlier PNG/ICNS exports had a white background baked in (opaque corners),
# which macOS shows as a white square behind the icon. rsvg-convert preserves
# the SVG alpha channel; iconutil packs the multi-resolution .icns.
#
# Requires: rsvg-convert (brew install librsvg), iconutil (macOS).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$(cd "$SCRIPT_DIR/../assets" && pwd)"
SVG="$ASSETS/icon.svg"
PNG="$ASSETS/icon.png"
ICNS="$ASSETS/icon.icns"

command -v rsvg-convert >/dev/null 2>&1 || {
  echo "error: rsvg-convert not found (brew install librsvg)" >&2
  exit 1
}
command -v iconutil >/dev/null 2>&1 || {
  echo "error: iconutil not found (macOS only)" >&2
  exit 1
}
[[ -f "$SVG" ]] || {
  echo "error: missing $SVG" >&2
  exit 1
}

# 1024x1024 master PNG, transparent background (rsvg default).
rsvg-convert --width 1024 --height 1024 "$SVG" --output "$PNG"
echo "wrote $PNG"

# Build a .iconset by rendering each required size straight from the SVG
# (crisper + preserves alpha better than downscaling the raster).
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
render() { # size filename
  rsvg-convert --width "$1" --height "$1" "$SVG" --output "$ICONSET/$2"
}
render 16 icon_16x16.png
render 32 icon_16x16@2x.png
render 32 icon_32x32.png
render 64 icon_32x32@2x.png
render 128 icon_128x128.png
render 256 icon_128x128@2x.png
render 256 icon_256x256.png
render 512 icon_256x256@2x.png
render 512 icon_512x512.png
render 1024 icon_512x512@2x.png

iconutil --convert icns "$ICONSET" --output "$ICNS"
rm -rf "$(dirname "$ICONSET")"
echo "wrote $ICNS"
