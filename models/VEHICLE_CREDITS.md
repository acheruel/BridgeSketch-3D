# Vehicle models

Since 0.6.6 the cars, SUVs, pickups, vans, box trucks and tractors are procedural models written for
BridgeSketch 3D (`modules/car-models.mjs`, MIT like the rest of the app): lofted bodies with real wheel arches,
greenhouses with tumblehome, alloy wheels, light clusters, grilles and mirrors, at about 7 000 to 11 000
triangles per vehicle. The semi-trailer, the double (train routier) trailers and the cyclists are procedural too
(`modules/vehicles.mjs`).

Earlier versions (0.5 to 0.6.5) used Car Kit 3.1 by Kenney (CC0 1.0, https://kenney.nl/assets/car-kit). Kenney's
Train Kit and City Kits are still used for the trains and the shelved urban setting (see SCENE_CREDITS.md); their
licence is retained in KENNEY-LICENSE.txt.

All meshes are generated locally. There are no external asset requests at runtime.
