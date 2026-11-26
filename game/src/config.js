// Sky Courier — tunables in one place: speeds, fuel, damage, missions and palette.
// Every number here is a gameplay decision, not a magic constant buried in a step.
export const GAME_NAME = 'Sky Courier';
export const GAME_TAGLINE = 'Valley Run';

// The loop's fixed step and the localStorage key for the best score.
export const STEP = 1 / 60;
export const BEST_KEY = 'sky-courier-best';

// One shared degrees-to-radians factor for every module that turns angles.
export const DEG = Math.PI / 180;

// Flight model (arcade, knots and feet on the dials, metres inside).
export const STALL_SPEED_KTS = 62;      // below this the wing gives up and the nose drops
export const CRUISE_SPEED_KTS = 185;    // what full throttle settles near, level
export const MAX_SPEED_KTS = 260;       // redline: past it the airframe complains
export const MAX_LANDING_SPEED_KTS = 120; // touchdown any faster is a hard landing
export const MAX_SINK_FPM = 900;        // vertical speed at touchdown above this hurts
export const CLIMB_RATE_FPM = 2600;     // best climb at full throttle, clean
export const TURN_RATE_DEG = 42;        // heading change per second at full bank
export const MAX_BANK_DEG = 55;
export const MAX_PITCH_DEG = 24;

// Fuel and damage.
export const FUEL_CAPACITY = 100;       // percent
export const FUEL_BURN_PER_SEC = 0.55;  // at full throttle; idle burns a fifth of this
export const RING_FUEL_BONUS = 4;       // a ring tops the tanks a little
export const INTEGRITY_MAX = 100;
export const HARD_LANDING_DAMAGE = 34;  // one bad touchdown
export const TERRAIN_SCRAPE_DAMAGE = 60; // brushing a hilltop

// World geometry (metres).
export const RUNWAY_LENGTH = 1800;
export const RUNWAY_WIDTH = 46;
export const RUNWAY_HEADING_DEG = 90;   // runway 09: you land flying east
export const RING_RADIUS_M = 55;
export const RING_COUNT = 8;

// Scoring.
export const RING_POINTS = 150;
export const LANDING_BASE_POINTS = 400;
export const DELIVERY_BASE_POINTS = 500;
export const TIME_BONUS_PER_SEC = 4;

// Palette: one late-afternoon look for sky, ground and panel together.
export const SKY_TOP = '#2e5f8f';
export const SKY_MID = '#7fb0d8';
export const SKY_HORIZON = '#f6c98a';
export const SUN_COLOR = '#ffd98a';
export const FIELD_COLORS = ['#6da24a', '#7fae56', '#c2a95e', '#8fae4e', '#5d8f43', '#a8b060'];
export const WATER_COLOR = '#3f7fae';
export const FOREST_COLOR = '#3f6d33';
export const TOWN_COLOR = '#9a938a';
export const RUNWAY_COLOR = '#3a3d42';
export const RUNWAY_MARK_COLOR = '#f2f0e6';
export const RING_COLOR = '#ffc93c';
export const PANEL_BG = 'rgba(10, 16, 26, 0.88)';
export const PANEL_EDGE = '#2c3e55';
export const GAUGE_LIT = '#7ef0c1';
export const GAUGE_WARN = '#ffb347';
export const GAUGE_DANGER = '#ff5a5a';
export const HUD_TEXT = '#eaf6ff';
