// Boot and the one loop: input is read every frame, the plane advances in
// fixed 1/60 s steps, and the renderer paints what is there. The game moves
// between title, play, paused and over; the title picks one of three sorties.
//
// #shot=title|flight|landing|courier (with #seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady
// for a screenshot.
import { BEST_KEY, STALL_SPEED_KTS, STEP } from './config.js';
import { createWorld } from './world.js';
import { createPlane } from './plane.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  MISSION_COURIER, MISSION_LANDING, MISSION_RINGS, centrelineDistance,
  judgeLanding, missionById, startMission, updateMission,
} from './missions.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const FT_PER_M = 3.28084;

function hashParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ''));
}

const params = hashParams();
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
const planeApi = createPlane();
const plane = planeApi.plane;
const renderer = createRenderer(canvas, {
  hud: document.getElementById('hud'),
  title: document.getElementById('title'),
  over: document.getElementById('over'),
  paused: document.getElementById('paused'),
  missionLine: document.getElementById('mission-line'),
  timeLine: document.getElementById('time-line'),
  altBox: document.getElementById('alt-box'),
  spdBox: document.getElementById('spd-box'),
  hdgBox: document.getElementById('hdg-box'),
  scoreBox: document.getElementById('score-box'),
  bestBox: document.getElementById('best-box'),
  soundBox: document.getElementById('sound-box'),
  banner: document.getElementById('banner'),
  attitude: document.getElementById('attitude'),
  altNum: document.getElementById('alt-num'),
  spdNum: document.getElementById('spd-num'),
  hdgNum: document.getElementById('hdg-num'),
  compass: document.getElementById('compass'),
  thrBar: document.getElementById('thr-bar'),
  fuelBar: document.getElementById('fuel-bar'),
  fuelText: document.getElementById('fuel-text'),
  gearLamp: document.getElementById('lamp-gear'),
  flapsLamp: document.getElementById('lamp-flaps'),
  stallLamp: document.getElementById('lamp-stall'),
  lowFuelLamp: document.getElementById('lamp-lowfuel'),
  minimap: document.getElementById('minimap'),
  bestLine: document.getElementById('best-line'),
  overTitle: document.getElementById('over-title'),
  overDetail: document.getElementById('over-detail'),
  overScore: document.getElementById('over-score'),
  overSub: document.getElementById('over-sub'),
});
const audio = createAudio();
renderer.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => renderer.resize(window.innerWidth, window.innerHeight));

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}
function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (a data: URL page has none): the best then lasts this visit only.
  }
}

