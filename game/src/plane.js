// The aircraft: one arcade flight model. Speed answers the throttle, pitch trades
// speed for altitude, bank turns the heading, and the wing quits below stall speed.
// Fuel burns with throttle, and the airframe keeps score of hard landings.
import {
  CLIMB_RATE_FPM, CRUISE_SPEED_KTS, DEG, FUEL_BURN_PER_SEC, FUEL_CAPACITY,
  INTEGRITY_MAX, MAX_BANK_DEG, MAX_PITCH_DEG, MAX_SPEED_KTS, STALL_SPEED_KTS,
  TURN_RATE_DEG,
} from './config.js';

const KTS_TO_MS = 0.514444;
const FPM_TO_MS = 0.00508;

/** Fresh aircraft, sitting on the runway threshold, engine idling. */
export function createPlane() {
  return {
    x: -1150,          // metres: just west of the runway threshold
    z: 0,
    alt: 0,            // metres above the valley floor (groundHeight adds the terrain)
    headingDeg: 90,    // runway heading: east
    pitchDeg: 0,
    rollDeg: 0,
    speedKts: 0,
    throttle: 0,       // 0..1
    fuel: FUEL_CAPACITY,
    integrity: INTEGRITY_MAX,
    gearDown: true,
    flaps: false,
    onGround: true,
    verticalSpeedFpm: 0,
    engineOut: false,
  };
}

/** Put the aircraft in the air at a chosen spot, for a mission start or a screenshot. */
export function placeInAir(plane, { x, z, alt, headingDeg, speedKts, throttle }) {
  plane.x = x;
  plane.z = z;
  plane.alt = alt;
  plane.headingDeg = headingDeg;
  plane.pitchDeg = 0;
  plane.rollDeg = 0;
  plane.speedKts = speedKts;
  plane.throttle = throttle;
  plane.onGround = false;
  plane.gearDown = false;
  plane.verticalSpeedFpm = 0;
  plane.engineOut = false;
}

export function speedMs(plane) {
  return plane.speedKts * KTS_TO_MS;
}

/**
 * One fixed step of flight. `ctl` is { pitch: -1..1, roll: -1..1, throttle: -1..1 }
 * from the keyboard, and `dt` is seconds. Returns nothing; the plane is mutated.
 */
export function stepPlane(plane, ctl, dt, groundHeightAt) {
  // Throttle: Shift feeds it, Ctrl pulls it back; it stays where you leave it.
  plane.throttle = clamp(plane.throttle + ctl.throttle * dt * 0.55, 0, 1);
  if (plane.fuel <= 0) {
    plane.throttle = 0;
    plane.engineOut = true;
  }
  plane.fuel = Math.max(0, plane.fuel - plane.throttle * FUEL_BURN_PER_SEC * dt * (plane.flaps ? 1.25 : 1));

  // Pitch and bank answer the stick at once, and ease back when it is released.
  const pitchTarget = ctl.pitch * MAX_PITCH_DEG;
  const rollTarget = ctl.roll * MAX_BANK_DEG;
  plane.pitchDeg += (pitchTarget - plane.pitchDeg) * Math.min(1, dt * 3.2);
  plane.rollDeg += (rollTarget - plane.rollDeg) * Math.min(1, dt * 3.2);

  // The bank turns the nose: a steeper bank turns faster, and only while flying.
  if (!plane.onGround) {
    plane.headingDeg += Math.sin(plane.rollDeg * DEG) * TURN_RATE_DEG * dt * 2.4;
    plane.headingDeg = (plane.headingDeg + 360) % 360;
  }

  // Speed chases the throttle's target, faster with a clean wing, slower with flaps.
  const targetSpeed = plane.throttle * CRUISE_SPEED_KTS * (plane.flaps ? 0.82 : 1);
  const accel = plane.onGround ? 34 : 12; // knots per second
  plane.speedKts += clamp(targetSpeed - plane.speedKts, -accel * dt, accel * dt);

  // Climb needs lift: below stall the nose drops whatever the stick says.
  const stalled = plane.speedKts < STALL_SPEED_KTS && !plane.onGround;
  const climbFpm = stalled
    ? -1400
    : Math.sin(plane.pitchDeg * DEG) * CLIMB_RATE_FPM * (plane.speedKts / CRUISE_SPEED_KTS);
  plane.verticalSpeedFpm += (climbFpm - plane.verticalSpeedFpm) * Math.min(1, dt * 1.6);

  // Move along the heading, and up or down with the climb.
  const h = plane.headingDeg * DEG;
  const v = speedMs(plane);
  plane.x += Math.sin(h) * v * dt;
  plane.z += Math.cos(h) * v * dt;
  plane.alt += plane.verticalSpeedFpm * FPM_TO_MS * dt;

  // Takeoff roll: fast enough and the wheels leave the ground on their own.
  if (plane.onGround) {
    const ground = groundHeightAt(plane.x, plane.z);
    plane.alt = ground;
    if (plane.speedKts > STALL_SPEED_KTS + 8 && plane.pitchDeg > 4) {
      plane.onGround = false;
      plane.gearDown = false;
    }
  }

  // Never outrun the airframe: past redline the drag bites hard.
  if (plane.speedKts > MAX_SPEED_KTS) {
    plane.speedKts -= (plane.speedKts - MAX_SPEED_KTS) * dt * 0.8;
  }
  return { stalled };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
