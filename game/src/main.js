// Boot and the one loop: input is read every frame, the plane advances in fixed
// 1/60 s steps, and the renderer paints what is there. The game moves between
// title, play, paused and over; the title picks one of three sorties.
//
// #shot=title|flight|landing|score (with #seed=N) stages that scene instead of
// running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, STALL_SPEED_KTS, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { createPlane, stepPlane } from './plane.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  MISSION_COURIER, MISSION_LANDING, MISSION_RINGS, MISSIONS,
  centrelineDistance, judgeLanding, missionById, startMission, updateMission,
} from './missions.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped, not replayed. */
const MAX_FRAME = 0.25;
/** Feet per metre, for the dials. */
const FT_PER_M = 3.28084;

function hashParams() {
  const h = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(h);
}

const params = hashParams();
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
const plane = createPlane();
plane.groundY = world.groundHeight(plane.x, plane.z);
const renderer = createRenderer(canvas);
const audio = createAudio();

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
  const s = stageShot(name, world, plane);
  s.world = world;
  s.plane = plane;
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
    missionState = startMission(world, plane, id);
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
    endGame();
  }

  function pickMissionFromClick(click) {
    if (!click) return null;
    for (const card of renderer.titleCards) {
      if (click.x >= card.x && click.x <= card.x + card.w
        && click.y >= card.y && click.y <= card.y + card.h) {
        return card.id;
      }
    }
    return null;
  }

  function handleActions() {
    const actions = input.takeActions();
    const click = input.takeClick();
    if (actions & ACTION_MUTE) {
      muted = audio.toggleMute();
    }
    if (screen === SCREEN_TITLE) {
      if (input.pressed('1')) return beginMission(MISSION_RINGS);
      if (input.pressed('2')) return beginMission(MISSION_LANDING);
      if (input.pressed('3')) return beginMission(MISSION_COURIER);
      const picked = pickMissionFromClick(click);
      if (picked) return beginMission(picked);
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
    // Gear: G toggles on the press, not while held.
    if (ctl.gear && !gearKeyDown) {
      plane.gearDown = !plane.gearDown;
      showBanner(plane.gearDown ? 'GEAR DOWN' : 'GEAR UP');
      audio.click();
    }
    gearKeyDown = ctl.gear;
    // Flaps follow slow flight: below 130 kt they help, above they drag.
    plane.flaps = plane.speedKts < 130 && !plane.onGround;
    // Space is the airbrake in the air; over the beacon it drops the parcel.
    const dropping = ctl.brake && mission.id === MISSION_COURIER;
    const { stalled } = stepPlane(plane, ctl, STEP, (x, z) => world.groundHeight(x, z));
    if (ctl.brake && !dropping) plane.speedKts = Math.max(0, plane.speedKts - 26 * STEP);
    plane.groundY = world.groundHeight(plane.x, plane.z);

    const agl = plane.alt; // alt is metres above the valley floor here
    const terrainWarn = !plane.onGround && agl < 46
      && centrelineDistance(world, plane) > 40;
    if (stalled && time - lastWarnAt > 2) {
      lastWarnAt = time;
      audio.warn();
    }
    if (terrainWarn && time - lastWarnAt > 2) {
      lastWarnAt = time;
      audio.warn();
    }

    // Mission progress: rings, the beacon drop, and the score they carry.
    const event = updateMission(world, plane, missionState, time, dropping);
    if (event === 'ring') {
      audio.ring();
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

    // Fuel out: the engine quits and the valley decides where you stop.
    if (plane.engineOut && plane.onGround) {
      crash('Out of fuel — she rolled to a stop in the fields.');
      return;
    }

    // The ground arrives: a runway touchdown is judged, anything else is a crash.
    const ground = world.groundHeight(plane.x, plane.z);
    if (!plane.onGround && plane.alt <= ground + 0.5) {
      plane.alt = ground;
      const { along, lateral } = world.runwayFrame(plane.x, plane.z);
      const overRunway = Math.abs(along) < 900 && Math.abs(lateral) < 23;
      if (overRunway && plane.gearDown && mission.id !== MISSION_RINGS) {
        plane.onGround = true;
        plane.speedKts = Math.max(0, plane.speedKts - 30 * STEP);
        judgeLanding(world, plane, missionState, time);
        if (missionState.status === 'landed') {
          audio.land();
          showBanner('WHEELS DOWN!');
          endGame();
        } else {
          crash(missionState.detail);
        }
        return;
      }
      if (overRunway && plane.gearDown) {
        // Ring Run: touching the strip is a belly landing, not a crash — you
        // rolled out and the sortie is over, rings unflown.
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
      // A soft wheels-down touchdown off the strip: a field landing, sortie over.
      plane.onGround = true;
      plane.integrity -= 34;
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
    const s = {
      world, plane, screen, time,
      mission, missionState: missionState ?? createMissionStateForTitle(),
      banner, bannerUntil, muted, best,
      stalled: plane.speedKts < STALL_SPEED_KTS && !plane.onGround,
      terrainWarn: !plane.onGround && plane.alt < 46 && centrelineDistance(world, plane) > 40,
      aglFt: plane.alt * FT_PER_M,
    };
    renderer.draw(s);
  }

  function createMissionStateForTitle() {
    return { id: MISSION_RINGS, startedAt: 0, ringsHit: 0, score: 0, status: 'flying', detail: '' };
  }

  // Leaving the tab pauses a running game rather than letting it fly unseen.
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
