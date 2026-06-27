/**
 * World Portfolio — tile-based procedural city with flying ship traffic.
 */

import {
  Actor,
  CameraComponent,
  EnvironmentComponent,
  LightComponent,
  Runtime,
  Scene,
  TransformComponent,
  makeCameraProps,
  makeEnvironmentProps,
  makeLightProps,
  makeTransformProps,
} from '@runtime/index';
import * as THREE from 'three';
import { LoadingScreen } from './LoadingScreen';
import { AssetCatalog } from './world/AssetCatalog';
import { VehicleCatalog } from './world/VehicleCatalog';
import { initBlenderAssetLighting } from './world/blenderAssetLighting';
import { CarTraffic } from './world/CarTraffic';
import { OrbitCamera } from './world/OrbitCamera';
import { ShipTraffic } from './world/ShipTraffic';
import { SkyAtmosphere } from './world/SkyAtmosphere';
import { SnowSystem } from './world/SnowSystem';
import { ASSET_BASE, TILE_SIZE, computeTileRadius } from './world/config';
import { TileWorld } from './world/TileWorld';

async function bootstrap(): Promise<void> {
  const loading = new LoadingScreen();
  loading.setStage('Starting renderer…', 0.04);

  const canvas = document.getElementById('flamecore-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Expected #flamecore-canvas.');
  }
  const hudFps = document.getElementById('hud-fps');

  const runtime = Runtime.create({ canvas, antialias: true, maxPixelRatio: 2 });
  const orbit = new OrbitCamera(canvas);
  runtime.setOverrideCamera(orbit.camera);

  const scene = new Scene('WorldPortfolio');
  applySceneEnvironment(runtime.context.renderer, scene.threeScene);
  initBlenderAssetLighting(runtime.context.renderer);
  loading.setStage('Lighting scene…', 0.1);

  const envActor = new Actor('Environment');
  envActor.addComponent(new TransformComponent(makeTransformProps()));
  envActor.addComponent(
    new EnvironmentComponent(
      makeEnvironmentProps({
        backgroundColor: [0.02, 0.03, 0.07],
        fog: { enabled: true, color: [0.04, 0.06, 0.12], near: 70, far: 160 },
      }),
    ),
  );
  scene.add(envActor);

  const cameraActor = new Actor('MainCamera');
  cameraActor.addComponent(new TransformComponent(makeTransformProps({ position: [0, 30, 40] })));
  cameraActor.addComponent(new CameraComponent(makeCameraProps({ fov: 52, near: 0.1, far: 400 })));
  scene.add(cameraActor);

  const sun = new Actor('Moonlight');
  sun.addComponent(
    new TransformComponent(makeTransformProps({ position: [30, 50, 20], rotation: [-1.0, 0.35, 0] })),
  );
  sun.addComponent(
    new LightComponent(
      makeLightProps({ kind: 'directional', color: [0.75, 0.82, 1], intensity: 2.0 }),
    ),
  );
  scene.add(sun);

  const ambient = new Actor('Ambient');
  ambient.addComponent(new TransformComponent(makeTransformProps()));
  ambient.addComponent(
    new LightComponent(makeLightProps({ kind: 'ambient', color: [0.45, 0.52, 0.72], intensity: 0.75 })),
  );
  scene.add(ambient);

  const worldActor = new Actor('TileWorldRoot');
  worldActor.addComponent(new TransformComponent(makeTransformProps()));
  scene.add(worldActor);

  const catalog = new AssetCatalog();
  loading.setStage('Loading buildings…', 0.18);
  await catalog.loadAll();

  const vehicleCatalog = new VehicleCatalog();
  loading.setStage('Loading vehicles…', 0.52);
  await vehicleCatalog.loadAll();

  const tileWorld = new TileWorld(catalog);
  const shipTraffic = new ShipTraffic();
  const carTraffic = new CarTraffic(vehicleCatalog);
  orbit.onFollowCleared = () => shipTraffic.clearFollow();
  const sky = new SkyAtmosphere();
  const snow = new SnowSystem(400);

  worldActor.object3D.add(sky.root);
  worldActor.object3D.add(snow.root);
  worldActor.object3D.add(tileWorld.root);
  worldActor.object3D.add(carTraffic.root);
  worldActor.object3D.add(shipTraffic.root);

  loading.setStage('Loading ships…', 0.72);
  await shipTraffic.loadShipModel(`${ASSET_BASE}/flying_ship.glb?v=20260625perfopt1`);

  loading.setStage('Placing tiles…', 0.88);
  runtime.loadScene(scene);
  runtime.start();

  const onResize = (): void => {
    orbit.resize(canvas.clientWidth, canvas.clientHeight);
  };
  onResize();
  window.addEventListener('resize', onResize);

  let anchorTx = 0;
  let anchorTz = 0;
  let snowTime = 0;

  const initRadius = computeTileRadius(orbit.distance, orbit.camera.fov, orbit.camera.aspect);
  shipTraffic.ensureCoverage(0, 0, initRadius);
  carTraffic.ensureCoverage(0, 0, initRadius);
  tileWorld.updateAnchor(0, 0, initRadius);

  loading.setStage('Warming up world…', 0.96);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await loading.complete();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      const pos = shipTraffic.cycleFollow(orbit.camera);
      orbit.setFollowWorld(pos);
    }
    if (e.key === 'Escape') {
      shipTraffic.clearFollow();
      orbit.clearFollow();
    }
  });

  runtime.events.on('beforeUpdate', ({ dt }) => {
    orbit.update(dt);
    tileWorld.updateAnimation(dt, orbit.camera);
    snowTime += dt;
    sky.update(dt, orbit.camera.position);
    snow.update(dt, orbit.target.x, orbit.target.z, snowTime);

    const tileRadius = computeTileRadius(
      orbit.distance,
      orbit.camera.fov,
      orbit.camera.aspect,
    );
    const { x, z } = orbit.getAnchorXZ();
    tileWorld.updateAnchor(x, z, tileRadius);
    const newTx = Math.floor(x / TILE_SIZE);
    const newTz = Math.floor(z / TILE_SIZE);
    if (newTx !== anchorTx || newTz !== anchorTz) {
      anchorTx = newTx;
      anchorTz = newTz;
    }
    shipTraffic.ensureCoverage(anchorTx, anchorTz, tileRadius);
    carTraffic.ensureCoverage(anchorTx, anchorTz, tileRadius);

    if (shipTraffic.isFollowing() && orbit.isFollowing()) {
      orbit.setFollowWorld(shipTraffic.getFollowPosition());
    }

    shipTraffic.update(dt, orbit.camera, orbit.target);
    carTraffic.update(dt, orbit.camera, orbit.target);
  });

  let acc = 0;
  let frames = 0;
  runtime.events.on('afterUpdate', ({ dt }) => {
    acc += dt;
    frames += 1;
    if (acc >= 0.5 && hudFps) {
      hudFps.textContent = `${Math.round(frames / acc)} fps · ${shipTraffic.countInView(orbit.camera)}/${shipTraffic.shipCount} ships · ${carTraffic.countInView(orbit.camera)}/${carTraffic.carCount} cars`;
      acc = 0;
      frames = 0;
    }
  });

  (window as unknown as { worldPortfolio: unknown }).worldPortfolio = {
    runtime,
    scene,
    tileWorld,
    shipTraffic,
    carTraffic,
    vehicleCatalog,
    sky,
    snow,
    orbit,
  };
}

