# BridgeSketch 3D

## 0.6.3 — 2026-10-25 — Anthony Chéruel

Source : page Notion « Bridge Sketch 3D version 0.6.3 ».

- Écran de lancement : l'image `intro-bridge.png` est remplacée par un dessin SVG intégré, fidèle à l'original (travées dans les proportions 0,8-1-0,8, poutres à hauteur variable avec une zone de hauteur constante sur les piles, chevêtre étroit, sans cotes de proportion). Le pont sert de barre de chargement : un croquis clair se trace, puis le pont plein se remplit de gauche à droite au rythme du chargement, avec une progression lente entre les étapes. Les transformations sont composées par le GPU, donc l'animation continue pendant la construction de la scène. Le balayage en boucle, qui faisait sortir le dessin de l'écran puis revenir, est supprimé. Mise en page centrée et mise à l'échelle selon la largeur et la hauteur de l'écran. « 3D » est aligné sur la ligne du titre. Un onglet ouvert en arrière-plan commence aussi à charger (délai maximal de 100 ms au lieu d'attendre le premier affichage).
- Profil en long : déplacé de « Model info » vers le menu File (« Road profile… », dialogue). Ajout des coordonnées en plan X, Y des points, à partir d'un point de référence X0, Y0 à l'axe Ouest et du gisement de l'alignement à cet axe (degrés depuis le nord, sens horaire ; 90° par défaut = vers +X). On distingue ainsi un tracé courbe d'un tracé droit. Points pris sur la ligne de profil (ligne de crête). Colonnes X et Y dans le tableau et le CSV, et ligne de référence en tête du CSV. Les champs acceptent les formules et sont mémorisés dans le navigateur.
- Arbres : le feuillage des trembles (« Aspen », texture d'origine jaune) est recoloré en vert en été et sous la neige ; l'automne garde sa palette.
- Hébergement : plus d'exigence hors-ligne, GitHub Pages est la voie principale (README, AGENTS, HANDOFF, GITHUB_PAGES mis à jour). Le lanceur local `OPEN_OFFLINE.cmd` reste disponible.
- Prototypes (non intégrés) : eau de rivière (d'après web-ocean et Seascape) et ciel atmosphérique (Hillaire 2020 / Bruneton). Comparaison A/B et mesures dans `Claude outputs/prototypes-0.6.3/index.html`, scripts dans `tmp/prototypes/`. Recommandation : intégrer le ciel atmosphérique ; pour l'eau, ne reprendre que quelques éléments.
- Tests : coordonnées X, Y (tracé droit à 90°, 0° et 135°, tracé courbe dans les deux sens), nouvelles colonnes du CSV.

## 0.6.2 — 2026-10-16 — Anthony Chéruel

Source : page Notion « Bridge Sketch 3D vers 0.6.2 ».

- Nuit : plus d'ombres portées (l'intensité d'ombre du soleil suit la lumière du jour ; la carte d'ombre n'est plus recalculée quand elle est nulle).
- Vue 3D : titre et sous-titre retirés du coin supérieur gauche.
- Culées : le siège, le mur garde-grève, les murs en retour et les cache-poutres partagent un même parement extérieur (75 mm en retrait du bord du tablier) ; ils formaient des marches de 75 à 100 mm.
- Chevêtres effilés : un fût sous la partie effilée monte jusqu'au point le plus haut de la sous-face sur sa largeur (vide d'environ 75 mm côté extérieur auparavant).
- Poutres peintes : occlusion de la lumière ambiante sous le tablier (les poutres recevaient tout le ciel, d'où des couleurs vives et plates), légère perte de chroma et poussière.
- Performance : « Reveal structure » ne masque plus les PointLights des lampadaires (le changement du nombre de lumières recompilait tous les shaders, ≈ 1,5–2 s ; maintenant ≈ 30 ms). Semis d'herbe indexé par grille (reconstruction ≈ 35 % plus rapide). Véhicules en mouvement sans ombre solaire (carte d'ombre statique au lieu de 11 Hz) ; temps qui s'écoule : ombres toutes les 2 s, éclairage du ciel toutes les 4 s. Données Kenney réduites de 1,7 à 0,75 Mo.
- Arbres : touffes de feuillage (k-moyennes sur les rameaux EZ-Tree, cartes croisées à normales de houppier), bosquets denses par champ de bruit, arbustes de sous-bois ; budget 260 / 380 / 520 arbres selon la qualité.
- Trains procéduraux à l'échelle (`modules/trains.mjs`) : fret avec locomotive diesel 6 essieux de 22,3 m, wagons couverts, trémies, citernes et porte-conteneurs ; intercity avec locomotive profilée et voitures inox de 25,9 m ; automotrice de banlieue (voitures de 19–20 m, pantographes baissés). Remplacent le Train Kit Kenney.
- Profil en long : tableau chaînage / élévation dans « Model info » (pas de 5 m par défaut, 0 m à l'axe Ouest = parement du mur de front de la culée Ouest, élévation 30,000 m par défaut à cet axe, axes des piles et extrémités) et export CSV (séparateur point-virgule, virgule décimale).
- Tests : `node check.mjs` couvre le profil et les trains ; deux tests périmés depuis 0.6.1 corrigés (NEBT sans hauteur variable, ancien fini « rough »).

## 0.6.1 — 2026-10-10 — Anthony Chéruel

Source : page Notion « BridgeSketch3D 0.6.1 update ».

- Interface façon QuickerBridge : jetons de couleur (marine, sarcelle, ambre, fond #f0f4f7), champs à libellé au-dessus avec états survol/focus/erreur, sous-sections pliables (`<details>`) toutes repliées au démarrage avec un résumé de valeur.
- Formules dans les champs numériques (`=2*17,4`, `(12+3)/2`, `pi`, `^`), analyseur sûr sans `eval`, flèches ↑/↓ (Maj ×10), erreur affichée sous le champ sans modifier le modèle.
- Menu Fichier : Ouvrir (Ctrl+O), Enregistrer (Ctrl+S), Annuler (Ctrl+Z), Rétablir (Ctrl+Y / Ctrl+Maj+Z) ; historique de 100 états, indicateur « • Modified », sauvegarde locale automatique avec proposition de restauration.
- Option « Dock below » retirée. Onglet Site réorganisé : Crossings by span, Terrain, Surroundings, River, Sky & weather, Rendering ; les autres onglets sont découpés en sous-sections plus courtes.
- Véhicules : peinture vernie (clearcoat) et palette réaliste, vitres teintées, remorques et bandes de livrée assorties, ombre de contact douce, inclinaison sur le dévers, garde-boue, coffres de toit / galeries ; géométries partagées et semi-remorques fusionnées (moins d'appels de dessin).
- Oiseaux : silhouettes de goélands à ailes articulées (poignet), vols battus/planés, inclinaison en virage, 6 groupes, ombrage dessus/dessous et brume ; option « Birds » (un seul appel de dessin).
- Serveur hors ligne : en-tête `Cache-Control: no-cache` pour charger les modules à jour après une mise à jour.
- README raccourci (deux captures).
- Cases « Orbit » et « Golden hour » retirées de la vue (le curseur d'heure reste).
- Bloom (« Glow ») désactivé par défaut pour tous les exemples. Correctif : la cible du bloom n'appliquait ni tone mapping ni sRGB, puis le composite appliquait ACES + sRGB à toute l'image, y compris au ciel, aux étoiles, aux oiseaux et à la météo, dont les shaders écrivent déjà des couleurs d'affichage. Le ciel était donc délavé vers le blanc. La cible est maintenant rendue comme l'écran et le bloom s'ajoute en espace d'affichage (seuil 0,82).
- Exemples revus pour des arrangements réalistes : travées de rive ≈ 0,75–0,8 des travées intérieures ; rivière d'été 28/36/42/36/28 m sur piles-murs arrondies ; caissons acier courbes 34/46/42/30 m sur hammerheads ; arc à tirant de 45 m ; viaduc 40 + 6 × 50 + 40 m à hauteur constante ; béquilles 30/70/30 m ; arc de 100 m avec accès de 20–22 m ; passage supérieur NEBT 1600 de 2 × 36 m.

### Notes Notion du 2026-10-01 (incluses dans 0.6.1)

- NEBT : plus d'option de hauteur variable (masquée dans l'interface, forcée à `false` à la validation).
- Béton : couleur d'origine retirée, libellés « Cool grey » / « Warm pale grey » sans « reference » ; gris froid par défaut pour les 7 concepts (les anciens liens `rough` passent en gris froid).
- Performance : l'édition d'un paramètre ne montre plus le logo de chargement ni ne précompile les shaders (réservé au changement de modèle). Cause du gel corrigée : le semis d'herbe (~40 000 touffes) est mis en cache tant que le terrain ne change pas, et ses tests de hauteur/appuis utilisent des boîtes englobantes.
- Piles : extrémités des murs arrondies, en pointe ou carrées ; hammerhead à fût rectangulaire, à côtés arrondis ou évasé (congé courbe), tête effilée (épaisseur au fût / en bout) ; portique à poteaux carrés/rectangulaires inclinés (traverse optionnelle) ; pile en V avec ou sans chevêtre.
- Rendu : bloom léger à chaîne de mips (technique Call of Duty / Unreal), MSAA 4× conservé, vignettage discret ; actif en Balanced et High, désactivable (« Glow »).

## 0.6.0 — revue du 2026-09-29, publiée le 2026-09-30

Source : uniquement la page Notion « BridgeSketch 3D 0.6.0 — Compte rendu 2026-09-28 puis commentaires 2026-09-29 ».

- Couronne : sommets ajoutés à la ligne centrale sur les deux faces de dalle; épaisseur conservée, goussets de 20 à 120 mm et blocs d'assise variables (minimum 100 mm). Libellé « Center line ». Début d'effilement du chevêtre réglable.
- SDC : 17 barrotins par intervalle de 3 m, grille continue entre travées et éclairage sous la main courante.
- Site : option de murs TSM à panneaux pour les deux approches; herbe sur le terrain vague et les talus. Train routier de 4,15 m de haut, sélectionné moins souvent.
- Rendu : couleurs de béton gris froid et gris chaud, cartes PBR conservées; chaussée mouillée moins réfléchissante. Les deux modèles de ciel restent disponibles.
- Interface : logo visible avant reconstruction, dimensions d'obstacles ouvertes et focus de saisie conservé, Blue studio, bandeau aminci, Focus plein écran sur desktop/mobile.
- Introduction : image pré-rendue animée par CSS en boucle de 2 s jusqu'à disponibilité de la scène. Temps deux fois plus lent, zoom plus proche, pan plus sensible.
- Sept exemples couvrent plusieurs systèmes, 1 à 8 travées, pluie/neige/automne/été, tailles de terrain et heures variées. Modules JavaScript regroupés dans `dist/modules/`; lancement et contrôles hors ligne adaptés.

Rapport et captures locaux : `Codex outputs/Compte-rendu-BridgeSketch-0.6.0-2026-09-30.md`. Publication : [3cfd498](https://github.com/ACFakkoh/BridgeSketch-3D/commit/3cfd498a2493f0da0d98669b1aa8a35487218ddc). Le dépôt regroupe 24 modules dans `modules/` et les documents de suivi dans `docs/`; la racine passe de 36 à 9 fichiers. Le déploiement GitHub Pages est réussi et les fichiers publiés correspondent à cette version.

## 0.6.0 — 2026-09-28 — Anthony Chéruel

Directives Notion « Bridge Sketch 3D fix and features for 0.6 »:

- Deck crossfall: crown with 2 % on each side of an adjustable crown line (default: deck centreline), or a uniform 2 / 3 / 4 % crossfall to the left or right (or flat). Slab, asphalt, curbs, barriers, railings, lights, vehicles, approaches, return-wall and backwall tops follow it; each girder is set rigidly at its own level with level haunches, bearings, seats, diaphragms and bracing adapted. The section shows the crossfall arrows and the crown line.
- Every girder bridge (steel and NEBT) is continuous over the piers by default.
- NEBT: haunches cover the full 1200 mm top flange (3D and section); cast-in-place intermediate diaphragms per MTQ Table 8.2-4 (none up to 15 m, one up to 30 m, two up to 45 m, one per 15 m, equally spaced).
- Girder screens (cache-poutres) at the abutments: a concrete wall under each deck edge from the seat to the slab (option, on by default for girder bridges).
- Bent caps: linear taper from the outer column face to the end thickness.
- Railings: new architectural railing « Samuel-De Champlain » (2.4 m, leaning 12° outwards, round top rail, handrail, balusters, white-grey paint); posts at 3000 mm on one grid along spans and approaches; the bridge railings always continue to the end of the return walls (then W-beam, continued railings or nothing); no asphalt under approach wheel curbs and barriers (concrete strip, pavement stops at the curb face).
- Markings: optional solid double yellow line between directions (deck and two-way crossing roads).
- Crossing roads: 2 % crown from the centreline, carriageway 0.5 m above the ground, 1 m gravel shoulders, 3H:1V slopes to 0.3 m drainage ditches. Two or more crossing roads form a divided highway: one direction per carriageway (right-hand traffic), yellow left edge line, dashed white lane line.
- New obstacle « Open ground » (terrain vague): no crossing, a gently rolling surface at the span elevation blended into the neighbouring terrain.
- New vehicle: double (train routier) with a long-nose tractor and two pup trailers, 18.0 m from the steer axle to the last axle, 4.8 m high.
- Sky: seeded procedural starfield (≈ 4 200 stars, blackbody colours, twinkle, hidden by clouds and daylight) and a faint Milky Way, after CK42BB/procedural-stars-threejs (MIT). Optional physical sky (Preetham scattering, after Tw1ddle/Sky-Shader, MIT); the tuned stylised sky stays the default.
- Grass: three species after CK42BB/procedural-grass-threejs (MIT) — meadow, tall sedges and reeds with cattails on the wet river banks, dry bunch grass on slopes and dry patches — with tapered, pointed blades; slightly lower tuft budget.
- Concrete finish: rough (existing), smooth formwork (plywood panel joints and tie holes) or weathered (runoff streaks, patina, lichen), procedural in the shader.
- Snapshot: camera icon; rendered once at up to 3840 px (×3 max) with a 4096 px shadow map, full-resolution reflection and the dense meadow, saved as a lossless PNG with the viewport vignette.
- Phones and tablets: the 3D view on top with a fixed aspect, the parameters below; compact scrolling toolbars; camera framing adapted to the smaller overlays.
- Low-cost visual touches: soft CSS vignette, a flock of 18 birds by day (one instanced draw call, GPU-animated), glowing head and tail lamps after dusk, wet (glossier) asphalt and concrete in the rain.
- New concept: « Highway overpass · NEBT » (divided highway and open median, crown, double yellow line, formwork concrete, tapered caps, girder screens).
- Checks: `node check.mjs` covers crossfall, continuity, haunch width, MTQ diaphragm counts, girder screens, linear cap taper, SDC railing, the post grid, approach curbs, open ground, crowned roads and ditches, the divided highway and the double truck.

## 0.5.6 — 2026-09-27 — Anthony Chéruel

- Orbit is off by default, at start-up and when a concept is selected.
- Time runs by default: 15 minutes every 5 seconds by day, three times faster at night (wall-clock, lighting re-applied twice a second); a ❚❚ / ▶ button next to the slider stops or restarts it. The setting is saved (`timeFlow`). Concepts open at 18:00.
- Daylight follows the sun elevation (sunrise 06:30, sunset 19:30): golden hour when the sun is low (peak about 19:05, **Golden hour** = 19:00), then blue hour and night lights from 20:00. The scene no longer brightens again after golden hour.
- Profile-following terrain: the river meanders (about ±6 m) with irregular shorelines, varying berms and valley sides; valley walls undulate away from the bridge.
- Prestressed concrete box girders: 1 to 4 single-cell boxes under one deck slab (at least 4.2 m of deck per box), two bearings and a diaphragm per box on each support line, dimensioned in the section. The Box girder viaduct concept now has twin boxes under a 16.5 m, four-lane deck.
- Stats overlay moved to the bottom centre (the navigation hint hides while it is shown).

## 0.5.5 — 2026-09-27 — Anthony Chéruel

Directives « Bridge Sketch 3D directives 2026-09-27 V2 suite »:

- Fixes: smaller trees (5–10.5 m), no open strip in the approach pavement next to a sidewalk protected by a Type 301 barrier on the bridge (the protection continues only with continued railings), street lights hidden with **Reveal structure**, author name on the launch sequence.
- Street lights: 12 m tapered poles with a transformer base and a single upswept davit arm reaching 3.0 m, curved lower brace and struts, flat LED head; instanced (three draw calls for all poles).
- Barriers: MTQ Type 311 (880 mm, 460 mm base, 275 mm top) and Type 311 A+B with a 200 × 150 mm steel rail 400 mm above the concrete on posts at 2.4 m, in 3D and in the section.
- Structural systems: prestressed concrete box girder; rigid frame (portique) with monolithic supports; strutted frame with inclined legs (béquilles); concrete or steel deck arch with spandrel columns; tied arch with leaning ribs, hangers and wind bracing. Five new concepts: Box girder viaduct, Strutted frame, Concrete deck arch, Steel tied arch, Rigid frame.
- Site: autumn season (tree colours, straw meadow, fallen leaves) and falling-leaves weather; terrain that follows the road profile with 2H:1V valley slopes parallel to the abutments and crossings; moving cloud shadows; water marks on piers in the river.
- Performance: Balanced by default; new Auto quality (GPU guess, then steps down under 24 fps); tree levels of detail (far kit ≈ 450 triangles per tree), distance-thinned meadow in culled 32 m tiles, sun shadows redrawn only when needed, ambient animation capped at 30 fps, reflection refreshed every other frame when the camera is still, lower pixel-ratio caps; shaders compiled before the first frame and a compositor-only launch drawing; Stats overlay with fps, CPU and GPU time (timer query), draw calls and triangles. WebGPU lab page (`lab/webgpu-meadow.html`) with meadow and rain in TSL compute shaders.

## Non publié — correctifs du 2026-09-27 — Anthony Chéruel

- Defaults for every preset: dynamic clouds, calm mirror river, High quality, atmospheric haze (optional, tinted by the hour).
- Deck: MTQ Type 201 / 301 concrete barriers, 301 barrier in front of a sidewalk, 450 × 280 wheel curbs and 280 mm sidewalks with a 35/280 road face and 1 % crossfall; 200/225/250 mm slab; dashed lane lines (yellow between directions); approach barriers: none, continued railings or W-beam (pedestrian bridges: none or curb + 20C).
- Structure: support diaphragm or K-bracing from girder depth and spacing (MTQ Table 10.5-1); rectangular columns and adjustable outer column spacing; adjustable front-slope start; paint colour calibrated to the swatch.
- Site: EZ-Tree procedural trees (MIT), denser meadow (Balanced = former High) continuing under the deck, uniform soil cut faces on all edges, 0.5 m crushed-stone railway ballast (clearance above ballast), random train mix; scene width up to 600 m and approaches up to 200 m.
- Street lights on the left, right or both sides; separate finish for fascia (edge) girders; a launch sequence under 5 s (self-drawing blueprint elevation, wordmark, real progress, curtain lift and camera fly-in; click or key to skip).
- Night lighting (LED street lights or 20C handrail LEDs, 20:00–06:30), light rain and snow, zoomable section view (SVG button removed).

## Non publié — R&D rendu — 2026-09-26 — Anthony Chéruel

- River: half-resolution planar reflection, PBR Fresnel, tileable generated wave normals flowing downstream, depth-based tint, shoreline foam and sun glints; the water plane runs under raised banks so the terrain draws a natural shoreline.
- Meadow: budgeted instanced tufts (7 curved blades) with GPU wind, root-to-tip gradient, up-facing normals and golden-hour back-lighting, denser near the bridge; small wildflowers in rural scenes. Adapted from three-stylized (MIT) ideas.
- Sky: sunset scattering gradient, sun halo and sun-lit clouds; the sky is captured as image-based lighting on each time change and is now the viewport backdrop (except on the white background).
- New Render quality setting (Performance / Balanced / High) for reflection resolution, meadow density, shadow map size and pixel ratio.

## 0.5.0 — 2026-09-26 — Anthony Chéruel

Follow-up of 2026-09-26 (evaluation items 2–6):

- Transverse section with dimension chains (deck zones, total width, girder spacing, structure depth) and a title block (variant, version, date, author).
- Light atmospheric haze sized to the model and tinted by the hour; river with Fresnel depth and roughness (no noon blow-out), shallow banks and foam line; meadow tinted wetter near water, drier on slopes, lawn-like in urban scenes; grey bank boulders.
- Internal 25 mm plate diaphragms inside every steel box on each bearing line.
- Code: sources formatted (Prettier, 120 columns); `scene.mjs` split into `materials`, `sections`, `steel-details`, `railings`, `traffic` and `terrain` modules; developer checks now in the repository as `tests/check.mjs`; `.gitattributes` normalises line endings.
- README screenshots regenerated with 0.5.0, adding the cycle footbridge and the dimensioned section.

Review round of 2026-09-26 (version number kept at 0.5.0):

- Deck: 65 mm asphalt now covers the roadway only; sidewalks, wheel curbs, concrete barriers and medians stand on the slab. Steel railings on a raised sidewalk are anchored in the sidewalk without a wheel curb. The ends of curbs, barriers and every swept solid are closed with outward-facing concrete faces.
- Steel plate girders: cross-frames at 8 m or less in every span, deep transverse diaphragms (web + flanges) on every bearing line at abutments and piers, 14 mm vertical stiffeners following the local depth and the skew — on interior faces at cross-frames, and three at 150 mm on every face at bearings. Box girders get diaphragms but no stiffeners.
- Steel boxes: the bottom flange now drives box width, gaps and cantilevers instead of being rejected; top flanges stay straight and parallel where the box deepens at supports (webs 1H:4V at typical depth, steeper in the haunches).
- Supports: 75 mm bearings sit on constant 150 mm plinths; pier caps, pier walls and abutment seats follow the plinth undersides across the deck. Tapered bent-cap ends are closed and textured.
- Front-of-abutment slopes are 2H:1V from the abutment face to the ground and share the toe line of the quarter cones for any span, obstacle or variable girder depth; when the crossing leaves too little room the slope starts lower on the wall. New procedural 200–300 mm riprap texture for stone slopes and cones.
- Spans up to 150 m, curve radii down to 30 m (at least deck half-width + 12 m), deeper girders (up to 5 m typical, 8 m at supports). Shadows adapt to the model size.
- Deck haunch fixed at 50 mm and removed from the parameters.
- Finishes: AMS 15090 blue removed (old files map to 15065); AMS 16515 light gray (#C7C9C7) added for a Pont Saint-Jacques look.
- Named variants: the name appears in the viewer title and in JSON, snapshot, SVG and GLB file names with the save date and software version (e.g. `BridgeSketch-Option-A_2026-09-26_v0.5.0.json`).
- Cyclists rebuilt with a diamond frame, spoked wheels, drop bars and a leaning rider; wheels, cranks and legs animate with the distance travelled.
- Transverse section: 15 × 15 mm chamfers on concrete outlines, asphalt limited to the roadway, medians drawn, curb-less sidewalk railings and dashed stiffeners. Time and view overlays hide in section view; scene titles gain a stronger shadow for legibility.

Initial 0.5.0 release (2026-09-25):


- Added a cycle-traffic mode with moving low-poly cyclists and a one-span cycle-footbridge preset.
- 3–6 m cycle decks accept one narrow lane, two to four steel plate girders, or one steel box; the 3 m and 6 m extremes are covered by geometry checks.
- Added optional procedural cloud sky and reflective river finish. Clouds follow the time-of-day lighting and drift during animation; both options work offline with no additional runtime packages.
- Tuned sunset gradients and river glints after browser visual checks. Kept the existing instanced meadow and foliage textures after comparing proposed grass, water and cloud packages against the scene budget.
- Recorded library, performance and licensing decisions in `TASKS.md`; GitHub publication follows local checks and the Notion R&D report.

## 0.4.3 — 2026-09-24 — Anthony Chéruel

- Concrete haunches now match their 500 mm steel top flanges, including both moving flanges of variable-depth box girders.
- Each inclined box web starts at the corresponding edge of the bottom flange. Automatic box layout sizes the bottom plate to preserve the 1H:4V web slope at maximum depth.
- Steel-railing wheel curbs keep a vertical outer face and an inclined road-side face, as in the supplied drawings. Their concrete edges retain 15 mm chamfers; the transverse SVG section shows the same shape.
- Concrete facing in front of an abutment no longer changes the separately selected grass or stone approach-cone finish.
- Skewed, curved approach asphalt reaches the full model cut width; the grass-covered rear closure spans both embankment slopes.
- Added `TASKS.md` to track verified fixes, publication and subsequent R&D work.

## 0.4.2 — 2026-09-24 — Anthony Chéruel

- Backwall and return-wall tops follow the actual road profile under skew and curves; concrete edges receive 15 mm chamfers.
- Bent caps can vary in depth at their ends; wall and hammerhead caps match their support thickness.
- Variable-depth steel and concrete girders and concrete slabs retain a 400 mm constant section over bearings, including single spans with deeper abutment ends.
- Steel boxes use two 500 × 50 mm top flanges; a single box and a pedestrian-only deck with zero lanes are supported.
- Independent left and right railings: concrete, HSS 210A / 210C, or 20C pickets. Steel railings sit on trapezoidal 450 × 280 mm concrete curbs, with posts at 3 m. Optional traffic-side sidewalk protection is available.
- Optional 2H:1V front-of-abutment slopes and quarter-cone stone facing, using a bundled CC0 Poly Haven rock texture. Approach fills reach the terrain cut and have closed grass-covered ends.
- Bracing follows support skew; trains use the right-hand track for their direction of travel.
- New station-adjustable transverse deck section view with SVG export. Traffic controls moved beside Reveal structure.
- Girder colours use the selected AMS-STD-595 screen swatches: 10045, 14109, 16314, 15056, 15065, 15090 and 11086, with a custom hex option.
- Removed Midnight mode. The time slider blends daylight continuously through dusk; Golden hour restores the warm 0.3 lighting values.

## 0.4.1 — 2026-09-23 — Anthony Chéruel

- Return walls follow the approach road's vertical profile and horizontal alignment, including skewed supports and curved crests.
- Midnight scene and dark controls, available from the time slider or Midnight button; night views persist in saved concepts, links and snapshots.
- CC0 Poly Haven rough-concrete colour, normal and roughness maps replace the generated concrete surface; steel paint colours are more restrained.
- Steel girders accept a colour picker and validated six-digit hex code, preserved in JSON, links and exports.

## 0.4.0 — 2026-09-22 — Anthony Chéruel

- Railway consists now vary reproducibly from 4 to 12 cars; full-length trains enter and leave the visible railway corridor.
- Live 06:00–20:00 daylight slider moves the sun and shadows; Golden hour remains the 17:30 default and can be restored with one click.
- Editable steel-box bottom flange width preserves 1H:4V web inclination; Reveal structure now hides concrete deck haunches.
- Kenney trains face their direction of travel, with one train per crossing and a gap between appearances.
- Snow terrain mode, wider configurable site width (140 m default), and more detailed meadow-grass texture.
- Three selectable local Kenney Train Kit consists (diesel freight, bullet and city passenger), plus four Kenney suburban/commercial buildings in urban scenes.
- CC0 water colour and ripple-normal textures improve rivers without network requests.
- Steel boxes now allow 2–14 girders, including odd counts. Box width and overhang are laid out together, keeping twin boxes under the deck with a realistic gap.
- Replaced the abstract app icon with a legible bridge-over-water logo.
- Golden hour, orbit and moving right-hand traffic now start enabled. Moving traffic remains optional.
- Six curated bridge concepts; all curated concepts use return walls; wingwalls remain optional.
- Locally bundled CC0 Kenney cars and trucks with dedicated automotive materials replace the old generated shapes and concrete-textured trucks.
- Editable lane width (3.5 m default) and continuous white boundaries at every lane edge, on the bridge and approaches.
- Editable bent-cap width along the road and vertical thickness.
- Richer grass colour, texture and instanced blades, more distinctive green/weathered steel, improved golden-hour/day lighting and detailed steel angle bracing with gussets and bolts.
- Trees and buildings stay out of the zones between adjacent road and rail crossings.
- English GitHub README with screenshots and matching GitHub Pages/offline packages.

## 0.3.1 — 2026-09-21 — Anthony Chéruel

- Drive now follows the road, river or railway in the span nearest the bridge midpoint, approaching and passing beneath the bridge while keeping it in view.
- River tours follow the rendered joined river and its meanders. Road and railway tours follow the actual crossing alignment and level.
- Crossing-road traffic is hidden temporarily; bridge traffic stays visible. Stop/Escape restores the previous camera.

## 0.3.0 — 2026-09-21 — Anthony Chéruel

- Embankment crests move back until the foremost 2H:1V quarter-cone toes meet the actual skewed abutment plane. Curved approaches extend tangentially, preventing tall fills from looping into the span. Retaining-wall lengths follow the fill setback.
- Blue studio or pure-white backgrounds, retained in JSON, share links and snapshots.
- Centre concrete barrier or raised sidewalk/island. Median centres account for side sidewalks; lane placement, markings, width validation and vehicle exclusion share the same layout.
- Seven vehicle silhouettes and seven paint colours, with shaped cabins, mirrors, lights, rims, pickup beds and articulated trailers.
- Driver’s-eye tour at 30 km/h: follows the actual forward lane and grade, hides bridge traffic temporarily and restores the prior view on Stop/Escape.
- Updated offline and GitHub Pages packages, using local assets and relative URLs.

## 0.2.0 — 2026-09-17 — Anthony Chéruel

- New name, bridge logo and navy/teal workspace consistent with QuickerBridge.
- Model, Deck, Structure, Supports and Site tabs; optional bottom dock and full-view Focus mode. Statistics moved into Model info.
- Revised daylight, concrete and asphalt contrast. Steel finish colours use #2B3A5B, #77A662, #435468 and #9A6436 without a dark diffuse texture masking them.
- Steel boxes accept exactly 2 or 4 per span. Four continuous plates form each hollow box; sampled parabolic haunches replace capped staircase segments. Side webs retain 1H:4V inclination.
- Variable-depth slabs use the actual transverse position at skewed supports, keeping the haunch centred on the pier line.
- Square or round bent columns, with editable side length/diameter.
- Approach fills meet the terrain at 2H:1V, with 90° conical end slopes at bridge corners.
- Three rectangular HSS rails with hollow posts, base plates and bolts. Roadside guards use a folded W-beam section with posts and stand-offs.
- Lane centres and vehicle orientation follow right-hand traffic. Sidewalks remain 200 mm thick and vehicles are excluded from them.
- Urban mode omits trees. Full tree/building extents clear the bridge, approaches and crossings.
- Version, date and author in the header and About dialog; saved JSON includes release metadata.
- Matching offline and GitHub Pages archives; no runtime network dependencies or build step.
