// The valley: a seeded height field, and the Three.js meshes built from it.
// One seed makes one valley. The river snakes west to east, the runway sits
// on the flat western apron, a town huddles south of the strip, pine woods
// cover the lower slopes, and the mountains wall the valley in.
// Units are metres; x is east, z is south, y is up.
// THREE is the global from the vendored classic script vendor/three.min.js.
import { createNoise, createRandom } from './random.js';
import {
  ISLAND_X, ISLAND_Z, RING_COUNT, RUNWAY_HALF_WIDTH_M, RUNWAY_HEADING_DEG,
  RUNWAY_LENGTH_M, RUNWAY_X, RUNWAY_Z, WORLD_HALF_X, WORLD_HALF_Z,
} from './config.js';

const TAU = Math.PI * 2;

function smoothstep(a, b, t) {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

export function createWorld(seed) {
  const noise = createNoise(seed);
  const rand = createRandom(seed ^ 0x9e3779b9);

  // The river's centreline: two slow sines, so the valley bends.
  function riverZ(x) {
    return 200 * Math.sin(x / 1100) + 90 * Math.sin(x / 430 + 1.3);
  }

  // Ground height at any point. The same function feeds the mesh, the
  // physics, the props and the screenshots, so nothing can disagree.
  function heightAt(x, z) {
    // Rolling foothills.
    let h = noise.fbm(x / 900 + 13.7, z / 900 + 4.2, 4) * 26;
    // The valley walls: the ground climbs steeply toward every edge.
    const wallZ = smoothstep(950, 2400, Math.abs(z)) * 330;
    const wallX = smoothstep(2500, 3500, Math.abs(x)) * 260;
    h += Math.max(wallZ, wallX * 0.8);
    // The river carves its bed down to the water.
    const dz = Math.abs(z - riverZ(x));
    const carve = smoothstep(260, 40, dz);
    h = h * (1 - carve) + 2 * carve;
    // The island rises out of the eastern flats.
    const di = Math.hypot(x - ISLAND_X, z - ISLAND_Z);
    h += 30 * Math.max(0, 1 - di / 420) * smoothstep(420, 120, di);
    // Flat apron around the runway and the town.
    const dr = Math.hypot((x - RUNWAY_X) / 1050, (z - RUNWAY_Z) / 620);
    const flatR = smoothstep(1, 0.45, dr);
    h *= 1 - flatR;
    const dt = Math.hypot((x + 1150) / 700, (z - 430) / 520);
    h *= 1 - 0.85 * smoothstep(1, 0.4, dt);
    return h;
  }

  const group = new THREE.Group();
  group.name = 'valley';

  // --- Terrain skin, coloured by height and slope ---
  const SEG_X = 176;
  const SEG_Z = 132;
  const terrainGeo = new THREE.PlaneGeometry(
    WORLD_HALF_X * 2, WORLD_HALF_Z * 2, SEG_X, SEG_Z,
  );
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const cFieldA = new THREE.Color(0x4f7a33);
  const cFieldB = new THREE.Color(0x6fa344);
  const cDry = new THREE.Color(0xa89a5a);
  const cSand = new THREE.Color(0xd8c48f);
  const cRock = new THREE.Color(0x8a8d90);
  const cSnow = new THREE.Color(0xf2f5f7);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = noise.fbm(x / 260 + 3.1, z / 260 + 8.8, 3) * 0.5 + 0.5;
    tmp.copy(cFieldA).lerp(cFieldB, n);
    if (n > 0.82) tmp.lerp(cDry, (n - 0.82) * 1.9);
    const dz = Math.abs(z - riverZ(x));
    if (dz < 40 && h < 10) tmp.lerp(cSand, smoothstep(40, 18, dz) * 0.5);
    const slope = Math.abs(heightAt(x + 24, z) - h) + Math.abs(heightAt(x, z + 24) - h);
    if (slope > 9 || h > 190) tmp.lerp(cRock, Math.min(1, (slope - 9) / 14 + Math.max(0, (h - 190) / 120)));
    if (h > 380) tmp.lerp(cSnow, smoothstep(380, 440, h));
    // Farmland patchwork on the valley floor, so the ground reads as fields
    // from the air instead of one flat wash of green.
    if (h < 60 && dz > 45 && Math.abs(x) < WORLD_HALF_X * 0.72 && Math.abs(z) < WORLD_HALF_Z * 0.72) {
      const ix = Math.floor(x / 190);
      const iz = Math.floor(z / 190);
      const sv = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
      tmp.multiplyScalar(0.85 + (sv - Math.floor(sv)) * 0.3);
    }
    colours[i * 3] = tmp.r;
    colours[i * 3 + 1] = tmp.g;
    colours[i * 3 + 2] = tmp.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  terrain.name = 'terrain';
  group.add(terrain);

  // --- The river: a flat blue ribbon that follows its centreline ---
  const riverPts = [];
  for (let x = -WORLD_HALF_X; x <= WORLD_HALF_X; x += 110) {
    riverPts.push(new THREE.Vector3(x, 2.6, riverZ(x)));
  }
  const riverCurve = new THREE.CatmullRomCurve3(riverPts);
  const riverLen = Math.floor(riverCurve.getLength() / 110);
  const riverGeo = new THREE.BufferGeometry();
  const rPos = [];
  const rIdx = [];
  for (let i = 0; i <= riverLen; i += 1) {
    const t = i / riverLen;
    const p = riverCurve.getPoint(t);
    const tangent = riverCurve.getTangent(t);
    const nx = -tangent.z;
    const nz = tangent.x;
    const w = 34;
    rPos.push(p.x + nx * w, 2.6, p.z + nz * w, p.x - nx * w, 2.6, p.z - nz * w);
    if (i < riverLen) {
      const a = i * 2;
      rIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
  riverGeo.setIndex(rIdx);
  riverGeo.computeVertexNormals();
  const river = new THREE.Mesh(
    riverGeo,
    new THREE.MeshLambertMaterial({ color: 0x2e7cc2, transparent: true, opacity: 0.92 }),
  );
  river.name = 'river';
  group.add(river);

  // --- The town: instanced houses with pitched roofs ---
  const houseGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(0.75, 0.55, 4);
  const houseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xb5502e });
  const houseCount = 46;
  const houses = new THREE.InstancedMesh(houseGeo, houseMat, houseCount);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, houseCount);
  const dummy = new THREE.Object3D();
  const wallPalette = [0xe8dcc0, 0xd9b48a, 0xc9c9c9, 0xe0a080, 0xf0e6d2];
  const roofPalette = [0xb5502e, 0x7a4a2b, 0x5d6b7a, 0x9a3f2a];
  for (let i = 0; i < houseCount; i += 1) {
    const hx = -1150 + rand.range(-320, 320);
    const hz = 430 + rand.range(-220, 220);
    const w = rand.range(9, 15);
    const d = rand.range(9, 14);
    const hgt = rand.range(6, 13);
    const gy = heightAt(hx, hz);
    dummy.position.set(hx, gy + hgt / 2, hz);
    dummy.scale.set(w, hgt, d);
    dummy.rotation.set(0, rand.range(0, TAU), 0);
    dummy.updateMatrix();
    houses.setMatrixAt(i, dummy.matrix);
    houses.setColorAt(i, new THREE.Color(wallPalette[i % wallPalette.length]));
    dummy.position.set(hx, gy + hgt + 0.26, hz);
    dummy.scale.set(Math.max(w, d) * 1.05, 1, Math.max(w, d) * 1.05);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    roofs.setColorAt(i, new THREE.Color(roofPalette[i % roofPalette.length]));
  }
  houses.name = 'town-houses';
  roofs.name = 'town-roofs';
  group.add(houses, roofs);

  // --- Pine woods on the lower slopes ---
  const pineCount = 650;
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 4, 5);
  const coneGeo = new THREE.ConeGeometry(4.6, 15, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x2c5a2e });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, pineCount);
  const pines = new THREE.InstancedMesh(coneGeo, pineMat, pineCount);
  let placed = 0;
  let guard = 0;
  while (placed < pineCount && guard < 9000) {
    guard += 1;
    const px = rand.range(-WORLD_HALF_X + 200, WORLD_HALF_X - 200);
    const pz = rand.range(-WORLD_HALF_Z + 200, WORLD_HALF_Z - 200);
    const ph = heightAt(px, pz);
    if (ph < 16 || ph > 230) continue;
    if (Math.abs(px - RUNWAY_X) < 1100 && Math.abs(pz - RUNWAY_Z) < 420) continue;
    if (Math.abs(pz - riverZ(px)) < 90) continue;
    if (Math.hypot(px + 1150, pz - 430) < 420) continue;
    const s = rand.range(0.7, 1.6);
    dummy.position.set(px, ph + 2 * s, pz);
    dummy.scale.setScalar(s);
    dummy.rotation.set(0, rand.range(0, TAU), 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.set(px, ph + (4 + 7.5) * s, pz);
    dummy.updateMatrix();
    pines.setMatrixAt(placed, dummy.matrix);
    pines.setColorAt(placed, new THREE.Color().setHSL(0.33 + rand.range(-0.03, 0.03), 0.5, 0.3 + rand.range(0, 0.09)));
    placed += 1;
  }
  trunks.count = placed;
  pines.count = placed;
  trunks.name = 'pine-trunks';
  pines.name = 'pine-tops';
  group.add(trunks, pines);

  // --- Clouds: soft white puffs drifting east ---
  const clouds = new THREE.Group();
  clouds.name = 'clouds';
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.92,
  });
  const cloudPuffs = [];
  for (let i = 0; i < 18; i += 1) {
    const puff = new THREE.Group();
    const puffs = 3 + Math.floor(rand.next() * 3);
    for (let j = 0; j < puffs; j += 1) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(rand.range(26, 60), 10, 8), cloudMat);
      ball.position.set(rand.range(-90, 90), rand.range(-8, 10), rand.range(-40, 40));
      ball.scale.y = 0.42;
      puff.add(ball);
    }
    puff.position.set(
      rand.range(-WORLD_HALF_X, WORLD_HALF_X),
      rand.range(480, 720),
      rand.range(-WORLD_HALF_Z, WORLD_HALF_Z),
    );
    puff.userData.speed = rand.range(6, 14);
    clouds.add(puff);
    cloudPuffs.push(puff);
  }
  group.add(clouds);

  // --- Runway 09: asphalt, dashes, thresholds, numbers, PAPI, windsock ---
  const runway = new THREE.Group();
  runway.name = 'runway-09';
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(RUNWAY_LENGTH_M, 0.8, RUNWAY_HALF_WIDTH_M * 2),
    new THREE.MeshLambertMaterial({ color: 0x3a3d42 }),
  );
  strip.position.set(RUNWAY_X, 0.4, RUNWAY_Z);
  runway.add(strip);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f0 });
  for (let i = 0; i < 13; i += 1) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(34, 0.25, 2.4), dashMat);
    dash.position.set(RUNWAY_X - RUNWAY_LENGTH_M / 2 + 90 + i * 100, 0.95, RUNWAY_Z);
    runway.add(dash);
  }
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k += 1) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 3), dashMat);
      bar.position.set(
        RUNWAY_X + end * (RUNWAY_LENGTH_M / 2 - 42), 0.95, RUNWAY_Z + k * 6,
      );
      runway.add(bar);
    }
  }
  // Painted "09" at the western threshold, from a tiny canvas.
  const numCanvas = document.createElement('canvas');
  numCanvas.width = 256;
  numCanvas.height = 128;
  const nctx = numCanvas.getContext('2d');
  nctx.fillStyle = '#f5f5f0';
  nctx.font = 'bold 96px sans-serif';
  nctx.textAlign = 'center';
  nctx.textBaseline = 'middle';
  nctx.fillText('09', 128, 68);
  const numTex = new THREE.CanvasTexture(numCanvas);
  const numbers = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 60),
    new THREE.MeshBasicMaterial({ map: numTex, transparent: true }),
  );
  numbers.rotation.x = -Math.PI / 2;
  numbers.rotation.z = Math.PI / 2;
  numbers.position.set(RUNWAY_X - RUNWAY_LENGTH_M / 2 + 130, 1.05, RUNWAY_Z);
  runway.add(numbers);
  // PAPI lights: four small lamps that glow beside the threshold.
  const papiMat = new THREE.MeshBasicMaterial({ color: 0xff5040 });
  const papiMat2 = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let k = 0; k < 4; k += 1) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), k < 2 ? papiMat : papiMat2);
    lamp.position.set(RUNWAY_X - RUNWAY_LENGTH_M / 2 + 260, 1.2, RUNWAY_Z + 34 + k * 5);
    runway.add(lamp);
  }
  // Windsock on a pole, pointing downwind.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 12, 6),
    new THREE.MeshLambertMaterial({ color: 0xdddddd }),
  );
  pole.position.set(RUNWAY_X - 300, 6, RUNWAY_Z + 60);
  runway.add(pole);
  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 9, 8),
    new THREE.MeshLambertMaterial({ color: 0xff7a1a }),
  );
  sock.rotation.z = Math.PI / 2;
  sock.position.set(RUNWAY_X - 295, 11.4, RUNWAY_Z + 60);
  runway.add(sock);
  group.add(runway);

  // --- Golden rings for the Ring Run, strung along the river ---
  const ringMat = new THREE.MeshLambertMaterial({
    color: 0xffb400, emissive: 0x7a5200,
  });
  const rings = [];
  for (let i = 0; i < RING_COUNT; i += 1) {
    const t = i / (RING_COUNT - 1);
    const rx = -2200 + t * 4600;
    const rz = riverZ(rx) + (i % 2 === 0 ? -130 : 130);
    const ry = 75 + 62 * Math.sin(i * 1.7 + 0.6);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 1.7, 10, 40), ringMat);
    ring.position.set(rx, ry, rz);
    ring.name = `ring-${i + 1}`;
    group.add(ring);
    rings.push({ mesh: ring, x: rx, y: ry, z: rz, hit: false });
  }

  // --- The island beacon for the Island Courier ---
  const beacon = new THREE.Group();
  beacon.name = 'island-beacon';
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 3.2, 34, 10),
    new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }),
  );
  tower.position.set(ISLAND_X, heightAt(ISLAND_X, ISLAND_Z) + 17, ISLAND_Z);
  beacon.add(tower);
  const towerTop = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.4, 5, 10),
    new THREE.MeshLambertMaterial({ color: 0xd33a2c }),
  );
  towerTop.position.set(ISLAND_X, heightAt(ISLAND_X, ISLAND_Z) + 36, ISLAND_Z);
  beacon.add(towerTop);
  const beaconLightMat = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  const beaconLight = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), beaconLightMat);
  beaconLight.position.set(ISLAND_X, heightAt(ISLAND_X, ISLAND_Z) + 40, ISLAND_Z);
  beacon.add(beaconLight);
  const dropRing = new THREE.Mesh(
    new THREE.TorusGeometry(42, 1.8, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd34d }),
  );
  dropRing.rotation.x = Math.PI / 2;
  dropRing.position.set(ISLAND_X, heightAt(ISLAND_X, ISLAND_Z) + 2, ISLAND_Z);
  beacon.add(dropRing);
  group.add(beacon);

  // Sky: a big gradient dome would need a shader; a solid sky colour plus
  // fog reads cleaner at the contact-sheet size, so keep it simple.
  const sky = new THREE.Color(0x87b5dd);

  function update(dt, time) {
    for (const puff of cloudPuffs) {
      puff.position.x += puff.userData.speed * dt;
      if (puff.position.x > WORLD_HALF_X + 300) puff.position.x = -WORLD_HALF_X - 300;
    }
    for (let i = 0; i < rings.length; i += 1) {
      const s = 1 + 0.07 * Math.sin(time * 2.4 + i * 1.3);
      rings[i].mesh.scale.setScalar(s);
    }
    const blink = (Math.sin(time * 3.2) > 0.2) ? 1 : 0.15;
    beaconLightMat.color.setScalar(0);
    beaconLightMat.color.setRGB(1 * blink, 0.83 * blink, 0.3 * blink);
  }

  return {
    group, sky, heightAt, riverZ, rings, clouds,
    runway: { x: RUNWAY_X, z: RUNWAY_Z, length: RUNWAY_LENGTH_M, halfWidth: RUNWAY_HALF_WIDTH_M, headingDeg: RUNWAY_HEADING_DEG },
    beacon: { x: ISLAND_X, z: ISLAND_Z },
    update,
  };
}
