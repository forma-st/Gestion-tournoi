// Trompe de stade synthétisée (aucun fichier son) : fin du temps de jeu d'une rotation.
// Reproduit un enregistrement de corne à air analysé (hauteur, harmoniques, enveloppe).
// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur : armer avec unlock() (clic).
let ctx = null;
let wave = null;

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

// Spectre mesuré sur l'enregistrement (régime établi), en dB par rapport à l'harmonique la plus forte.
// Harmoniques 1 à 24 : le 2e domine, puis le 4e, le 3e et le 8e ; quasiment pas de souffle.
const HARMONICS_DB = [-12, 0, -6.3, -2.1, -15.2, -10.5, -14.6, -6.6, -14, -13.1, -14, -15.6, -23.9, -22.4, -26.8, -23.1, -21.5, -21.4, -24.9, -30.4, -30.1, -34.5, -36.4, -33.4];

function hornWave() {
  if (wave) return wave;
  const n = HARMONICS_DB.length + 1;
  const real = new Float32Array(n), imag = new Float32Array(n);
  HARMONICS_DB.forEach((db, i) => { imag[i + 1] = 10 ** (db / 20); });
  wave = ctx.createPeriodicWave(real, imag);
  return wave;
}

/**
 * Trompe de stade, d'après l'enregistrement :
 * - une seule note, ≈ 284 Hz (ré 4 un peu bas), qui part de ≈ 378 Hz et glisse vers sa note en 0,5 s ;
 * - attaque immédiate, son tenu ≈ 1,9 s, puis extinction rapide (−10 dB en 50 ms) et traîne de 0,8 s.
 */
export function horn() {
  if (!soundReady()) return false;
  const t0 = ctx.currentTime + 0.02;
  const f0 = 284, hold = 1.9, tail = 0.8;
  const master = ctx.createGain();
  master.gain.value = 0.6;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.1;
  master.connect(comp).connect(ctx.destination);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(1, t0 + 0.006);
  env.gain.setValueAtTime(1, t0 + hold);
  env.gain.exponentialRampToValueAtTime(0.32, t0 + hold + 0.05);
  env.gain.setTargetAtTime(0.0001, t0 + hold + 0.05, tail / 5);
  env.connect(master);
  const o = ctx.createOscillator();
  o.setPeriodicWave(hornWave());
  // glissé mesuré : f(t) ≈ 284 + 94·e^(−t/0,13)
  o.frequency.setValueAtTime(f0 + 94, t0);
  o.frequency.setTargetAtTime(f0, t0, 0.13);
  o.connect(env);
  o.start(t0);
  o.stop(t0 + hold + 0.05 + tail);
  return true;
}

/**
 * Déclenche la trompe une seule fois par fin de rotation.
 * key : identifiant unique de la rotation (tournoi + créneau + départ du chrono).
 */
export function hornOnce(key) {
  try {
    // localStorage : partagé entre les onglets (admin + grand écran sur le même ordinateur → une seule trompe)
    if (localStorage.getItem(`rot:horn:${key}`)) return false;
    localStorage.setItem(`rot:horn:${key}`, '1');
  } catch { /* */ }
  return horn();
}
