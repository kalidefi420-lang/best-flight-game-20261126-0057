// Seeded randomness for Sky Courier: every valley is built from one seed,
// so a screenshot staged with #seed=N always shows the same valley.
// mulberry32 is a small fast seeded PRNG; the value-noise field on top of it
// gives smooth hills without any library.
export function createRandom(seed) {
  let a = seed >>> 0;
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function range(min, max) {
    return min + (max - min) * next();
  }
  function pick(list) {
    return list[Math.floor(next() * list.length) % list.length];
  }
  return { next, range, pick };
}

// Two-dimensional value noise: a lattice of random heights, smoothly
// interpolated, stacked into octaves for rolling terrain.
export function createNoise(seed) {
  const rand = createRandom(seed);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) base[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rand.next() * (i + 1));
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255];

  function fade(t) {
    return t * t * (3 - 2 * t);
  }
  function lattice(ix, iz) {
    return perm[(perm[ix & 255] + iz) & 255] / 255;
  }
  function noise2(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    const u = fade(fx);
    const v = fade(fz);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  // Fractal Brownian motion: several octaves, each half the strength.
  function fbm(x, z, octaves) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += noise2(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
  return { noise2, fbm };
}
