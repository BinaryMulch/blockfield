import { FrameMetrics } from './metrics.js';

const ms = value => Number.isFinite(value) ? `${value.toFixed(1)} ms` : '—';
const bytes = value => Number.isFinite(value) ? `${(value / 1048576).toFixed(1)} MiB` : 'Unavailable';
const percent = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Warming up…';

export class PerformanceOverlay {
  frames = new FrameMetrics();
  enabled = false;
  lastPaint = -Infinity;
  nextPoll = 0;
  server = null;
  serverState = 'Checking host…';

  constructor(read) {
    this.read = read;
    this.panel = document.querySelector('#performance-panel');
    this.toggle = document.querySelector('#performance-toggle');
    this.fields = new Map([...this.panel.querySelectorAll('[data-stat]')].map(node => [node.dataset.stat, node]));
    this.graph = this.panel.querySelector('canvas');
    this.context = this.graph.getContext('2d');
    this.toggle.addEventListener('click', () => this.setEnabled(!this.enabled));
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.setEnabled(false));
    this.panel.querySelector('[data-reset]').addEventListener('click', () => this.reset());
    this.panel.querySelector('[data-export]').addEventListener('click', () => this.export());
    document.addEventListener('visibilitychange', () => {
      this.reset();
      if (document.hidden) this.controller?.abort();
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.panel.hidden = !enabled;
    this.toggle.setAttribute('aria-pressed', String(enabled));
    this.reset();
    if (!enabled) this.controller?.abort();
    else { this.nextPoll = 0; this.paint(); }
  }

  reset() { this.frames.reset(); this.lastPaint = -Infinity; }

  frame(start, end, rendered = true) {
    if (!this.enabled || document.hidden) return;
    this.frames.add(start, end, rendered);
    if (end - this.lastPaint >= 500) { this.lastPaint = end; this.paint(); }
    if (!this.controller && end >= this.nextPoll) void this.poll();
  }

  async poll() {
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 3000), started = performance.now();
    try {
      const response = await fetch('/api/performance', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Host metrics unavailable');
      const server = await response.json();
      if (server.version !== 1) throw new Error('Host metrics unavailable');
      if (controller.signal.aborted || !this.enabled || document.hidden) return;
      this.server = { ...server, httpRoundTripMs: performance.now() - started, receivedAt: Date.now() };
      this.serverState = server.saveHealthy ? 'Host connected' : 'Host save error';
    } catch {
      if (this.enabled && !document.hidden) { this.server = null; this.serverState = 'Host metrics unavailable'; }
    } finally {
      clearTimeout(timer); this.controller = null; this.nextPoll = performance.now() + 2000;
      if (this.enabled && !document.hidden) this.paint();
    }
  }

  snapshot() {
    const client = this.read();
    // Chromium-only estimate; worker/shared-heap coverage varies by browser.
    const heap = performance.memory?.usedJSHeapSize;
    return { format: 'blockfield-performance', version: 1, capturedAt: new Date().toISOString(),
      client: { ...client, ...this.frames.summary(), heapUsedEstimate: Number.isFinite(heap) ? heap : null,
        sampleFrames: this.frames.intervals.values.length },
      server: this.server, serverStatus: this.serverState,
      notes: ['FPS and frame intervals cover the latest 240 rendered frames, excluding callbacks skipped by the FPS cap, and reset on play/pause, graphics changes, or world changes.',
        'Main work covers the latest 240 animation callbacks, including those without rendering. It is elapsed game-loop work, not total CPU usage or GPU execution time.',
        'Worker work excludes queue and message transfer; worker round trip includes them. Timings cover the latest 60 jobs.',
        'Browser heap is a browser-provided estimate, not total browser or GPU memory. Worker/shared-heap coverage varies; it may be unavailable.',
        'Server CPU is for the whole Node process: 100% equals one logical CPU core. Development includes Vite.',
        'HTTP round trip includes network, request handling, and response parsing; it is not WebSocket ping.'] };
  }

  paint() {
    const { client: c, server: s } = this.snapshot();
    const set = (key, value) => { this.fields.get(key).textContent = value; };
    set('fps', Number.isFinite(c.fps) ? c.fps.toFixed(0) : '—');
    set('context', c.context);
    set('graphics', `${c.graphics.fpsLimit} FPS / ${Math.round(c.graphics.resolutionScale * 100)}%`);
    set('buffer', `${c.graphics.bufferWidth} × ${c.graphics.bufferHeight}`);
    set('frame', `${ms(c.frameMs.mean)} / ${ms(c.frameMs.p95)}`);
    set('worst', ms(c.frameMs.max));
    set('work', `${ms(c.workMs.mean)} / ${ms(c.workMs.p95)}`);
    set('heap', bytes(c.heapUsedEstimate));
    set('draws', `${c.render.calls.toLocaleString()} / ${c.render.triangles.toLocaleString()}`);
    set('resources', `${c.render.geometries} / ${c.render.textures}`);
    set('chunks', `${c.chunks.loaded} / ${c.chunks.meshed} / ${c.chunks.queued}`);
    set('mesh', `${ms(c.mesh?.workMs?.mean)} / ${ms(c.mesh?.turnaroundMs?.mean)}`);
    set('generate', c.mode === 'single' ? `${ms(c.generate?.workMs?.mean)} / ${ms(c.generate?.turnaroundMs?.mean)}` : 'Runs on host');
    set('jobs', `${c.mesh?.pending || 0} / ${c.generate?.pending || 0}`);
    const listener = c.mode === 'single' ? c.listener : s?.listener;
    set('listener', listener ? `${listener.state} · ${listener.activity}` : '—');
    set('director', listener?.director ? `${listener.director.phase} · budget ${listener.director.budget} · pressure ${listener.director.maxPressure}%` : '—');
    set('director-reason', listener?.director?.reason || '—');
    set('listener-decision', listener?.decision || '—');
    set('listener-evidence', listener?.evidence || '—');
    set('listener-queries', listener ? `${listener.candidates} candidates · ${listener.perceptionSteps} trace cells · ${listener.failedRoutes} failed goals` : '—');
    set('listener-work', listener ? `${listener.expandedNodes} / ${listener.blockReads} · ${listener.pathNodes} path` : '—');
    set('lighting', `${ms(c.lighting.jobs?.workMs?.mean)} / ${c.lighting.sources} / ${c.lighting.jobs?.pending || 0}`);
    set('server', s ? `${this.serverState} · ${s.mode}` : this.serverState);
    set('cpu', s ? percent(s.cpuPercent) : '—');
    set('rss', s ? bytes(s.memory.rss) : '—');
    set('loop', s ? percent(s.eventLoopPercent) : '—');
    set('tick', ms(s?.tickMs?.p95));
    set('save', s?.saving ? ms(s.saveMs?.last) : s ? 'Disk saving off' : '—');
    set('host-world', s ? `${s.players} / ${s.loadedChunks}` : '—');
    set('latency', ms(s?.httpRoundTripMs));
    this.drawGraph();
  }

  drawGraph() {
    const ctx = this.context; if (!ctx) return;
    const { width, height } = this.graph, values = this.frames.intervals.ordered();
    const ceiling = Math.max(50, Math.min(200, this.frames.intervals.summary().max || 50));
    ctx.clearRect(0, 0, width, height);
    for (const value of [16.67, 33.33]) {
      const y = height - value / ceiling * height;
      ctx.strokeStyle = '#adc8b733'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillStyle = '#b6c9bf'; ctx.font = '10px monospace'; ctx.fillText(`${value.toFixed(1)} ms`, 4, y - 3);
    }
    const step = width / 240;
    for (let i = 0; i < values.length; i++) {
      ctx.fillStyle = values[i] > 33.34 ? '#e8a16e' : '#98d9b5';
      const h = Math.min(height, values[i] / ceiling * height);
      ctx.fillRect((240 - values.length + i) * step, height - h, Math.max(1, step), h);
    }
  }

  export() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.snapshot(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `blockfield-performance-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
