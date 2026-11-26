// The three sorties, each a different kind of flying: thread the rings down the
// valley, put the wheels on runway 09, or drop a parcel on the island beacon.
// A mission owns its start, its win condition, its score and its hint line.
import {
  DELIVERY_BASE_POINTS, LANDING_BASE_POINTS, MAX_LANDING_SPEED_KTS,
  MAX_SINK_FPM, RING_FUEL_BONUS, RING_POINTS, TIME_BONUS_PER_SEC,
} from './config.js';
import { nextRing } from './world.js';
import { placeInAir } from './plane.js';

export const MISSION_RINGS = 'rings';
export const MISSION_LANDING = 'landing';
export const MISSION_COURIER = 'courier';

export const MISSIONS = [
  {
    id: MISSION_RINGS,
    name: 'Ring Run',
    blurb: 'Thread all 8 golden rings down the river valley. Fast and clean wins.',
    parSeconds: 240,
  },
  {
    id: MISSION_LANDING,
    name: 'Runway Landing',
    blurb: 'Bring her home onto runway 09: on centreline, gear down, gentle as you like.',
    parSeconds: 300,
  },
  {
    id: MISSION_COURIER,
    name: 'Island Courier',
    blurb: 'Carry the parcel east to the island beacon and drop it inside the yellow ring.',
    parSeconds: 300,
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
}

/** Fresh mission state for a sortie. */
export function createMissionState(missionId) {
  return {
    id: missionId,
    startedAt: 0,        // seconds of game time when the sortie began
    ringsHit: 0,
    score: 0,
    status: 'flying',    // flying | landed | crashed | complete | dropped
    detail: '',          // the one-line verdict shown at the end
    dropX: null,         // where the parcel landed, once dropped
    dropZ: null,
    dropErrorM: null,
    landing: null,       // { centrelineM, sinkFpm, speedKts, zone } once down
  };
}

/** Place the aircraft for the chosen mission and reset the world. */
export function startMission(world, plane, missionId) {
  world.reset();
  const state = createMissionState(missionId);
  if (missionId === MISSION_RINGS) {
    placeInAir(plane, { x: -3400, z: world.riverZ(-3400), alt: 220, headingDeg: 90, speedKts: 170, throttle: 0.75 });
  } else if (missionId === MISSION_LANDING) {
    placeInAir(plane, { x: -5200, z: 0, alt: 750, headingDeg: 90, speedKts: 150, throttle: 0.45 });
    plane.gearDown = true;
  } else {
    placeInAir(plane, { x: -3400, z: world.riverZ(-3400), alt: 420, headingDeg: 90, speedKts: 175, throttle: 0.7 });
  }
  plane.fuel = 100;
  plane.integrity = 100;
  return state;
}

/** Distance from the aircraft to the runway centreline, in metres. */
export function centrelineDistance(world, plane) {
  const { lateral } = world.runwayFrame(plane.x, plane.z);
  return Math.abs(lateral);
}

/**
 * Called every step while flying: rings, the drop zone and the beacon.
 * Returns an event name ('ring' | 'dropped' | null) for sound and banners.
 */
export function updateMission(world, plane, state, nowSec, dropParcel) {
  if (state.id === MISSION_RINGS) {
    const ring = nextRing(world);
    if (ring) {
      const dx = plane.x - ring.x;
      const dz = plane.z - ring.z;
      const dy = plane.alt - ring.y;
      // The course runs east, so a ring is flown when the aircraft is close
      // along x and inside the ring's circle in the y-z plane.
      if (Math.abs(dx) < 45 && Math.hypot(dz, dy) < ring.r) {
        ring.hit = true;
        state.ringsHit += 1;
        state.score += RING_POINTS;
        plane.fuel = Math.min(100, plane.fuel + RING_FUEL_BONUS);
        if (state.ringsHit >= world.rings.length) {
          state.status = 'complete';
          const elapsed = Math.max(1, nowSec - state.startedAt);
          const bonus = Math.max(0, Math.round((missionById(state.id).parSeconds - elapsed) * TIME_BONUS_PER_SEC));
          state.score += bonus;
          state.detail = `All ${world.rings.length} rings, ${Math.round(elapsed)}s — time bonus +${bonus}.`;
        }
        return 'ring';
      }
    }
  }
  if (state.id === MISSION_COURIER) {
    const b = world.beacon;
    const dist = Math.hypot(plane.x - b.x, plane.z - b.z);
    if (dropParcel && state.status === 'flying' && plane.alt < 380) {
      state.status = 'dropped';
      state.dropX = plane.x;
      state.dropZ = plane.z;
      state.dropErrorM = Math.round(dist);
      const quality = Math.max(0, 1 - dist / 300);
      const points = Math.round(DELIVERY_BASE_POINTS * quality);
      state.score += points;
      state.detail = dist < 90
        ? `Parcel dead on the beacon — ${state.dropErrorM} m out, +${points}.`
        : `Parcel ${state.dropErrorM} m from the beacon, +${points}.`;
      return 'dropped';
    }
  }
  return null;
}

/** Judge a touchdown on the runway and write the verdict into the mission state. */
export function judgeLanding(world, plane, state, nowSec) {
  const { along, lateral } = world.runwayFrame(plane.x, plane.z);
  const onStrip = Math.abs(along) < 900 && Math.abs(lateral) < 23;
  const sink = -plane.verticalSpeedFpm;
  const soft = sink < MAX_SINK_FPM;
  const slow = plane.speedKts < MAX_LANDING_SPEED_KTS;
  const zone = along < -300 ? 'early' : along < 300 ? 'sweet spot' : 'deep';
  state.landing = {
    centrelineM: Math.round(Math.abs(lateral)),
    sinkFpm: Math.round(sink),
    speedKts: Math.round(plane.speedKts),
    zone,
  };
  if (!onStrip) {
    state.status = 'crashed';
    state.detail = 'Off the strip — the valley floor is no runway.';
    return;
  }
  if (!soft || !slow) {
    state.status = 'crashed';
    state.detail = `Too hard (${state.landing.sinkFpm} fpm) or too fast (${state.landing.speedKts} kt) — the gear gave up.`;
    return;
  }
  state.status = 'landed';
  const centreScore = Math.max(0, 1 - Math.abs(lateral) / 23);
  const sinkScore = Math.max(0, 1 - sink / MAX_SINK_FPM);
  const points = Math.round(LANDING_BASE_POINTS * (0.4 + 0.35 * centreScore + 0.25 * sinkScore));
  state.score += points;
  state.detail = `Down in the ${zone}, ${state.landing.centrelineM} m off centreline, ${state.landing.sinkFpm} fpm — +${points}.`;
}
