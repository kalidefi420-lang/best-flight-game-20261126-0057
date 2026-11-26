// The valley: one seeded landscape that every mission flies over — rolling fields,
// a river, a little town, pine woods, and a single runway (09) on the valley floor.
// The ring course follows the river valley east, the courier beacon sits on the
// island in the lake, and the runway is the only flat place to put the wheels down.
import {
  DEG, FIELD_COLORS, FOREST_COLOR, RING_COUNT, RING_RADIUS_M, RUNWAY_HEADING_DEG,
  RUNWAY_LENGTH, RUNWAY_WIDTH, TOWN_COLOR, WATER_COLOR,
} from './config.js';
import { createRandom, makeNoise, pick } from './random.js';

/** The runway runs east-west on the valley floor, centred near the origin. */
export const RUNWAY = {
  // Centre of the strip, metres. Heading 090: threshold at the west end.
  cx: 0,
  cz: 0,
  headingDeg: RUNWAY_HEADING_DEG,
  length: RUNWAY_LENGTH,
  width: RUNWAY_WIDTH,
  thresholdX: -RUNWAY_LENGTH / 2, // west end: where you cross to land
};

/** Build the whole world from a seed: terrain, fields, river, town, rings, beacon. */
export function createWorld(seed) {
  const rand = createRandom(seed);
  const noise = makeNoise(seed ^ 0x9e3779b9);

  // The valley floor is flat along the runway and the river; hills rise away.
  function hillHeight(x, z) {
    const n = noise(x * 0.0016, z * 0.0016) * 0.6
      + noise(x * 0.004 + 40, z * 0.004 + 40) * 0.4;
    // Hills grow with distance from the valley axis (the river line z = riverZ(x)).
    const d = Math.abs(z - riverZ(x));
    const rise = Math.min(1, d / 2600);
    return 30 + n * 90 * rise + rise * rise * 130;
  }

  // The river winds east along the valley: a gentle sine the course follows.
  function riverZ(x) {
    return 420 * Math.sin(x * 0.00042 + 0.8) + 140 * Math.sin(x * 0.0011 + 2.2);
  }

  // Distance from a point to the runway centreline, and along-runway position.
  function runwayFrame(x, z) {
    const dx = x - RUNWAY.cx;
    const dz = z - RUNWAY.cz;
    const along = dx; // heading 090: east is +x
    const lateral = dz;
    return { along, lateral };
  }

  function groundHeight(x, z) {
    const { along, lateral } = runwayFrame(x, z);
    const onStrip = Math.abs(along) < RUNWAY_LENGTH / 2 + 260
      && Math.abs(lateral) < RUNWAY_WIDTH / 2 + 260;
    if (onStrip) {
      // Blend the flat strip into the hills over ~260 m so no cliff appears.
      const edge = Math.max(
        Math.abs(along) - RUNWAY_LENGTH / 2,
        Math.abs(lateral) - RUNWAY_WIDTH / 2,
      );
      const t = Math.max(0, Math.min(1, edge / 260));
      return hillHeight(x, z) * t * t;
    }
    return hillHeight(x, z);
  }

  // --- Fields: seeded rectangles of crop colour scattered over the valley floor. ---
  const fields = [];
  for (let i = 0; i < 150; i++) {
    const x = (rand() - 0.5) * 9000;
    const z = riverZ(x) + (rand() - 0.5) * 5200;
    const w = 260 + rand() * 620;
    const d = 200 + rand() * 480;
    const rot = (rand() - 0.5) * 0.5;
    fields.push({ x, z, w, d, rot, color: pick(rand, FIELD_COLORS) });
  }

  // --- The river: a chain of wide flat quads following riverZ, water blue. ---
  const river = [];
  for (let x = -5200; x < 5200; x += 260) {
    river.push({ x, z: riverZ(x), w: 120 + 40 * Math.sin(x * 0.001) });
  }

  // --- Pine woods: dark patches on the hillsides. ---
  const woods = [];
  for (let i = 0; i < 26; i++) {
    const x = (rand() - 0.5) * 9000;
    const z = riverZ(x) + (rand() < 0.5 ? -1 : 1) * (1500 + rand() * 1600);
    woods.push({ x, z, r: 260 + rand() * 420 });
  }

  // --- The town of Millford: grey blocks beside the runway's west end. ---
  const town = [];
  for (let i = 0; i < 34; i++) {
    const x = -2600 + rand() * 900;
    const z = -700 + rand() * 500;
    town.push({ x, z, w: 40 + rand() * 90, d: 30 + rand() * 70 });
  }

  // --- Ring course: eight rings down the valley, 900 m apart, weaving with the river. ---
  const rings = [];
  let rx = -2600;
  for (let i = 0; i < RING_COUNT; i++) {
    rx += 880;
    const rz = riverZ(rx) + (i % 2 === 0 ? 160 : -160);
    const alt = 180 + 90 * Math.sin(i * 1.3); // metres above the valley floor
    rings.push({ x: rx, z: rz, y: alt, r: RING_RADIUS_M, hit: false, index: i });
  }

  // --- Courier beacon: a red-and-white pylon on the island in the lake. ---
  const beacon = { x: 3900, z: riverZ(3900) - 700, y: 0, r: 90 };
  beacon.y = groundHeight(beacon.x, beacon.z);

  // --- Clouds: soft billboards drifting high over the valley. ---
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    clouds.push({
      x: (rand() - 0.5) * 12000,
      z: (rand() - 0.5) * 10000,
      y: 900 + rand() * 500,
      s: 260 + rand() * 420,
    });
  }

  // --- Distant ridge line: three layered silhouettes drawn at the horizon. ---
  const ridges = [
    { base: 0.62, amp: 0.10, color: '#8fa8c4', seed: seed + 11 },
    { base: 0.70, amp: 0.13, color: '#6d89a8', seed: seed + 23 },
    { base: 0.78, amp: 0.16, color: '#4d688a', seed: seed + 47 },
  ];

  return {
    seed, groundHeight, riverZ, runwayFrame,
    fields, river, woods, town, rings, beacon, clouds, ridges,
    reset() {
      for (const ring of rings) ring.hit = false;
    },
  };
}

/** The next ring the pilot has to fly through, or null when the course is done. */
export function nextRing(world) {
  return world.rings.find((r) => !r.hit) ?? null;
}

export { FOREST_COLOR, TOWN_COLOR, WATER_COLOR };
