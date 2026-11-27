// Keyboard and mouse, read as intents. The loop asks once a frame what the
// pilot is doing: pitch and bank as -1..1, throttle keys, brake, and the
// one-shot actions (pause, restart, mute, confirm) plus the last click.
// Keys: arrows or WASD to fly, Shift/Ctrl throttle, Space airbrake (or drop
// the parcel on the Courier run), G gear, P pause, R restart, M sound,
// 1/2/3 pick a sortie on the title screen, Enter confirms.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_MUTE = 8;

const KEYMAP = {
  ArrowUp: 'pitchUp', KeyW: 'pitchUp',
  ArrowDown: 'pitchDown', KeyS: 'pitchDown',
  ArrowLeft: 'bankLeft', KeyA: 'bankLeft',
  ArrowRight: 'bankRight', KeyD: 'bankRight',
  ShiftLeft: 'thrUp', ShiftRight: 'thrUp',
  ControlLeft: 'thrDown', ControlRight: 'thrDown',
  Space: 'brake',
  KeyG: 'gear',
  KeyP: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
  Enter: 'confirm',
  Digit1: 'one', Digit2: 'two', Digit3: 'three',
};

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  let actions = 0;
  let click = null;

  function onKeyDown(event) {
    const name = KEYMAP[event.code];
    if (!name) return;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    if (!held.has(name)) pressed.add(name);
    held.add(name);
    if (name === 'pause') actions |= ACTION_PAUSE;
    if (name === 'restart') actions |= ACTION_RESTART;
    if (name === 'mute') actions |= ACTION_MUTE;
    if (name === 'confirm') actions |= ACTION_CONFIRM;
  }
  function onKeyUp(event) {
    const name = KEYMAP[event.code];
    if (name) held.delete(name);
  }
  function onMouseDown(event) {
    const rect = canvas.getBoundingClientRect();
    click = {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousedown', onMouseDown);

  // The stick: pitch up is positive, bank right is positive.
  function control() {
    const pitch = (held.has('pitchUp') ? 1 : 0) - (held.has('pitchDown') ? 1 : 0);
    const bank = (held.has('bankRight') ? 1 : 0) - (held.has('bankLeft') ? 1 : 0);
    return {
      pitch, bank,
      throttleUp: held.has('thrUp'),
      throttleDown: held.has('thrDown'),
      brake: held.has('brake'),
      gear: held.has('gear'),
    };
  }
  // wasPressed answers once, then forgets — for menus and toggles.
  function wasPressed(name) {
    if (pressed.has(name)) {
      pressed.delete(name);
      return true;
    }
    return false;
  }
  function takeActions() {
    const a = actions;
    actions = 0;
    return a;
  }
  function takeClick() {
    const c = click;
    click = null;
    return c;
  }
  return { control, wasPressed, takeActions, takeClick };
}
