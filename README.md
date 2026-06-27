# World Portfolio

A tile-based procedural infinite city built with the **FlameCore** engine. Inspired by [Infinitown](https://demos.littleworkshop.fr/infinitown) (pastel modular city, ambient traffic) and [Everburn Interactive](https://everburninteractive.com/) (discrete tile grid layout).

Flying ships replace cars, traveling on glowing sky-lanes above the city blocks.

## Quick start

```bash
cd "G:\Portfolio Websites\world portfolio"
npm install
npm run dev
```

Open http://127.0.0.1:5180 — drag to orbit, scroll to zoom.

## Live demo

After deployment, the site is hosted on GitHub Pages:

**https://phoenixtblaze.github.io/world-portfolio/**

Pushes to `main` rebuild and deploy automatically via `.github/workflows/deploy-pages.yml`.

## Folder layout

```
world portfolio/
  public/assets/      # Runtime-served GLBs
  src/
    main.ts           # FlameCore bootstrap
    world/            # Tile grid, ships, camera
```

## Controls

- **Drag** — orbit camera
- **Scroll** — zoom in/out

## Assets

| File | Source | Role |
|------|--------|------|
| `flying_ship.glb` | Blender (custom) | Sky traffic |
| `spire_building.glb` | Blender (custom) | Landmark tiles (~8% of grid) |

## Stack

- FlameCore runtime (private repo; cloned at build time, never committed here)
- Three.js r160
- Vite

## FlameCore setup (private dependency)

FlameCore source is **not** stored in this repository. For local development, use one of:

1. **Sibling checkout (recommended):** clone [FlameCore](https://github.com/PhoenixtBlaze/FlameCore) next to this project so `../../FlameCore` exists.
2. **Token clone:** set `FLAMECORE_PAT` to a GitHub PAT with `Contents: Read` on FlameCore, then run `npm install`.

For GitHub Pages CI, add a repository secret named **`FLAMECORE_PAT`** with the same PAT (Settings → Secrets and variables → Actions).

After changing repo visibility, confirm Pages **Source** is **GitHub Actions**, not "Deploy from a branch".

## License notes

Custom Blender assets are project-owned. Third-party downloads must respect their CC licenses (attribution in credits when shipping).
