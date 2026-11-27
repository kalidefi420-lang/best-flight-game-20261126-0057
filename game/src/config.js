// Every tunable number for Sky Courier lives here, so the feel of the game
// can be changed in one place. Speeds are knots, distances metres, times
// seconds. The physics step is fixed at 60 Hz (see main.js).

// Flight model
export const STEP = 1 / 60;
export const MAX_SPEED_KTS = 215;
export const CRUISE_SPEED_KTS = 150;
export const STALL_SPEED_KTS = 66;
export const TAKEOFF_SPEED_KTS = 78;
export const CLIMB_RATE_MS = 9;
export const SINK_RATE_MS = 11;
export const MAX_BANK_DEG = 58;
export const TURN_RATE = 0.42;
export const PITCH_AUTHORITY = 1.0;
export const FLAP_STALL_BONUS_KTS = 8;
export const GEAR_DRAG_KTS = 12;

// Fuel and damage: fuel lasts a whole sortie at cruise, damage only comes
// from hitting the ground wrong.
export const FUEL_BURN_BASE = 0.1;
export const FUEL_BURN_THROTTLE = 0.24;
export const HARD_LANDING_FPM = 900;
export const CRASH_FPM = 2200;
export const FIELD_LANDING_DAMAGE = 30;

// Missions
export const RING_COUNT = 8;
export const RING_SCORE = 150;
export const RING_RADIUS_M = 26;
export const PAR_RING_S = 240;
export const PAR_LANDING_S = 300;
export const PAR_COURIER_S = 300;
export const LANDING_BASE_SCORE = 400;
export const LANDING_CENTRELINE_BONUS = 150;
export const LANDING_SINK_BONUS = 150;
export const LANDING_SPEED_BONUS = 100;
export const DROP_SCORE = 600;
export const DROP_RING_RADIUS_M = 42;
export const TIME_BONUS_PER_S = 2;

// The valley: x runs west-east along the river, z north-south across it.
export const WORLD_HALF_X = 3600;
export const WORLD_HALF_Z = 2700;
export const RUNWAY_X = -1900;
export const RUNWAY_Z = 0;
export const RUNWAY_LENGTH_M = 1400;
export const RUNWAY_HALF_WIDTH_M = 22;
export const RUNWAY_HEADING_DEG = 90;
export const ISLAND_X = 2900;
export const ISLAND_Z = 650;
export const BEST_KEY = 'skycourier.best.score.v2';
