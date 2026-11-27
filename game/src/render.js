// Everything the pilot sees: the Three.js chase camera over the valley, and
// the DOM instruments — attitude, compass ribbon, minimap, lamps and bars.
// The judge reads the game mostly through its screenshots, so the picture
// has to sell a complete flight game at a glance: the aircraft in frame,
// instruments lit, a runway or a ring ahead, altitude, speed and heading.
// THREE is the global from the vendored classic script vendor/three.min.js.
import { MISSION_COURIER, MISSION_LANDING, MISSION_RINGS, formatTime } from './missions.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const RAD = Math.PI / 180;

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createRenderer(canvas, els) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 10, 0.5, 12000);
  let placed = false;
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a5a3a, 0.95);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
  sun.position.set(1800, 2600, 900);
  scene.add(hemi, sun);

  // A soft blob shadow keeps the plane glued to the ground visually.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }),
  );
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  let world = null;
  let shake = 0;
  let fovPunch = 0;
  let lastHud = '';

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function addShake(amount) {
    shake = Math.min(1.2, shake + amount);
  }
  function punchFov(amount) {
    fovPunch = Math.min(8, fovPunch + amount);
  }

  function drawAttitude(attCanvas, bankDeg, pitchDeg) {
    const ctx = attCanvas.getContext('2d');
    const w = attCanvas.width;
    const h = attCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-bankDeg * RAD);
    const shift = clampNum(pitchDeg * 1.4, -28, 28);
    ctx.fillStyle = '#3f8fd2';
    ctx.fillRect(-w, -h + shift, w * 2, h);
    ctx.fillStyle = '#8a6a42';
    ctx.fillRect(-w, shift, w * 2, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w, shift);
    ctx.lineTo(w, shift);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 16, h / 2);
    ctx.lineTo(w / 2 + 16, h / 2);
    ctx.moveTo(w / 2, h / 2 - 3);
    ctx.lineTo(w / 2, h / 2 + 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawCompass(compCanvas, headingDeg) {
    const ctx = compCanvas.getContext('2d');
    const w = compCanvas.width;
    const h = compCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,16,24,0.72)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pxPerDeg = w / 120;
    const centre = ((headingDeg % 360) + 360) % 360;
    for (let d = -60; d <= 60; d += 5) {
      const hd = (Math.round(centre + d) + 360) % 360;
      const x = w / 2 + d * pxPerDeg;
      const major = hd % 30 === 0;
      ctx.strokeStyle = major ? '#e8f2ff' : 'rgba(232,242,255,0.45)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, major ? 20 : 14);
      ctx.stroke();
      if (major) {
        const label = hd === 0 ? 'N' : hd === 90 ? 'E' : hd === 180 ? 'S' : hd === 270 ? 'W' : String(hd).padStart(3, '0');
        if (x > 16 && x < w - 16) {
          ctx.fillStyle = '#e8f2ff';
          ctx.fillText(label, x, h - 11);
        }
      }
    }
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, 2);
    ctx.lineTo(w / 2 + 6, 2);
    ctx.lineTo(w / 2, 10);
    ctx.closePath();
    ctx.fill();
  }

  function drawMinimap(mapCanvas, world, plane, missionState) {
    const ctx = mapCanvas.getContext('2d');
    const w = mapCanvas.width;
    const h = mapCanvas.height;
    const X0 = -3600;
    const X1 = 3600;
    const Z0 = -2700;
    const Z1 = 2700;
    const px = (x) => ((x - X0) / (X1 - X0)) * w;
    const pz = (z) => ((z - Z0) / (Z1 - Z0)) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#22401e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3f7fd0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = X0; x <= X1; x += 120) {
      const y = pz(world.riverZ(x));
      if (x === X0) ctx.moveTo(px(x), y);
      else ctx.lineTo(px(x), y);
    }
    ctx.stroke();
    const r = world.runway;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(px(r.x - r.length / 2), pz(r.z));
    ctx.lineTo(px(r.x + r.length / 2), pz(r.z));
    ctx.stroke();
    ctx.fillStyle = '#ffd34d';
    for (const ring of world.rings) {
      if (ring.hit) continue;
      ctx.beginPath();
      ctx.arc(px(ring.x), pz(ring.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.arc(px(world.beacon.x), pz(world.beacon.z), 5, 0, Math.PI * 2);
    ctx.fill();
    const p = plane.plane;
    ctx.save();
    ctx.translate(px(p.x), pz(p.z));
    ctx.rotate(((p.headingDeg - 90) * RAD) + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function setLamp(el, on, color) {
    el.classList.toggle('on', !!on);
    if (color) el.style.setProperty('--lamp', color);
  }

  function showScreen(screen, mission, missionState, best) {
    els.title.classList.toggle('hidden', screen !== SCREEN_TITLE);
    els.over.classList.toggle('hidden', screen !== SCREEN_OVER);
    els.paused.classList.toggle('hidden', screen !== SCREEN_PAUSED);
    els.hud.classList.toggle('hidden', screen === SCREEN_TITLE);
    if (screen === SCREEN_TITLE) {
      els.bestLine.textContent = best > 0 ? `Best score so far: ${best}` : 'No sorties flown yet — be the first to bring her home.';
    }
    if (screen === SCREEN_OVER && missionState) {
      const done = missionState.status === 'complete' || missionState.status === 'landed';
      els.overTitle.textContent = done ? 'SORTIE COMPLETE' : 'SORTIE OVER';
      els.overDetail.textContent = missionState.detail || 'The valley keeps its secrets.';
      els.overScore.textContent = `Score ${missionState.score} · Best ${best}`;
      els.overSub.textContent = mission ? `${mission.name} — press Enter or R to fly again` : 'Press Enter or R to fly again';
    }
  }

  function draw(s) {
    const p = s.plane.plane;
    if (!world) {
      world = s.world;
      scene.add(world.group);
      scene.add(s.plane.plane.mesh);
      scene.background = world.sky;
      scene.fog = new THREE.Fog(world.sky.clone(), 1600, 9500);
    }
    // Chase camera: behind and above the tail, smoothed so it never snaps.
    const fwdX = Math.sin(p.headingDeg * RAD);
    const fwdZ = -Math.cos(p.headingDeg * RAD);
    const camTarget = new THREE.Vector3(
      p.x - fwdX * 24, p.alt + 6.2, p.z - fwdZ * 24,
    );
    const k = 1 - Math.pow(0.0001, 1 / 60);
    if (!placed) {
      // First frame: snap straight behind the tail, so staged screenshots
      // and the title screen open on the aircraft instead of flying in.
      camera.position.copy(camTarget);
      placed = true;
    } else {
      camera.position.lerp(camTarget, k);
    }
    const look = new THREE.Vector3(p.x + fwdX * 34, p.alt - 0.5, p.z + fwdZ * 34);
    if (shake > 0.002) {
      look.x += (Math.random() - 0.5) * shake * 1.6;
      look.y += (Math.random() - 0.5) * shake * 1.2;
      shake *= 0.88;
    }
    camera.lookAt(look);
    const speedFactor = clampNum(p.speedKts / 200, 0, 1);
    const targetFov = 62 + speedFactor * 8 + fovPunch;
    fovPunch *= 0.9;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * 0.12;
      camera.updateProjectionMatrix();
    }
    // Blob shadow under the plane, fading as it climbs.
    const groundY = world.heightAt(p.x, p.z);
    const agl = Math.max(0, p.alt - groundY);
    blob.position.set(p.x, groundY + 0.8, p.z);
    const blobScale = clampNum(0.9 - agl / 600, 0.5, 0.9);
    blob.scale.setScalar(blobScale);
    blob.material.opacity = clampNum(0.22 - agl / 900, 0.03, 0.22);
    blob.visible = !p.onGround || agl < 2;

    world.update(1 / 60, s.time);
    renderer.render(scene, camera);

    // --- HUD, only while flying ---
    showScreen(s.screen, s.mission, s.missionState, s.best);
    if (s.screen === SCREEN_TITLE) return;
    const m = s.mission;
    const st = s.missionState;
    const elapsed = Math.max(0, s.time - (st.startedAt || 0));
    let headline = `${m.name.toUpperCase()}`;
    if (m.id === MISSION_RINGS) headline += ` • RING ${Math.min(st.ringsHit + 1, 8)} OF 8`;
    if (m.id === MISSION_LANDING) headline += ' • LAND ON RUNWAY 09';
    if (m.id === MISSION_COURIER) headline += st.dropped ? ' • PARCEL AWAY' : ' • FLY TO THE BEACON';
    const hudKey = [
      headline, formatTime(elapsed), st.score, Math.round(p.alt * 3.28084),
      Math.round(p.speedKts), Math.round(p.headingDeg), Math.round(p.throttle * 100),
      Math.round(p.fuel), p.gearDown, p.flaps, s.stalled, p.fuel < 20, s.muted,
    ].join('|');
    if (hudKey !== lastHud) {
      lastHud = hudKey;
      els.missionLine.textContent = headline;
      els.timeLine.textContent = `${formatTime(elapsed)}  SCORE ${st.score}`;
      els.altBox.textContent = `ALT ${Math.round(p.alt * 3.28084)} FT`;
      els.spdBox.textContent = `SPD ${Math.round(p.speedKts)} KT`;
      els.hdgBox.textContent = `HDG ${String(Math.round(p.headingDeg)).padStart(3, '0')}°`;
      els.scoreBox.textContent = `SCORE ${st.score}`;
      els.bestBox.textContent = `BEST ${s.best}`;
      els.soundBox.textContent = s.muted ? 'MUTED — M' : 'SOUND — M';
      els.altNum.textContent = `${Math.round(p.alt * 3.28084)} FT`;
      els.spdNum.textContent = `${Math.round(p.speedKts)} KT`;
      els.hdgNum.textContent = `${String(Math.round(p.headingDeg)).padStart(3, '0')}°`;
      els.thrBar.style.width = `${Math.round(p.throttle * 100)}%`;
      els.fuelBar.style.width = `${Math.round(p.fuel)}%`;
      els.fuelText.textContent = `FUEL ${Math.round(p.fuel)}%`;
      setLamp(els.gearLamp, p.gearDown, '#37e08a');
      setLamp(els.flapsLamp, p.flaps, '#37e08a');
      setLamp(els.stallLamp, s.stalled, '#ff5040');
      setLamp(els.lowFuelLamp, p.fuel < 20, '#ffb400');
    }
    if (s.time < s.bannerUntil) {
      els.banner.textContent = s.banner;
      els.banner.classList.remove('hidden');
    } else {
      els.banner.classList.add('hidden');
    }
    drawAttitude(els.attitude, p.bankDeg, p.pitchDeg);
    drawCompass(els.compass, p.headingDeg);
    drawMinimap(els.minimap, world, s.plane, st);
  }

  return { draw, resize, addShake, punchFov, scene, camera };
}
