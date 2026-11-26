// Corne de brume synthétisée (aucun fichier son) : fin du temps de jeu d'une rotation.
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

/** Corne de brume : son grave et puissant, environ 2,5 s, répété `times` fois. */
export function horn(times = 2) {
  if (!soundReady()) return false;
  const out = ctx.createDynamicsCompressor();
  out.threshold.value = -10; out.ratio.value = 4;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(out).connect(ctx.destination);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1.2;
  lp.connect(master);
  for (let k = 0; k < times; k++) {
    const t0 = ctx.currentTime + k * 3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + 0.12);
    env.gain.setValueAtTime(1, t0 + 2.2);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 2.7);
    env.connect(lp);
    // accord grave légèrement désaccordé, comme une vraie corne
    for (const [f, type, g] of [[98, 'sawtooth', 0.5], [98.8, 'sawtooth', 0.4], [147, 'square', 0.18], [49, 'sine', 0.6]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * 0.94, t0);
      o.frequency.linearRampToValueAtTime(f, t0 + 0.25);
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg).connect(env);
      o.start(t0); o.stop(t0 + 2.75);
    }
  }
  return true;
}

/**
 * Surveille les chronos d'une rotation et déclenche la corne une seule fois quand le temps est écoulé.
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
