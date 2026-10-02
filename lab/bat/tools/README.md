# lab/bat — how the pieces are made

Everything the page loads is checked in; these scripts only need re-running when the logo or the live copy changes.
Run them from `lab/bat/`.

1. `python tools/trace.py` — traces `assets/img/logo.png` into `src/emblem.json` (outline + the three letter holes)
   and bakes `assets/relief.webp` (the normal map for the emblem's faces). Needs `opencv-python-headless`, `numpy`, `Pillow`.
2. `python tools/blocks.py` — pulls the exact copy and markup this page reuses from the live `index.html`
   (H1, story, craft, the price block, the sticky bar), builds the flat SVG emblem and the craft photo.
3. `python tools/build.py` — writes `index.html`.
4. Bundle the 3D emblem (`src/bat3d.js` + `earcut` + `src/emblem.json`) into `js/bat3d.min.js`:

       npm i earcut@3 esbuild        # anywhere outside the repo
       esbuild src/bat3d.js --bundle --minify --format=iife --target=es2018 --outfile=js/bat3d.min.js

   No 3D library: one mesh, one shader, ~9 KB gzipped.
