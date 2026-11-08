export const MUSIC_TRACKS = Object.freeze({ day: '/audio/music/day.mp3', night: '/audio/music/night.mp3', tension: '/audio/music/tension.mp3' });
export const MUSIC_RELEASE_SECONDS = 10;

export function musicMood(phase, creature, player, previous = null) {
  const night = ((phase % 1) + 1) % 1 >= .48 && ((phase % 1) + 1) % 1 < .96;
  if (creature && creature.state !== 'dormant' && player) {
    const distance = Math.hypot(creature.x - player.x, creature.y - player.y, creature.z - player.z);
    if (distance < (previous === 'tension' ? 36 : 28)) return 'tension';
  }
  return night ? 'night' : 'day';
}

// Stream compressed tracks instead of retaining minutes of decoded stereo PCM.
// Three reusable decks cap memory and make interrupted crossfades reversible.
export class AdaptiveMusic {
  constructor(context, destination, { createMedia = () => new Audio() } = {}) {
    this.context = context; this.destination = destination; this.createMedia = createMedia;
    this.decks = new Map(); this.target = null; this.lastMood = null; this.releaseAt = 0;
    this.enabled = true; this.volume = .35; this.duckUntil = 0; this.suspended = false;
  }
  unlock() {
    if (!this.enabled || !this.volume) return;
    for (const mood of Object.keys(MUSIC_TRACKS)) {
      const deck = this.deck(mood); deck.retryAt = 0; void this.start(deck);
    }
  }
  deck(mood) {
    if (this.decks.has(mood)) return this.decks.get(mood);
    const media = this.createMedia(); media.src = MUSIC_TRACKS[mood]; media.loop = true; media.preload = 'auto';
    const source = this.context.createMediaElementSource(media), gain = this.context.createGain(); gain.gain.value = 0;
    source.connect(gain); gain.connect(this.destination);
    const deck = { media, source, gain, from: 0, to: 0, at: 0, duration: 0, stopAt: 0, starting: false, retryAt: 0 };
    this.decks.set(mood, deck); return deck;
  }
  level(deck, now) {
    const progress = deck.duration ? Math.min(1, Math.max(0, (now - deck.at) / deck.duration)) : 1;
    return deck.from + (deck.to - deck.from) * progress;
  }
  fade(deck, to, seconds) {
    if (deck.to === to) return;
    const now = this.context.currentTime, current = this.level(deck, now), param = deck.gain.gain;
    param.cancelScheduledValues(now); param.setValueAtTime(current, now); param.linearRampToValueAtTime(to, now + seconds);
    Object.assign(deck, { from: current, to, at: now, duration: seconds, stopAt: to === 0 ? now + seconds : 0 });
  }
  duck(seconds = 2) { this.duckUntil = Math.max(this.duckUntil, this.context.currentTime + seconds); }
  setEnabled(enabled) { this.enabled = !!enabled; if (!enabled) this.stop(); }
  setVolume(volume) { if (Number.isFinite(volume)) this.volume = Math.max(0, Math.min(1, volume)); if (!this.volume) this.stop(); }
  async start(deck) {
    if (!deck.media.paused || deck.starting || this.context.currentTime < deck.retryAt) return;
    deck.starting = true;
    try { await deck.media.play(); }
    catch { deck.retryAt = this.context.currentTime + 5; }
    finally { deck.starting = false; if (this.suspended || !this.enabled || !this.volume || deck.to === 0) deck.media.pause(); }
  }
  update({ phase, creature, player, active, downed = false }) {
    if (!active || !this.enabled || !this.volume || this.context.state !== 'running') { this.stop(); return; }
    this.suspended = false;
    const now = this.context.currentTime;
    let mood = musicMood(phase, creature, player, this.lastMood);
    if (mood === 'tension') this.releaseAt = now + MUSIC_RELEASE_SECONDS;
    else if (this.lastMood === 'tension' && now < this.releaseAt) mood = 'tension';
    const changed = mood !== this.target;
    const chasing = mood === 'tension' && (creature?.state === 'stalk' || creature?.pressing || creature?.winding);
    const amount = this.volume * (chasing ? 1.05 : mood === 'tension' ? .85 : .8) * (now < this.duckUntil || downed ? .5 : 1);
    const deck = this.deck(mood);
    const fade = changed ? mood === 'tension' ? 1.8 : 7 : .65;
    for (const [name, other] of this.decks) {
      this.fade(other, name === mood ? amount : 0, fade);
      if (other.stopAt && now >= other.stopAt) { other.media.pause(); other.stopAt = 0; }
    }
    this.target = mood; this.lastMood = mood;
    void this.start(deck);
  }
  stop() {
    if (this.suspended) return;
    this.suspended = true;
    for (const deck of this.decks.values()) {
      deck.media.pause(); deck.gain.gain.cancelScheduledValues(this.context.currentTime);
      deck.gain.gain.setValueAtTime(0, this.context.currentTime);
      Object.assign(deck, { from: 0, to: 0, duration: 0, stopAt: 0 });
    }
    this.target = null; this.lastMood = null; this.releaseAt = 0;
  }
  reset() { this.stop(); this.duckUntil = 0; for (const deck of this.decks.values()) { try { deck.media.currentTime = 0; } catch { /* Not loaded yet. */ } } }
}
