/* ModulationToy — UI: state ↔ controls ↔ URL hash, compute(), Plotly rendering. */
(function () {
  'use strict';
  const { PRESETS, BASE } = window.Presets;
  const G = window.Glossary;
  const $ = (id) => document.getElementById(id);

  const KEYS = ['topology', 'strategy', 'carrier', 'sampling', 'reference', 'M', 'k3', 'mf', 'f1', 'Vdc', 'probe',
    'load', 'R', 'Lmh', 'E', 'delta', 'tdus'];
  const NUMERIC = new Set(['M', 'k3', 'mf', 'f1', 'Vdc', 'R', 'Lmh', 'E', 'delta', 'tdus']);
  const BOOL = new Set(['load']);
  let state = Model.normalise({});
  let activePreset = null;
  let showSV = false;                       // space-vector view (three-phase only), UI state

  // Option label (plain text) and hint ({id} = glossary symbol) per strategy.
  const STRATEGY_INFO = {
    single: ['—', ''],
    bipolar: ['Bipolar (2-level)', 'Leg b is the complement of leg a: output ±{Vdc}, two levels.'],
    unipolar: ['Unipolar (3-level)', 'Legs a and b compare +m and −m with the same carrier: output +{Vdc}, 0, −{Vdc}.'],
    hybrid: ['Hybrid (leg b at f₁)', 'Leg b switches only at {f1} (sign of m); leg a does all the PWM.'],
    spwm: ['SPWM', '{SPWM} — sinusoidal PWM: plain sine references, {z} = 0. Linear up to {M} = 1.'],
    thipwm: ['THIPWM (3rd-harmonic injection)', '{THIPWM} — third-harmonic injection PWM: {z} = {k3}·{M}·sin 3θ. With {k3} = 1/6, linear up to {M} = 1.155.'],
    svpwm: ['SVPWM (space vector)', '{SVPWM} — space-vector PWM, carrier-based form: {z} = −(max + min)/2 centres the references and shares each carrier period equally between the zero vectors 000 and 111. Linear up to {M} = 1.155.'],
    dpwm1: ['DPWM1 (clamp at peaks)', '{DPWM} — discontinuous PWM. DPWM1: the phase with the largest reference is clamped to its rail for 60° around each peak; each leg rests 120° per period.'],
    dpwm0: ['DPWM0 (clamp 30° earlier)', '{DPWM} — discontinuous PWM. DPWM0: as DPWM1 with the clamp windows 30° earlier. With natural sampling, the jumps of {z} can land mid-slope on the carrier and distort the output (try regular sampling).'],
    dpwm2: ['DPWM2 (clamp 30° later)', '{DPWM} — discontinuous PWM. DPWM2: as DPWM1 with the clamp windows 30° later, where they catch the current peak of a load whose current lags by about 30°. With natural sampling, the jumps of {z} can land mid-slope on the carrier (try regular sampling).'],
    dpwmmax: ['DPWMMAX (clamp to +)', '{DPWM} — discontinuous PWM. DPWMMAX: the phase with the largest reference is clamped to the positive rail for 120°.'],
    dpwmmin: ['DPWMMIN (clamp to −)', '{DPWM} — discontinuous PWM. DPWMMIN: the phase with the smallest reference is clamped to the negative rail for 120°.'],
    sixstep: ['Six-step (square wave)', 'Each leg is on for half the period, the three 120° apart: the largest possible fundamental, (4/π)·{Vdc}/2 per pole, with 2 switchings per leg per period. {M} is ignored.'],
  };
  const PROBE_INFO = {
    HB: { vaO: 'Output (a–O)' },
    FB: { vab: 'Output (a–b)', vcm: 'Common mode (a, b average – O)' },
    TP: { vab: 'Line-to-line (a–b)', van: 'Phase (a–n)', vaO: 'Pole (a–O)', vcm: 'Common mode (n–O)' },
  };
  const PROBE_TIP = {
    vaO: '<i>v</i><sub>aO</sub>: node a with respect to the DC-bus midpoint O',
    vab: '<i>v</i><sub>ab</sub>: node a with respect to node b',
    van: '<i>v</i><sub>an</sub>: node a with respect to the load star point n',
    vcm: 'common-mode voltage with respect to the DC-bus midpoint O',
  };

  // ---------------------------------------------------------------- URL hash
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const s = {};
    KEYS.forEach((k) => {
      if (!p.has(k)) return;
      s[k] = NUMERIC.has(k) ? parseFloat(p.get(k)) : BOOL.has(k) ? p.get(k) === '1' : p.get(k);
    });
    Object.keys(s).forEach((k) => { if (NUMERIC.has(k) && !isFinite(s[k])) delete s[k]; });
    return { s, preset: p.get('p'), sv: p.get('sv') === '1' };
  }
  function writeHash() {
    const p = new URLSearchParams();
    KEYS.forEach((k) => p.set(k, NUMERIC.has(k) ? +(+state[k]).toPrecision(6) : BOOL.has(k) ? (state[k] ? '1' : '0') : state[k]));
    if (activePreset) p.set('p', activePreset);
    if (showSV) p.set('sv', '1');
    history.replaceState(null, '', '#' + p.toString());
  }

  // ---------------------------------------------------------------- controls
  function syncControls() {
    const tp = state.topology === 'TP';
    const strat = Model.TOPOLOGIES[state.topology].strategies;
    $('strategy').innerHTML = strat.map((s) => `<option value="${s}">${STRATEGY_INFO[s][0]}</option>`).join('');
    $('probe').innerHTML = Object.entries(PROBE_INFO[state.topology]).map(([id, t]) => `<option value="${id}">${t}</option>`).join('');
    ['topology', 'strategy', 'carrier', 'sampling', 'reference', 'probe'].forEach((k) => { $(k).value = state[k]; });
    $('strategyLabel').textContent = tp ? 'Modulation' : 'Full-bridge strategy';
    $('strategyHint').innerHTML = G.render(STRATEGY_INFO[state.strategy][1]);
    $('referenceField').hidden = tp;
    $('svToggle').hidden = !tp; $('sv').checked = showSV;
    const dc = state.reference === 'dc';
    $('M_r').min = $('M').min = dc ? -1 : 0;
    $('M_r').max = $('M').max = dc ? 1 : 1.3;
    ['M', 'k3', 'mf'].forEach((k) => { $(k).value = +(+state[k]).toFixed(3); $(k + '_r').value = state[k]; });
    ['f1', 'Vdc', 'R', 'Lmh', 'E', 'delta', 'tdus'].forEach((k) => { $(k).value = state[k]; });
    const tdc = state.tdus * 1e-6 * state.mf * state.f1;
    $('tdHint').innerHTML = state.tdus > 0 ? `${(100 * tdc).toFixed(2)} % of the carrier period ${G.sym('Tc')}` : 'Off: ideal complementary gates';
    $('load').checked = state.load;
    $('loadFields').hidden = !state.load;
    $('specOf').hidden = $('specOfLabel').hidden = !state.load;
    if (!state.load) $('specOf').value = 'v';
    $('strategyField').hidden = state.topology === 'HB';
    $('k3Field').hidden = !(tp ? state.strategy === 'thipwm' : state.reference === 'sine3');
    $('MLabel').innerHTML = (dc ? 'DC reference level ' : 'Modulation index ') + G.sym('M');
    $('MHint').innerHTML = dc
      ? G.render(`Leg a duty {d} = (1 + {M})/2 = ${((1 + state.M) / 2).toFixed(3)}`)
      : 'Fundamental amplitude of the reference, in carrier units (carrier spans ±1)';
    $('preset').value = activePreset || '';
    const p = PRESETS.find((q) => q.id === activePreset);
    $('look').innerHTML = p
      ? G.render(p.look)
      : 'Custom setup. Pick a preset above for a guided observation. Hover any dotted-underlined symbol for its meaning; zoom a time plot to see single carrier periods.';
    if (!$('schem').hidden) fillSchematic();
  }

  function set(patch, keepPreset) {
    const prevRef = state.reference;
    state = Model.normalise(Object.assign({}, state, patch));
    if (state.reference === 'dc' && prevRef !== 'dc') state.M = Math.min(Math.max(state.M, -1), 1);
    if (state.reference !== 'dc' && state.M < 0) state.M = 0;
    state.mf = Math.min(Math.max(Math.round(state.mf * 10) / 10, 1), 100);
    state.f1 = Math.max(state.f1, 0.1);
    state.Vdc = Math.max(state.Vdc, 1e-3);
    if (!keepPreset) activePreset = null;
    syncControls(); writeHash(); schedule();
  }

  function bind() {
    ['topology', 'strategy', 'carrier', 'sampling', 'reference', 'probe'].forEach((k) =>
      $(k).addEventListener('change', () => set({ [k]: $(k).value })));
    $('sv').addEventListener('change', () => { showSV = $('sv').checked; writeHash(); schedule(); });
    ['M', 'k3', 'mf'].forEach((k) => {
      $(k + '_r').addEventListener('input', () => set({ [k]: parseFloat($(k + '_r').value) }));
      $(k).addEventListener('change', () => { const v = parseFloat($(k).value); if (isFinite(v)) set({ [k]: v }); else syncControls(); });
    });
    ['f1', 'Vdc', 'Lmh'].forEach((k) => $(k).addEventListener('change', () => {
      const v = parseFloat($(k).value); if (isFinite(v) && v > 0) set({ [k]: v }); else syncControls();
    }));
    ['R', 'E', 'tdus'].forEach((k) => $(k).addEventListener('change', () => {
      const v = parseFloat($(k).value); if (isFinite(v) && v >= 0) set({ [k]: v }); else syncControls();
    }));
    $('delta').addEventListener('change', () => {
      const v = parseFloat($('delta').value); if (isFinite(v)) set({ delta: ((v + 180) % 360 + 360) % 360 - 180 }); else syncControls();
    });
    $('load').addEventListener('change', () => set({ load: $('load').checked }));
    $('specOf').addEventListener('change', schedule);
    $('specScale').addEventListener('change', schedule);
    $('copyLink').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); $('copyLink').textContent = 'Link copied'; }
      catch (e) { $('copyLink').textContent = 'Copy failed: use the address bar'; }
      setTimeout(() => { $('copyLink').textContent = 'Copy link to this setup'; }, 1600);
    });
    $('themeBtn').addEventListener('click', () => {
      const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('modtoy-theme', document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
      schedule();
    });
    const sel = $('preset');
    sel.innerHTML = '<option value="">Custom</option>' + PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    sel.addEventListener('change', () => {
      const p = PRESETS.find((q) => q.id === sel.value);
      if (!p) { activePreset = null; syncControls(); writeHash(); return; }
      activePreset = p.id;
      set(Object.assign({}, BASE, p.set), true);   // BASE includes V_dc and f1: the notes quote numbers for them
    });

    document.querySelectorAll('[data-sym]').forEach((el) => { el.outerHTML = G.sym(el.dataset.sym); });
    bindSchematic();
    bindFloat();
    bindTips();
  }

  // ---------------------------------------------------------------- schematic popover
  function fillSchematic() {
    $('schemTitle').textContent = Model.TOPOLOGIES[state.topology].label;
    $('schemBody').innerHTML = Schematic.svg(state.topology);
  }
  function placeSchematic() {
    const b = $('schemBtn').getBoundingClientRect(), box = $('schem');
    const w = box.offsetWidth, hgt = box.offsetHeight;
    const left = innerWidth < 700 ? 16 : Math.min(b.right + 12, innerWidth - w - 16);
    const top = Math.max(12, Math.min(b.top - 20, innerHeight - hgt - 12));
    box.style.left = left + 'px'; box.style.top = top + 'px';
  }
  function toggleSchematic(open) {
    $('schem').hidden = !open;
    $('schemBtn').setAttribute('aria-expanded', String(open));
    if (open) { fillSchematic(); placeSchematic(); }
  }
  function bindSchematic() {
    $('schemBtn').addEventListener('click', () => toggleSchematic($('schem').hidden));
    $('schemClose').addEventListener('click', () => toggleSchematic(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleSchematic(false); hideTip(); } });
    document.addEventListener('mousedown', (e) => {
      if (!$('schem').hidden && !e.target.closest('#schem, #schemBtn')) toggleSchematic(false);
    });
    addEventListener('resize', () => { if (!$('schem').hidden) placeSchematic(); });
  }

  // ---------------------------------------------------------------- floating space-vector panel
  // Drag by the title bar, resize from the corner (CSS resize); position kept within the window.
  let floatPlaced = false;
  function placeFloat() {
    const box = $('svFloat');
    if (!floatPlaced) {
      box.style.left = Math.max(8, innerWidth - box.offsetWidth - 24) + 'px';
      box.style.top = Math.max(8, innerHeight - box.offsetHeight - 24) + 'px';
      floatPlaced = true;
    }
    clampFloat();
  }
  function clampFloat() {
    const box = $('svFloat'), r = box.getBoundingClientRect();
    // keep at least 80 px of the title bar inside the window, and never above its top edge
    box.style.left = Math.max(8 - r.width + 80, Math.min(r.left, innerWidth - 80)) + 'px';
    box.style.top = Math.max(8, Math.min(r.top, innerHeight - 40)) + 'px';
  }
  function bindFloat() {
    const box = $('svFloat'), head = $('svHead');
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      box.style.left = (e.clientX - drag.dx) + 'px'; box.style.top = (e.clientY - drag.dy) + 'px';
      clampFloat();
    });
    const end = () => { drag = null; };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    $('svClose').addEventListener('click', () => { showSV = false; $('sv').checked = false; writeHash(); schedule(); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (!box.hidden) Plotly.Plots.resize('svPlot'); }).observe(box);
    // fallback (e.g. a background tab, where ResizeObserver does not deliver): refit when a corner drag ends
    box.addEventListener('mouseup', () => { if (!box.hidden) Plotly.Plots.resize('svPlot'); });
    addEventListener('resize', () => { if (!box.hidden) clampFloat(); });
  }

  // ---------------------------------------------------------------- tooltips
  // Any element with data-tip (HTML) shows it on hover, keyboard focus, or tap.
  let tipEl = null;
  function showTip(el) {
    const tip = $('tip');
    tipEl = el; tip.innerHTML = el.dataset.tip; tip.hidden = false;
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.min(Math.max(8, r.left), innerWidth - tw - 8);
    let y = r.bottom + 6; if (y + th > innerHeight - 8) y = r.top - th - 6;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tipEl = null; $('tip').hidden = true; }
  function bindTips() {
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el === tipEl) return;
      if (el) showTip(el); else hideTip();
    });
    document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
    document.addEventListener('focusout', hideTip);
    document.addEventListener('scroll', hideTip, true);
  }

  // ---------------------------------------------------------------- plot toolbar: save / copy image
  // The camera button saves a PNG at 2× resolution with a descriptive name; the clipboard button
  // copies the same image (browsers allow clipboard writes only on https or localhost pages; elsewhere
  // the image is downloaded instead).
  const imgName = (what) => ['pwm', state.topology, state.strategy === 'single' ? 'sine' : state.strategy,
    'M' + (+state.M).toFixed(2).replace(/0$/, ''), 'mf' + state.mf, what].join('_');
  const CLIPBOARD_ICON = {
    width: 24, height: 24,
    path: 'M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1zm0 2v2h6V4H9zM6 6v14h12V6h-2v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6H6z',
    transform: 'matrix(1 0 0 1 0 0)',
  };
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  async function copyImage(gd, what) {
    // the plot's own laid-out size (always valid pixels, unlike offsetWidth in a hidden or collapsed page)
    const opts = { format: 'png', scale: 2, width: Math.round(gd._fullLayout.width), height: Math.round(gd._fullLayout.height) };
    try {
      if (!navigator.clipboard || !window.ClipboardItem || !window.isSecureContext) throw new Error('no clipboard');
      // hand the clipboard a pending image right away: Safari only allows a write started inside the click
      const blob = Plotly.toImage(gd, opts).then((url) => fetch(url)).then((r) => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Image copied to the clipboard');
    } catch (e) {
      await Plotly.downloadImage(gd, Object.assign({ filename: imgName(what) }, opts));
      toast('Clipboard not available on this page: image downloaded instead');
    }
  }
  const plotConfig = (what) => ({
    responsive: true, displaylogo: false,
    toImageButtonOptions: { format: 'png', scale: 2, filename: imgName(what) },
    modeBarButtonsToAdd: [{ name: 'Copy image to clipboard', icon: CLIPBOARD_ICON, click: (gd) => copyImage(gd, what) }],
  });

  // ---------------------------------------------------------------- rendering
  let pending = false;
  // requestAnimationFrame never fires in a hidden tab, which would leave `pending` stuck; use a timer there.
  function schedule() {
    if (pending) return;
    pending = true;
    const run = () => { pending = false; render(); };
    if (document.hidden) setTimeout(run, 0); else requestAnimationFrame(run);
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, d = 3) => (isFinite(v) ? (+v.toPrecision(d)).toString() : '—');
  const fmtHz = (f) => (f >= 1e6 ? fmt(f / 1e6) + ' MHz' : f >= 1e3 ? fmt(f / 1e3) + ' kHz' : fmt(f) + ' Hz');
  const pct = (v) => (isFinite(v) ? (100 * v).toFixed(v < 0.1 ? 2 : 1) + ' %' : '—');

  // Unit from the fundamental period, not the window, so it never flips with mf.
  function timeUnit() {
    return 1 / state.f1 >= 1e-3 ? { k: 1e3 / state.f1, name: 'ms' } : { k: 1e6 / state.f1, name: 'µs' };
  }
  const scaleX = (xs, k) => xs.map((x) => x * k);

  function render() {
    const res = Model.compute(state);
    const out = res.out;
    const noFund = state.reference === 'dc' || state.probe === 'vcm';   // no fundamental to refer to
    const { mf, Q } = res.win;
    const u = timeUnit();
    const C = {
      text: css('--text'), text2: css('--text-2'), muted: css('--muted'), grid: css('--grid'),
      surface: css('--surface'), a: css('--s-a'), b: css('--s-b'), c: css('--s-c'), carrier: css('--s-carrier'),
      out: css('--s-out'), fund: css('--s-fund'), avg: css('--s-avg'), spec: css('--s-spec'),
    };
    const legColor = (i) => [C.a, C.b, C.c][i];

    // ---- time plot: three stacked rows sharing one x axis
    const traces = [];
    const firstCmp = res.legs.find((l) => l.kind === 'compare');
    const ct = PWM.carrierTrace(firstCmp.carrier, mf, Q);
    traces.push({ x: scaleX(ct.x, u.k), y: ct.y, yaxis: 'y', name: 'carrier', mode: 'lines',
      line: { color: C.carrier, width: 1.2 }, hoverinfo: 'skip' });
    res.legs.forEach((l, i) => {
      if (l.kind !== 'compare') return;
      const rt = PWM.refTrace(l.ref, l.carrier, state.sampling, mf, Q);
      traces.push({ x: scaleX(rt.x, u.k), y: rt.y, yaxis: 'y', mode: 'lines',
        name: `<i>r</i><sub>${l.name}</sub>`, line: { color: legColor(i), width: 2 },
        hovertemplate: `<i>r</i><sub>${l.name}</sub> = %{y:.3f}<extra></extra>` });
    });
    if (res.zero && state.strategy !== 'spwm') {
      const zx = Array.from({ length: 1501 }, (_, i) => i * Q / 1500);
      traces.push({ x: scaleX(zx, u.k), y: zx.map(res.zero), yaxis: 'y', mode: 'lines', name: '<i>z</i> (zero-sequence)',
        line: { color: C.muted, width: 1.5, dash: 'dash' }, hovertemplate: '<i>z</i> = %{y:.3f}<extra></extra>' });
    }

    const nRows = res.legs.length * 2, pitch = 1.4, ticks = [], tickText = [];
    res.legs.forEach((l, i) => {
      [['+', 1, 0], ['−', 0, 1]].forEach(([sgn, hi, lo], j) => {
        const row = i * 2 + j, base = (nRows - 1 - row) * pitch;
        // with dead time, the actual gates (turn-on delayed); otherwise the complementary commands
        const tl = res.deadtime && res.deadtime.gates[i];
        const gw = tl ? { Q, b: tl.x.concat(Q), L: tl.g.map((g) => ((j === 0 ? g === 1 : g === -1) ? 1 : 0)) } : PWM.legWave(l.edges, hi, lo);
        const st = PWM.stepTrace(gw, 1, base);
        traces.push({ x: scaleX(st.x, u.k), y: st.y, yaxis: 'y2', mode: 'lines', showlegend: false,
          line: { color: legColor(i), width: 1.5 }, opacity: j ? 0.55 : 1,
          name: `S<sub>${l.name}${sgn}</sub>`, hoverinfo: 'skip' });
        ticks.push(base + 0.5); tickText.push(`S<sub>${l.name}${sgn}</sub>`);
      });
    });

    const w = out.wave, so = PWM.stepTrace(w);
    traces.push({ x: scaleX(so.x, u.k), y: so.y, yaxis: 'y3', mode: 'lines', name: out.label, legend: 'legend2',
      line: { color: C.out, width: 1.2 }, hovertemplate: '%{y:.4g} V<extra></extra>' });
    const nG = Math.min(6000, 1500 * Q), xg = Array.from({ length: nG + 1 }, (_, i) => i * Q / nG);
    const avg = PWM.movingAverage(w, 1 / mf, xg);
    traces.push({ x: scaleX(xg, u.k), y: avg, yaxis: 'y3', mode: 'lines', name: 'average over <i>T</i><sub>c</sub>', legend: 'legend2',
      line: { color: C.avg, width: 2, dash: 'dash' }, hovertemplate: 'avg %{y:.4g} V<extra></extra>' });
    const k1 = Q, re = out.spec.re[k1], im = out.spec.im[k1];
    if (!noFund) {
      traces.push({ x: scaleX(xg, u.k), y: xg.map((x) => 2 * (re * Math.cos(2 * Math.PI * x) - im * Math.sin(2 * Math.PI * x))),
        yaxis: 'y3', mode: 'lines', name: 'fundamental', legend: 'legend2', line: { color: C.fund, width: 2 },
        hovertemplate: 'fund. %{y:.4g} V<extra></extra>' });
    }

    // ---- load current row (when a load is connected)
    const ld = res.load;
    if (ld) {
      ld.phases.forEach((p, i) => {
        traces.push({ x: scaleX(p.i.x, u.k), y: p.i.y, yaxis: 'y4', mode: 'lines', legend: 'legend3',
          name: ld.nPhases > 1 ? `<i>i</i><sub>${p.name}</sub>` : '<i>i</i>', line: { color: legColor(i), width: 1.5 },
          hovertemplate: (ld.nPhases > 1 ? `<i>i</i><sub>${p.name}</sub>` : '<i>i</i>') + ' = %{y:.3g} A<extra></extra>' });
      });
      const ci = ld.ispec.re[Q], si = ld.ispec.im[Q], i0 = ld.ispec.re[0];
      traces.push({ x: scaleX(xg, u.k), y: xg.map((x) => i0 + 2 * (ci * Math.cos(2 * Math.PI * x) - si * Math.sin(2 * Math.PI * x))),
        yaxis: 'y4', mode: 'lines', legend: 'legend3', name: 'fundamental' + (ld.nPhases > 1 ? ' of <i>i</i><sub>a</sub>' : ''),
        line: { color: C.fund, width: 1.5, dash: 'dash' }, hovertemplate: 'fund. %{y:.3g} A<extra></extra>' });
    }

    const axis = (extra) => Object.assign({ gridcolor: C.grid, zerolinecolor: C.grid, linecolor: C.grid,
      tickfont: { color: C.text2 }, title: { font: { color: C.text2 } } }, extra);
    // Section titles; hovering one explains the plot below it (dotted underline = hover text).
    const note = (y, text, hovertext) => ({ xref: 'paper', yref: 'paper', x: 0, y, xanchor: 'left', yanchor: 'bottom',
      text: `<span style="text-decoration: underline dotted">${text}</span>`, hovertext, showarrow: false,
      font: { color: C.text, size: 13 }, hoverlabel: { bgcolor: C.text, font: { color: C.surface } } });
    const outTip = PROBE_TIP[state.probe];
    // Row domains: three rows, or four with the load-current row.
    const D = ld ? { y1: [0.79, 1], y2: [0.55, 0.73], y3: [0.29, 0.49], y4: [0, 0.23] }
      : { y1: [0.70, 1], y2: [0.40, 0.63], y3: [0, 0.33] };
    const layout = {
      paper_bgcolor: C.surface, plot_bgcolor: C.surface, font: { color: C.text, family: 'system-ui, sans-serif' },
      // One legend per row, right-aligned on the row's title line.
      margin: { l: 64, r: 16, t: 26, b: 36 }, hovermode: 'x', uirevision: String(state.f1),
      legend: { orientation: 'h', x: 1, xanchor: 'right', y: D.y1[1], yanchor: 'bottom', font: { color: C.text2 }, bgcolor: 'rgba(0,0,0,0)' },
      legend2: { orientation: 'h', x: 1, xanchor: 'right', y: D.y3[1], yanchor: 'bottom', font: { color: C.text2 }, bgcolor: 'rgba(0,0,0,0)' },
      legend3: { orientation: 'h', x: 1, xanchor: 'right', y: ld ? D.y4[1] : 0, yanchor: 'bottom', font: { color: C.text2 }, bgcolor: 'rgba(0,0,0,0)' },
      // Always open on one fundamental period; longer windows (non-integer mf) are there to zoom out to.
      xaxis: axis({ anchor: ld ? 'y4' : 'y3', ticksuffix: ' ' + u.name, range: [0, u.k], autorange: false }),
      yaxis: axis({ domain: D.y1, title: { text: 'Carrier units', font: { color: C.text2 } }, zeroline: true }),
      yaxis2: axis({ domain: D.y2, tickvals: ticks, ticktext: tickText, showgrid: false, zeroline: false,
        range: [-0.3, (nRows - 1) * pitch + 1.3] }),
      yaxis3: axis({ domain: D.y3, title: { text: 'Volts', font: { color: C.text2 } }, zeroline: true }),
      yaxis4: axis({ domain: ld ? D.y4 : [0, 0.01], visible: !!ld, title: { text: 'Amps', font: { color: C.text2 } }, zeroline: true }),
      annotations: [
        note(1.0, 'Carrier and references', 'Each leg compares its reference <i>r</i> with the carrier:<br>the upper switch is on while <i>r</i> > carrier. With regular<br>sampling the held (staircase) reference is shown. Three-phase:<br>the dashed zero-sequence <i>z</i> is already included in every <i>r</i>.'),
        note(D.y2[1], 'Gate signals (upper +, lower −)', res.deadtime ? 'Gate signals of the upper (+) and lower (−) switch of each leg:<br>high = on. Every turn-on is delayed by the dead time t<sub>d</sub>; zoom in on an edge to see the gap.' : 'Gate commands of the upper (+) and lower (−) switch of each leg:<br>high = on. Ideal and complementary (no dead time).'),
        note(D.y3[1], `Output ${out.label}`, `${outTip}, with its fundamental<br>and its average over one carrier period (what an averaged model predicts).`)]
        .concat(ld ? [note(D.y4[1], `Load current${ld.nPhases > 1 ? 's' : ''}`, `From L di/dt + R i = v − e, with v = ${ld.vLabel} across the load branch.<br>Exact periodic steady state (no simulation transient).`)] : []),
    };
    Plotly.react('timePlot', traces, layout, plotConfig('waveforms'));

    // ---- spectrum
    const mode = $('specScale').value, dc = state.reference === 'dc';
    const cur = !!ld && $('specOf').value === 'i';
    const sp = cur ? ld.ispec : out.spec, unit = cur ? 'A' : 'V';
    const A = sp.A, A1 = A[Q];
    const noRef = cur ? !(A1 > 0) : noFund;
    const refAmp = noRef ? (cur ? Math.max(...A) : state.Vdc) : A1;
    const refName = noRef ? (cur ? 'largest line' : '<i>V</i><sub>dc</sub>') : 'fundamental';
    const floorDb = -80;
    const val = (a) => (mode === 'volts' ? a : mode === 'pct' ? 100 * a / refAmp : Math.max(floorDb, 20 * Math.log10(a / refAmp)));
    const base = mode === 'db' ? floorDb : 0;
    const thr = 1e-6 * (cur ? Math.max(...A) : state.Vdc);
    const hx = [], hy = [], sx = [], sy = [], hover = [];
    for (let k = 0; k <= sp.kmax; k++) {
      if (!noRef && k === Q) continue;
      if (A[k] < thr) continue;
      const h = k / Q, v = val(Math.abs(A[k]));
      sx.push(h, h, null); sy.push(base, v, null);
      hx.push(h); hy.push(v);
      hover.push(`<i>h</i> = ${fmt(h, 4)} · ${fmtHz(h * state.f1)}<br>${fmt(Math.abs(A[k]), 4)} ${unit} · ${pct(Math.abs(A[k]) / refAmp)} of ${noRef ? refName : (cur ? 'I<sub>1</sub>' : 'V<sub>1</sub>')}`);
    }
    const specTraces = [
      { x: sx, y: sy, mode: 'lines', line: { color: C.spec, width: 1.5 }, hoverinfo: 'skip', showlegend: false },
      { x: hx, y: hy, mode: 'markers', marker: { color: C.spec, size: 6 }, name: dc ? 'DC and harmonics' : 'harmonics',
        text: hover, hovertemplate: '%{text}<extra></extra>' },
    ];
    if (!noRef) {
      const v1 = val(A1);
      specTraces.push({ x: [1, 1, null], y: [base, v1, null], mode: 'lines', line: { color: C.fund, width: 2.5 }, hoverinfo: 'skip', showlegend: false });
      specTraces.push({ x: [1], y: [v1], mode: 'markers', marker: { color: C.fund, size: 8 }, name: 'fundamental',
        text: [`fundamental · ${fmtHz(state.f1)}<br>${fmt(A1, 4)} ${unit}`], hovertemplate: '%{text}<extra></extra>' });
    }
    const yTitle = mode === 'volts' ? `Amplitude [${unit}]` : mode === 'pct' ? `% of ${refName}` : `dB rel. ${refName}`;
    Plotly.react('specPlot', specTraces, {
      paper_bgcolor: C.surface, plot_bgcolor: C.surface, font: { color: C.text, family: 'system-ui, sans-serif' },
      margin: { l: 64, r: 16, t: 30, b: 48 }, hovermode: 'closest', uirevision: `${Q}|${mf}`,
      legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.0, yanchor: 'bottom', font: { color: C.text2 } },
      xaxis: axis({ title: { text: 'Harmonic order <i>h</i> = <i>f</i> / <i>f</i><sub>1</sub>', font: { color: C.text2 } },
        range: [-0.5, Model.hmaxFor(mf) + 0.5], zeroline: false }),
      yaxis: axis({ title: { text: yTitle, font: { color: C.text2 } }, rangemode: mode === 'db' ? 'normal' : 'tozero',
        range: mode === 'db' ? [floorDb, 5] : undefined, autorange: mode === 'db' ? false : true }),
      annotations: [note(1.0, cur ? `Harmonic spectrum of the load current${ld.nPhases > 1 ? ' <i>i</i><sub>a</sub>' : ''}` : `Harmonic spectrum of ${out.label}`,
        cur ? 'Peak amplitude of each harmonic of the load current: I<sub>h</sub> = (V<sub>h</sub> − E<sub>h</sub>)/Z(h),<br>exact from the voltage spectrum. The inductance divides each line by its order.'
          : 'Peak amplitude of each harmonic of the output voltage, from its exact<br>Fourier series over the analysis window. Hover a stem for its value.')],
    }, plotConfig(cur ? 'current_spectrum' : 'spectrum'));

    renderSpaceVector(res, C, axis);
    renderMetrics(res, out);
  }

  // Space vector (three-phase only): hexagon of switching states, linear-range circles,
  // commanded fundamental, and the path of the carrier-period average of v_alpha-beta.
  function renderSpaceVector(res, C, axis) {
    const on = state.topology === 'TP' && showSV;
    const box = $('svFloat');
    if (on && box.hidden) { box.hidden = false; placeFloat(); }
    if (!on) { box.hidden = true; return; }
    const V = state.Vdc, R = 2 * V / 3, { mf, Q } = res.win;
    const ks = [0, 1, 2, 3, 4, 5, 0];
    const hexX = ks.map((k) => R * Math.cos(k * Math.PI / 3)), hexY = ks.map((k) => R * Math.sin(k * Math.PI / 3));
    const circle = (r) => {
      const t = Array.from({ length: 181 }, (_, i) => i * 2 * Math.PI / 180);
      return { x: t.map((a) => r * Math.cos(a)), y: t.map((a) => r * Math.sin(a)) };
    };
    const n = Math.min(6000, 1500 * Q), xg = Array.from({ length: n + 1 }, (_, i) => i * Q / n);
    const va = PWM.movingAverage(res.alphaBeta.alpha, 1 / mf, xg), vb = PWM.movingAverage(res.alphaBeta.beta, 1 / mf, xg);
    const c1 = circle(V / 2), c2 = circle(V / Math.sqrt(3));
    const c3 = circle(res.probes.find((p) => p.id === 'van').ideal(res.settings));
    const states = ['100', '110', '010', '011', '001', '101'];
    const vx = hexX.slice(0, 6), vy = hexY.slice(0, 6);
    const traces = [
      { x: hexX, y: hexY, mode: 'lines', line: { color: C.muted, width: 1.5 }, name: 'switching-state hexagon', hoverinfo: 'name' },
      { x: vx, y: vy, mode: 'markers+text', text: states,
        textposition: vx.map((x) => (x > 1e-9 ? 'middle right' : x < -1e-9 ? 'middle left' : 'top center')),
        marker: { color: C.text2, size: 7 }, textfont: { color: C.text2, size: 11 },
        name: 'active vectors', hovertemplate: 'state %{text} (a b c; 1 = upper switch on)<extra></extra>' },
      { x: [0], y: [0], mode: 'markers+text', text: ['000 / 111'], textposition: 'bottom center',
        marker: { color: C.text2, size: 7 }, textfont: { color: C.text2, size: 11 },
        name: 'zero vectors', hovertemplate: 'zero vectors 000 and 111<extra></extra>' },
      { x: c1.x, y: c1.y, mode: 'lines', line: { color: C.muted, width: 1, dash: 'dash' }, name: 'SPWM linear limit, radius V<sub>dc</sub>/2', hoverinfo: 'name' },
      { x: c2.x, y: c2.y, mode: 'lines', line: { color: C.muted, width: 1, dash: 'dot' }, name: 'inscribed circle = SVPWM limit, radius V<sub>dc</sub>/√3', hoverinfo: 'name' },
      { x: c3.x, y: c3.y, mode: 'lines', line: { color: C.fund, width: 1.5 }, name: 'commanded fundamental', hoverinfo: 'name' },
      { x: va, y: vb, mode: 'lines', line: { color: C.avg, width: 2 }, name: 'carrier-period average of the space vector', hoverinfo: 'name' },
    ];
    const lim = 0.8 * V;
    Plotly.react('svPlot', traces, {
      paper_bgcolor: C.surface, plot_bgcolor: C.surface, font: { color: C.text, family: 'system-ui, sans-serif' },
      margin: { l: 48, r: 12, t: 12, b: 42 }, showlegend: false, hovermode: 'closest', uirevision: 'sv',
      hoverlabel: { namelength: -1 },   // show trace names in full (Plotly truncates at 15 characters)
      xaxis: axis({ range: [-lim, lim], zeroline: true, title: { text: '<i>v</i><sub>α</sub> [V]', font: { color: C.text2 } } }),
      yaxis: axis({ range: [-lim, lim], zeroline: true, scaleanchor: 'x', scaleratio: 1 }),
    }, plotConfig('space_vector'));
  }

  function renderMetrics(res, out) {
    const m = out.metrics, dc = state.reference === 'dc', { Q, mf } = res.win;
    const levels = new Set(out.wave.L.map((v) => v.toFixed(6))).size;
    const peak = res.refPeak;
    const six = state.strategy === 'sixstep', tp = state.topology === 'TP';
    const pole = six ? '(4/π)·V<sub>dc</sub>/2' : 'M·V<sub>dc</sub>/2';
    const idealFormula = state.topology === 'FB' ? 'M·V<sub>dc</sub>'
      : tp && state.probe === 'vab' ? `√3 · ${pole}` : pole;
    const idealTip = (what) => G.tip(`<small>ideal ${fmt(res.ideal, 4)}</small>`,
      `${what} = ${idealFormula}: the ideal value in the linear range${six ? ' (six-step: square-wave poles)' : ''}. Sampling effects and overmodulation make the measured value differ.`);
    const noFund = state.probe === 'vcm';
    const Tw = Q / state.f1, ms = Tw >= 1e-3;
    const items = [
      [`Carrier ${G.sym('fc')}`, G.tip(fmtHz(mf * state.f1), 'f<sub>c</sub> = m<sub>f</sub>·f<sub>1</sub>')],
      [G.tip('Window', 'Analysis window: the PWM pattern repeats after Q fundamental periods (Q = 1 when m<sub>f</sub> is an integer). Spectral lines are spaced f<sub>1</sub>/Q.'),
        `${Q} × ${G.sym('T1')} = ${fmt(Tw * (ms ? 1e3 : 1e6))} ${ms ? 'ms' : 'µs'}`],
    ];
    if (noFund) {
      const pk = Math.max(...out.wave.L.map(Math.abs));
      items.push([G.tip('Peak |v|', 'Largest magnitude the selected voltage reaches.'), `${fmt(pk, 4)} V`]);
    } else if (dc) {
      items.push([`Output DC ${G.sym('V0')}`, `${fmt(m.V0, 4)} V ${idealTip('V<sub>0</sub>')}`]);
      items.push([`Duty leg a ${G.sym('d')}`, fmt((1 + state.M) / 2, 3)]);
    } else {
      items.push([`Fundamental ${G.sym('V1')}`, `${fmt(m.V1, 4)} V ${idealTip('V<sub>1</sub>')}`]);
      items.push([G.tip('Fundamental RMS <i>V</i><sub>1</sub>/√2', 'RMS of the fundamental component alone: the value textbook formulas give (e.g. √(3/2)·M·V<sub>dc</sub>/2 line-to-line for three-phase SPWM) and the useful voltage a motor sees. The total RMS below also contains the switching harmonics: RMS<sup>2</sup> = V<sub>0</sub><sup>2</sup> + (V<sub>1</sub>/√2)<sup>2</sup> + harmonics<sup>2</sup>.'),
        `${fmt(m.V1 / Math.SQRT2, 4)} V`]);
      items.push([G.sym('THD'), pct(m.THD)]);
      items.push([G.sym('WTHD'), pct(m.WTHD)]);
      items.push([`DC component ${G.sym('V0')}`, `${fmt(Math.abs(m.V0) < 1e-9 * state.Vdc ? 0 : m.V0, 3)} V`]);
    }
    items.push([G.tip('RMS (total)', 'True RMS of the whole PWM waveform, fundamental plus all switching harmonics (exact, from the waveform): what a true-RMS meter reads. For a two-level output it is always V<sub>dc</sub>/2, whatever M; the split between fundamental and harmonics is what changes.'), `${fmt(m.Vrms, 4)} V`]);
    items.push([G.tip('Reference peak', 'Largest |reference| over the window, in carrier units. Above 1 the reference leaves the carrier range and pulses are dropped (overmodulation).'),
      isFinite(peak) ? `${fmt(peak, 3)}${peak > 1 + 1e-9 ? ' <small>overmodulated</small>' : ''}` : '<small>saturated legs</small>']);
    if (tp && !six) {
      // Linear limit: M at which the largest pole reference reaches the carrier peak.
      let lim = 1;
      if (state.strategy === 'thipwm') {
        let pk = 0; for (let i = 0; i <= 3600; i++) { const t = i * Math.PI / 3600; pk = Math.max(pk, Math.abs(Math.sin(t) + state.k3 * Math.sin(3 * t))); }
        lim = 1 / pk;
      } else if (state.strategy !== 'spwm') lim = 2 / Math.sqrt(3);
      items.push([G.tip(`Linear limit of ${G.S.M[0]}`, 'Largest M before the references leave the carrier range: 1 for SPWM; 2/√3 ≈ 1.155 when the zero-sequence z flattens the references (SVPWM, DPWM, THIPWM with k<sub>3</sub> = 1/6).'), fmt(lim, 4)]);
    }
    items.push([G.tip(`Switchings / leg / ${G.S.T1[0]}`, 'Transitions of each leg per fundamental period; each one turns one switch off and the other on. A leg that follows the carrier makes 2 per carrier period, i.e. 2m<sub>f</sub>.'),
      res.legs.map((l, i) => `${l.name}: ${fmt(res.switchings[i], 4)}`).join(' · ')]);
    items.push([G.tip('Output levels', 'Number of distinct voltage levels the selected output takes: 2 for a pole voltage or a bipolar full bridge, 3 for unipolar and for line-to-line, 5 for a three-phase phase voltage.'), String(levels)]);
    const dt = res.deadtime;
    if (dt) {
      const nLegs = state.probe === 'vcm' ? NaN : state.topology === 'FB' && state.probe === 'vab' ? 2
        : state.topology === 'TP' && state.probe === 'vab' ? Math.sqrt(3) : 1;
      const pred = nLegs * 4 / Math.PI * state.Vdc * state.tdus * 1e-6 * res.win.mf * state.f1;
      items.push([null, 'Dead time']);
      items.push([`Fundamental loss ${G.sym('dV1')}`, `${fmt(dt.dV1, 3)} V <small>estimate ${fmt(pred, 3)}</small>`]);
      const a = res.load.phases[0].i; let z = 0;
      for (let j = 0; j + 1 < a.x.length; j++) if (a.y[j] === 0 && a.y[j + 1] === 0) z += a.x[j + 1] - a.x[j];
      items.push([`Current ${G.sym('clamp')}`, `${fmt(100 * z / res.win.Q, 3)} % of ${G.sym('T1')}`]);
      if (!dt.converged) items.push([G.tip('Steady state', 'The periodic steady-state iteration did not reach its tolerance; values may be approximate.'), `<small>not converged (${fmt(dt.residual, 2)} A)</small>`]);
      if (dt.Reff > state.R) items.push([G.tip('Note', 'R = 0 has no unique periodic steady state with dead time; a tiny R (0.1 % of ωL) is used.'), `<small>R raised to ${fmt(dt.Reff, 2)} Ω</small>`]);
    }
    if (res.load) {
      const c = res.load.metrics, n = res.load.nPhases;
      // With a DC reference there is no fundamental: show the DC current, drop lag, THD and P1.
      const iFund = c.I1 > 1e-6 * c.Irms, iDC = Math.abs(c.I0) > 1e-6 * c.Irms;
      items.push([null, `Load current${n > 1 ? ' (phase a)' : ''}`]);
      if (iDC) items.push([G.tip('DC current <i>I</i><sub>0</sub>', 'Average of the load current. With a DC reference (buck leg) it carries the power: V<sub>0</sub>·I<sub>0</sub>.'), `${fmt(c.I0, 4)} A`]);
      if (iFund) {
        items.push([`Fundamental ${G.sym('I1')}`, `${fmt(c.I1, 4)} A`]);
        items.push([`Lag ${G.sym('phi')}`, `${fmt(c.lag * 180 / Math.PI, 3)}°`]);
      }
      items.push([G.tip('RMS', 'RMS of the load current (DC + all harmonics up to h<sub>max</sub>).'), `${fmt(c.Irms, 4)} A`]);
      if (iFund) items.push([G.tip('THD of <i>i</i>', 'Current distortion: RMS of all harmonics except the fundamental and DC, over the RMS of the fundamental. The load inductance makes it much smaller than the voltage THD.'), pct(c.THD)]);
      items.push([`Ripple ${G.sym('ripple')}`, `${fmt(c.ripple, 3)} A`]);
      items.push([`Power ${G.sym('P')}${n > 1 ? ' (3 phases)' : ''}`, `${fmt(res.load.P / 1000, 4)} kW`]);
      if (iFund) items.push([`of which fundamental ${G.sym('P1')}`, `${fmt(res.load.P1 / 1000, 4)} kW`]);
    }
    $('metrics').innerHTML = items.map(([k, v]) => (k === null
      ? `<div class="metric section">${v}</div>`
      : `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`)).join('');
  }

  // ---------------------------------------------------------------- boot
  try { const t = localStorage.getItem('modtoy-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
  bind();
  const h = readHash();
  activePreset = PRESETS.some((p) => p.id === h.preset) ? h.preset : null;
  showSV = h.sv;
  state = Model.normalise(Object.assign({}, BASE, h.s));
  set({}, true);
  window.addEventListener('hashchange', () => {
    const r = readHash(); activePreset = r.preset; state = Model.normalise(Object.assign({}, state, r.s)); syncControls(); schedule();
  });
})();
