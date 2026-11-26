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
 * Trompe de stade : un coup continu de 2 s sur une seule note nette (la 3, 220 Hz), timbre cuivré.
 * Une seule fréquence fondamentale (pas d'accord ni de désaccord, donc pas d'effet « double son »),
 * enrichie par ses harmoniques naturelles ; attaque rapide, fin qui s'éteint en 0,3 s.
 */
export function horn(dur = 2) {
  if (!soundReady()) return false;
  const f = 220;
  const t0 = ctx.currentTime + 0.03;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(comp).connect(ctx.destination);
  // pavillon métallique : présence vers 1,2 kHz, pas d'aigus agressifs
  const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 1200; body.Q.value = 1; body.gain.value = 7;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.7;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(1, t0 + 0.05);
  env.gain.setValueAtTime(1, t0 + dur - 0.3);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  env.connect(shaper(6)).connect(hp).connect(body).connect(lp).connect(master);
  // même note pour les deux oscillateurs (dent de scie + carré) : un seul son, timbre plus plein
  for (const [type, g] of [['sawtooth', 0.55], ['square', 0.25]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f * 0.96, t0);
    o.frequency.exponentialRampToValueAtTime(f, t0 + 0.1); // la trompe « monte » à sa note
    const gg = ctx.createGain(); gg.gain.value = g;
    o.connect(gg).connect(env);
    o.start(t0); o.stop(t0 + dur + 0.02);
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
