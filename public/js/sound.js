// Trompe de stade synthétisée (aucun fichier son) : fin du temps de jeu d'une rotation.
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

/** Saturation douce : rend le son cuivré sans le rendre criard. */
function shaper(amount) {
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  const w = ctx.createWaveShaper(); w.curve = curve; w.oversample = '4x';
  return w;
}

/**
 * Trompe de stade (corne de but, façon patinoire) : un coup continu de 2 s, grave et cuivré.
 * Accord ample (si 2 – ré♯ 3 – fa♯ 3, ≈ 123 / 156 / 185 Hz, doublé à l'octave), saturation modérée,
 * attaque rapide mais ronde, léger tremblement d'air, fin qui s'éteint en 0,3 s.
 */
export function horn(dur = 2) {
  if (!soundReady()) return false;
  const t0 = ctx.currentTime + 0.03;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(comp).connect(ctx.destination);
  // pavillon métallique : présence vers 900 Hz, pas d'aigus agressifs
  const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 1000; body.Q.value = 1; body.gain.value = 7;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.7;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(1, t0 + 0.06);
  env.gain.setValueAtTime(1, t0 + dur - 0.3);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  env.connect(shaper(8)).connect(hp).connect(body).connect(lp).connect(master);
  // léger tremblement d'air (5,5 Hz) partagé par toutes les anches
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.6;
  lfo.connect(lfoAmt); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  for (const [f, g] of [[123.5, 0.42], [155.6, 0.32], [185, 0.3], [247, 0.18], [311, 0.1]]) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.96, t0);
      o.frequency.exponentialRampToValueAtTime(f, t0 + 0.12); // la trompe « monte » à sa note
      o.detune.value = det;
      lfoAmt.connect(o.frequency);
      const gg = ctx.createGain(); gg.gain.value = g / 2;
      o.connect(gg).connect(env);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
  }
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
