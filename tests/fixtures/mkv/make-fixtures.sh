#!/usr/bin/env bash
# Regenerates tests/fixtures/mkv/ for the direct-play spike's MKV subtitle tests:
# 60 s of testsrc (H.264), two AAC tracks (jpn, eng), a Spanish ASS track and an
# English SRT track (ffmpeg), then mkvmerge remuxes with a font attachment, zlib-compressed
# subtitles, no subtitle cues, and no cues at all. Needs ffmpeg and Docker (mkvtoolnix runs
# in an Alpine container; this PC's Docker has no DNS of its own, hence --dns).
# subs_es.ass, subs_en.srt and Test.ttf (3000 random bytes) are kept in the folder.
set -euo pipefail
cd "$(dirname "$0")"

ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i testsrc=size=160x90:rate=12:duration=60 \
    -f lavfi -i sine=frequency=440:duration=60 \
    -f lavfi -i sine=frequency=880:duration=60 \
    -i subs_es.ass -i subs_en.srt \
    -map 0:v -map 1:a -map 2:a -map 3 -map 4 \
    -c:v libx264 -preset veryfast -crf 45 -g 24 -c:a aac -b:a 16k -ac 1 -c:s:0 ass -c:s:1 srt \
    -metadata:s:a:0 language=jpn -metadata:s:a:0 title="Japanese" \
    -metadata:s:a:1 language=eng -metadata:s:a:1 title="English" \
    -metadata:s:s:0 language=spa -metadata:s:s:0 title="Español (ASS)" \
    -metadata:s:s:1 language=eng -metadata:s:s:1 title="English (SRT)" \
    -disposition:s:0 default ffmpeg-sample.mkv

docker run --rm --dns 1.1.1.1 -v "$PWD":/w -w /w alpine:3.20 sh -c "
    apk add --no-cache mkvtoolnix >/dev/null &&
    mkvmerge -q -o mkvmerge-sample.mkv --attachment-mime-type font/ttf --attach-file Test.ttf ffmpeg-sample.mkv &&
    mkvmerge -q -o mkvmerge-zlib.mkv --compression 3:zlib --compression 4:zlib ffmpeg-sample.mkv &&
    mkvmerge -q -o mkvmerge-nosubcues.mkv --cues 3:none --cues 4:none ffmpeg-sample.mkv &&
    mkvmerge -q -o mkvmerge-nocues.mkv --no-cues ffmpeg-sample.mkv &&
    chown $(id -u):$(id -g) *.mkv"
