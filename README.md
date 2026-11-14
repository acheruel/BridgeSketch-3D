# BridgeSketch 3D

**Try it online:** [acheruel.github.io/BridgeSketch-3D](https://acheruel.github.io/BridgeSketch-3D/)

A quick visual tool for bridge concepts · Version 0.7.3 · 13 November 2026 · Anthony Chéruel

BridgeSketch 3D is an interactive 3D bridge configurator that runs in the browser. Choose the spans, the deck, the supports and the site, then look at the result from above, from below or along the obstacle being crossed. It produces concept and presentation geometry, not structural design.

![The BridgeSketch 3D workspace](screenshots/workspace.webp)

## Features

- **Bridge systems:** steel plate girders, NEBT precast girders, steel and concrete boxes, solid slabs, frames, arches and steel truss footbridges.
- **Geometry:** curves, skew, crossfall, vertical profiles, lane directions, wall, hammerhead, bent, portal and V piers, abutments with return or wing walls.
- **Site:** rivers, roads, railways, vegetation, seasons, weather and time of day, or a real terrain imported from [QuickerAtlas](https://acheruel.github.io/QuickerAtlas/) (Québec), with a second bridge on the same site.
- **Views:** 3D, plan, elevation and section, plus a drive under the bridge.
- **Files:** save and open JSON or a complete project, share a link, export PNG, SVG, GLB and IFC (2x3, 4, 4.3), or send the bridge to [QuickerBridge](https://acheruel.github.io/QuickerBridge/) for a quick girder-line analysis.

## Use

Open the link above in a recent desktop browser (WebGL 2). Drag to orbit, right-drag to pan, scroll to zoom. The parameters are on the left (numeric fields accept formulas such as `=12*3`, Ctrl+Z undoes); the views, the time of day and the scene menu (weather, season, quality) are in the top-right corner.

To host it yourself, serve this repository with any static web server.

## License and credits

[MIT License](LICENSE) · © 2026 Anthony Chéruel. Third-party assets keep their own licences (CC0 or MIT):

- **Kenney** (CC0): Train Kit, City Kit Suburban and City Kit Commercial.
- **Poly Haven, ambientCG, OpenGameArt** (CC0): concrete, asphalt, grass, bark and water textures.
- **MIT:** [Three.js](https://github.com/mrdoob/three.js), [EZ-Tree](https://github.com/dgreenheck/ez-tree), CK42BB procedural stars and grass, Tw1ddle Sky-Shader.

Full credits: [models](models/SCENE_CREDITS.md), [vehicles](models/VEHICLE_CREDITS.md), [textures](textures/CREDITS.md).
