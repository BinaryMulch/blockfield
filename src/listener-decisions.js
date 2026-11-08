// Hard eligibility is checked before scoring. Commitment and a small seeded
// preference among close scores prevent flicker without overriding safety.
export function chooseListenerAction(candidates, current, heldFor, random) {
  const eligible = candidates.filter(c => c.allowed && Number.isFinite(c.score));
  if (!eligible.length) return { action: 'listen', reason: 'No convincing evidence', score: 0 };
  const held = eligible.find(c => c.action === current);
  const ranked = eligible.map(c => ({ ...c, score: c.score + (c.action === current ? .06 : 0) + random() * .02 })).sort((a, b) => b.score - a.score);
  if (held && heldFor < 1.5) return held;
  return ranked[0];
}
