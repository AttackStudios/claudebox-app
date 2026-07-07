// Seeded 2D simplex noise + fbm. Shared by the server (spawning) and the
// client (terrain mesh) so both always agree on the shape of the island.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export class Simplex2D {
  constructor(seed = 1337) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(xin, yin) {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    const corners = [
      [x0, y0, this.perm[ii + this.perm[jj]]],
      [x1, y1, this.perm[ii + i1 + this.perm[jj + j1]]],
      [x2, y2, this.perm[ii + 1 + this.perm[jj + 1]]],
    ];
    for (const [x, y, h] of corners) {
      let tt = 0.5 - x * x - y * y;
      if (tt < 0) continue;
      tt *= tt;
      const g = GRAD[h & 7];
      n += tt * tt * (g[0] * x + g[1] * y);
    }
    return 70 * n; // roughly [-1, 1]
  }

  // Fractal brownian motion: layered octaves of noise.
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // Ridged noise for mountains: sharp crests instead of smooth bumps.
  ridged(x, y, octaves = 4) {
    let amp = 0.5, freq = 1, sum = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (1 - Math.abs(this.noise(x * freq, y * freq)));
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum;
  }
}

export { mulberry32 };
