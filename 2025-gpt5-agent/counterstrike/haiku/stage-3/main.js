import * as THREE from 'three';

// ---------- Tuning ----------
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.35;
const MOVE_SPEED = 6; // meters per second
const MOUSE_SENSITIVITY = 0.002;
const FIRE_INTERVAL = 0.12; // seconds between shots while the button is held
const BODY_DAMAGE = 25;
const HEADSHOT_DAMAGE = 100;
const ENEMY_MAX_HP = 100;
const ENEMY_COUNT = 8;
const ENEMY_RADIUS = 0.6; // keeps enemies from spawning inside walls or crates
const RESPAWN_DELAY = 2.5; // seconds a killed enemy stays down before coming back
const SPAWN_MIN_DISTANCE = 10; // enemies never spawn this close to the player
const ARENA_HALF = 38; // the map runs from -38 to 38 on both axes
const TRACER_LIFE = 0.06;

// ---------- Renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const SKY_COLOR = 0x9cc7e8;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.Fog(SKY_COLOR, 50, 140);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
scene.add(camera); // added to the scene so the gun, which is a child of the camera, gets drawn

scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6b4a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(20, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 150 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

// ---------- Helpers ----------
const lambert = (color) => new THREE.MeshLambertMaterial({ color });

function makeBox(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Flat, unlit box, used for the health bars
function flatBox(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
}

// ---------- Map ----------
const floor = makeBox(ARENA_HALF * 2, 0.2, ARENA_HALF * 2, lambert(0x6b7f5a));
floor.position.y = -0.1;
scene.add(floor);

const grid = new THREE.GridHelper(ARENA_HALF * 2, ARENA_HALF, 0x4d5f43, 0x4d5f43);
grid.position.y = 0.005;
scene.add(grid);

const solids = []; // ground-level boxes that the player and enemies cannot walk through
const worldMeshes = []; // what bullets can hit

function addBlock(x, z, w, h, d, color) {
  const mesh = makeBox(w, h, d, lambert(color));
  mesh.position.set(x, h / 2, z);
  scene.add(mesh);
  worldMeshes.push(mesh);
  solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

// Outer walls
const WALL_COLOR = 0x6e6e78;
const WALL_HEIGHT = 4;
const E = ARENA_HALF;
addBlock(0, -E - 0.5, 2 * E + 2, WALL_HEIGHT, 1, WALL_COLOR); // north
addBlock(0, E + 0.5, 2 * E + 2, WALL_HEIGHT, 1, WALL_COLOR); // south
addBlock(-E - 0.5, 0, 1, WALL_HEIGHT, 2 * E, WALL_COLOR); // west
addBlock(E + 0.5, 0, 1, WALL_HEIGHT, 2 * E, WALL_COLOR); // east

// Cover: crates, low walls, and pillars. Each entry is [x, z, width, height, depth].
const COVER_LAYOUT = [
  [-6, -6, 3, 1.2, 1.5],
  [10, 8, 2, 1.2, 2],
  [-12, 10, 4, 2.5, 1],
  [14, -12, 1, 3, 6],
  [-18, -2, 2, 1.5, 2],
  [0, 14, 6, 2.5, 1],
  [0, -16, 6, 2.5, 1],
  [24, 2, 2, 2, 2],
  [-24, 16, 3, 1.2, 3],
  [-26, -18, 2, 3, 2],
  [24, 22, 5, 2, 1],
  [-8, 24, 2, 2, 2],
  [18, -26, 3, 1.5, 3],
  [32, -6, 1, 4, 10],
  [-32, 8, 1, 4, 8],
  [8, 28, 2, 1.5, 2],
  [-16, -28, 4, 2, 2],
  [4, -24, 2, 3, 2],
  [30, 30, 3, 1, 3],
  [-32, -30, 2, 1.5, 2],
  [10, 16, 1.2, 1.2, 1.2],
  [-4, 5, 1.5, 1, 1.5],
  [-22, 0, 1, 2.5, 6],
  [20, -2, 1.5, 1.5, 1.5],
];
const COVER_COLORS = [0x8b5e3c, 0x8d8f94, 0x7d6b4f, 0xa67c52];
COVER_LAYOUT.forEach(([x, z, w, h, d], i) => addBlock(x, z, w, h, d, COVER_COLORS[i % COVER_COLORS.length]));

// True if a circle of the given radius centered at (x, z) overlaps a solid box
function isBlocked(x, z, radius) {
  for (const s of solids) {
    const nearestX = Math.min(Math.max(x, s.minX), s.maxX);
    const nearestZ = Math.min(Math.max(z, s.minZ), s.maxZ);
    const dx = x - nearestX;
    const dz = z - nearestZ;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

// ---------- Player ----------
const player = { x: 0, z: 0, yaw: 0, pitch: 0 };
const keys = new Set();
const isDown = (...codes) => codes.some((code) => keys.has(code));

// The first-person gun is a child of the camera, so it always stays in the same place on screen.
// Its parts are positioned relative to gunRoot. The rifle points down -Z, the same way the camera looks.
// The gun and hands are not set to cast shadows, so they don't leave dark marks on the map.
const GUN_REST = new THREE.Vector3(0.24, -0.26, -0.5);
const gunRoot = new THREE.Group();
gunRoot.position.copy(GUN_REST);
camera.add(gunRoot);

function viewBox(w, h, d, x, y, z, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  mesh.position.set(x, y, z);
  gunRoot.add(mesh);
  return mesh;
}

// A thin box stretched between two points, used for the sleeves
function viewLimb(from, to, thickness, color) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, dir.length()), lambert(color));
  mesh.position.copy(from).lerp(to, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
  gunRoot.add(mesh);
}

// Rifle: receiver, rail, barrel, muzzle brake, sights, handguard, magazine, grip, and stock
viewBox(0.1, 0.12, 0.38, 0, 0, -0.1, 0x2b2f36);
viewBox(0.03, 0.025, 0.2, 0, 0.075, -0.06, 0x2b2f36);
viewBox(0.04, 0.05, 0.26, 0, 0.01, -0.44, 0x15171a);
viewBox(0.07, 0.07, 0.04, 0, 0.01, -0.6, 0x15171a);
viewBox(0.015, 0.03, 0.015, 0, 0.07, -0.52, 0x15171a);
viewBox(0.07, 0.07, 0.25, 0, -0.04, -0.3, 0x3a3f47);
viewBox(0.06, 0.2, 0.07, 0, -0.16, -0.14, 0x3a3f47);
viewBox(0.06, 0.16, 0.07, 0, -0.14, 0.04, 0x1d1f23);
viewBox(0.07, 0.11, 0.24, 0, -0.02, 0.2, 0x4a3524);

// Hands on the grip and the handguard, with sleeves running off the bottom of the screen
viewBox(0.075, 0.09, 0.08, 0, -0.13, 0.04, 0xe0b07f);
viewBox(0.085, 0.085, 0.09, -0.03, -0.05, -0.3, 0xe0b07f);
viewLimb(new THREE.Vector3(0, -0.13, 0.1), new THREE.Vector3(0.14, -0.5, 0.42), 0.09, 0x4a5a3a);
viewLimb(new THREE.Vector3(-0.03, -0.06, -0.26), new THREE.Vector3(-0.22, -0.5, -0.02), 0.09, 0x4a5a3a);

// The tip of the barrel. Tracers start here.
const muzzle = new THREE.Object3D();
muzzle.position.set(0, 0.01, -0.64);
gunRoot.add(muzzle);

function updatePlayer(dt) {
  const forwardInput = (isDown('KeyW', 'ArrowUp') ? 1 : 0) - (isDown('KeyS', 'ArrowDown') ? 1 : 0);
  const sideInput = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0);

  if (forwardInput !== 0 || sideInput !== 0) {
    const length = Math.hypot(forwardInput, sideInput);
    const forward = forwardInput / length;
    const side = sideInput / length;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    // World direction of "forward" is (-sin, -cos) and of "right" is (cos, -sin) at this yaw
    const dx = (-sin * forward + cos * side) * MOVE_SPEED * dt;
    const dz = (-cos * forward - sin * side) * MOVE_SPEED * dt;
    // Move one axis at a time so the player slides along walls instead of stopping dead
    if (!isBlocked(player.x + dx, player.z, PLAYER_RADIUS)) player.x += dx;
    if (!isBlocked(player.x, player.z + dz, PLAYER_RADIUS)) player.z += dz;
  }

  camera.position.set(player.x, EYE_HEIGHT, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

// ---------- Enemies ----------
const enemies = [];

// Builds a person out of square boxes: a shirt and vest, pants, boots, arms holding a small rifle, and a head
function buildEnemy() {
  const shirtMat = lambert(0xb83a2e);
  const vestMat = lambert(0x4a5a3a);
  const pantsMat = lambert(0x3b3f4a);
  const bootMat = lambert(0x1c1c1c);
  const skinMat = lambert(0xe0b07f);
  const hairMat = lambert(0x2a1d14);
  const darkMat = lambert(0x222222); // belt, pouches, eyes
  const gunMat = lambert(0x161616);

  const group = new THREE.Group();
  // Yaw first, then the fall in the enemy's own frame, so an enemy falls toward where it faces
  group.rotation.order = 'YXZ';
  const parts = [];
  const headParts = [];

  // A box centered at (x, y, z). Positions are relative to the enemy's feet.
  const add = (w, h, d, x, y, z, material) => {
    const mesh = makeBox(w, h, d, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    parts.push(mesh);
    return mesh;
  };

  // A thin box stretched between two points, used for arms
  const limb = (from, to, thickness, material) => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const mesh = makeBox(thickness, thickness, dir.length(), material);
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    group.add(mesh);
    parts.push(mesh);
  };

  // Boots, legs, hips, belt
  add(0.24, 0.14, 0.32, -0.13, 0.07, -0.03, bootMat);
  add(0.24, 0.14, 0.32, 0.13, 0.07, -0.03, bootMat);
  add(0.22, 0.72, 0.24, -0.13, 0.48, 0, pantsMat);
  add(0.22, 0.72, 0.24, 0.13, 0.48, 0, pantsMat);
  add(0.5, 0.14, 0.3, 0, 0.87, 0, pantsMat);
  add(0.52, 0.06, 0.32, 0, 0.95, 0, darkMat);

  // Torso, vest, and chest pouches
  add(0.5, 0.55, 0.3, 0, 1.2, 0, shirtMat);
  add(0.46, 0.42, 0.1, 0, 1.25, -0.19, vestMat);
  add(0.1, 0.1, 0.06, -0.13, 1.2, -0.25, darkMat);
  add(0.1, 0.1, 0.06, 0.13, 1.2, -0.25, darkMat);

  // Arms reach forward to hold the rifle: shoulder to elbow to hand
  const shoulderR = new THREE.Vector3(0.3, 1.42, -0.02);
  const elbowR = new THREE.Vector3(0.28, 1.2, -0.22);
  const handR = new THREE.Vector3(0.06, 1.27, -0.45);
  const shoulderL = new THREE.Vector3(-0.3, 1.42, -0.02);
  const elbowL = new THREE.Vector3(-0.3, 1.2, -0.2);
  const handL = new THREE.Vector3(-0.01, 1.28, -0.6);
  limb(shoulderR, elbowR, 0.15, shirtMat);
  limb(elbowR, handR, 0.13, shirtMat);
  limb(shoulderL, elbowL, 0.15, shirtMat);
  limb(elbowL, handL, 0.13, shirtMat);
  add(0.12, 0.12, 0.12, handR.x, handR.y, handR.z, skinMat);
  add(0.12, 0.12, 0.12, handL.x, handL.y, handL.z, skinMat);

  // Small rifle: receiver, barrel, magazine, and stock
  add(0.1, 0.12, 0.42, 0.02, 1.32, -0.5, gunMat);
  add(0.05, 0.05, 0.22, 0.02, 1.34, -0.82, gunMat);
  add(0.06, 0.14, 0.07, 0.02, 1.2, -0.46, gunMat);
  add(0.08, 0.1, 0.18, 0.02, 1.32, -0.19, gunMat);

  // Neck and head. The head pieces count as a headshot when hit.
  add(0.14, 0.1, 0.14, 0, 1.5, 0, skinMat);
  headParts.push(add(0.32, 0.32, 0.32, 0, 1.68, 0, skinMat));
  headParts.push(add(0.34, 0.08, 0.34, 0, 1.86, 0, hairMat));
  headParts.push(add(0.05, 0.04, 0.02, -0.08, 1.7, -0.17, darkMat));
  headParts.push(add(0.05, 0.04, 0.02, 0.08, 1.7, -0.17, darkMat));
  headParts.push(add(0.12, 0.03, 0.02, 0, 1.6, -0.17, hairMat));
  scene.add(group);

  // Health bar floats above the enemy and turns to face the camera every frame
  const barGroup = new THREE.Group();
  const barFill = flatBox(1, 0.09, 0.04, 0x52e06b);
  barFill.position.z = 0.01;
  barGroup.add(flatBox(1, 0.12, 0.03, 0x1a1a1a), barFill);
  scene.add(barGroup);

  return { group, parts, headParts, shirtMat, barGroup, barFill, hp: ENEMY_MAX_HP, state: 'alive', timer: 0, flash: 0 };
}

// Finds a random open spot far enough from the player and from the other living enemies
function findSpawnSpot(self) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const x = (Math.random() * 2 - 1) * (ARENA_HALF - 3);
    const z = (Math.random() * 2 - 1) * (ARENA_HALF - 3);
    if (Math.hypot(x - player.x, z - player.z) < SPAWN_MIN_DISTANCE) continue;
    if (isBlocked(x, z, ENEMY_RADIUS)) continue;
    const crowded = enemies.some(
      (o) => o !== self && o.state === 'alive' && Math.hypot(o.group.position.x - x, o.group.position.z - z) < 4,
    );
    if (crowded) continue;
    return { x, z };
  }
  return { x: ARENA_HALF - 3, z: ARENA_HALF - 3 }; // only reached if the map is too crowded to find a clear spot
}

// Used for the first spawn and for every respawn
function placeEnemy(enemy) {
  const spot = findSpawnSpot(enemy);
  enemy.group.position.set(spot.x, 0, spot.z);
  enemy.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
  enemy.hp = ENEMY_MAX_HP;
  enemy.state = 'alive';
  enemy.timer = 0;
}

function updateHealthBar(enemy) {
  const alive = enemy.state === 'alive';
  enemy.barGroup.visible = alive;
  if (!alive) return;

  const x = enemy.group.position.x;
  const z = enemy.group.position.z;
  enemy.barGroup.position.set(x, 2.2, z);
  enemy.barGroup.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
  const fraction = enemy.hp / ENEMY_MAX_HP;
  enemy.barFill.scale.x = Math.max(fraction, 0.001);
  enemy.barFill.position.x = -(1 - fraction) / 2; // keeps the green bar anchored to the left edge
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    if (enemy.state === 'dying') {
      enemy.timer += dt;
      const fall = Math.min(enemy.timer / 0.4, 1);
      enemy.group.rotation.x = (-fall * Math.PI) / 2;
      if (enemy.timer >= RESPAWN_DELAY) placeEnemy(enemy);
    }
    enemy.flash = Math.max(0, enemy.flash - dt);
    enemy.shirtMat.emissive.setRGB(enemy.flash > 0 ? 0.6 : 0, 0, 0);
    updateHealthBar(enemy);
  }
}

for (let i = 0; i < ENEMY_COUNT; i++) {
  const enemy = buildEnemy();
  enemies.push(enemy);
  placeEnemy(enemy);
}

// ---------- Shooting ----------
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0); // the crosshair is always at the center of the screen
const muzzleWorld = new THREE.Vector3();
const tracers = [];
const tracerGeometry = new THREE.BoxGeometry(0.03, 0.03, 1);
const tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xffe066 });

