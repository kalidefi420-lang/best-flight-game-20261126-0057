// The painter: a chase-view pseudo-3D sky over the valley. The world is drawn in a
// context rolled with the bank, the aircraft is drawn in screen space at the
// bottom, and the instruments and HUD are drawn flat on top of both. Every frame
// paints sky, ridges, clouds, ground patches, river, town, runway, rings, beacon,
// plane, panel and screens — in that order, far to near.
import {
  DEG, GAUGE_DANGER, GAUGE_LIT, GAUGE_WARN, HUD_TEXT, PANEL_BG,
  PANEL_EDGE, RING_COLOR, RUNWAY_COLOR, RUNWAY_MARK_COLOR, SKY_HORIZON,
  SKY_MID, SKY_TOP, SUN_COLOR,
} from './config.js';
import { MISSIONS } from './missions.js';
import { nextRing } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const FOV_DEG = 62;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let focal = 800;
  // Mission-card rectangles from the last title paint, for click picking.
  let titleCards = [];

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(320, Math.floor(r.width));
    H = Math.max(240, Math.floor(r.height));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    focal = (H * 0.5) / Math.tan((FOV_DEG / 2) * DEG);
  }

  // --- Camera and projection -------------------------------------------------
  function camera(plane) {
    const h = plane.headingDeg * DEG;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const groundY = plane.groundY ?? 0;
    // Chase camera: behind and above the tail, looking where the nose points.
    const cam = {
      x: plane.x - fx * 16,
      y: groundY + plane.alt + 5,
      z: plane.z - fz * 16,
    };
    const pitch = plane.pitchDeg * 0.55 * DEG;
    const fwd = norm3(fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch));
    const right = norm3(fwd[2], 0, -fwd[0]);
    const up = cross(fwd, right); // cross(fwd, right) is world-up when facing forward
    return { cam, fwd, right, up, cy: H * 0.46 };
  }

  function project(cam, x, y, z) {
    const dx = x - cam.cam.x;
    const dy = y - cam.cam.y;
    const dz = z - cam.cam.z;
    const f = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
    if (f < 4) return null;
    const r = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
    const u = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
    const s = focal / f;
    return { x: W / 2 + r * s, y: cam.cy - u * s, s, f };
  }

  function poly(points, fill) {
    if (points.some((p) => !p)) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // --- Sky, sun, ridges, clouds ----------------------------------------------
  function drawSky(plane, time) {
    const horizonY = H * 0.46 + plane.pitchDeg * 4;
    const g = ctx.createLinearGradient(0, 0, 0, horizonY);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(0.55, SKY_MID);
    g.addColorStop(1, SKY_HORIZON);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizonY + 1);
    // Late sun low in the east: it rides the horizon and tints the haze.
    const sunX = W * 0.72 - plane.headingDeg * 0.6;
    const sunY = horizonY - H * 0.16;
    const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 180);
    glow.addColorStop(0, 'rgba(255, 220, 140, 0.95)');
    glow.addColorStop(0.25, 'rgba(255, 200, 120, 0.45)');
    glow.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 190, sunY - 190, 380, 380);
    ctx.fillStyle = SUN_COLOR;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
    ctx.fill();
    // Ground base: hazy valley green darkening toward the viewer.
    const gg = ctx.createLinearGradient(0, horizonY, 0, H);
    gg.addColorStop(0, '#7d9b58');
    gg.addColorStop(0.5, '#5d8446');
    gg.addColorStop(1, '#42632f');
    ctx.fillStyle = gg;
    ctx.fillRect(0, horizonY, W, H - horizonY);
    return horizonY;
  }

  function drawRidges(plane, horizonY) {
    // Layered silhouettes: their peaks slide with heading so turning feels real.
    const layers = [
      { base: 0.30, amp: 0.05, color: 'rgba(143, 168, 196, 0.85)', k: 0.004, off: 11 },
      { base: 0.42, amp: 0.07, color: 'rgba(109, 137, 168, 0.9)', k: 0.006, off: 23 },
      { base: 0.55, amp: 0.09, color: 'rgba(77, 104, 138, 0.95)', k: 0.008, off: 47 },
    ];
    for (const L of layers) {
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let x = 0; x <= W; x += 16) {
        const n = Math.sin((x + plane.headingDeg * 14 + L.off * 97) * L.k)
          * 0.6 + Math.sin((x + L.off * 31) * L.k * 2.7) * 0.4;
        const y = horizonY - H * (L.base * 0.28 + n * L.amp);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, horizonY);
      ctx.closePath();
      ctx.fillStyle = L.color;
      ctx.fill();
    }
  }

  function drawClouds(world, cam) {
    const sorted = [...world.clouds].sort((a, b) => {
      const da = Math.hypot(a.x - cam.cam.x, a.z - cam.cam.z);
      const db = Math.hypot(b.x - cam.cam.x, b.z - cam.cam.z);
      return db - da;
    });
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const c of sorted) {
      const p = project(cam, c.x, c.y, c.z);
      if (!p) continue;
      const s = p.s * c.s * 0.0016;
      if (s < 4) continue;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, s * 1.6, s * 0.55, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x - s * 0.9, p.y + s * 0.12, s * 0.9, s * 0.4, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + s * 0.9, p.y + s * 0.12, s, s * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- Ground features ---------------------------------------------------------
  function groundCircle(cam, world, cx, cz, r, fill) {
    const pts = [];
    const y = world.groundHeight(cx, cz) + 1;
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      pts.push(project(cam, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
    }
    poly(pts, fill);
  }

  function drawGround(world, cam, plane) {
    // Fields: seeded crop rectangles, far first.
    const fields = [...world.fields].sort((a, b) => {
      const da = Math.hypot(a.x - plane.x, a.z - plane.z);
      const db = Math.hypot(b.x - plane.x, b.z - plane.z);
      return db - da;
    });
    for (const f of fields) {
      const dx = f.x - plane.x;
      const dz = f.z - plane.z;
      if (Math.hypot(dx, dz) > 6500) continue;
      const c = Math.cos(f.rot);
      const s = Math.sin(f.rot);
      const corners = [
        [-f.w / 2, -f.d / 2], [f.w / 2, -f.d / 2],
        [f.w / 2, f.d / 2], [-f.w / 2, f.d / 2],
      ].map(([lx, lz]) => {
        const wx = f.x + lx * c - lz * s;
        const wz = f.z + lx * s + lz * c;
        return project(cam, wx, world.groundHeight(wx, wz) + 0.5, wz);
      });
      poly(corners, f.color);
    }
    // River: a blue ribbon winding down the valley.
    for (let i = 0; i < world.river.length - 1; i++) {
      const a = world.river[i];
      const b = world.river[i + 1];
      const quad = [
        project(cam, a.x, world.groundHeight(a.x, a.z - a.w / 2) + 0.5, a.z - a.w / 2),
        project(cam, a.x, world.groundHeight(a.x, a.z + a.w / 2) + 0.5, a.z + a.w / 2),
        project(cam, b.x, world.groundHeight(b.x, b.z + b.w / 2) + 0.5, b.z + b.w / 2),
        project(cam, b.x, world.groundHeight(b.x, b.z - b.w / 2) + 0.5, b.z - b.w / 2),
      ];
      poly(quad, 'rgba(63, 127, 174, 0.92)');
    }
    // Pine woods: dark patches on the hillsides.
    for (const w of world.woods) {
      groundCircle(cam, world, w.x, w.z, w.r, 'rgba(63, 109, 51, 0.85)');
    }
    // Millford: grey town blocks by the runway's west end.
    for (const t of world.town) {
      const corners = [
        project(cam, t.x, world.groundHeight(t.x, t.z) + 1, t.z),
        project(cam, t.x + t.w, world.groundHeight(t.x + t.w, t.z) + 1, t.z),
        project(cam, t.x + t.w, world.groundHeight(t.x + t.w, t.z + t.d) + 1, t.z + t.d),
        project(cam, t.x, world.groundHeight(t.x, t.z + t.d) + 1, t.z + t.d),
      ];
      poly(corners, 'rgba(154, 147, 138, 0.9)');
    }
    drawRunway(world, cam);
  }

  function drawRunway(world, cam) {
    const hw = 23;
    const pts = (along, lat) => {
      const x = along; // runway runs east-west, centreline z = 0
      return project(cam, x, 0.6, lat);
    };
    // Asphalt strip.
    poly([pts(-900, -hw), pts(900, -hw), pts(900, hw), pts(-900, hw)], RUNWAY_COLOR);
    // Edge lines.
    poly([pts(-900, -hw + 2), pts(900, -hw + 2), pts(900, -hw + 4), pts(-900, -hw + 4)], RUNWAY_MARK_COLOR);
    poly([pts(-900, hw - 4), pts(900, hw - 4), pts(900, hw - 2), pts(-900, hw - 2)], RUNWAY_MARK_COLOR);
    // Centreline dashes.
    for (let x = -840; x < 880; x += 60) {
      poly([pts(x, -1), pts(x + 30, -1), pts(x + 30, 1), pts(x, 1)], RUNWAY_MARK_COLOR);
    }
    // Threshold bars at the west end.
    for (let i = -3; i <= 3; i++) {
      poly([pts(-895, i * 6 - 2), pts(-875, i * 6 - 2), pts(-875, i * 6 + 2), pts(-895, i * 6 + 2)], RUNWAY_MARK_COLOR);
    }
    // The big 09: painted where you cross the threshold, nine metres tall.
    const p = project(cam, -820, 1, 0);
    if (p && p.f > 10) {
      ctx.save();
      ctx.fillStyle = RUNWAY_MARK_COLOR;
      ctx.font = `bold ${Math.max(8, Math.min(90, p.s * 9))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('09', p.x, p.y);
      ctx.restore();
    }
  }

  function drawRings(world, cam, time) {
    for (const ring of world.rings) {
      const p = project(cam, ring.x, ring.y, ring.z);
      if (!p) continue;
      const radius = ring.r * p.s;
      if (radius < 3) continue;
      const hit = ring.hit;
      ctx.save();
      ctx.strokeStyle = hit ? 'rgba(126, 240, 193, 0.9)' : RING_COLOR;
      ctx.lineWidth = Math.max(2, radius * 0.07);
      ctx.shadowColor = hit ? '#7ef0c1' : '#ffc93c';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hit ? 'rgba(126, 240, 193, 0.35)' : 'rgba(255, 201, 60, 0.35)';
      ctx.lineWidth = Math.max(1, radius * 0.02);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      // The next ring pulses so the eye finds it.
      if (!hit && ring === nextRing(world)) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 4);
        ctx.globalAlpha = 0.5 + pulse * 0.5;
        ctx.fillStyle = '#fff2c0';
        ctx.font = `bold ${Math.max(11, radius * 0.16)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`RING ${ring.index + 1}`, p.x, p.y + radius + 18);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function drawBeacon(world, cam, time) {
    const b = world.beacon;
    const base = project(cam, b.x, b.y, b.z);
    const top = project(cam, b.x, b.y + 42, b.z);
    if (!base || !top) return;
    // Drop zone: a yellow circle on the island grass.
    groundCircle(cam, world, b.x, b.z, b.r, 'rgba(255, 201, 60, 0.30)');
    const zp = project(cam, b.x, b.y + 1, b.z);
    if (zp) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 201, 60, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(zp.x, zp.y, b.r * zp.s, b.r * zp.s * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // The pylon: red and white bands, blinking lamp on top.
    ctx.save();
    ctx.strokeStyle = '#d23c2e';
    ctx.lineWidth = Math.max(2, 5 * top.s);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const blink = Math.sin(time * 5) > 0;
    if (blink) {
      ctx.fillStyle = '#ff5a5a';
      ctx.shadowColor = '#ff5a5a';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(top.x, top.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- The aircraft, drawn in screen space -------------------------------------
  function drawPlane(plane, time) {
    const px = W / 2;
    const py = H * 0.60 + plane.pitchDeg * 2.2;
    const bank = -plane.rollDeg * DEG * 0.9;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(bank);
    // Contrails at speed: two fading streaks off the wingtips.
    if (plane.speedKts > 190 && !plane.onGround) {
      ctx.save();
      ctx.rotate(-bank);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-105, 18);
      ctx.lineTo(-150, -70);
      ctx.moveTo(105, 18);
      ctx.lineTo(150, -70);
      ctx.stroke();
      ctx.restore();
    }
    // Engine glow grows with throttle.
    const glow = plane.throttle * 0.85;
    if (glow > 0.05) {
      const g = ctx.createRadialGradient(0, 58, 2, 0, 58, 46);
      g.addColorStop(0, `rgba(255, 170, 60, ${glow})`);
      g.addColorStop(1, 'rgba(255, 170, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 58, 46, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wings: swept, dark on top with a lit leading edge.
    ctx.fillStyle = '#5d6b7d';
    ctx.beginPath();
    ctx.moveTo(-14, -18);
    ctx.lineTo(-118, 26);
    ctx.lineTo(-108, 38);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, -18);
    ctx.lineTo(118, 26);
    ctx.lineTo(108, 38);
    ctx.lineTo(10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(234, 246, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -18);
    ctx.lineTo(-118, 26);
    ctx.moveTo(14, -18);
    ctx.lineTo(118, 26);
    ctx.stroke();
    // Fuselage: silver-blue taper, nose up.
    const fus = ctx.createLinearGradient(-16, 0, 16, 0);
    fus.addColorStop(0, '#8fa3b8');
    fus.addColorStop(0.5, '#dfe9f2');
    fus.addColorStop(1, '#8fa3b8');
    ctx.fillStyle = fus;
    ctx.beginPath();
    ctx.moveTo(0, -102);
    ctx.quadraticCurveTo(15, -58, 13, 8);
    ctx.quadraticCurveTo(12, 44, 7, 58);
    ctx.lineTo(-7, 58);
    ctx.quadraticCurveTo(-12, 44, -13, 8);
    ctx.quadraticCurveTo(-15, -58, 0, -102);
    ctx.closePath();
    ctx.fill();
    // Canopy: dark glass teardrop.
    ctx.fillStyle = '#18242f';
    ctx.beginPath();
    ctx.moveTo(0, -88);
    ctx.quadraticCurveTo(9, -62, 7, -34);
    ctx.quadraticCurveTo(0, -28, -7, -34);
    ctx.quadraticCurveTo(-9, -62, 0, -88);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-3, -64, 2.5, 8, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // Tail fin and stabilisers.
    ctx.fillStyle = '#46586c';
    ctx.beginPath();
    ctx.moveTo(0, 30);
    ctx.lineTo(-9, 62);
    ctx.lineTo(9, 62);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-8, 44);
    ctx.lineTo(-52, 62);
    ctx.lineTo(-46, 68);
    ctx.lineTo(-6, 54);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, 44);
    ctx.lineTo(52, 62);
    ctx.lineTo(46, 68);
    ctx.lineTo(6, 54);
    ctx.closePath();
    ctx.fill();
    // Wingtip nav lights, blinking.
    if (Math.sin(time * 6) > -0.2) {
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath();
      ctx.arc(-112, 30, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5aff8a';
      ctx.beginPath();
      ctx.arc(112, 30, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Instruments and HUD -------------------------------------------------------
  function drawPanel(s) {
    const ph = 118;
    const y0 = H - ph;
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, y0, W, ph);
    ctx.strokeStyle = PANEL_EDGE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(W, y0);
    ctx.stroke();
    const cy = y0 + ph / 2;
    const plane = s.plane;

    // Artificial horizon: a ball that rolls with the bank and slides with pitch.
    const hx = 78;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, cy, 44, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(hx, cy);
    ctx.rotate(-plane.rollDeg * DEG);
    ctx.translate(0, plane.pitchDeg * 1.6);
    ctx.fillStyle = '#3f8fd0';
    ctx.fillRect(-46, -90, 92, 90);
    ctx.fillStyle = '#8a6a42';
    ctx.fillRect(-46, 0, 92, 90);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-46, 0);
    ctx.lineTo(46, 0);
    ctx.stroke();
    ctx.restore();
    // Fixed aircraft symbol over the ball.
    ctx.save();
    ctx.strokeStyle = GAUGE_LIT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hx - 26, cy);
    ctx.lineTo(hx + 26, cy);
    ctx.moveTo(hx, cy - 4);
    ctx.lineTo(hx, cy + 6);
    ctx.stroke();
    ctx.strokeStyle = '#dfe9f2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, cy, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    label('ATTITUDE', hx, y0 + 14);

    // Digital readouts: altitude, speed, heading.
    readout(178, 'ALT', `${Math.round(s.aglFt).toLocaleString()} FT`, y0, cy);
    readout(300, 'SPD', `${Math.round(plane.speedKts)} KT`, y0, cy);
    readout(422, 'HDG', `${String(Math.round(plane.headingDeg)).padStart(3, '0')}°`, y0, cy);

    // Compass ribbon: cardinal marks sliding with the heading.
    const compX = 520;
    const compW = 240;
    ctx.save();
    ctx.beginPath();
    ctx.rect(compX, cy - 30, compW, 60);
    ctx.clip();
    const cardinals = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
    for (const [deg, name] of cardinals) {
      let d = ((deg - plane.headingDeg + 540) % 360) - 180;
      const x = compX + compW / 2 + d * 2.1;
      if (x < compX - 20 || x > compX + compW + 20) continue;
      ctx.fillStyle = name.length === 1 ? GAUGE_LIT : HUD_TEXT;
      ctx.font = `bold ${name.length === 1 ? 17 : 13}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(name, x, cy - 6);
      ctx.fillStyle = '#9fb6cc';
      ctx.fillRect(x - 1, cy + 4, 2, 10);
    }
    ctx.restore();
    ctx.strokeStyle = GAUGE_LIT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(compX + compW / 2, cy - 34);
    ctx.lineTo(compX + compW / 2, cy + 34);
    ctx.stroke();
    label('COMPASS', compX + compW / 2, y0 + 14);

    // Throttle lever.
    const thX = 790;
    ctx.fillStyle = '#16222f';
    ctx.fillRect(thX, cy - 40, 16, 80);
    const thH = plane.throttle * 76;
    ctx.fillStyle = plane.throttle > 0.9 ? GAUGE_WARN : GAUGE_LIT;
    ctx.fillRect(thX + 2, cy + 38 - thH, 12, thH);
    ctx.fillStyle = HUD_TEXT;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(plane.throttle * 100)}%`, thX + 8, cy + 54);
    label('THR', thX + 8, y0 + 14);

    // Fuel bar.
    const fuX = 850;
    const fuW = 130;
    ctx.fillStyle = '#16222f';
    ctx.fillRect(fuX, cy - 8, fuW, 16);
    const fuelFrac = plane.fuel / 100;
    ctx.fillStyle = fuelFrac > 0.5 ? GAUGE_LIT : fuelFrac > 0.2 ? GAUGE_WARN : GAUGE_DANGER;
    ctx.fillRect(fuX + 1, cy - 7, (fuW - 2) * fuelFrac, 14);
    ctx.fillStyle = HUD_TEXT;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`FUEL ${Math.round(plane.fuel)}%`, fuX, cy + 34);
    label('FUEL', fuX + fuW / 2, y0 + 14);

    // Gear and warning lamps.
    const lampX = 1030;
    lamp(lampX, cy - 22, plane.gearDown ? GAUGE_LIT : '#3a4a5a', 'GEAR');
    lamp(lampX, cy + 18, plane.flaps ? GAUGE_LIT : '#3a4a5a', 'FLAPS');
    const warnX = 1120;
    lamp(warnX, cy - 22, s.stalled ? blink(s.time, GAUGE_DANGER) : '#3a4a5a', 'STALL');
    lamp(warnX, cy + 18, plane.fuel < 20 ? blink(s.time, GAUGE_WARN) : '#3a4a5a', 'LOW FUEL');

    function label(text, x, y) {
      ctx.fillStyle = '#8fa8bd';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y);
    }
    function readout(x, name, value, y0, cy) {
      ctx.fillStyle = '#8fa8bd';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y0 + 14);
      ctx.fillStyle = GAUGE_LIT;
      ctx.font = 'bold 22px ui-monospace, monospace';
      ctx.fillText(value, x, cy + 8);
    }
    function lamp(x, y, color, name) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = HUD_TEXT;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(name, x + 12, y + 4);
    }
    function blink(t, color) {
      return Math.sin(t * 8) > 0 ? color : '#3a4a5a';
    }
  }

  function drawHud(s) {
    const plane = s.plane;
    // Top-left: the three numbers that matter, big and lit.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    chip(16, 16, 210, 86, [
      ['ALT', `${Math.round(s.aglFt).toLocaleString()} FT`],
      ['SPD', `${Math.round(plane.speedKts)} KT`],
      ['HDG', `${String(Math.round(plane.headingDeg)).padStart(3, '0')}°`],
    ]);
    // Top-centre: what the sortie asks for, and the clock.
    const m = s.mission;
    let objective = '';
    if (m.id === 'rings') {
      const ring = nextRing(s.world);
      objective = ring ? `RING ${ring.index + 1} OF 8` : 'COURSE CLEAR';
    } else if (m.id === 'landing') objective = 'LAND ON RUNWAY 09';
    else objective = s.missionState.status === 'dropped' ? 'PARCEL AWAY' : 'DROP OVER THE BEACON';
    const elapsed = Math.max(0, s.time - s.missionState.startedAt);
    const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
    const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10, 16, 26, 0.66)';
    ctx.fillRect(W / 2 - 190, 16, 380, 46);
    ctx.fillStyle = HUD_TEXT;
    ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.fillText(`${m.name.toUpperCase()}  •  ${objective}`, W / 2, 36);
    ctx.fillStyle = '#9fb6cc';
    ctx.font = '15px ui-monospace, monospace';
    ctx.fillText(`${mm}:${ss}   SCORE ${s.missionState.score}`, W / 2, 56);
    // Top-right: score and best.
    ctx.textAlign = 'right';
    chip(W - 226, 16, 210, 86, [
      ['SCORE', String(s.missionState.score)],
      ['BEST', String(s.best)],
      [s.muted ? 'MUTED — M' : 'SOUND — M', ''],
    ]);
    // Flight-path marker: where the nose is actually going.
    const fx = W / 2 + plane.rollDeg * 1.4;
    const fy = H * 0.42 - plane.pitchDeg * 3.4;
    ctx.strokeStyle = 'rgba(234, 246, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fx, fy, 10, 0, Math.PI * 2);
    ctx.moveTo(fx - 18, fy);
    ctx.lineTo(fx - 10, fy);
    ctx.moveTo(fx + 10, fy);
    ctx.lineTo(fx + 18, fy);
    ctx.moveTo(fx, fy - 10);
    ctx.lineTo(fx, fy + 10);
    ctx.stroke();
    // Banner: one line that fades after a couple of seconds.
    if (s.banner && s.bannerUntil > s.time) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(10, 16, 26, 0.6)';
      const wdt = ctx.measureText(s.banner).width + 36;
      ctx.fillRect(W / 2 - wdt / 2, H * 0.24, wdt, 44);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(s.banner, W / 2, H * 0.24 + 31);
    }
    // Warnings, centre screen, impossible to miss.
    if (s.stalled) warnLine('STALL — NOSE DOWN, POWER UP', GAUGE_DANGER);
    else if (s.terrainWarn) warnLine('TERRAIN — PULL UP', GAUGE_WARN);
    else if (plane.fuel < 20 && !plane.onGround) warnLine('LOW FUEL — FIND THE RUNWAY', GAUGE_WARN);

    function chip(x, y, w, h, rows) {
      ctx.fillStyle = 'rgba(10, 16, 26, 0.66)';
      ctx.fillRect(x, y, w, h);
      ctx.textAlign = 'left';
      rows.forEach(([k, v], i) => {
        ctx.fillStyle = '#8fa8bd';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(k, x + 12, y + 24 + i * 26);
        ctx.fillStyle = GAUGE_LIT;
        ctx.font = 'bold 19px ui-monospace, monospace';
        ctx.fillText(v, x + 62, y + 24 + i * 26);
      });
    }
    function warnLine(text, color) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.fillStyle = Math.sin(s.time * 8) > 0 ? color : 'rgba(255,255,255,0.9)';
      ctx.fillText(text, W / 2, H * 0.17);
    }
  }

  // --- Screens -------------------------------------------------------------------
  function drawTitle(s) {
    ctx.fillStyle = 'rgba(8, 14, 24, 0.42)';
    ctx.fillRect(0, 0, W, H - 118);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 12;
    ctx.fillText('SKY COURIER', W / 2, 128);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText('VALLEY RUN  •  three sorties, one valley, your call', W / 2, 168);
    titleCards = [];
    const cw = 300;
    const ch = 150;
    const gap = 28;
    const x0 = W / 2 - (cw * 3 + gap * 2) / 2;
    const y0 = 210;
    MISSIONS.forEach((m, i) => {
      const x = x0 + i * (cw + gap);
      ctx.fillStyle = 'rgba(10, 16, 26, 0.88)';
      ctx.fillRect(x, y0, cw, ch);
      ctx.strokeStyle = '#ffc93c';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y0, cw, ch);
      ctx.fillStyle = '#ffc93c';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(`${i + 1} — ${m.name.toUpperCase()}`, x + cw / 2, y0 + 34);
      ctx.fillStyle = HUD_TEXT;
      ctx.font = '15px system-ui, sans-serif';
      wrapText(m.blurb, x + 18, y0 + 62, cw - 36, 20);
      ctx.fillStyle = '#8fa8bd';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(`Par ${Math.floor(m.parSeconds / 60)}:${String(m.parSeconds % 60).padStart(2, '0')}`, x + cw / 2, y0 + ch - 16);
      titleCards.push({ x, y: y0, w: cw, h: ch, id: m.id });
    });
    ctx.fillStyle = HUD_TEXT;
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillText('Click a sortie, or press 1 / 2 / 3', W / 2, y0 + ch + 44);
    ctx.fillStyle = '#c8d8e6';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Fly: ↑ ↓ pitch  •  ← → bank and turn  •  Shift / Ctrl throttle', W / 2, y0 + ch + 70);
    ctx.fillText('Space airbrake / drop  •  G gear  •  P pause  •  M sound', W / 2, y0 + ch + 94);
    if (s.best > 0) {
      ctx.fillStyle = '#7ef0c1';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText(`Best score so far: ${s.best}`, W / 2, y0 + ch + 126);
    }
  }

  function wrapText(text, x, y, maxW, lh) {
    ctx.textAlign = 'left';
    const words = text.split(' ');
    let line = '';
    let yy = y;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = w;
        yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  function drawOver(s) {
    const st = s.missionState;
    const won = st.status === 'landed' || st.status === 'complete' || st.status === 'dropped';
    ctx.fillStyle = 'rgba(8, 14, 24, 0.55)';
    ctx.fillRect(0, 0, W, H - 118);
    ctx.textAlign = 'center';
    ctx.fillStyle = won ? '#7ef0c1' : '#ff8a8a';
    ctx.font = 'bold 52px system-ui, sans-serif';
    const title = st.status === 'crashed' ? 'CRASHED'
      : st.status === 'landed' ? 'WHEELS DOWN — LANDED'
      : st.status === 'complete' ? 'COURSE CLEAR'
      : st.status === 'dropped' ? 'PARCEL DELIVERED' : 'SORTIE OVER';
    ctx.fillText(title, W / 2, H * 0.30);
    ctx.fillStyle = HUD_TEXT;
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(st.detail || '', W / 2, H * 0.30 + 40);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(`SCORE  ${st.score}`, W / 2, H * 0.30 + 96);
    ctx.fillStyle = '#c8d8e6';
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillText('Press R or click to fly again', W / 2, H * 0.30 + 140);
  }

  function drawPaused() {
    ctx.fillStyle = 'rgba(8, 14, 24, 0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = HUD_TEXT;
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText('PAUSED', W / 2, H * 0.42);
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Press P or click to keep flying', W / 2, H * 0.42 + 36);
  }

  // --- The one public call ---------------------------------------------------------
  function draw(s) {
    resize();
    const plane = s.plane;
    const cam = camera(plane);
    ctx.save();
    // The world rolls with the bank around the horizon centre.
    ctx.translate(W / 2, cam.cy);
    ctx.rotate(-plane.rollDeg * DEG * 0.45);
    ctx.translate(-W / 2, -cam.cy);
    const horizonY = drawSky(plane, s.time);
    drawRidges(plane, horizonY);
    drawClouds(s.world, cam);
    drawGround(s.world, cam, plane);
    drawRings(s.world, cam, s.time);
    drawBeacon(s.world, cam, s.time);
    ctx.restore();
    drawPlane(plane, s.time);
    if (s.screen !== SCREEN_TITLE) drawPanel(s);
    if (s.screen === SCREEN_PLAY || s.screen === SCREEN_PAUSED) drawHud(s);
    if (s.screen === SCREEN_TITLE) drawTitle(s);
    if (s.screen === SCREEN_OVER) drawOver(s);
    if (s.screen === SCREEN_PAUSED) drawPaused();
  }

  return { draw, get titleCards() { return titleCards; } };
}

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
