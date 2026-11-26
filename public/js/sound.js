// Klaxon à gaz de supporter synthétisé (aucun fichier son) : fin du temps de jeu d'une rotation.
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

/** Saturation forte : le grain criard du klaxon à gaz. */
function shaper(amount) {
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  const w = ctx.createWaveShaper(); w.curve = curve; w.oversample = '4x';
  return w;
}

/**
 * Klaxon à gaz de supporter (corne de brume en bombe) : un seul coup continu d'environ 1,6 s,
 * aigu et nasillard. Deux membranes proches (≈ 415 et 440 Hz) battent entre elles, la saturation
 * donne le côté criard, et la note baisse un peu à la fin quand la pression chute.
 */
export function horn(dur = 1.6) {
  if (!soundReady()) return false;
  const t0 = ctx.currentTime + 0.03;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 4; comp.ratio.value = 10; comp.attack.value = 0.002; comp.release.value = 0.1;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(comp).connect(ctx.destination);
  // coloration « pavillon en plastique » : bosse vers 2,4 kHz, aigus coupés au-delà de 6 kHz
  const peak = ctx.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 2400; peak.Q.value = 1.4; peak.gain.value = 9;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(1, t0 + 0.015); // attaque immédiate
  env.gain.setValueAtTime(1, t0 + dur - 0.12);
  env.gain.linearRampToValueAtTime(0, t0 + dur);
  env.connect(shaper(60)).connect(hp).connect(peak).connect(lp).connect(master);
  for (const [f, g, type] of [[415, 0.45, 'sawtooth'], [440, 0.4, 'square'], [830, 0.12, 'sawtooth']]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f * 0.92, t0); // petit « couac » au départ
    o.frequency.exponentialRampToValueAtTime(f, t0 + 0.05);
    o.frequency.setValueAtTime(f, t0 + dur - 0.35);
    o.frequency.exponentialRampToValueAtTime(f * 0.95, t0 + dur); // la pression baisse
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
