# World Portfolio

An example project by [Everburn Interactive](https://everburninteractive.com/) showcasing real-time 3D web craft and the **FlameCore** browser engine.

Explore a tile-based procedural infinite city: modular blocks, ambient traffic, and flying ships on glowing sky-lanes above the streets. The demo draws from the mood of [Infinitown](https://demos.littleworkshop.fr/infinitown) and Everburn’s discrete tile-grid approach, built as a live portfolio piece rather than a static reel.

## Live demo

**https://phoenixtblaze.github.io/world-portfolio/**

- **Drag** — orbit the camera
- **Scroll** — zoom in and out
- **F** — follow a ship
- **Esc** — release follow

## What this demonstrates

**Everburn Interactive**

- Procedural tile streaming and city layout
- Custom Blender-authored buildings, props, and vehicles
- Ship and car traffic systems with intersection-aware flow
- Polished loading, atmosphere, and orbit camera presentation

**FlameCore**

- Runtime scene bootstrap and render loop
- Asset loading and instanced world content
- Component-driven lighting integration for authored GLB materials
- Production build and GitHub Pages deployment pipeline

## Stack

FlameCore, Three.js, and Vite — deployed to GitHub Pages from this repository.

## Credits and attributions

Third-party 3D models appear in the shipped GLBs under `public/assets/`. Licenses below reflect the terms on each model's Sketchfab page at the time of download.

### Required attribution

These models use Creative Commons licenses that require credit when reused:

| Model | Author | License | Used in this demo |
| --- | --- | --- | --- |
| [Sci-Fi Food Processor/Sorter](https://sketchfab.com/3d-models/sci-fi-food-processorsorter-5653434e7c3e45c2b2c0e465b74adde1) | [Adelaide Essex](https://sketchfab.com/Adelaide_Essex) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `portal_lab` landmark (`Platform`, `Portal`, `Flying_Robot` meshes) |
| [Simple Tessellation glass dome](https://sketchfab.com/3d-models/simple-tessellation-glass-dome-8baa1add858a49e2ab76b01ec0baa17c) | [Metaversalarts (@rogerbootsma)](https://sketchfab.com/rogerbootsma) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `observatory_dome` landmark |

Suggested attribution lines (TASL):

- *Sci-Fi Food Processor/Sorter* by [Adelaide Essex](https://sketchfab.com/Adelaide_Essex) ([Sketchfab model](https://sketchfab.com/3d-models/sci-fi-food-processorsorter-5653434e7c3e45c2b2c0e465b74adde1)), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- *Simple Tessellation glass dome* by [Metaversalarts (@rogerbootsma)](https://sketchfab.com/rogerbootsma) ([Sketchfab model](https://sketchfab.com/3d-models/simple-tessellation-glass-dome-8baa1add858a49e2ab76b01ec0baa17c)), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

### Courtesy credits (Sketchfab Free Standard)

These models use Sketchfab's Free Standard license, which does not legally require attribution. We credit the authors because their meshes ship in the demo:

| Model | Author | Used in this demo |
| --- | --- | --- |
| [Time Machine](https://sketchfab.com/3d-models/time-machine-a11c6d625e3f46dca26d6e4c4edf2a79) | [vertexmonster](https://sketchfab.com/vertexmonster) | `timemachine.glb` and default `landmark.glb` hero buildings |
| [Free Sci-fi Houses](https://sketchfab.com/3d-models/free-sci-fi-houses-169a7638b2ca427daae43c2bc2367eb7) | [MarkoJantti / GameAssetsFin](https://sketchfab.com/MarkoJantti) | Residential house pool (`House1.glb` through `House4.glb`) |

### Public domain (CC0) — no attribution required

[Unity Fan (@unityfan777)](https://sketchfab.com/unityfan777) dedicates these models to the public domain. Attribution is optional; we list them as a courtesy.

| Model | Used in this demo |
| --- | --- |
| [FREE Sci-Fi City (CC0)](https://sketchfab.com/3d-models/free-sci-fi-city-public-domain-cc0-b353532235bb4c45afeac578187c9be1) | Apartment and office building variant pool (`building_*.glb`, 32 variants) |
| [FREE Sci-Fi LODs set 004 (CC0)](https://sketchfab.com/unityfan777/models) | Street traffic vehicles `city_car_03`, `city_car_04`, and `city_car_05` |
| [FREE Sci-Fi Panel 004 (CC0)](https://sketchfab.com/3d-models/free-sci-fi-panel-004-public-domain-cc0-eb90ad6a3d3b42fbac0d6ff2ad9b1bfc) | Shop tile door panel mesh (`Shop_Door_SciFi_panel_004_a`) |

### Everburn Interactive original work

Authored or assembled for this project by Everburn Interactive:

- Flying ship traffic model (`flying_ship.glb`)
- Street traffic vehicles `city_car_01` and `city_car_02`
- Hero tile buildings (shop, park, civic, industrial, apartment, office, small house, and related props)
- Park and plaza props, street furniture, and foliage variants
- Landmark assemblies `relay_station` and `landing_pad`

### Inspiration (no assets reused)

Procedural city mood references [Infinitown](https://demos.littleworkshop.fr/infinitown) and Everburn's tile-grid approach. No Infinitown assets are included in this repository.
