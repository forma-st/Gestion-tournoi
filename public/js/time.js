// Horloge commune : décalage avec l'heure du serveur, pour que tous les chronos affichent la même chose.
export const clock = {
  offset: 0,
  now() { return Date.now() + this.offset; },
};

/** Temps écoulé d'un chrono {running, elapsed, since}. */
export const elapsedOf = (tm) => (tm ? tm.elapsed + (tm.running ? clock.now() - tm.since : 0) : 0);
