// Staged scenes for screenshots: the same game, the same world, frozen at four
// moments that show it at its best — the title over the runway, rings ahead,
// final approach, and a landed score. Deterministic: fixed seed, fixed states.
import { placeInAir } from './plane.js';
import { createMissionState, startMission } from './missions.js';

/** Stage one named scene and return the draw state for it. */
export function stageShot(name, world, plane) {
  if (name === 'title') {
    // Parked on the runway threshold, engine idling, the valley ahead.
    plane.x = -1150;
    plane.z = 0;
    plane.alt = 0;
    plane.groundY = 0;
    plane.headingDeg = 90;
    plane.pitchDeg = 0;
    plane.rollDeg = 0;
    plane.speedKts = 0;
    plane.throttle = 0.35;
    plane.fuel = 100;
    plane.integrity = 100;
    plane.gearDown = true;
    plane.onGround = true;
    world.reset();
    return {
      screen: 'title', time: 2.4, mission: { id: 'rings', name: 'Ring Run' },
      missionState: createMissionState('rings'), banner: '', bannerUntil: 0,
      stalled: false, terrainWarn: false, aglFt: 0, best: 1250, muted: false,
    };
  }
  if (name === 'flight') {
    // Mid-course on the Ring Run: three rings ahead, gear up, climbing gently.
    startMission(world, plane, 'rings');
    plane.x = -300;
    plane.z = world.riverZ(-300);
    plane.alt = 260;
    plane.groundY = world.groundHeight(plane.x, plane.z);
    plane.headingDeg = 90;
    plane.pitchDeg = 4;
    plane.rollDeg = -12;
    plane.speedKts = 186;
    plane.throttle = 0.8;
    plane.gearDown = false;
    const missionState = createMissionState('rings');
    missionState.startedAt = 0;
    missionState.ringsHit = 2;
    missionState.score = 300;
    world.rings[0].hit = true;
    world.rings[1].hit = true;
    return {
      screen: 'play', time: 24, mission: { id: 'rings', name: 'Ring Run' },
      missionState, banner: 'RING 2! +150', bannerUntil: 26,
      stalled: false, terrainWarn: false, aglFt: 853, best: 1250, muted: false,
    };
  }
  if (name === 'landing') {
    // Short final for runway 09: gear down, flaps, just off centreline so the
    // strip reads beside the aircraft instead of hiding behind it.
    startMission(world, plane, 'landing');
    plane.x = -1700;
    plane.z = 45;
    plane.alt = 180;
    plane.groundY = world.groundHeight(plane.x, plane.z);
    plane.headingDeg = 90;
    plane.pitchDeg = -3;
    plane.rollDeg = 2;
    plane.speedKts = 108;
    plane.throttle = 0.42;
    plane.gearDown = true;
    plane.flaps = true;
    const missionState = createMissionState('landing');
    missionState.startedAt = 0;
    return {
      screen: 'play', time: 96, mission: { id: 'landing', name: 'Runway Landing' },
      missionState, banner: 'GEAR DOWN — FINAL', bannerUntil: 98,
      stalled: false, terrainWarn: false, aglFt: 591, best: 1250, muted: false,
    };
  }
  // 'score': a gentle touchdown just made, the verdict on screen.
  startMission(world, plane, 'landing');
  plane.x = -120;
  plane.z = 4;
  plane.alt = 0;
  plane.groundY = 0;
  plane.headingDeg = 90;
  plane.pitchDeg = 0;
  plane.rollDeg = 0;
  plane.speedKts = 62;
  plane.throttle = 0;
  plane.gearDown = true;
  plane.flaps = true;
  plane.onGround = true;
  const missionState = createMissionState('landing');
  missionState.startedAt = 0;
  missionState.status = 'landed';
  missionState.score = 740;
  missionState.detail = 'Down in the sweet spot, 4 m off centreline, 310 fpm — +740.';
  return {
    screen: 'over', time: 130, mission: { id: 'landing', name: 'Runway Landing' },
    missionState, banner: '', bannerUntil: 0,
    stalled: false, terrainWarn: false, aglFt: 0, best: 1250, muted: false,
  };
}
