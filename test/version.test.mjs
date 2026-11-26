import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVersion } from '../scripts/version.mjs';

test('empreinte du service worker à jour (sinon les téléphones garderaient l’ancien code)', () => {
  const { upToDate } = computeVersion();
  assert.ok(upToDate, 'lancez « npm run version » avant de publier');
});
