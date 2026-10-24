# Publish BridgeSketch 3D on GitHub Pages

The GitHub Pages archive contains the static site. The [BridgeSketch 3D repository](https://github.com/acheruel/BridgeSketch-3D) uses these files at the root of `main`; its live address is [acheruel.github.io/BridgeSketch-3D](https://acheruel.github.io/BridgeSketch-3D/). Application scripts are grouped in `modules/` and supporting documents in `docs/`. Packaging by itself does not push changes.

1. Extract the archive. Copy its **contents** into your repository root so `index.html`, `modules/`, `docs/`, `vendor/` and `textures/` are at the top level. Include the `.nojekyll` file. When updating a release older than this layout, move its application `.mjs` files into `modules/` and its tracking documents into `docs/`, then replace them with the current files.
2. Commit these files to your `main` branch and push them to GitHub.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, select **main** and **/ (root)**, then Save.
5. Wait for GitHub's Pages deployment to finish and open the URL shown there, normally `https://YOUR-NAME.github.io/YOUR-REPOSITORY/`.

No npm install, build command, paid API, server backend or secret is required. Asset paths are relative, including the Three.js import map, so repository subpaths work. Use a modern desktop browser with WebGL 2 enabled.

GitHub Pages availability depends on the repository's visibility and your GitHub plan. The repository's Pages settings show the options available to you.

Official instructions: [Publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [Creating a Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Offline use of this same package

On Windows, double-click `OPEN_OFFLINE.cmd`. The included PowerShell launcher serves this folder at `http://127.0.0.1:5174/`; keep its window open. No installation or internet connection is needed. Do not open `index.html` directly with `file://`, because browser module restrictions prevent that mode.

The separate offline archive has the same app files under `dist/`. Both packages retain editable parameters through Save/Open JSON. A share link from localhost works only on a computer running the same local server; use your published Pages address when sharing publicly.

## Updating

Replace the runtime files and asset folders with those from a later release, retaining `.nojekyll`. Configuration JSON files belong outside the application folder and do not need to be uploaded. Check the displayed version after a hard refresh.

BridgeSketch 3D · a quick visual tool for bridge concepts · Anthony Chéruel.
