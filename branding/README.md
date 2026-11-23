# Branding

`logo.svg` is the single source of the Garceslab Anime logo: a placeholder "GA" monogram
drawn with plain strokes (no fonts, no third-party artwork), licensed GPL-3.0 like the rest
of the repository. `splash.svg` is the webOS launch screen (the same drawing plus the name).
To change them, edit or replace the SVGs and run:

```sh
sh branding/export.sh   # needs rsvg-convert (librsvg)
```

It rewrites the webOS icons and splash (`webos/icon.png` 80×80, `webos/largeIcon.png`
130×130, `webos/splash.png` 1920×1080) and the logo used inside the app
(`src/assets/images/`). The Android TV and tvOS images in `src/assets/images/tv/` are not
generated (those platforms aren't targeted).
