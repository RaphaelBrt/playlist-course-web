// Ordre pseudo-aléatoire reproductible (graine = numéro de course + thème).
// Même principe que le programme Go (FNV-1a 64 bits, mélange de Fisher-Yates) ;
// le générateur diffère, donc l'ordre obtenu n'est pas le même que sur Mac/Windows.
export function fnv1a64(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (const o of new TextEncoder().encode(s)) {
    h ^= BigInt(o);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

export function mulberry32(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function melanger<T>(t: T[], cle: string): T[] {
  const h = fnv1a64(cle);
  const r = mulberry32(Number((h ^ (h >> 32n)) & 0xffffffffn));
  const out = t.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
