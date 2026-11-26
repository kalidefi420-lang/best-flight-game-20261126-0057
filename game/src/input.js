// Keyboard and mouse: arrows fly the plane, Shift/Ctrl work the throttle, Space is
// the airbrake in the air and the parcel drop over the beacon, G drops the gear,
// and the mouse (or Enter) starts the game and picks a mission from the title.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_RESTART = 8;

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let click = null; // { x, y } of the last mouse click, consumed once

  function keyOf(e) {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
  }

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    const k = keyOf(e);
    if (!e.repeat) {
      if (k === 'Enter' || k === ' ') actions |= ACTION_CONFIRM;
      if (k === 'p' || k === 'Escape') actions |= ACTION_PAUSE;
      if (k === 'm') actions |= ACTION_MUTE;
      if (k === 'r') actions |= ACTION_RESTART;
    }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(keyOf(e)));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    click = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    actions |= ACTION_CONFIRM;
  });

  function has(...names) {
    return names.some((n) => keys.has(n));
  }

  return {
    /** Pitch -1..1 (nose down..up), roll -1..1, throttle -1..1, gear/airbrake flags. */
    control() {
      return {
        pitch: (has('ArrowDown') ? -1 : 0) + (has('ArrowUp') ? 1 : 0),
        roll: (has('ArrowLeft') ? -1 : 0) + (has('ArrowRight') ? 1 : 0),
        throttle: (has('Shift') ? 1 : 0) + (has('Control') ? -1 : 0)
          + (has('w') ? 0.6 : 0) + (has('s') ? -0.6 : 0),
        brake: has(' '),
        gear: keys.has('g'),
      };
    },
    takeActions() {
      const a = actions;
      actions = 0;
      return a;
    },
    takeClick() {
      const c = click;
      click = null;
      return c;
    },
    pressed(key) {
      return keys.has(key);
    },
  };
}
