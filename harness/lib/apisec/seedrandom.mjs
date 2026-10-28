// Preload (node --import): replaces Math.random with a seeded PRNG (mulberry32) so unseeded prover scripts replay deterministically.
let a = Number(process.env.SEED ?? 1) >>> 0;
Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
