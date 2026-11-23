#!/bin/sh
# Regenerates the Garceslab Anime TV app icons and splash from branding/logo.svg and
# branding/splash.svg. Needs rsvg-convert (librsvg). Run from anywhere:
#   sh branding/export.sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
logo="$root/branding/logo.svg"
splash="$root/branding/splash.svg"
img="$root/src/assets/images"

png() { rsvg-convert -w "$1" -h "$1" "$logo" -o "$2"; }

# LG webOS (webos/appinfo.json): icon 80x80, largeIcon 130x130, splash 1920x1080.
png 80 "$root/webos/icon.png"
png 130 "$root/webos/largeIcon.png"
rsvg-convert -w 1920 -h 1080 "$splash" -o "$root/webos/splash.png"

# Logo inside the app (navigation bar, server setup, loading screens) and the Expo icons.
png 512 "$img/logo_2.png"
png 512 "$img/icon.png"
png 512 "$img/adaptive-icon.png"
png 512 "$img/splash-logo.png"
png 256 "$img/splash.png"
png 32 "$img/favicon.png"

echo "Icons written from $logo and $splash"
