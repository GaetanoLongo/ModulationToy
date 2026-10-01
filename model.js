/* ModulationToy — references, strategies, topologies and the compute() entry point.
 * No DOM. A topology is a set of legs plus output probes (linear combinations of
 * leg voltages); a strategy maps the settings to one reference + carrier per leg.
 */
(function (root) {
  'use strict';
  const PWM = (typeof require !== 'undefined') ? require('./pwm.js') : root.PWM;
  const Circuit = (typeof require !== 'undefined') ? require('./circuit.js') : root.Circuit;
  const DeadTime = (typeof require !== 'undefined') ? require('./deadtime.js') : root.DeadTime;
  const TAU = 2 * Math.PI;

  const DEFAULTS = {
    topology: 'HB',        // 'HB' | 'FB' | 'TP' (three-phase)
    strategy: 'bipolar',   // FB: 'bipolar' | 'unipolar' | 'hybrid';  TP: see ZERO_SEQUENCE
    carrier: 'triangle',   // 'triangle' | 'saw-up' | 'saw-down'
    sampling: 'natural',   // 'natural' | 'regular1' | 'regular2'
    reference: 'sine',     // HB/FB: 'sine' | 'sine3' | 'dc'  (TP: always sine)
    M: 0.8,                // fundamental amplitude of the reference (DC level for 'dc'), carrier units
    k3: 1 / 6,             // 3rd-harmonic injection, relative to M
    mf: 21,                // carrier periods per fundamental period (quantised to 0.1)
    f1: 50,                // fundamental frequency [Hz], scales the time axis only
    Vdc: 400,              // DC-bus voltage [V]
    probe: '',             // output shown in plots 3–4; '' = the topology's default
    load: false,           // series R–L + back-EMF per phase
    R: 5,                  // [Ω]
    Lmh: 10,               // [mH]
    E: 0,                  // back-EMF amplitude [V peak]
    delta: 0,              // back-EMF phase relative to the reference fundamental [deg]
    tdus: 0,               // dead time [µs]; needs the load
  };

  // Normalised modulation function m(x): what the output should follow, as a
  // fraction of the leg's half-swing. The 3rd harmonic is kept separate because
  // it is injected as a common-mode term.
  function modulation(st) {
    if (st.reference === 'dc') return { m: () => st.M, cm: () => 0 };
    const m = (x) => st.M * Math.sin(TAU * x);
    const cm = st.reference === 'sine3' ? (x) => st.M * st.k3 * Math.sin(3 * TAU * x) : () => 0;
    return { m, cm };
  }

  // ---------------------------------------------------------------------------
  // Three-phase: every carrier-based method is r_x = M sin(θ − φ_x) + z(θ), with the
  // same zero-sequence z added to all three legs. z(r, x) gets the three sine references.
  const PHASE = [0, -TAU / 3, TAU / 3];              // a, b, c
  function dpwm(st, psi) {
    // Clamp the phase whose reference, delayed by psi, is largest in magnitude, to the
    // rail of its sign. psi = 0: DPWM1 (60° windows centred on the peaks);
    // psi = −30°: DPWM0 (windows 30° earlier); psi = +30°: DPWM2 (windows 30° later).
    return (r, x) => {
      let k = 0, best = -1;
      for (let j = 0; j < 3; j++) {
        const s = Math.sin(TAU * x + PHASE[j] - psi);
        if (Math.abs(s) > best) { best = Math.abs(s); k = j; }
      }
      return Math.sin(TAU * x + PHASE[k] - psi) >= 0 ? 1 - r[k] : -1 - r[k];
    };
  }
  const ZERO_SEQUENCE = {
    spwm: () => () => 0,
    thipwm: (st) => (r, x) => st.M * st.k3 * Math.sin(3 * TAU * x),
    svpwm: () => (r) => -(Math.max(r[0], r[1], r[2]) + Math.min(r[0], r[1], r[2])) / 2,
    dpwm0: (st) => dpwm(st, -Math.PI / 6),
    dpwm1: (st) => dpwm(st, 0),
    dpwm2: (st) => dpwm(st, Math.PI / 6),
    dpwmmax: () => (r) => 1 - Math.max(r[0], r[1], r[2]),
    dpwmmin: () => (r) => -1 - Math.min(r[0], r[1], r[2]),
  };
  const TP_STRATEGIES = ['spwm', 'thipwm', 'svpwm', 'dpwm1', 'dpwm0', 'dpwm2', 'dpwmmax', 'dpwmmin', 'sixstep'];

  function threePhase(st, car) {
    const sines = (x) => PHASE.map((p) => st.M * Math.sin(TAU * x + p));
    let legs, zero = null;
    if (st.strategy === 'sixstep') {
      // Square-wave pole voltages: each leg on for the positive half of its sine.
      legs = PHASE.map((p, k) => ({ name: 'abc'[k], kind: 'compare', carrier: car,
        ref: (x) => (Math.sin(TAU * x + p) >= 0 ? 1.1 : -1.1) }));
    } else {
      const zf = ZERO_SEQUENCE[st.strategy](st);
      zero = (x) => zf(sines(x), x);
      legs = PHASE.map((p, k) => ({ name: 'abc'[k], kind: 'compare', carrier: car,
        ref: (x) => { const r = sines(x); return r[k] + zf(r, x); } }));
    }
    legs.zero = zero;
    return legs;
  }

  // Leg specs: { name, kind: 'compare', ref, carrier } or { name, kind: 'complement', of }.
  const STRATEGIES = {
    // Half bridge: one leg, reference = m + common-mode.
    single(st, mod, car) {
      return [{ name: 'a', kind: 'compare', ref: (x) => mod.m(x) + mod.cm(x), carrier: car }];
    },
    // Bipolar (two-level): leg b is the complement of leg a → v_ab = V_dc(2s_a − 1).
    bipolar(st, mod, car) {
      return [
        { name: 'a', kind: 'compare', ref: (x) => mod.m(x) + mod.cm(x), carrier: car },
        { name: 'b', kind: 'complement', of: 0 },
      ];
    },
    // Unipolar (three-level): ±m against the same carrier; common-mode added to both legs.
    unipolar(st, mod, car) {
      return [
        { name: 'a', kind: 'compare', ref: (x) => mod.m(x) + mod.cm(x), carrier: car },
        { name: 'b', kind: 'compare', ref: (x) => -mod.m(x) + mod.cm(x), carrier: car },
      ];
    },
    // Hybrid: leg b switches at the fundamental (sign of m); leg a carries the PWM
    // so that d_a − d_b = m. References beyond ±1 saturate the comparator.
    hybrid(st, mod, car) {
      const mm = (x) => mod.m(x) + mod.cm(x);
      return [
        { name: 'a', kind: 'compare', ref: (x) => { const v = mm(x); return v >= 0 ? 2 * v - 1 : 2 * v + 1; }, carrier: car },
        { name: 'b', kind: 'compare', ref: (x) => (mm(x) >= 0 ? -1.1 : 1.1), carrier: car },
      ];
    },
  };

  // Probes: v = offset + Σ coef_k · s_k, in volts. ideal: fundamental (or DC) in the linear range.
  const SQ3 = Math.sqrt(3);
  const TOPOLOGIES = {
    HB: {
      label: 'Half bridge',
      strategies: ['single'],
      probes: (Vdc) => [
        { id: 'vaO', label: '<i>v</i><sub>aO</sub>', coef: [Vdc], offset: -Vdc / 2, ideal: (st) => st.M * Vdc / 2 },
      ],
    },
    FB: {
      label: 'Full bridge',
      strategies: ['bipolar', 'unipolar', 'hybrid'],
      probes: (Vdc) => [
        { id: 'vab', label: '<i>v</i><sub>ab</sub>', coef: [Vdc, -Vdc], offset: 0, ideal: (st) => st.M * Vdc },
        { id: 'vcm', label: '<i>v</i><sub>cm</sub>', coef: [Vdc / 2, Vdc / 2], offset: -Vdc / 2, ideal: () => NaN },
      ],
    },
    TP: {
      label: 'Three-phase bridge',
      strategies: TP_STRATEGIES,
      loadProbes: ['van', 'vbn', 'vcn'],
      probes: (Vdc) => [
        { id: 'vab', label: '<i>v</i><sub>ab</sub>', coef: [Vdc, -Vdc, 0], offset: 0, ideal: (st) => SQ3 * poleV1(st) },
        { id: 'van', label: '<i>v</i><sub>an</sub>', coef: [2 * Vdc / 3, -Vdc / 3, -Vdc / 3], offset: 0, ideal: poleV1 },
        { id: 'vaO', label: '<i>v</i><sub>aO</sub>', coef: [Vdc, 0, 0], offset: -Vdc / 2, ideal: poleV1 },
        { id: 'vcm', label: '<i>v</i><sub>nO</sub>', coef: [Vdc / 3, Vdc / 3, Vdc / 3], offset: -Vdc / 2, ideal: () => NaN },
      ],
      // phase voltages of b and c: used only for the load currents
      hidden: (Vdc) => [
        { id: 'vbn', coef: [-Vdc / 3, 2 * Vdc / 3, -Vdc / 3], offset: 0 },
        { id: 'vcn', coef: [-Vdc / 3, -Vdc / 3, 2 * Vdc / 3], offset: 0 },
      ],
    },
  };
  TOPOLOGIES.HB.loadProbes = ['vaO'];
  TOPOLOGIES.FB.loadProbes = ['vab'];
  // Fundamental of the pole voltage: M·V_dc/2 in the linear range; (4/π)·V_dc/2 for six-step.
  function poleV1(st) { return (st.strategy === 'sixstep' ? 4 / Math.PI : st.M) * st.Vdc / 2; }

  function normalise(input) {
    const st = Object.assign({}, DEFAULTS, input);
    const topo = TOPOLOGIES[st.topology];
    if (!topo) throw new Error('unknown topology ' + st.topology);
    if (!topo.strategies.includes(st.strategy)) st.strategy = topo.strategies[0];
    if (st.topology === 'TP') st.reference = 'sine';
    const ids = topo.probes(1).map((p) => p.id);
    if (!ids.includes(st.probe)) st.probe = ids[0];
    return st;
  }

  // Harmonic range: past the 4th carrier group, at least order 40.
  function hmaxFor(mf) { return Math.max(40, Math.ceil(4.5 * mf)); }

  function compute(input) {
    const st = normalise(input);
    const win = PWM.windowFor(st.mf);
    const { mf, Q } = win;
    const topo = TOPOLOGIES[st.topology];
    const car = PWM.carrierOf({ shape: st.carrier });
    const specs = st.topology === 'TP' ? threePhase(st, car) : STRATEGIES[st.strategy](st, modulation(st), car);

    const legs = [];
    specs.forEach((sp) => {
      const edges = sp.kind === 'compare'
        ? PWM.compare(sp.ref, sp.carrier, st.sampling, mf, Q)
        : PWM.complement(legs[sp.of].edges);
      legs.push(Object.assign({}, sp, { edges }));
    });
    const edges = legs.map((l) => l.edges);
    const hidden = topo.hidden ? topo.hidden(st.Vdc) : [];
    const ld = { R: Math.max(0, st.R), L: Math.max(1e-9, st.Lmh / 1000), E: Math.max(0, st.E) };
    const phiOf = (k) => st.delta * Math.PI / 180 + (st.topology === 'TP' ? PHASE[k] : 0);

    // Ideal waveforms (commands = leg states, no dead time).
    const idealWaves = {};
    topo.probes(st.Vdc).concat(hidden).forEach((p) => { idealWaves[p.id] = PWM.probe(edges, p.coef, p.offset, Q); });

    // Dead time needs the load (the current decides the diodes).
    let dt = null, legV = null;
    const useDT = st.load && st.tdus > 0;
    if (useDT) {
      const w1L = 2 * Math.PI * st.f1 * ld.L;
      const ldt = Object.assign({}, ld, { R: Math.max(ld.R, 1e-3 * w1L) });   // R = 0 has no unique steady state
      const guess = topo.loadProbes.map((id, k) => Circuit.current(idealWaves[id], ldt, st.f1, phiOf(k)).y[0]);
      dt = DeadTime.solve({ topo: st.topology, edges, td: st.tdus * 1e-6 * st.f1, Vdc: st.Vdc, ld: ldt, f1: st.f1,
        phis: topo.loadProbes.map((id, k) => phiOf(k)), guess });
      dt.Reff = ldt.R;
      legV = dt.legV;
    }
    const waveOf = (p) => (legV ? PWM.combine(legV, p.coef.map((c) => c / st.Vdc), p.offset, Q) : idealWaves[p.id]);

    // Waveforms for every probe; spectrum and metrics for the selected one only.
    const probes = topo.probes(st.Vdc).map((p) => Object.assign({}, p, { wave: waveOf(p) }));
    const out = probes.find((p) => p.id === st.probe);
    out.spec = PWM.fourier(out.wave, hmaxFor(mf) * Q);
    out.metrics = PWM.metrics(out.wave, out.spec);
    if (dt) {
      // dead-time error of the fundamental: phasor difference to the ideal waveform
      const si = PWM.fourier(idealWaves[out.id], Q);
      dt.dV1 = 2 * Math.hypot(out.spec.re[Q] - si.re[Q], out.spec.im[Q] - si.im[Q]);
      dt.V1ideal = si.A[Q];
    }

    // Space-vector components (amplitude-invariant Clarke transform of the pole voltages).
    let alphaBeta = null;
    if (st.topology === 'TP') {
      const ca = [2 * st.Vdc / 3, -st.Vdc / 3, -st.Vdc / 3], cb = [0, st.Vdc / SQ3, -st.Vdc / SQ3];
      alphaBeta = legV
        ? { alpha: PWM.combine(legV, ca.map((c) => c / st.Vdc), 0, Q), beta: PWM.combine(legV, cb.map((c) => c / st.Vdc), 0, Q) }
        : { alpha: PWM.probe(edges, ca, 0, Q), beta: PWM.probe(edges, cb, 0, Q) };
    }

    let refPeak = 0;
    specs.forEach((sp) => {
      if (sp.kind !== 'compare') return;
      for (let i = 0; i < 2000; i++) refPeak = Math.max(refPeak, Math.abs(sp.ref(i / 2000)));
    });
    const saturated = st.strategy === 'hybrid' || st.strategy === 'sixstep';

    // Load currents: i_x from the voltage across phase x (exact, periodic steady state).
    let load = null;
    if (st.load) {
      const all = probes.concat(hidden.map((p) => Object.assign({}, p, { wave: waveOf(p) })));
      const phases = topo.loadProbes.map((id, k) => ({ name: 'abc'[k], phi: phiOf(k), wave: all.find((p) => p.id === id).wave }));
      const ldc = dt ? Object.assign({}, ld, { R: dt.Reff }) : ld;
      phases.forEach((p, k) => { p.i = dt ? dt.currents[k] : Circuit.current(p.wave, ld, st.f1, p.phi); });
      const a = phases[0];
      const vspec = PWM.fourier(a.wave, hmaxFor(mf) * Q);
      const ispec = Circuit.currentSpectrum(vspec, ldc, st.f1, a.phi);
      // Total active power into the load, every branch: P = mean(v·i) in the time domain (no harmonic
      // cutoff; v exact, i sampled at every breakpoint and densely in between). P1: the fundamental's
      // share, exact from the spectra.
      let P = 0, P1 = 0;
      phases.forEach((p, k) => {
        const w = p.wave, c = p.i;
        let s = 0, seg = 0;
        for (let j = 0; j + 1 < c.x.length; j++) {
          const x0 = c.x[j], x1 = c.x[j + 1];
          while (seg + 1 < w.L.length && w.b[seg + 1] <= x0 + 1e-15) seg++;
          s += PWM.valueAt(w, seg, 0.5 * (x0 + x1)) * 0.5 * (c.y[j] + c.y[j + 1]) * (x1 - x0);
        }
        P += s / w.Q;
        const vs = k === 0 ? vspec : PWM.fourier(p.wave, Q);
        const is = k === 0 ? ispec : Circuit.currentSpectrum(vs, ldc, st.f1, p.phi);
        P1 += Circuit.activePower(vs, is).P1;
      });
      load = { params: ldc, phases, vspec, ispec, metrics: Circuit.currentMetrics(ispec, a.i, vspec), P, P1,
        vLabel: probes.find((p) => p.id === topo.loadProbes[0]).label, nPhases: phases.length };
    }

    return {
      settings: st, win, topo, legs, probes, out, alphaBeta, load, deadtime: dt,
      zero: specs.zero || null,
      ideal: out.ideal(st),
      refPeak: saturated ? NaN : refPeak,
      switchings: legs.map((l) => PWM.switchingsPerPeriod(l.edges)),
    };
  }

  const api = { DEFAULTS, STRATEGIES, TOPOLOGIES, ZERO_SEQUENCE, TP_STRATEGIES, normalise, compute, hmaxFor, modulation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Model = api;
})(typeof self !== 'undefined' ? self : this);
