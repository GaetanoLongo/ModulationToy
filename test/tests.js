/* ModulationToy — checks against closed-form results. Runs in the browser
 * (test/index.html) or in Node (`node test/tests.js`); no dependencies. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const PWM = isNode ? require('../pwm.js') : root.PWM;
  const Model = isNode ? require('../model.js') : root.Model;
  const Circuit = isNode ? require('../circuit.js') : root.Circuit;
  const BRUTE = isNode ? require('./bruteforce_ref.js') : root.BRUTE_REF;
  const BRUTE_DT = isNode ? require('./bruteforce_dt_ref.js') : root.BRUTE_DT_REF;
  const Presets = isNode ? require('../presets.js') : root.Presets;

  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function close(a, b, tol, what) {
    if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: got ${a}, expected ${b} (tol ${tol})`);
  }
  function ok(cond, what) { if (!cond) throw new Error(what); }

  // J_n(x) = (1/2π) ∫_0^{2π} cos(nτ − x sin τ) dτ — trapezoid on a periodic integrand
  // converges geometrically.
  function besselJ(n, x) {
    const N = 256; let s = 0;
    for (let i = 0; i < N; i++) { const t = 2 * Math.PI * i / N; s += Math.cos(n * t - x * Math.sin(t)); }
    return s / N;
  }
  const amp = (r, h) => r.out.spec.A[Math.round(h * r.win.Q)];

  test('analysis window for integer and non-integer mf', () => {
    const a = PWM.windowFor(21), b = PWM.windowFor(10.5), c = PWM.windowFor(7.3);
    ok(a.Q === 1 && a.N === 21, 'mf 21'); ok(b.Q === 2 && b.N === 21, 'mf 10.5');
    ok(c.Q === 10 && c.N === 73, 'mf 7.3');
  });

  test('Bessel helper matches scipy.special.jv', () => {
    [[0, 1.2566370614359172, 0.6425118365775732], [1, 1.2566370614359172, 0.5121907087243274],
     [2, 2.5132741228718345, 0.4479015567422611], [4, 3.7699111843077517, 0.24609412801530947],
     [7, 2.5132741228718345, 0.0008041674591362601]]
      .forEach(([n, x, v]) => close(besselJ(n, x), v, 1e-13, `J_${n}(${x})`));
  });

  test('half bridge, natural sine–triangle: spectrum equals the Bessel closed form', () => {
    // v_aO = (V_dc/2) M cos ω1t + (2V_dc/π) Σ_m Σ_n (1/m) J_n(mπM/2) sin((m+n)π/2) cos(mω_c t + nω1 t)
    const M = 0.8, Vdc = 2, mf = 101;
    const r = Model.compute({ topology: 'HB', M, Vdc, mf });
    close(amp(r, 1), M * Vdc / 2, 1e-9, 'fundamental');
    for (let h = 2; h <= mf - 12; h++) close(amp(r, h), 0, 1e-9, `baseband h=${h}`);
    for (let m = 1; m <= 3; m++) for (let n = -6; n <= 6; n++) {
      const want = (2 * Vdc / Math.PI) / m * Math.abs(besselJ(n, m * Math.PI * M / 2) * Math.sin((m + n) * Math.PI / 2));
      close(amp(r, m * mf + n), want, 1e-9, `m=${m}, n=${n}`);
    }
  });

  // Closed forms below were derived for this tool's conventions (README.md,
  // "Verification"): q = m + n/mf, h = m·mf + n.
  test('half bridge, natural sawtooth (rising and falling): single-edge Bessel closed form', () => {
    // A = (V_dc/πm)|J_n(mπM)|,  n ≠ 0;   A = (V_dc/πm)|1 − (−1)^m J_0(mπM)|,  n = 0
    const M = 0.8, Vdc = 2, mf = 101;
    ['saw-up', 'saw-down'].forEach((carrier) => {
      const r = Model.compute({ topology: 'HB', carrier, M, Vdc, mf });
      close(amp(r, 1), M * Vdc / 2, 1e-9, `${carrier} fundamental`);
      for (let h = 2; h <= mf - 15; h++) close(amp(r, h), 0, 1e-9, `${carrier} baseband h=${h}`);
      for (let m = 1; m <= 3; m++) for (let n = -6; n <= 6; n++) {
        const z = m * Math.PI * M;
        const want = Vdc / (Math.PI * m) * (n ? Math.abs(besselJ(n, z)) : Math.abs(1 - (-1) ** m * besselJ(0, z)));
        close(amp(r, m * mf + n), want, 1e-9, `${carrier} m=${m}, n=${n}`);
      }
    });
  });

  test('half bridge, regular sampling (triangle): symmetric and asymmetric closed forms', () => {
    // symmetric  (1 sample/period):  A = (2V_dc/πq)|sin((q − n)π/2) J_n(qπM/2)|
    // asymmetric (2 samples/period): A = (2V_dc/πq)|sin((m + n)π/2) J_n(qπM/2)|
    // mf = 21 keeps neighbouring carrier groups off the tested orders (overlap < 1e-12).
    const M = 0.8, Vdc = 2, mf = 21;
    [['regular1', (q, m, n) => Math.sin((q - n) * Math.PI / 2)],
     ['regular2', (q, m, n) => Math.sin((m + n) * Math.PI / 2)]].forEach(([sampling, S]) => {
      const r = Model.compute({ topology: 'HB', sampling, M, Vdc, mf });
      const want = (m, n) => { const q = m + n / mf; return 2 * Vdc / (Math.PI * q) * Math.abs(S(q, m, n) * besselJ(n, q * Math.PI * M / 2)); };
      for (let n = 1; n <= 5; n++) close(amp(r, n), want(0, n), 1e-9, `${sampling} baseband n=${n}`);
      for (let m = 1; m <= 2; m++) for (let n = -4; n <= 4; n++) close(amp(r, m * mf + n), want(m, n), 1e-9, `${sampling} m=${m}, n=${n}`);
    });
  });

  test('brute-force cross-check: every topology × strategy × carrier × sampling (numpy FFT reference)', () => {
    // Tolerance per case: the brute force's rigorous error bound TV(v)/N (see bruteforce.py).
    let worst = 0, worstCase = null, n = 0, dmax = 0;
    BRUTE.forEach(({ case: c, bound, A }) => {
      const r = Model.compute(Object.assign({ Vdc: 1 }, c)), B = r.out.spec.A;
      ok(B.length === A.length, `bins ${JSON.stringify(c)}`);
      const tol = bound + 1e-8;
      let d = 0; for (let k = 0; k < A.length; k++) d = Math.max(d, Math.abs(Math.abs(B[k]) - A[k]));
      if (d > tol) throw new Error(`case ${JSON.stringify(c)}: max |ΔA| = ${d.toExponential(2)} > tol ${tol.toExponential(2)}`);
      dmax = Math.max(dmax, d);
      if (d / tol > worst) { worst = d / tol; worstCase = c; }
      n++;
    });
    return `${n} cases; largest |ΔA| = ${dmax.toExponential(1)} V_dc; worst case used ${(100 * worst).toFixed(0)} % of its tolerance (${worstCase.topology}/${worstCase.strategy}/${worstCase.carrier}/${worstCase.sampling}, ${worstCase.reference}, M=${worstCase.M}, mf=${worstCase.mf})`;
  });

  // ---- three-phase bridge and common-mode probes
  const TP = (o) => Model.compute(Object.assign({ topology: 'TP', Vdc: 1, mf: 21, M: 0.8 }, o));

  test('three-phase SPWM: exact fundamentals of line-to-line, phase and pole voltages', () => {
    const M = 0.8;
    close(amp(TP({ probe: 'vab' }), 1), Math.sqrt(3) / 2 * M, 1e-9, 'v_ab');
    close(amp(TP({ probe: 'van' }), 1), M / 2, 1e-9, 'v_an');
    close(amp(TP({ probe: 'vaO' }), 1), M / 2, 1e-9, 'v_aO');
    close(amp(TP({ strategy: 'sixstep', probe: 'vab' }), 1), Math.sqrt(3) * 2 / Math.PI, 1e-9, 'six-step v_ab = √3·(4/π)·V_dc/2');
  });

  test('three-phase, mf multiple of 3: triplens vanish line-to-line and phase; common mode is only triplens', () => {
    // v_bO(t) = v_aO(t − T1/3) when the carrier repeats every T1/3, so harmonic h of v_ab carries
    // (1 − e^{−j2πh/3}) = 0 for h = 3k; and v_nO = (v_aO + v_bO + v_cO)/3 keeps only h = 3k.
    Model.TP_STRATEGIES.forEach((strategy) => {
      const lim = Model.hmaxFor(21);
      const ab = TP({ strategy, probe: 'vab' }), an = TP({ strategy, probe: 'van' }), cm = TP({ strategy, probe: 'vcm' });
      for (let h = 3; h <= lim; h += 3) {
        close(amp(ab, h), 0, 1e-9, `${strategy} v_ab h=${h}`); close(amp(an, h), 0, 1e-9, `${strategy} v_an h=${h}`);
      }
      for (let h = 1; h <= lim; h++) if (h % 3) close(amp(cm, h), 0, 1e-9, `${strategy} v_nO h=${h}`);
    });
  });

  test('three-phase zero-sequence: THIPWM 3rd harmonic in the pole, linear ranges of SPWM/THIPWM/SVPWM', () => {
    close(amp(TP({ strategy: 'thipwm', probe: 'vaO' }), 3), 0.8 / 6 / 2, 1e-3, 'THIPWM pole A3 = M·k3·V_dc/2');
    ok(TP({ strategy: 'spwm', M: 1.15 }).refPeak > 1.1, 'SPWM overmodulates at M = 1.15');
    ['thipwm', 'svpwm', 'dpwm0', 'dpwm1', 'dpwm2', 'dpwmmax', 'dpwmmin'].forEach((strategy) =>
      ok(TP({ strategy, M: 1.15 }).refPeak <= 1 + 1e-12, `${strategy} stays linear at M = 1.15`));
    close(TP({ strategy: 'svpwm', M: 1.15 }).refPeak, 1.15 * Math.sqrt(3) / 2, 1e-6, 'SVPWM peak = (√3/2)M');
  });

  test('three-phase DPWM: about 2/3 of the switchings; DPWMMAX/MIN never use one zero vector', () => {
    ['dpwm0', 'dpwm1', 'dpwm2', 'dpwmmax', 'dpwmmin'].forEach((strategy) =>
      TP({ strategy }).switchings.forEach((n) => ok(Math.abs(n - 28) <= 3, `${strategy}: ${n} switchings (2/3 of 42 = 28)`)));
    const lv = (strategy) => TP({ strategy, probe: 'vcm' }).out.wave.L;
    ok(Math.min(...lv('dpwmmax')) > -0.5 + 1e-9, 'DPWMMAX never reaches −V_dc/2 (000)');
    ok(Math.max(...lv('dpwmmin')) < 0.5 - 1e-9, 'DPWMMIN never reaches +V_dc/2 (111)');
    lv('sixstep').forEach((v) => close(Math.abs(v), 1 / 6, 1e-12, 'six-step common mode ±V_dc/6'));
  });

  test('space vector: the fundamental of v_α equals the phase-voltage fundamental', () => {
    const r = TP({ strategy: 'svpwm' });
    close(PWM.fourier(r.alphaBeta.alpha, 1).A[1], 0.4, 1e-3, 'α'); close(PWM.fourier(r.alphaBeta.beta, 1).A[1], 0.4, 1e-3, 'β');
  });

  test('full-bridge common mode: 0 for bipolar, levels {−V_dc/2, 0, +V_dc/2} for unipolar', () => {
    const fb = (strategy) => Model.compute({ topology: 'FB', strategy, probe: 'vcm', Vdc: 1, M: 0.8, mf: 21 }).out.wave.L;
    fb('bipolar').forEach((v) => close(v, 0, 1e-12, 'bipolar v_cm'));
    const u = [...new Set(fb('unipolar').map((v) => v.toFixed(9)))].map(Number).sort((p, q) => p - q);
    ok(JSON.stringify(u) === JSON.stringify([-0.5, 0, 0.5]), 'unipolar levels ' + u);
  });

  // ---- load currents (R–L–e, exact periodic steady state)
  const LD = (o) => Model.compute(Object.assign({ Vdc: 400, M: 0.8, f1: 50, mf: 21, load: true, R: 5, Lmh: 10, E: 0, delta: 0 }, o));
  const synth = (sp, x) => {
    let v = sp.re[0];
    for (let k = 1; k <= sp.kmax; k++) v += 2 * (sp.re[k] * Math.cos(2 * Math.PI * k * x / sp.Q) - sp.im[k] * Math.sin(2 * Math.PI * k * x / sp.Q));
    return v;
  };

  test('load current: time-domain solution equals the harmonic synthesis Σ (V_h − E_h)/Z(h)', () => {
    // The per-segment solution is exact; the synthesis converges onto it as 1/K.
    const r = LD({ topology: 'FB', strategy: 'unipolar', R: 1, Lmh: 5, E: 250, delta: -20 }), a = r.load.phases[0];
    const gap = (K) => {
      const sp = Circuit.currentSpectrum(PWM.fourier(a.wave, K), r.load.params, 50, a.phi);
      let d = 0; for (let j = 0; j < a.i.x.length; j += 13) d = Math.max(d, Math.abs(a.i.y[j] - synth(sp, a.i.x[j])));
      return d;
    };
    const g1 = gap(1600), g2 = gap(6400);
    ok(g2 < 0.02, 'gap at K = 6400: ' + g2); close(g1 / g2, 4, 0.8, 'gap falls as 1/K');
  });

  test('load current: fundamental and phase from the impedance; ripple closed forms', () => {
    ['HB', 'FB', 'TP'].forEach((topology) => {
      const r = LD({ topology }), Z = Math.hypot(5, 2 * Math.PI * 50 * 0.01);
      close(r.load.metrics.I1, r.load.vspec.A[1] / Z, 1e-9, `${topology} I1 = V1/|Z|`);
      close(r.load.metrics.lag, Math.atan2(2 * Math.PI * 50 * 0.01, 5), 1e-9, `${topology} lag = atan(ωL/R)`);
    });
    // peak-to-peak ripple at large mf, R → 0: V_dc/(4Lf_c) half bridge, /(2Lf_c) bipolar, /(8Lf_c) unipolar
    const fc = 101 * 50, L = 0.01;
    [[{ topology: 'HB' }, 4], [{ topology: 'FB', strategy: 'bipolar' }, 2], [{ topology: 'FB', strategy: 'unipolar' }, 8]].forEach(([o, k]) =>
      close(LD(Object.assign({ mf: 101, R: 0.01 }, o)).load.metrics.ripple / (400 / (k * L * fc)), 1, 0.01, `ripple ${o.topology} ${o.strategy || ''}`));
  });

  test('load current: energy balance mean(v·i) = R·mean(i²) + mean(e·i)', () => {
    [{ topology: 'HB' }, { topology: 'FB', strategy: 'unipolar', R: 1, Lmh: 5, E: 250, delta: -20 }, { topology: 'TP', strategy: 'svpwm', E: 150, delta: 10 }].forEach((o) => {
      const r = LD(o), a = r.load.phases[0], w = a.wave, R = r.load.params.R, E = r.load.params.E;
      let pv = 0, pr = 0, pe = 0, seg = 0;
      for (let j = 0; j + 1 < a.i.x.length; j++) {
        const x0 = a.i.x[j], x1 = a.i.x[j + 1], dx = x1 - x0, im = (a.i.y[j] + a.i.y[j + 1]) / 2;
        while (seg + 1 < w.L.length && w.b[seg + 1] <= x0 + 1e-15) seg++;
        const e = E * Math.sin(2 * Math.PI * (x0 + x1) / 2 + a.phi);
        pv += w.L[seg] * im * dx; pr += R * (a.i.y[j] ** 2 + a.i.y[j] * a.i.y[j + 1] + a.i.y[j + 1] ** 2) / 3 * dx; pe += e * im * dx;
      }
      close((pr + pe) / pv, 1, 2e-3, `${o.topology} energy balance`);
    });
  });

  test('load power: total P = R·Σ mean(i²) + Σ mean(e·i) (DC buck included); P1 = fundamental share', () => {
    // energy balance per branch, from the sampled currents: the inductor stores no net energy
    const balance = (r) => r.load.phases.reduce((acc, p) => {
      const c = p.i, E = r.load.params.E, R = r.load.params.R; let pr = 0, pe = 0;
      for (let j = 0; j + 1 < c.x.length; j++) {
        const dx = c.x[j + 1] - c.x[j], xm = (c.x[j] + c.x[j + 1]) / 2;
        pr += R * (c.y[j] ** 2 + c.y[j] * c.y[j + 1] + c.y[j + 1] ** 2) / 3 * dx;
        pe += E * Math.sin(2 * Math.PI * xm + p.phi) * (c.y[j] + c.y[j + 1]) / 2 * dx;
      }
      return acc + (pr + pe) / r.win.Q;
    }, 0);
    [{ topology: 'HB', reference: 'dc', M: 0.5, mf: 10 }, { topology: 'HB', reference: 'dc', M: 0.5, mf: 10, tdus: 3 },
     { topology: 'HB' }, { topology: 'FB', strategy: 'unipolar', R: 0.1, Lmh: 5, E: 300, delta: -15 },
     { topology: 'TP', strategy: 'spwm', mf: 22 }, { topology: 'TP', strategy: 'svpwm', mf: 100, tdus: 5, E: 100, delta: 20 }].forEach((o) => {
      const r = LD(o), name = JSON.stringify(o);
      close(r.load.P / balance(r), 1, 2e-4, `${name}: P vs energy balance`);
      // the spectral sum (to h_max) agrees, short only by the ripple-loss tail above h_max
      const sp = r.load.phases.reduce((s, p, k) => { const vs = PWM.fourier(p.wave, Model.hmaxFor(r.win.mf) * r.win.Q); return s + Circuit.activePower(vs, Circuit.currentSpectrum(vs, r.load.params, 50, p.phi)).P; }, 0);
      close(sp / r.load.P, 1, 1e-3, `${name}: spectral P`);
    });
    const buck = LD({ topology: 'HB', reference: 'dc', M: 0.5, mf: 10 });
    close(buck.load.P1, 0, 1e-9, 'buck: no fundamental power');
    // V0 = M·V_dc/2 = 100 V → V0²/R = 2 kW, plus the ripple loss in R
    close(buck.load.vspec.re[0] * buck.load.ispec.re[0], 100 * 100 / 5, 1e-9, 'buck: DC power V0·I0 = V0²/R');
    ok(buck.load.P > 2000 && buck.load.P < 2200, 'buck: P = 2 kW + ripple loss, got ' + buck.load.P);
  });

  test('load current: R = 0 is zero-mean and lags 90°; three-phase currents sum to zero; back-EMF sets power flow', () => {
    const r0 = LD({ topology: 'HB', R: 0 });
    close(r0.load.metrics.I0, 0, 1e-9, 'zero mean'); close(r0.load.metrics.lag, Math.PI / 2, 1e-9, 'lag 90°');
    close(r0.load.metrics.P1, 0, 1e-6, 'no active power');
    const t = LD({ topology: 'TP', strategy: 'dpwm1' });
    // each phase is sampled at its own breakpoints: compare on a common grid by linear interpolation
    const at = (p, x) => { const X = p.i.x, Y = p.i.y; let lo = 0, hi = X.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= x) lo = m; else hi = m; } return Y[lo] + (Y[hi] - Y[lo]) * (x - X[lo]) / (X[hi] - X[lo]); };
    let worst = 0; for (let j = 0; j < 500; j++) { const x = (j + 0.37) / 500; worst = Math.max(worst, Math.abs(t.load.phases.reduce((s, p) => s + at(p, x), 0))); }
    ok(worst < 0.05, 'i_a + i_b + i_c = ' + worst + ' A (linear interpolation only)');
    const g = (d) => LD({ topology: 'FB', strategy: 'unipolar', R: 0.1, Lmh: 5, E: 300, delta: d }).load.metrics.P1;
    ok(g(-15) > 7000 && g(15) < -7000, `power flow: δ = −15° → ${g(-15)}, δ = +15° → ${g(15)}`);
  });

  // ---- dead time (exact event-driven solver vs fixed-step brute force)
  test('dead time: event-driven solver matches the fixed-step brute force (every probe, current, clamping)', () => {
    let worst = 0, n = 0, worstName = '';
    BRUTE_DT.forEach(({ case: c, spectra, current }) => {
      const name = `${c.topology}/${c.strategy} R=${c.R} L=${c.Lmh} E=${c.E} td=${c.tdus}`;
      Object.entries(spectra).forEach(([probe, ref]) => {
        const r = Model.compute(Object.assign({}, c, { load: true, probe }));
        ok(r.deadtime && r.deadtime.converged, `${name}: steady state not converged`);
        const A = r.out.spec.A, tol = ref.bound + 1e-6 * c.Vdc;
        let d = 0; for (let k = 0; k < ref.A.length; k++) d = Math.max(d, Math.abs(Math.abs(A[k]) - ref.A[k]));
        if (d > tol) throw new Error(`${name} ${probe}: max |ΔA| = ${d.toExponential(2)} V > ${tol.toExponential(2)}`);
        if (d / tol > worst) { worst = d / tol; worstName = `${name} ${probe}`; }
        n++;
      });
      const r = Model.compute(Object.assign({}, c, { load: true }));
      close(r.load.metrics.I1 / current.I1, 1, 1e-4, `${name}: I1`);
      // time with the current clamped at zero (fraction of the window)
      const a = r.load.phases[0].i; let z = 0;
      for (let j = 0; j + 1 < a.x.length; j++) if (a.y[j] === 0 && a.y[j + 1] === 0) z += a.x[j + 1] - a.x[j];
      close(z / r.win.Q, current.clamp, 2e-5, `${name}: clamped fraction`);
    });
    return `${n} spectra in ${BRUTE_DT.length} cases; worst used ${(100 * worst).toFixed(0)} % of its tolerance (${worstName})`;
  });

  test('dead time: t_d → 0 reproduces the ideal solution; loss of fundamental ≈ (4/π)·V_dc·t_d·f_c per leg at high current', () => {
    const base = { Vdc: 400, M: 0.8, f1: 50, load: true, R: 1, Lmh: 10 };
    const r0 = Model.compute(Object.assign({ topology: 'TP', strategy: 'svpwm', tdus: 1e-6 }, base));
    close(r0.deadtime.dV1, 0, 1e-6, 'vanishing dead time');
    // high current, small ripple (mf = 101): the classic average-error estimate holds within a few %
    [['HB', {}, 1], ['FB', { strategy: 'bipolar' }, 2], ['TP', { strategy: 'spwm', probe: 'van' }, 1]].forEach(([topology, o, legs]) => {
      const r = Model.compute(Object.assign({ topology, mf: 101, tdus: 2 }, base, o));
      const pred = legs * 4 / Math.PI * 400 * 2e-6 * 101 * 50;
      close(r.deadtime.dV1 / pred, 1, 0.03, `${topology}: ΔV1 = ${r.deadtime.dV1.toFixed(3)} vs ${pred.toFixed(3)}`);
    });
  });

  test('dead time: soft commutation (current reverses every carrier period) costs nothing', () => {
    // half bridge at light load with large ripple: every turn-on finds the current already in its diode
    const r = Model.compute({ topology: 'HB', Vdc: 400, M: 0.8, f1: 50, mf: 21, load: true, R: 40, Lmh: 5, tdus: 5 });
    close(r.deadtime.dV1, 0, 1e-9, 'no fundamental error');
  });

  // ---- every number and claim quoted in the preset notes (presets.js), with the preset's own settings
  test('preset claims: every number and statement in the preset notes', () => {
    const P = (id, extra) => {
      const p = Presets.PRESETS.find((q) => q.id === id); ok(p, 'preset ' + id);
      return Model.compute(Object.assign({}, Presets.BASE, { f1: 50, Vdc: 400 }, p.set, extra || {}));
    };
    const A = (r, h) => Math.abs(r.out.spec.A[Math.round(h * r.win.Q)]);
    const ph = (r) => Math.atan2(r.out.spec.im[r.win.Q], r.out.spec.re[r.win.Q]) * 180 / Math.PI;
    const near = (v, want, tol, what) => close(v, want, tol, what);                 // quoted values, ± rounding
    const levels = (r) => [...new Set(r.out.wave.L.map((v) => +v.toFixed(6)))].sort((p, q) => p - q);
    const evenMax = (r) => { let m = 0; for (let h = 2; h <= Model.hmaxFor(r.win.mf); h += 2) m = Math.max(m, A(r, h)); return m; };
    const clampPct = (r) => { const a = r.load.phases[0].i; let z = 0; for (let j = 0; j + 1 < a.x.length; j++) if (a.y[j] === 0 && a.y[j + 1] === 0) z += a.x[j + 1] - a.x[j]; return 100 * z / r.win.Q; };
    const done = new Set(); const mark = (id) => done.add(id);

    let r = P('spwm'); mark('spwm');
    near(A(r, 1), 160, 1e-6, 'spwm V1');
    for (let h = 2; h < 17; h++) ok(A(r, h) < 1, `spwm: line at h=${h} above 1 V`); ok(A(r, 17) > 1, 'spwm: first line at 17');
    ok(evenMax(r) < 1e-9, 'spwm: no even order');

    const tri = r; r = P('saw'); mark('saw');
    [19, 20, 22, 23].forEach((h) => ok(A(r, h) > 10, `saw: sideband at ${h}`));
    near(r.out.metrics.THD * 100, 145.8, 0.05, 'saw THD'); near(r.out.metrics.THD, tri.out.metrics.THD, 1e-9, 'saw THD = triangle THD');

    r = P('regular'); mark('regular');
    { const n = P('regular', { sampling: 'natural' }), r2 = P('regular', { sampling: 'regular2' });
      near(ph(n) - ph(r), 20, 0.05, 'regular lag'); near(100 * (1 - A(r, 1) / 160), 1.8, 0.05, 'regular shortfall %');
      near(A(r, 2), 3.8, 0.05, 'regular A2'); near(ph(n) - ph(r2), 10, 0.05, 'regular2 lag'); ok(evenMax(r2) < 1e-9, 'regular2: no even order'); }

    r = P('overmod'); mark('overmod');
    ok(r.switchings[0] === 26, 'overmod switchings'); near(A(r, 1), 221, 0.5, 'overmod V1');
    near(A(r, 3), 14, 0.5, 'overmod A3'); near(A(r, 5), 7.2, 0.05, 'overmod A5'); near(A(r, 7), 1.4, 0.05, 'overmod A7');

    r = P('async'); mark('async');
    ok(r.win.Q === 2, 'async window'); near(A(r, 0.5), 1.5, 0.05, 'async sub-harmonic');
    near(20 * Math.log10(A(r, 0.5) / A(r, 1)), -40, 0.5, 'async dB');

    r = P('dc'); mark('dc');
    near(r.out.metrics.V0, 0.75 * 400 - 200, 1e-9, 'dc mean (d = 0.75)');
    for (let k = 1; k <= r.out.spec.kmax; k++) ok(k % 10 === 0 || r.out.spec.A[k] < 1e-6, `dc: line at ${k} not a multiple of mf`);

    r = P('hb-load'); mark('hb-load');
    { const m = r.load.metrics; near(400 / (4 * 0.01 * 1050), 9.5, 0.05, 'hb-load formula'); near(m.ripple, 9.6, 0.05, 'hb-load ripple');
      near(m.THD * 100, 10.3, 0.05, 'hb-load THD i'); near(r.out.metrics.THD / m.THD, 14, 0.5, 'hb-load THD ratio');
      const h = P('hb-load', { mf: 100 }); near(h.load.metrics.ripple / (400 / (4 * 0.01 * 5000)), 1, 0.004, 'hb-load mf=100 within 0.4 %');
      // ripple (current minus DC and fundamental, as the reading defines it) per carrier period follows
      // V_dc/(4Lf_c)·(1 − m²): largest where the reference crosses zero
      const i = r.load.phases[0].i, n = r.win.mf, sp = r.load.ispec;
      const fund = (x) => sp.re[0] + 2 * (sp.re[1] * Math.cos(2 * Math.PI * x) - sp.im[1] * Math.sin(2 * Math.PI * x));
      let best = -1, kb = 0;
      for (let k = 0; k < n; k++) {
        let lo = 1e9, hi = -1e9;
        for (let j = 0; j < i.x.length; j++) if (i.x[j] >= k / n && i.x[j] < (k + 1) / n) { const d = i.y[j] - fund(i.x[j]); lo = Math.min(lo, d); hi = Math.max(hi, d); }
        const m = 0.8 * Math.sin(2 * Math.PI * (k + 0.5) / n);
        close(hi - lo, 400 / (4 * 0.01 * 1050) * (1 - m * m), 0.15, `hb-load: ripple in carrier period ${k} vs (1 − m²) law`);
        if (hi - lo > best) { best = hi - lo; kb = k; }
      }
      ok(Math.abs(Math.sin(2 * Math.PI * (kb + 0.5) / n)) < 0.2, 'hb-load: largest ripple near the reference zero crossing'); }

    r = P('hb-dt'); mark('hb-dt');
    ok(r.win.mf * 50 === 5000, 'hb-dt fc'); near(100 * 5e-6 * 5000, 2.5, 1e-9, 'hb-dt 2.5 %');
    near(A(r, 1), 149, 0.5, 'hb-dt V1'); near(r.deadtime.dV1, 12.7, 0.05, 'hb-dt dV1'); near(4 / Math.PI * 400 * 5e-6 * 5000, 12.7, 0.05, 'hb-dt estimate');
    near(A(r, 3), 4.2, 0.05, 'hb-dt A3'); near(A(r, 5), 2.5, 0.05, 'hb-dt A5'); near(A(r, 7), 1.8, 0.05, 'hb-dt A7');

    r = P('bipolar'); mark('bipolar');
    { const hb = P('spwm'); for (let k = 0; k <= 95; k++) near(r.out.spec.A[k], 2 * hb.out.spec.A[k], 1e-9, 'bipolar = 2 × half bridge');
      ok(JSON.stringify(levels(r)) === '[-400,400]', 'bipolar levels'); }

    r = P('unipolar'); mark('unipolar');
    { ok(JSON.stringify(levels(r)) === '[-400,0,400]', 'unipolar levels');
      // the group around mf = 21 is gone; below 37 only the far tail of the 2mf group remains (< 1 V)
      for (let h = 11; h <= 31; h++) ok(A(r, h) < 1e-3, `unipolar: group around mf at ${h}`);
      for (let h = 2; h <= 36; h++) ok(A(r, h) < 1, `unipolar: line above 1 V at ${h}`);
      let mx = 0, hm = 0; for (let h = 37; h <= 50; h++) if (A(r, h) > mx) { mx = A(r, h); hm = h; }
      ok(hm === 41 || hm === 43, 'unipolar strongest at 2mf ± 1'); near(A(r, 41), 126, 0.5, 'unipolar A41'); near(A(r, 43), 126, 0.5, 'unipolar A43');
      near(r.out.metrics.WTHD * 100, 1.50, 0.005, 'unipolar WTHD'); near(P('unipolar', { strategy: 'bipolar' }).out.metrics.WTHD * 100, 5.47, 0.005, 'bipolar WTHD'); }

    r = P('hybrid'); mark('hybrid');
    ok(r.switchings[1] === 2, 'hybrid leg b'); near(A(r, 1), 320, 0.05, 'hybrid V1'); ok(levels(r).length === 3, 'hybrid levels'); near(A(r, 21), 184, 0.5, 'hybrid A21');

    r = P('fb-load'); mark('fb-load');
    { const b = P('fb-load', { strategy: 'bipolar' });
      near(r.load.metrics.I1, b.load.metrics.I1, 1e-6, 'fb-load same I1'); near(b.load.metrics.ripple / r.load.metrics.ripple, 4, 0.05, 'fb-load ratio 4');
      near(400 / (8 * 0.01 * 1050), 4.8, 0.05, 'fb-load unipolar formula'); near(400 / (2 * 0.01 * 1050), 19, 0.05, 'fb-load bipolar formula'); }

    r = P('fb-grid'); mark('fb-grid');
    near(A(r, 1), 320, 1e-6, 'fb-grid V1'); near(r.load.metrics.P1 / 1000, 8, 0.1, 'fb-grid P'); near(P('fb-grid', { delta: 15 }).load.metrics.P1 / 1000, -7.7, 0.05, 'fb-grid P reversed');

    r = P('cm-fb'); mark('cm-fb');
    ok(JSON.stringify(levels(r)) === '[-200,0,200]', 'cm-fb levels'); ok(JSON.stringify(levels(P('cm-fb', { strategy: 'bipolar' }))) === '[0]', 'cm-fb bipolar 0');

    r = P('tp-spwm'); mark('tp-spwm');
    { near(A(r, 1), 277, 0.5, 'tp-spwm V1'); ok(levels(r).length === 3, 'tp-spwm levels'); near(A(r, 21), 0, 1e-9, 'tp-spwm vab at fc');
      near(A(P('tp-spwm', { mf: 22 }), 22), 0, 1e-9, 'tp-spwm vab at fc, mf = 22');
      near(A(P('tp-spwm', { probe: 'vaO' }), 21), 164, 0.5, 'tp-spwm pole at fc'); near(A(P('tp-spwm', { probe: 'vcm' }), 21), 164, 0.5, 'tp-spwm common mode at fc');
      ok(A(r, 19) > 10 && A(r, 23) > 10, 'tp-spwm sidebands remain'); }

    r = P('tp-thi'); mark('tp-thi');
    near(P('tp-thi', { strategy: 'spwm' }).refPeak, 1.1, 0.005, 'tp-thi SPWM peak'); near(r.refPeak, 0.95, 0.005, 'tp-thi peak');
    near(A(P('tp-thi', { probe: 'vaO' }), 3), 36.7, 0.05, 'tp-thi pole A3'); near(A(r, 3), 0, 1e-9, 'tp-thi vab A3'); near(A(P('tp-thi', { probe: 'van' }), 3), 0, 1e-9, 'tp-thi van A3');

    r = P('tp-svpwm'); mark('tp-svpwm');
    { near(r.refPeak, 0.996, 0.0005, 'tp-svpwm peak'); near(400 / Math.sqrt(3), 231, 0.5, 'tp-svpwm inscribed radius');
      const xs = Array.from({ length: 600 }, (_, i) => i / 600), va = PWM.movingAverage(r.alphaBeta.alpha, 1 / 21, xs), vb = PWM.movingAverage(r.alphaBeta.beta, 1 / 21, xs);
      xs.forEach((x, i) => ok(Math.abs(Math.hypot(va[i], vb[i]) / 231 - 1) < 0.05, 'tp-svpwm: averaged vector within 5 % of the inscribed circle')); }

    r = P('tp-dpwm1'); mark('tp-dpwm1');
    { ok(r.switchings[0] === 30, 'tp-dpwm1 switchings'); ok(P('tp-dpwm1', { strategy: 'spwm' }).switchings[0] === 42, 'spwm switchings');
      near(r.out.metrics.WTHD * 100, 3.45, 0.005, 'tp-dpwm1 WTHD'); near(P('tp-dpwm1', { strategy: 'spwm' }).out.metrics.WTHD * 100, 2.39, 0.005, 'spwm WTHD');
      const t = [0, ...r.legs[0].edges.toggles, 1], runs = []; for (let i = 0; i + 1 < t.length; i++) runs.push((t[i + 1] - t[i]) * 360);
      runs.sort((p, q) => q - p); near(runs[0], 66, 0.5, 'tp-dpwm1 flat stretch'); near(runs[1], 66, 0.5, 'tp-dpwm1 second flat stretch'); ok(runs[2] < 20, 'only two long stretches'); }

    r = P('tp-dpwm-jump'); mark('tp-dpwm-jump');
    { const id = Math.sqrt(3) / 2 * 0.8 * 400;
      near(100 * (A(r, 1) / id - 1), 9.4, 0.05, 'dpwm2 natural V1 error'); near(A(r, 5), 28, 0.5, 'dpwm2 natural A5'); near(A(r, 7), 28, 1, 'dpwm2 natural A7');
      const g = P('tp-dpwm-jump', { sampling: 'regular2' }); ok(Math.abs(A(g, 1) / id - 1) < 0.001, 'dpwm2 regular2 V1 within 0.1 %');
      ok(A(g, 5) > 7 && A(g, 5) < 9 && A(g, 7) > 7 && A(g, 7) < 9, 'dpwm2 regular2: 5th, 7th in 7–9 V');
      const h = P('tp-dpwm-jump', { mf: 24 }); ok(A(h, 5) < 1 && A(h, 7) < 1, 'dpwm2 mf = 24: 5th, 7th below 1 V'); }

    r = P('tp-load'); mark('tp-load');
    near(r.load.metrics.THD * 100, 4.5, 0.05, 'tp-load SPWM'); near(P('tp-load', { strategy: 'svpwm' }).load.metrics.THD * 100, 4.1, 0.05, 'tp-load SVPWM');
    near(P('tp-load', { strategy: 'dpwm1' }).load.metrics.THD * 100, 6.5, 0.05, 'tp-load DPWM1'); ok(P('tp-load', { strategy: 'dpwm1' }).switchings[0] === 30, 'tp-load DPWM1 switchings');

    r = P('tp-dt'); mark('tp-dt');
    near(4 / Math.PI * 400 * 5e-6 * 5000, 12.7, 0.05, 'tp-dt estimate'); near(r.deadtime.dV1, 12.6, 0.05, 'tp-dt dV1');
    near(A(r, 5), 2.6, 0.05, 'tp-dt A5'); near(A(r, 7), 1.8, 0.05, 'tp-dt A7'); ok(A(r, 3) < 0.1, 'tp-dt: triplens cancel');

    r = P('tp-cm'); mark('tp-cm');
    { ok(JSON.stringify(levels(r)) === JSON.stringify([-200, -66.666667, 66.666667, 200]), 'tp-cm levels ' + levels(r));
      near(A(r, 21), 164, 0.5, 'tp-cm line at fc');
      const ab = P('tp-cm', { probe: 'vab' });
      for (let h = 1; h <= Model.hmaxFor(21); h++) {
        if (A(r, h) > 1e-6) { ok(h % 3 === 0, `tp-cm: line at ${h} is a multiple of 3`); ok(Math.abs((h % 21 + 21) % 21) % 3 === 0, `tp-cm: line ${h} is 3k orders from a carrier multiple`); ok(A(ab, h) < 1e-9, `tp-cm: line ${h} cancels line-to-line`); }
      }
      ok(Math.min(...P('tp-cm', { strategy: 'dpwmmax' }).out.wave.L) > -200 + 1e-6, 'tp-cm DPWMMAX never −Vdc/2');
      ok(JSON.stringify(levels(P('tp-cm', { strategy: 'sixstep' }))) === JSON.stringify([-66.666667, 66.666667]), 'tp-cm six-step ±Vdc/6'); }

    r = P('tp-six'); mark('tp-six');
    { near(A(P('tp-six', { probe: 'vaO' }), 1), 4 / Math.PI * 200, 1e-6, 'tp-six pole V1'); near(100 * (4 / Math.PI - 1), 27, 0.5, 'tp-six +27 %');
      ok(r.switchings[0] === 2, 'tp-six switchings');
      for (let h = 2; h <= 60; h++) { const ok6 = h % 6 === 1 || h % 6 === 5; if (!ok6) ok(A(r, h) < 1e-6, `tp-six: line at ${h}`); else ok(A(r, h) > 1, `tp-six: 6k±1 line at ${h}`); } }

    const missing = Presets.PRESETS.map((p) => p.id).filter((id) => !done.has(id));
    ok(missing.length === 0, 'presets without a claims check: ' + missing.join(', '));
    return `${done.size} presets checked`;
  });

  test('Parseval: harmonic powers converge to the waveform RMS² (tail ∝ 1/K)', () => {
    // A step waveform has |c_k| ∝ 1/k, so the power missing above bin K falls as 1/K.
    const r = Model.compute({ topology: 'HB', M: 0.8, Vdc: 1, mf: 5 });
    const w = r.out.wave, sp = PWM.fourier(w, 40000), R2 = PWM.rms(w) ** 2;
    const deficit = (K) => { let p = sp.A[0] ** 2; for (let k = 1; k <= K; k++) p += sp.A[k] ** 2 / 2; return 1 - p / R2; };
    ok(deficit(40000) > 0 && deficit(40000) < 1e-4, 'deficit at K = 40000: ' + deficit(40000));
    close(deficit(20000) / deficit(40000), 2, 0.1, 'deficit halves when K doubles');
  });

  test('THD from RMS equals THD summed from the spectrum', () => {
    const r = Model.compute({ topology: 'HB', M: 0.6, Vdc: 1, mf: 7, sampling: 'regular1' });
    const w = r.out.wave, sp = PWM.fourier(w, 20000);
    let d = 0; for (let k = 2; k <= sp.kmax; k++) d += sp.A[k] ** 2 / 2;
    close(r.out.metrics.THD, Math.sqrt(d) / (sp.A[1] / Math.SQRT2), 2e-3, 'THD');
  });

  test('full bridge bipolar is exactly twice the half-bridge output', () => {
    const base = { M: 0.7, Vdc: 1, mf: 15, carrier: 'saw-up', sampling: 'regular2' };
    const hb = Model.compute(Object.assign({ topology: 'HB' }, base)).out.wave;
    const fb = Model.compute(Object.assign({ topology: 'FB', strategy: 'bipolar' }, base)).out.wave;
    ok(hb.b.length === fb.b.length, 'same breakpoints');
    hb.L.forEach((v, i) => close(fb.L[i], 2 * v, 1e-12, `level ${i}`));
  });

  test('full bridge unipolar: fundamental M·V_dc, first carrier group cancelled', () => {
    const M = 0.8, mf = 41;
    const r = Model.compute({ topology: 'FB', strategy: 'unipolar', M, Vdc: 1, mf });
    close(amp(r, 1), M, 1e-9, 'fundamental');
    for (let h = mf - 10; h <= mf + 10; h++) close(amp(r, h), 0, 1e-9, `h=${h}`);
    ok(amp(r, 2 * mf - 1) > 0.05, 'second carrier group present');
    ok(r.switchings[0] === 2 * mf && r.switchings[1] === 2 * mf, 'each leg switches 2mf times per period');
  });

  test('DC reference: mean equals M·V_dc/2 for every carrier and sampling', () => {
    ['triangle', 'saw-up', 'saw-down'].forEach((carrier) =>
      ['natural', 'regular1', 'regular2'].forEach((sampling) => {
        const r = Model.compute({ topology: 'HB', reference: 'dc', M: 0.3, Vdc: 1, mf: 10, carrier, sampling });
        close(amp(r, 0), 0.15, 1e-12, `${carrier}/${sampling}`);
      }));
  });

  test('non-integer mf = 10.5: two-period window, exact fundamental', () => {
    const r = Model.compute({ topology: 'HB', M: 0.8, Vdc: 2, mf: 10.5 });
    ok(r.win.Q === 2, 'Q = 2'); close(amp(r, 1), 0.8, 1e-9, 'fundamental');
  });

  test('hybrid: fundamental M·V_dc, leg b switches twice per period', () => {
    const r = Model.compute({ topology: 'FB', strategy: 'hybrid', M: 0.8, Vdc: 1, mf: 20 });
    close(amp(r, 1), 0.8, 1e-9, 'fundamental'); ok(r.switchings[1] === 2, 'leg b');
  });

  test('common-mode 3rd harmonic: cancels in the unipolar full bridge, appears in the half bridge', () => {
    const base = { reference: 'sine3', M: 0.8, k3: 1 / 6, Vdc: 2, mf: 41 };
    const fb = Model.compute(Object.assign({ topology: 'FB', strategy: 'unipolar' }, base));
    const hb = Model.compute(Object.assign({ topology: 'HB' }, base));
    close(amp(fb, 3), 0, 1e-9, 'FB unipolar A3');
    close(amp(hb, 3), 0.8 / 6, 1e-3, 'HB A3');
  });

  test('overmodulation: fundamental below M·V_dc/2 and low-order harmonics appear', () => {
    const r = Model.compute({ topology: 'HB', M: 1.2, Vdc: 2, mf: 21 });
    ok(amp(r, 1) < 1.2 && amp(r, 1) > 1.0, 'fundamental between 1 and M');
    ok(amp(r, 3) > 0.02, 'third harmonic');
  });

  function run() {
    return tests.map(({ name, fn }) => {
      const t0 = Date.now();
      try { const note = fn(); return { name, pass: true, ms: Date.now() - t0, note }; }
      catch (e) { return { name, pass: false, ms: Date.now() - t0, err: e.message }; }
    });
  }

  if (isNode) {
    const res = run();
    res.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.err ? '\n      ' + r.err : ''}${r.note ? '\n      ' + r.note : ''}`));
    process.exitCode = res.every((r) => r.pass) ? 0 : 1;
  } else root.ToyTests = { run };
})(typeof self !== 'undefined' ? self : this);
