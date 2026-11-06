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

  advance(seconds) {
    if (!this.held && Number.isFinite(seconds) && seconds > 0) this.phase = wrap(this.phase + seconds / DAY_LENGTH);
  }

  next() {
    this.phase = { Day: 0.46, Sunset: 0.75, Night: 0.02, Sunrise: 0.18 }[timeLabel(this.phase)];
  }
}
