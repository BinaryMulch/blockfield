import test from 'node:test';
import assert from 'node:assert/strict';
import { runListenerSoak } from '../scripts/listener-soak.js';

test('mixed room activity remains valid through a night, recovery, reload, and offline pause', () => {
  const result = runListenerSoak({ seed: 'listener-regression', seconds: 720 });
  assert.equal(result.reloads, 1);
  assert.ok(result.growthTransitions > 0);
  assert.ok(result.arrivals > 0 && result.knockdowns > 0 && result.recoveries > 0);
  for (const phase of ['quiet', 'unease', 'pressure', 'peak', 'release']) assert.ok(result.phases.includes(phase));
});