let fireCooldown = 0;
let recoil = 0;
let hitMarkerTimer = 0;
let kills = 0;

const killsEl = document.getElementById('kills');
const hitMarkerEl = document.getElementById('hitmarker');

function spawnTracer(from, to) {
  const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial);
  mesh.position.copy(from).lerp(to, 0.5);
  mesh.lookAt(to);
  mesh.scale.z = from.distanceTo(to);
  scene.add(mesh);
  tracers.push({ mesh, life: TRACER_LIFE });
}

function damageEnemy(enemy, amount) {
  enemy.hp = Math.max(0, enemy.hp - amount);
  enemy.flash = 0.1;
  if (enemy.hp === 0) {
    enemy.state = 'dying';
    enemy.timer = 0;
    kills += 1;
    killsEl.textContent = `Kills: ${kills}`;
  }
}

function shoot() {
  raycaster.setFromCamera(screenCenter, camera);

  // Find the nearest wall or crate; enemies behind it cannot be hit
  const wallHit = raycaster.intersectObjects(worldMeshes, false)[0];
  let bestDistance = wallHit ? wallHit.distance : Infinity;
  let best = null;

  for (const enemy of enemies) {
    if (enemy.state !== 'alive') continue;
    const hit = raycaster.intersectObjects(enemy.parts, false)[0];
    if (hit && hit.distance < bestDistance) {
      best = { enemy, hit };
      bestDistance = hit.distance;
    }
  }

  let end;
  if (best) end = best.hit.point;
  else if (wallHit) end = wallHit.point;
  else end = raycaster.ray.at(80, new THREE.Vector3());

  muzzle.getWorldPosition(muzzleWorld);
  spawnTracer(muzzleWorld, end);

  recoil = 1;
  player.pitch = Math.min(player.pitch + 0.015, 1.5);

  if (best) {
    const headshot = best.enemy.headParts.includes(best.hit.object);
    damageEnemy(best.enemy, headshot ? HEADSHOT_DAMAGE : BODY_DAMAGE);
    hitMarkerTimer = 0.12;
  }
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) {
      scene.remove(tracers[i].mesh);
      tracers.splice(i, 1);
    }
  }
}