bootstrap().catch((err) => {
  console.error('[WorldPortfolio] boot failed:', err);
  const errorEl = document.getElementById('load-error');
  const screen = document.getElementById('load-screen');
  if (errorEl instanceof HTMLElement) {
    errorEl.hidden = false;
    errorEl.textContent = 'Failed to load the world. Refresh the page to try again.';
  }
  if (screen instanceof HTMLElement) {
    screen.classList.add('load-screen--error');
    screen.setAttribute('aria-busy', 'false');
  }
  const label = document.getElementById('load-label');
  if (label instanceof HTMLElement) label.textContent = 'Load failed';
});

/** PBR image-based lighting tuned for the night sky scene (metallic hulls need reflections). */
function applySceneEnvironment(renderer: THREE.WebGLRenderer, threeScene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x060a14);

  const hemi = new THREE.HemisphereLight(0x7a8aaa, 0x101828, 0.5);
  envScene.add(hemi);

  const moon = new THREE.DirectionalLight(0xb8c8e8, 1.25);
  moon.position.set(5, 9, -3);
  envScene.add(moon);

  const fill = new THREE.DirectionalLight(0x3a4a68, 0.3);
  fill.position.set(-7, 2, 5);
  envScene.add(fill);

  const env = pmrem.fromScene(envScene, 0.02).texture;
  threeScene.environment = env;
  pmrem.dispose();
}
