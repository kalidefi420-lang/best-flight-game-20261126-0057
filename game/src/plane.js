// The aeroplane: a low-poly high-wing bush plane built from boxes, cylinders
// and cones, plus the arcade flight step that moves it. The model faces +X
// in its own space; the group is yawed so +X points along the heading.
// Speeds are knots, angles degrees, distances metres, time seconds.
// THREE is the global from the vendored classic script vendor/three.min.js.
import {
  CLIMB_RATE_MS, FUEL_BURN_BASE, FUEL_BURN_THROTTLE, GEAR_DRAG_KTS,
  MAX_BANK_DEG, MAX_SPEED_KTS, PITCH_AUTHORITY, SINK_RATE_MS, STALL_SPEED_KTS,
  TURN_RATE,
} from './config.js';

const DEG = Math.PI / 180;
const KTS_TO_MS = 0.514444;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function easeToward(current, target, rate, dt) {
  const d = target - current;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

export function createPlane() {
  const plane = {
    x: 0, z: 0, alt: 120,
    headingDeg: 90, pitchDeg: 0, bankDeg: 0,
    speedKts: 110, throttle: 0.62,
    verticalSpeedFpm: 0,
    onGround: false, gearDown: true, flaps: false,
    fuel: 100, integrity: 100, engineOut: false,
    propAngle: 0,
  };

  // --- The model: white fuselage, orange high wing, spinning prop ---
  const group = new THREE.Group();
  group.name = 'sky-courier';
  const white = new THREE.MeshLambertMaterial({ color: 0xf2efe6 });
  const orange = new THREE.MeshLambertMaterial({ color: 0xe86a17 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c343c });
  const glass = new THREE.MeshLambertMaterial({ color: 0x27435c });

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.5, 6.2, 12), white);
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 12), orange);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 3.9;
  group.add(nose);
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 10), white);
  tailCone.rotation.z = Math.PI / 2;
  tailCone.position.x = -4.1;
  group.add(tailCone);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 8), glass);
  canopy.scale.set(1.7, 0.75, 1);
  canopy.position.set(1.1, 0.62, 0);
  group.add(canopy);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 11), orange);
  wing.position.set(0.4, 1.05, 0);
  group.add(wing);
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), dark);
    strut.position.set(0.5, 0.5, side * 2.4);
    strut.rotation.x = side * 0.5;
    group.add(strut);
    const tipLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2a2a : 0x2aff5a }),
    );
    tipLight.position.set(0.4, 1.05, side * 5.5);
    group.add(tipLight);
  }
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 3.4), orange);
  stab.position.set(-4.4, 0.25, 0);
  group.add(stab);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.7, 0.14), orange);
  fin.position.set(-4.4, 0.9, 0);
  fin.rotation.z = 0.35;
  group.add(fin);
  // Propeller: spinner, two blades, and a faint disc when it spins.
  const prop = new THREE.Group();
  prop.position.set(4.7, 0, 0);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 10), orange);
  spinner.rotation.z = -Math.PI / 2;
  prop.add(spinner);
  for (const a of [0, Math.PI]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.4, 0.3), dark);
    blade.rotation.x = a;
    blade.position.x = 0.2;
    prop.add(blade);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.75, 24),
    new THREE.MeshBasicMaterial({
      color: 0xcccccc, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
    }),
  );
  disc.position.x = 0.25;
  disc.rotation.y = Math.PI / 2;
  prop.add(disc);
  group.add(prop);
  // Fixed tricycle gear, hidden when the pilot retracts it.
  const gear = new THREE.Group();
  gear.name = 'landing-gear';
  for (const [gx, gz] of [[1.6, -1.1], [1.6, 1.1], [-2.6, 0]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), dark);
    leg.position.set(gx, -1.05, gz);
    gear.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), dark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(gx, -1.6, gz);
    gear.add(wheel);
  }
  group.add(gear);
  group.rotation.order = 'YXZ';
  plane.mesh = group;
  plane.prop = prop;
  plane.gearMesh = gear;

  function reset(x, z, alt, headingDeg, speedKts) {
    plane.x = x;
    plane.z = z;
    plane.alt = alt;
    plane.headingDeg = headingDeg;
    plane.pitchDeg = 0;
    plane.bankDeg = 0;
    plane.speedKts = speedKts;
    plane.throttle = 0.62;
    plane.verticalSpeedFpm = 0;
    plane.onGround = false;
    plane.gearDown = true;
    plane.flaps = false;
    plane.fuel = 100;
    plane.integrity = 100;
    plane.engineOut = false;
    syncMesh();
  }

  function setGear(down) {
    plane.gearDown = down;
    gear.visible = down;
  }

  function syncMesh() {
    group.position.set(plane.x, plane.alt, plane.z);
    group.rotation.y = (90 - plane.headingDeg) * DEG;
    group.rotation.x = plane.bankDeg * DEG;
    group.rotation.z = plane.pitchDeg * DEG;
  }

  // One fixed step of arcade flight. ctl carries pitch (-1..1, up positive),
  // bank (-1..1, right positive), throttleUp/throttleDown booleans, brake.
  // Returns { stalled } for the HUD and the warning horn.
  function step(ctl, dt, groundHeightAt) {
    if (plane.onGround) {
      // Rolling out: speed bleeds off, the plane stays planted.
      plane.speedKts = Math.max(0, plane.speedKts - 22 * dt);
      plane.pitchDeg = 0;
      plane.bankDeg = easeToward(plane.bankDeg, 0, 90, dt);
      plane.verticalSpeedFpm = 0;
      syncMesh();
      return { stalled: false };
    }
    if (ctl.throttleUp) plane.throttle = clamp(plane.throttle + 0.55 * dt, 0, 1);
    if (ctl.throttleDown) plane.throttle = clamp(plane.throttle - 0.55 * dt, 0, 1);
    if (plane.engineOut) plane.throttle = 0;

    const stall = STALL_SPEED_KTS - (plane.flaps ? 8 : 0);
    const stalled = plane.speedKts < stall;
    // Speed chases the throttle, with drag from gear and flaps, and a
    // penalty for climbing. Idle still glides at ~78 kt, so a brief throttle
    // cut on final costs speed without instantly stalling the wing.
    let target = 78 + plane.throttle * (MAX_SPEED_KTS - 78);
    if (plane.gearDown) target -= GEAR_DRAG_KTS;
    if (plane.flaps) target -= 9;
    target -= Math.max(0, plane.pitchDeg) * 1.4;
    plane.speedKts = easeToward(plane.speedKts, Math.max(0, target), stalled ? 10 : 14, dt);

    // Bank eases toward the stick, then turns the heading.
    const bankTarget = clamp(ctl.bank, -1, 1) * MAX_BANK_DEG;
    plane.bankDeg = easeToward(plane.bankDeg, bankTarget, 120, dt);
    const speedFactor = clamp(plane.speedKts / 150, 0.35, 1.25);
    plane.headingDeg = (plane.headingDeg + plane.bankDeg * TURN_RATE * speedFactor * dt + 360) % 360;

    // Pitch eases toward the stick; a stalled wing barely answers.
    const pitchAuthority = stalled ? 0.35 : PITCH_AUTHORITY;
    const pitchTarget = clamp(ctl.pitch, -1, 1) * 17 * pitchAuthority;
    plane.pitchDeg = easeToward(plane.pitchDeg, pitchTarget, 55, dt);

    // Vertical speed follows pitch and power; a stall sinks the nose.
    const speedMs = plane.speedKts * KTS_TO_MS;
    let vsMs = Math.sin(plane.pitchDeg * DEG) * speedMs * 0.92;
    vsMs += (plane.throttle - 0.55) * CLIMB_RATE_MS * 0.55;
    vsMs -= SINK_RATE_MS * 0.16;
    if (stalled) vsMs -= 6.5;
    if (plane.flaps && plane.speedKts < 130) vsMs += 1.2;
    plane.verticalSpeedFpm = vsMs * 196.85;
    plane.alt += vsMs * dt;

    // The airbrake scrubs speed in the air.
    if (ctl.brake) plane.speedKts = Math.max(0, plane.speedKts - 26 * dt);

    // Fuel: cruise sips it, full throttle drinks it.
    plane.fuel = Math.max(0, plane.fuel - (FUEL_BURN_BASE + plane.throttle * FUEL_BURN_THROTTLE) * dt);
    if (plane.fuel <= 0 && !plane.engineOut) {
      plane.engineOut = true;
    }

    plane.propAngle += (4 + plane.throttle * 26 + plane.speedKts * 0.05) * dt;
    prop.rotation.x = plane.propAngle;
    syncMesh();
    return { stalled };
  }

  return { plane, reset, setGear, syncMesh, step };
}
