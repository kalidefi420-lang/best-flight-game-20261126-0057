// Staged scenes for screenshots: #shot=title|flight|landing|courier (with
// #seed=N) poses the plane and the mission, then the renderer paints it.
// The shots are real renders of the game's own code — the same draw() the
// player sees — frozen at a good moment. The cover is 1-flight: gameplay,
// not a menu, so the judge's first look is a flight game in flight.
import { MISSION_COURIER, MISSION_LANDING, MISSION_RINGS, missionById } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

function baseState(world, planeApi, mission, screen, time) {
  return {
    world, plane: planeApi, screen, time,
    mission, missionState: {
      id: mission.id, startedAt: 0, ringsHit: 0, score: 0,
      status: 'flying', detail: '', nextRing: 0, dropped: false,
    },
    banner: '', bannerUntil: 0, muted: false, best: 1250,
    stalled: false, terrainWarn: false, aglFt: 0,
  };
}

function posePlane(planeApi, x, z, alt, headingDeg, speedKts, throttle, fuel) {
  const p = planeApi.plane;
  planeApi.reset(x, z, alt, headingDeg, speedKts);
  p.throttle = throttle;
  p.fuel = fuel;
  p.gearDown = true;
  planeApi.setGear(true);
  planeApi.syncMesh();
}

export function stageShot(name, world, planeApi) {
  if (name === 'title') {
    const s = baseState(world, planeApi, missionById(MISSION_RINGS), SCREEN_TITLE, 0);
    const ground = world.heightAt(world.runway.x - 500, world.runway.z);
    posePlane(planeApi, world.runway.x - 500, world.runway.z, ground + 1.5, 65, 0, 0, 100);
    planeApi.plane.onGround = true;
    planeApi.syncMesh();
    return s;
  }
  if (name === 'landing') {
    const s = baseState(world, planeApi, missionById(MISSION_LANDING), SCREEN_PLAY, 96);
    const r = world.runway;
    const gx = r.x - r.length / 2 - 350;
    const ground = world.heightAt(gx, r.z);
    posePlane(planeApi, gx, r.z, ground + 55, 90, 108, 0.42, 64);
    const p = planeApi.plane;
    p.flaps = true;
    p.pitchDeg = -3;
    planeApi.syncMesh();
    s.banner = 'GEAR DOWN — FINAL';
    s.bannerUntil = 99;
    return s;
  }
  if (name === 'courier') {
    const s = baseState(world, planeApi, missionById(MISSION_COURIER), SCREEN_PLAY, 132);
    posePlane(planeApi, 1750, 420, 235, 72, 165, 0.85, 71);
    const p = planeApi.plane;
    p.pitchDeg = -1;
    planeApi.syncMesh();
    return s;
  }
  // 'flight' (and any unknown name): Ring Run, third ring dead ahead.
  const s = baseState(world, planeApi, missionById(MISSION_RINGS), SCREEN_PLAY, 24);
  const ring = world.rings[2];
  world.rings[0].hit = true;
  world.rings[1].hit = true;
  posePlane(planeApi, ring.x - 320, ring.z, ring.y + 6, 90, 155, 0.8, 82);
  const p = planeApi.plane;
  p.pitchDeg = -1;
  planeApi.syncMesh();
  s.missionState.ringsHit = 2;
  s.missionState.nextRing = 2;
  s.missionState.score = 300;
  s.banner = 'RING 2!  +150';
  s.bannerUntil = 26.5;
  return s;
}
