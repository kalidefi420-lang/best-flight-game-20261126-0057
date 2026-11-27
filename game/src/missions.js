// The three sorties: what the pilot has to do, how it scores, and how a
// landing is judged. Missions are pure state machines over the plane and
// the world — no Three.js here, so the scoring can be read on its own.
import {
  DROP_RING_RADIUS_M, DROP_SCORE, LANDING_BASE_SCORE, LANDING_CENTRELINE_BONUS,
  LANDING_SINK_BONUS, LANDING_SPEED_BONUS, PAR_COURIER_S, PAR_LANDING_S,
  PAR_RING_S, RING_COUNT, RING_RADIUS_M, RING_SCORE, TIME_BONUS_PER_S,
} from './config.js';

export const MISSION_RINGS = 'rings';
export const MISSION_LANDING = 'landing';
export const MISSION_COURIER = 'courier';

export const MISSIONS = [
  {
    id: MISSION_RINGS,
    name: 'Ring Run',
    blurb: 'Thread all 8 golden rings down the river valley. Fast and clean wins.',
    par: PAR_RING_S,
  },
  {
    id: MISSION_LANDING,
    name: 'Runway Landing',
    blurb: 'Bring her home onto runway 09: on centreline, gear down, gentle as you like.',
    par: PAR_LANDING_S,
  },
  {
    id: MISSION_COURIER,
    name: 'Island Courier',
    blurb: 'Carry the parcel east to the island beacon and drop it inside the yellow ring.',
    par: PAR_COURIER_S,
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || MISSIONS[0];
}

// Metres from the runway centreline: lateral offset while over the strip,
// distance to the nearest threshold once past either end.
export function centrelineDistance(world, plane) {
  const r = world.runway;
  const along = plane.x - r.x;
  const lateral = Math.abs(plane.z - r.z);
  if (Math.abs(along) <= r.length / 2) return lateral;
  const endX = r.x + Math.sign(along) * (r.length / 2);
  return Math.hypot(plane.x - endX, plane.z - r.z);
}

function startPosition(world, id) {
  const r = world.runway;
  if (id === MISSION_LANDING) {
    // On final, six kilometres out, gear already down.
    return { x: r.x - r.length / 2 - 5200, z: r.z, alt: 380, heading: 90, speed: 125 };
  }
  return { x: r.x - r.length / 2 - 260, z: r.z, alt: 130, heading: 90, speed: 112 };
}

export function startMission(world, planeApi, id) {
  const spot = startPosition(world, id);
  planeApi.reset(spot.x, spot.z, spot.alt, spot.heading, spot.speed);
  if (id === MISSION_LANDING) planeApi.setGear(true);
  return {
    id, startedAt: 0, ringsHit: 0, score: 0,
    status: 'flying', detail: '', nextRing: 0, dropped: false,
  };
}

// Advance the mission one step. Returns 'ring' when a ring is flown,
// 'dropped' when the parcel lands in the ring, otherwise null. Completing
// a sortie sets status to 'complete' and banks the time bonus.
export function updateMission(world, plane, state, time, dropping) {
  const p = plane.plane;
  if (state.status !== 'flying') return null;
  if (state.id === MISSION_RINGS) {
    const ring = world.rings[state.nextRing];
    if (ring) {
      const d = Math.hypot(p.x - ring.x, p.alt - ring.y, p.z - ring.z);
      if (d < RING_RADIUS_M + 8) {
        ring.hit = true;
        state.ringsHit += 1;
        state.score += RING_SCORE;
        state.nextRing += 1;
        if (state.ringsHit >= RING_COUNT) {
          state.status = 'complete';
          state.detail = `All ${RING_COUNT} rings, ${formatTime(time - state.startedAt)}.`;
          state.score += Math.max(0, Math.round((PAR_RING_S - (time - state.startedAt)) * TIME_BONUS_PER_S));
        }
        return 'ring';
      }
    }
    return null;
  }
  if (state.id === MISSION_COURIER) {
    if (dropping && !state.dropped) {
      const d = Math.hypot(p.x - world.beacon.x, p.z - world.beacon.z);
      state.dropped = true;
      if (d <= DROP_RING_RADIUS_M && !p.onGround) {
        state.status = 'complete';
        state.score += DROP_SCORE;
        state.score += Math.max(0, Math.round((PAR_COURIER_S - (time - state.startedAt)) * TIME_BONUS_PER_S));
        state.detail = 'Parcel down inside the ring. The island sends its thanks.';
        return 'dropped';
      }
      state.detail = 'Parcel away — but it missed the ring.';
    }
    return null;
  }
  return null;
}

// Called the moment the wheels touch. A runway touchdown with the gear
// down is judged on centreline, sink rate and speed; anything else is a
// crash, and the detail says why.
export function judgeLanding(world, plane, state, time) {
  const p = plane.plane;
  const lateral = centrelineDistance(world, p);
  const sinkFpm = -p.verticalSpeedFpm;
  const elapsed = time - state.startedAt;
  if (sinkFpm > 2200) {
    state.status = 'crashed';
    state.detail = `Too hard — ${Math.round(sinkFpm)} fpm down the hill. The airframe broke up.`;
    return;
  }
  if (p.speedKts > 150) {
    state.status = 'crashed';
    state.detail = `Too fast — ${Math.round(p.speedKts)} kt over the threshold. She ran off the end.`;
    return;
  }
  state.status = 'landed';
  let score = LANDING_BASE_SCORE;
  const notes = [];
  if (lateral <= 6) {
    score += LANDING_CENTRELINE_BONUS;
    notes.push('dead on the centreline');
  } else if (lateral <= 14) {
    score += Math.round(LANDING_CENTRELINE_BONUS / 2);
    notes.push('close to the centreline');
  }
  if (sinkFpm <= 420) {
    score += LANDING_SINK_BONUS;
    notes.push('a greaser');
  } else if (sinkFpm <= 900) {
    score += Math.round(LANDING_SINK_BONUS / 2);
    notes.push('firm but fair');
  }
  if (p.speedKts >= 68 && p.speedKts <= 98) {
    score += LANDING_SPEED_BONUS;
    notes.push('right on speed');
  }
  score += Math.max(0, Math.round((PAR_LANDING_S - elapsed) * TIME_BONUS_PER_S));
  state.score += score;
  state.detail = `Wheels down on 09${notes.length ? ' — ' + notes.join(', ') : ''}.`;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
