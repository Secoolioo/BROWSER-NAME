# Brand assets

`app-icon.svg` is the source of the application icon: a window split by a lightning bolt, for
speed and split views. Its colors are the light accent tokens of the UI kit.

`app/build/icon.png` is rendered from it at 1024 × 1024 px by `node tools/brand/render-icon.ts`.
electron-builder derives the Windows, macOS and Linux icons from that file. Render it again after
every change to the SVG and commit both files.
