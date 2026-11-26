// Son de fin de temps d'une rotation.
// Par défaut : l'enregistrement sounds/trompe.mp3 (mis en cache pour le hors-ligne).
// L'organisation peut choisir un autre son pour son tournoi (fichier enregistré dans le tournoi).
// En secours (fichier illisible ou pas encore chargé) : une trompe synthétisée d'après l'enregistrement.
// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur : armer avec unlock() (clic).
let ctx = null;
let wave = null;
export const DEFAULT_SOUND = 'sounds/trompe.mp3';
let current = DEFAULT_SOUND; // adresse du son à jouer (fichier par défaut ou data URL du tournoi)
const buffers = new Map(); // adresse → AudioBuffer (ou promesse en cours)

export const soundReady = () => !!ctx && ctx.state === 'running';

function load(url) {
  if (!ctx) return Promise.resolve(null);
  const got = buffers.get(url);
  if (got) return got instanceof Promise ? got : Promise.resolve(got);
  const pr = fetch(url.startsWith('data:') ? url : new URL(url, document.baseURI))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then((b) => new Promise((ok, ko) => ctx.decodeAudioData(b, ok, ko)))
    .then((buf) => { buffers.set(url, buf); return buf; })
    .catch(() => { buffers.delete(url); return null; });
  buffers.set(url, pr);
  return pr;
}

/** Choisit le son du tournoi affiché (data URL), ou le son par défaut. */
export function useSound(url) {
  current = url || DEFAULT_SOUND;
  if (soundReady()) load(current);
}

export async function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== 'running') await ctx.resume();
    await load(current); // prêt dès le premier clic
    try { localStorage.setItem('rot:sound', '1'); } catch { /* */ }
    return soundReady();
  } catch { return false; }
}

export const soundWanted = () => { try { return localStorage.getItem('rot:sound') === '1'; } catch { return false; } };

/** Vérifie un fichier choisi par l'organisation : lisible, 8 s maximum. Renvoie sa durée en secondes. */
export async function checkSoundFile(dataUrl) {
  const c = ctx || new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  const b = await (await fetch(dataUrl)).arrayBuffer();
  const buf = await new Promise((ok, ko) => c.decodeAudioData(b, ok, () => ko(new Error('Fichier audio illisible : essayez un MP3 ou un WAV'))));
  if (buf.duration > 8) throw new Error(`Son trop long (${buf.duration.toFixed(1)} s) : 8 secondes maximum`);
  return buf.duration;
}

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
 * Trompe de stade synthétisée (secours), d'après l'enregistrement :
 * - une seule note, ≈ 268 Hz (un demi-ton sous l'original), qui part un tiers plus haut et glisse vers sa note en 0,5 s ;
 * - timbre de l'original, un peu plus cuivré (saturation douce, corps vers 850 Hz, moins de nasillard vers 1,9 kHz) ;
 * - attaque immédiate, son tenu ≈ 1,9 s, puis extinction rapide (−10 dB en 50 ms) et traîne de 0,8 s.
 */
function synthHorn() {
  const t0 = ctx.currentTime + 0.02;
  const f0 = 268, hold = 1.9, tail = 0.8; // un demi-ton sous l'enregistrement (284 Hz)
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
  // touche « cuivre » : saturation douce (éclat des cuivres), corps renforcé vers 850 Hz,
  // médiums aigus un peu creusés vers 1,9 kHz pour enlever le côté nasillard, aigus adoucis
  const sat = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = Math.tanh(2 * x) / Math.tanh(2); }
  sat.curve = curve; sat.oversample = '4x';
  const brass = ctx.createBiquadFilter(); brass.type = 'peaking'; brass.frequency.value = 850; brass.Q.value = 0.9; brass.gain.value = 4;
  const denasal = ctx.createBiquadFilter(); denasal.type = 'peaking'; denasal.frequency.value = 1900; denasal.Q.value = 1.4; denasal.gain.value = -3;
  const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 5500;
  env.connect(sat).connect(brass).connect(denasal).connect(soft).connect(master);
  const o = ctx.createOscillator();
  o.setPeriodicWave(hornWave());
  // glissé mesuré : la note part 33 % plus haut et rejoint sa hauteur (constante 0,13 s)
  o.frequency.setValueAtTime(f0 * 1.33, t0);
  o.frequency.setTargetAtTime(f0, t0, 0.13);
  o.connect(env);
  o.start(t0);
  o.stop(t0 + hold + 0.05 + tail);
  return true;
}

/** Joue le son de fin de temps : le fichier choisi s'il est prêt, sinon la trompe synthétisée. */
export function horn() {
  if (!soundReady()) return false;
  const buf = buffers.get(current);
  if (!buf || buf instanceof Promise) { load(current); return synthHorn(); }
  const g = ctx.createGain(); g.gain.value = 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + 0.02);
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