// ---------- Input ----------
const overlay = document.getElementById('overlay');
let locked = false;
let mouseDown = false;

window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  mouseDown = false;
});

overlay.addEventListener('click', () => renderer.domElement.requestPointerLock());

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  overlay.classList.toggle('hidden', locked);
  if (!locked) mouseDown = false;
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  player.yaw -= e.movementX * MOUSE_SENSITIVITY;
  player.pitch = Math.min(Math.max(player.pitch - e.movementY * MOUSE_SENSITIVITY, -1.5), 1.5);
});

document.addEventListener('mousedown', (e) => {
  if (locked && e.button === 0) mouseDown = true;
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
function update(dt) {
  updatePlayer(dt);
  updateEnemies(dt);

  // Raycasts read world matrices, so bring them up to date after moving things this frame
  scene.updateMatrixWorld();

  fireCooldown -= dt;
  if (mouseDown && fireCooldown <= 0) {
    fireCooldown = FIRE_INTERVAL;
    shoot();
  }

  // After a shot, the gun jumps back and tips its barrel up, then eases back to its rest position
  recoil *= Math.exp(-dt * 12);
  gunRoot.position.set(GUN_REST.x, GUN_REST.y + recoil * 0.015, GUN_REST.z + recoil * 0.06);
  gunRoot.rotation.x = recoil * 0.12;

  hitMarkerTimer = Math.max(0, hitMarkerTimer - dt);
  hitMarkerEl.classList.toggle('show', hitMarkerTimer > 0);

  updateTracers(dt);
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (locked) update(dt); // the world freezes while the game is paused (Esc)
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
