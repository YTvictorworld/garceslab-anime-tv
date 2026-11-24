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

# multisub.mkv: like an Erai-raws MultiSub release. 10 s of testsrc, one AAC track and nine
# ASS tracks whose CodecPrivate is ~45 KiB each (400 styles), so Tracks is ~400 KiB, far past
# the parser's first 128 KiB read; IETF languages (es-419, es-ES, pt-BR...), names, a font.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i testsrc=size=160x90:rate=12:duration=10 -f lavfi -i sine=frequency=440:duration=10 \
    -map 0:v -map 1:a -c:v libx264 -preset veryfast -crf 45 -g 24 -c:a aac -b:a 16k -ac 1 "$tmp/base.mkv"
for lang in eng spa419 spaES por fre ger ita ara rus; do
    {
        printf '[Script Info]\nTitle: %s\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\n' "$lang"
        printf 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
        printf 'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1\n'
        for i in $(seq -w 0 399); do
            printf 'Style: Sign%s%s,Arial,%d,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1\n' "$lang" "$i" $((40 + 10#$i % 30))
        done
        printf '\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
        for k in 0 1 2 3 4; do
            printf 'Dialogue: 0,0:00:0%d.50,0:00:0%d.50,Default,,0,0,0,,%s line %d\n' $((k * 2)) $((k * 2 + 1)) "$lang" $((k + 1))
        done
    } > "$tmp/$lang.ass"
done
cp Test.ttf "$tmp/"
docker run --rm --dns 1.1.1.1 -v "$tmp":/w -w /w alpine:3.20 sh -c "
    apk add --no-cache mkvtoolnix >/dev/null &&
    mkvmerge -q -o multisub.mkv --language 0:ja --language 1:ja --track-name 1:Japanese base.mkv \
        --language 0:en --track-name 0:English eng.ass \
        --language 0:es-419 --track-name 0:'Spanish (Latin America)' --default-track-flag 0:no spa419.ass \
        --language 0:es-ES --track-name 0:'Spanish (Spain)' --default-track-flag 0:no spaES.ass \
        --language 0:pt-BR --track-name 0:'Portuguese (Brazil)' --default-track-flag 0:no por.ass \
        --language 0:fr --track-name 0:French --default-track-flag 0:no fre.ass \
        --language 0:de --track-name 0:German --default-track-flag 0:no ger.ass \
        --language 0:it --track-name 0:Italian --default-track-flag 0:no ita.ass \
        --language 0:ar --track-name 0:Arabic --default-track-flag 0:no ara.ass \
        --language 0:ru --track-name 0:Russian --default-track-flag 0:no rus.ass \
        --attachment-mime-type font/ttf --attach-file Test.ttf &&
    chown $(id -u):$(id -g) multisub.mkv"
cp "$tmp/multisub.mkv" .
