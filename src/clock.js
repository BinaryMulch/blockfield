export const DAY_LENGTH = 480;
const wrap = value => ((value % 1) + 1) % 1;

export function timeLabel(phase) {
  const time = wrap(phase);
  if (time < 0.07 || time >= 0.94) return 'Sunrise';
  if (time < 0.38) return 'Day';
  if (time < 0.52) return 'Sunset';
  return 'Night';
}

export class DayClock {
  phase = 0.18;
  held = false;
  elapsedSeconds = 0;
  day = 1;

  constructor(saved) {
    if (saved) {
      this.phase = saved.phase;
      this.elapsedSeconds = saved.elapsedSeconds ?? 0;
      this.day = saved.day ?? 1;
    }
  }

  snapshot(running = false) {
    return { phase: this.phase, held: false, elapsedSeconds: this.elapsedSeconds, day: this.day, running };
  }

  advance(seconds) {
    if (!this.held && Number.isFinite(seconds) && seconds > 0) {
      const phase = this.phase + seconds / DAY_LENGTH;
      this.day += Math.floor(phase);
      this.elapsedSeconds += seconds;
      this.phase = wrap(phase);
    }
  }

  next() {
    this.phase = { Day: 0.46, Sunset: 0.75, Night: 0.02, Sunrise: 0.18 }[timeLabel(this.phase)];
  }
}
