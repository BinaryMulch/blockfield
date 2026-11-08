const point = p => p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : 'None';

export class DirectorDebugView {
  enabled = false;
  nextPaint = 0;
  nextPoll = 0;
  server = null;
  constructor(read) {
    this.read = read;
    this.panel = document.querySelector('#director-debug');
    this.toggle = document.querySelector('#director-debug-toggle');
    this.fields = new Map([...this.panel.querySelectorAll('[data-director]')].map(node => [node.dataset.director, node]));
    this.toggle.addEventListener('click', () => this.setEnabled(!this.enabled));
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.setEnabled(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.controller?.abort(); });
  }
  setEnabled(enabled) {
    this.enabled = enabled; this.panel.hidden = !enabled;
    this.toggle.setAttribute('aria-pressed', String(enabled));
    if (!enabled) this.controller?.abort();
    else { this.nextPaint = 0; this.nextPoll = 0; this.frame(performance.now()); }
  }
  async poll() {
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch('/api/performance', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Host diagnostics unavailable');
      const state = await response.json();
      if (!controller.signal.aborted && this.enabled) this.server = { listener: state.listener, at: performance.now() };
    } catch { this.server = null; }
    finally { clearTimeout(timeout); this.controller = null; this.nextPoll = performance.now() + 1000; this.nextPaint = 0; }
  }
  frame(now) {
    if (!this.enabled || document.hidden) return;
    const { mode, listener } = this.read();
    if (mode !== this.mode) { this.mode = mode; this.server = null; this.nextPoll = 0; }
    if (mode === 'multiplayer' && !this.controller && now >= this.nextPoll) void this.poll();
    if (now < this.nextPaint) return;
    this.nextPaint = now + 250;
    const state = mode === 'single' ? listener : this.server?.listener, d = state?.director;
    const set = (key, value) => { this.fields.get(key).textContent = value; };
    set('source', !mode ? 'No world open' : mode === 'single' ? 'Private world · live simulation' : this.server ? `Host simulation · ${Math.max(0, (now - this.server.at) / 1000).toFixed(1)}s old` : 'Waiting for host diagnostics…');
    set('phase', d ? `${d.phase} · ${d.phaseSeconds.toFixed(1)}s` : '—');
    set('reason', d?.reason || '—');
    set('allowance', d ? `${d.budget}/${d.maxBudget} budget · ${d.hits}/${d.maxHits} barrier hits` : '—');
    set('pressure', d ? `${d.maxPressure}% · quiet timer ${d.quietSeconds}s` : '—');
    set('permissions', d ? Object.entries(d.permissions).filter(([key]) => key !== 'at').map(([key, allowed]) => `${key}: ${allowed ? 'yes' : 'no'}`).join(' · ') : '—');
    set('state', state ? `${state.state} · ${state.activity}` : '—');
    set('decision', state?.decision || '—');
    set('evidence', state?.evidence || 'None');
    set('position', state ? `${point(state.position)} → ${point(state.target)}` : '—');
    set('barrier', state?.barrier ? `${state.barrier.activity}${state.barrier.target ? ` · ${state.barrier.target} · next hit ${state.barrier.nextHitSeconds.toFixed(1)}s` : ''}` : 'None');
    set('scores', state?.scores?.map(s => `${s.action} ${s.score}`).join(' · ') || 'None');
    set('work', state ? `${state.pathNodes} path nodes · ${state.failedRoutes} failed goals · ${state.expandedNodes} expanded / ${state.blockReads} reads` : '—');
    set('history', d?.history?.map(h => `${h.at.toFixed(1)}s ${h.phase}: ${h.reason}`).join('\n') || 'No transitions yet');
  }
}
