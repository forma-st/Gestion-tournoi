// Corne de stade synthétisée (aucun fichier son) : fin du temps de jeu d'une rotation.
// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur : armer avec unlock() (clic).
let ctx = null;

export const soundReady = () => !!ctx && ctx.state === 'running';

export async function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== 'running') await ctx.resume();
    try { localStorage.setItem('rot:sound', '1'); } catch { /* */ }
    return soundReady();
  } catch { return false; }
}

export const soundWanted = () => { try { return localStorage.getItem('rot:sound') === '1'; } catch { return false; } };

/** Distorsion douce : donne le grain « klaxon à air » de la corne de stade. */
function shaper(amount = 30) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  const w = ctx.createWaveShaper(); w.curve = curve; w.oversample = '2x';
  return w;
}

/** Un coup de corne : accord serré et brillant (type corne à air de stade), attaque franche. */
function blast(t0, dur, master) {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(1, t0 + 0.03);
  env.gain.setValueAtTime(1, t0 + dur - 0.08);
  env.gain.linearRampToValueAtTime(0, t0 + dur);
  const dist = shaper(40);
  const bp = ctx.createBiquadFilter();
  bp.type = 'peaking'; bp.frequency.value = 1800; bp.gain.value = 6; bp.Q.value = 0.8;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 5200;
  env.connect(dist).connect(bp).connect(lp).connect(master);
  // trois anches légèrement dissonantes, comme une corne à air (~ la b3 / do 4 / mi b 4)
  for (const [f, g] of [[233, 0.38], [262, 0.34], [311, 0.3], [466, 0.12]]) {
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.97, t0);
      o.frequency.exponentialRampToValueAtTime(f, t0 + 0.06);
      o.detune.value = det;
      const gg = ctx.createGain(); gg.gain.value = g / 2;
      o.connect(gg).connect(env);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
  }
}

/** Corne de stade : « ta-ta-taaaa » (deux coups brefs puis un long), puissante. */
export function horn() {
  if (!soundReady()) return false;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = 0.75;
  master.connect(comp).connect(ctx.destination);
  const t = ctx.currentTime + 0.05;
  blast(t, 0.45, master);
  blast(t + 0.6, 0.45, master);
  blast(t + 1.2, 2.2, master);
  return true;
}

/**
 * Déclenche la corne une seule fois par fin de rotation.
 * key : identifiant unique de la rotation (tournoi + créneau + départ du chrono).
 */
export function hornOnce(key) {
  try {
    // localStorage : partagé entre les onglets (admin + grand écran sur le même ordinateur → une seule corne)
    if (localStorage.getItem(`rot:horn:${key}`)) return false;
    localStorage.setItem(`rot:horn:${key}`, '1');
  } catch { /* */ }
  return horn();
}