function runShot(name) {
  const s = stageShot(name, world, planeApi);
  let painted = 0;
  function paint() {
    renderer.draw(s);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let mission = missionById(MISSION_RINGS);
  let missionState = null;
  let best = readBest();
  let time = 0;
  let accumulator = 0;
  let last = performance.now();
  let banner = '';
  let bannerUntil = 0;
  let muted = false;
  let lastWarnAt = 0;
  let gearKeyDown = false;

  function announce(message) {
    status.textContent = message;
  }
  function showBanner(text, seconds = 2.5) {
    banner = text;
    bannerUntil = time + seconds;
  }
  function beginMission(id) {
    mission = missionById(id);
    missionState = startMission(world, planeApi, id);
    missionState.startedAt = time;
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.click();
    announce(`${mission.name}. ${mission.blurb}`);
    showBanner(`${mission.name.toUpperCase()} — ${mission.blurb}`, 3.5);
  }
  function endGame() {
    screen = SCREEN_OVER;
    if (missionState.score > best) {
      best = missionState.score;
      saveBest(best);
    }
    announce(`Sortie over. Score ${missionState.score}. Best ${best}.`);
  }
  function crash(detail) {
    missionState.status = 'crashed';
    missionState.detail = detail;
    audio.crash();
    renderer.addShake(1.1);
    endGame();
  }

  // Title cards are real buttons in the DOM; clicking one starts its sortie.
  for (const card of document.querySelectorAll('.card')) {
    card.addEventListener('click', () => beginMission(card.dataset.mission));
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) muted = audio.toggleMute();
    if (screen === SCREEN_TITLE) {
      if (input.wasPressed('one')) return beginMission(MISSION_RINGS);
      if (input.wasPressed('two')) return beginMission(MISSION_LANDING);
      if (input.wasPressed('three')) return beginMission(MISSION_COURIER);
      if (actions & ACTION_CONFIRM) return beginMission(MISSION_RINGS);
      return;
    }
    if (screen === SCREEN_OVER) {
      if (actions & (ACTION_CONFIRM | ACTION_RESTART)) {
        screen = SCREEN_TITLE;
        announce('Sky Courier. Pick a sortie.');
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      screen = screen === SCREEN_PLAY ? SCREEN_PAUSED : SCREEN_PLAY;
      announce(screen === SCREEN_PAUSED ? 'Paused.' : 'Playing.');
      return;
    }
    if (screen === SCREEN_PAUSED && (actions & ACTION_CONFIRM)) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
    if (actions & ACTION_RESTART) {
      screen = SCREEN_TITLE;
      announce('Sky Courier. Pick a sortie.');
    }
  }

  function step() {
    time += STEP;
    if (screen !== SCREEN_PLAY) return;
    const ctl = input.control();
    if (ctl.gear && !gearKeyDown) {
      const down = !plane.gearDown;
      planeApi.setGear(down);
      showBanner(down ? 'GEAR DOWN' : 'GEAR UP');
      audio.click();
    }
    gearKeyDown = ctl.gear;
    plane.flaps = plane.speedKts < 130 && !plane.onGround;
    const dropping = ctl.brake && mission.id === MISSION_COURIER;
    const { stalled } = planeApi.step(ctl, STEP, (x, z) => world.heightAt(x, z));
    plane.groundY = world.heightAt(plane.x, plane.z);

    const agl = plane.alt - plane.groundY;
    const terrainWarn = !plane.onGround && agl < 46
      && centrelineDistance(world, plane) > 40;
    if ((stalled || terrainWarn) && time - lastWarnAt > 2) {
      lastWarnAt = time;
      audio.warn();
    }

    const event = updateMission(world, planeApi, missionState, time, dropping);
    if (event === 'ring') {
      audio.ring();
      renderer.punchFov(4);
      renderer.addShake(0.25);
      showBanner(`RING ${missionState.ringsHit}! +150`);
    } else if (event === 'dropped') {
      audio.land();
      showBanner('PARCEL AWAY!');
      endGame();
      return;
    }
    if (missionState.status === 'complete') {
      audio.land();
      showBanner('COURSE CLEAR!');
      endGame();
      return;
    }

    if (plane.engineOut && plane.onGround) {
      crash('Out of fuel — she rolled to a stop in the fields.');
      return;
    }

    // The ground arrives: a runway touchdown is judged, anything else is a crash.
    const ground = world.heightAt(plane.x, plane.z);
    if (!plane.onGround && plane.alt <= ground + 0.5) {
      plane.alt = ground;
      const { x, z } = plane;
      const r = world.runway;
      const along = Math.abs(x - r.x);
      const lateral = Math.abs(z - r.z);
      const overRunway = along < r.length / 2 + 60 && lateral < r.halfWidth + 4;
      if (overRunway && plane.gearDown && mission.id !== MISSION_RINGS) {
        plane.onGround = true;
        plane.speedKts = Math.max(0, plane.speedKts - 30 * STEP);
        judgeLanding(world, planeApi, missionState, time);
        if (missionState.status === 'landed') {
          audio.land();
          renderer.addShake(0.4);
          showBanner('WHEELS DOWN!');
          endGame();
        } else {
          crash(missionState.detail);
        }
        return;
      }
      if (overRunway && plane.gearDown) {
        plane.onGround = true;
        missionState.status = 'landed';
        missionState.detail = `Rolled out on runway 09 with ${missionState.ringsHit} of 8 rings.`;
        audio.land();
        endGame();
        return;
      }
      if (plane.verticalSpeedFpm < -2200 || !plane.gearDown) {
        crash(plane.gearDown
          ? 'Too hard — the airframe broke up on the hillside.'
          : 'Wheels up — she came down on her belly in the fields.');
        return;
      }
      plane.onGround = true;
      plane.integrity -= 30;
      missionState.status = 'landed';
      missionState.detail = 'Down in the fields — rough, but you walked away.';
      audio.land();
      endGame();
      return;
    }

    audio.update(plane.throttle, plane.speedKts, plane.onGround);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    while (accumulator >= STEP && screen !== SCREEN_PAUSED) {
      step();
      accumulator -= STEP;
      if (screen === SCREEN_OVER || screen === SCREEN_TITLE) break;
    }
    if (screen === SCREEN_PAUSED) accumulator = 0;
    const groundY = world.heightAt(plane.x, plane.z);
    renderer.draw({
      world, plane: planeApi, screen, time,
      mission, missionState: missionState ?? {
        id: MISSION_RINGS, startedAt: 0, ringsHit: 0, score: 0,
        status: 'flying', detail: '', nextRing: 0, dropped: false,
      },
      banner, bannerUntil, muted, best,
      stalled: plane.speedKts < STALL_SPEED_KTS && !plane.onGround,
      terrainWarn: !plane.onGround && (plane.alt - groundY) < 46
        && centrelineDistance(world, plane) > 40,
      aglFt: (plane.alt - groundY) * FT_PER_M,
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Sky Courier. Pick a sortie: Ring Run, Runway Landing, or Island Courier.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
