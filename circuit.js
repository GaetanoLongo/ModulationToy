/* ModulationToy — load model: series R–L with a sinusoidal back-EMF, driven by a
 * piecewise-constant voltage. No DOM: runs in Node and the browser.
 *
 *   L di/dt + R i = v(t) − e(t),   e(t) = E sin(2π f1 t + φ)
 *
 * Superposition: i = i_v + i_e.
 *   i_e — steady-state response to −e: −(E/|Z1|) sin(2π f1 t + φ − θ1), Z1 = R + jω1L.
 *   i_v — response to the piecewise-constant v, exact per segment:
 *         R > 0:  i → V/R + (i0 − V/R) e^{−Δt/τ},  τ = L/R
 *         R = 0:  i → i0 + V Δt / L  (steady state exists only for zero-mean v; the
 *                 free constant is fixed by taking a zero-mean current)
 *   The periodic steady state over the window [0, Q) solves i(Q) = i(0).
 * Time x is in fundamental periods (t = x/f1), as in pwm.js.
 */
(function (root) {
  'use strict';
  const TAU = 2 * Math.PI;

  function impedance(load, f1, h) {
    const X = TAU * f1 * h * load.L;
    return { re: load.R, im: X, abs: Math.hypot(load.R, X), arg: Math.atan2(X, load.R) };
  }

  // Values of i_v at every breakpoint of the waveform w (periodic steady state).
  function ivAtBreakpoints(w, load, f1) {
    const n = w.L.length, iv = new Float64Array(n + 1);
    const dt = (i) => (w.b[i + 1] - w.b[i]) / f1;
    if (load.R > 0) {
      const tau = load.L / load.R;
      let A = 1, B = 0;                          // i(end) = A·i0 + B
      for (let i = 0; i < n; i++) {
        const a = load.L > 0 ? Math.exp(-dt(i) / tau) : 0, vr = w.L[i] / load.R;
        A *= a; B = vr + (B - vr) * a;
      }
      iv[0] = Math.abs(1 - A) > 1e-15 ? B / (1 - A) : 0;
      for (let i = 0; i < n; i++) {
        const a = load.L > 0 ? Math.exp(-dt(i) / tau) : 0, vr = w.L[i] / load.R;
        iv[i + 1] = vr + (iv[i] - vr) * a;
      }
    } else {
      // Pure inductor: integrate, then remove the mean so the current is zero-mean.
      let area = 0;
      for (let i = 0; i < n; i++) {
        iv[i + 1] = iv[i] + w.L[i] * dt(i) / load.L;
        area += (iv[i] + iv[i + 1]) / 2 * (w.b[i + 1] - w.b[i]);   // exact: linear within a segment
      }
      const mean = area / w.Q;
      for (let i = 0; i <= n; i++) iv[i] -= mean;
    }
    return iv;
  }

  // i_v inside segment i at x (exact).
  function ivInside(w, load, f1, iv, i, x) {
    const d = (x - w.b[i]) / f1;
    if (load.R > 0) {
      const vr = w.L[i] / load.R;
      return load.L > 0 ? vr + (iv[i] - vr) * Math.exp(-d * load.R / load.L) : vr;
    }
    return iv[i] + w.L[i] * d / load.L;
  }

  function ie(load, f1, phi) {
    const z = impedance(load, f1, 1);
    return (x) => (z.abs > 0 ? -(load.E / z.abs) * Math.sin(TAU * x + phi - z.arg) : 0);
  }

  // Current waveform sampled at every breakpoint, plus interior points on long segments
  // (so curvature from the exponential and from e(t) is drawn faithfully).
  function current(w, load, f1, phi) {
    const iv = ivAtBreakpoints(w, load, f1), eFn = ie(load, f1, phi);
    const x = [], y = [];
    const maxStep = w.Q / 1500;
    for (let i = 0; i < w.L.length; i++) {
      const x0 = w.b[i], x1 = w.b[i + 1], k = Math.max(1, Math.ceil((x1 - x0) / maxStep));
      for (let j = 0; j < k; j++) {
        const xx = x0 + (x1 - x0) * j / k;
        x.push(xx); y.push((j === 0 ? iv[i] : ivInside(w, load, f1, iv, i, xx)) + eFn(xx));
      }
    }
    x.push(w.Q); y.push(iv[w.L.length] + eFn(w.Q));
    return { x, y };
  }

  // Exact current spectrum from the exact voltage spectrum: I_h = (V_h − E_h)/Z(h).
  // spec: pwm.fourier() output (re/im of c_k, k at order k/Q). Returns amplitudes and phases.
  function currentSpectrum(spec, load, f1, phi) {
    const Q = spec.Q, K = spec.kmax;
    const A = new Float64Array(K + 1), re = new Float64Array(K + 1), im = new Float64Array(K + 1);
    re[0] = load.R > 0 ? spec.re[0] / load.R : 0;     // DC (R = 0: zero-mean convention)
    A[0] = Math.abs(re[0]);
    for (let k = 1; k <= K; k++) {
      let vr = spec.re[k], vi = spec.im[k];
      if (k === Q) {                                   // back-EMF: c = (E/2j) e^{jφ}
        vr -= (load.E / 2) * Math.sin(phi); vi -= -(load.E / 2) * Math.cos(phi);
      }
      const z = impedance(load, f1, k / Q), d = z.re * z.re + z.im * z.im;
      if (d === 0) continue;
      re[k] = (vr * z.re + vi * z.im) / d; im[k] = (vi * z.re - vr * z.im) / d;
      A[k] = 2 * Math.hypot(re[k], im[k]);
    }
    return { Q, kmax: K, A, re, im };
  }

  // Current metrics from the exact spectrum and the sampled waveform.
  function currentMetrics(ispec, iw, vspec) {
    const Q = ispec.Q, I1 = ispec.A[Q];
    let dist = 0;
    for (let k = 1; k <= ispec.kmax; k++) if (k !== Q) dist += ispec.A[k] ** 2 / 2;
    const rms = Math.sqrt(ispec.A[0] ** 2 + I1 * I1 / 2 + dist);
    // ripple: peak-to-peak of i minus its DC and fundamental
    const c = ispec.re[Q], s = ispec.im[Q];
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < iw.x.length; j++) {
      const f = ispec.re[0] + 2 * (c * Math.cos(TAU * iw.x[j]) - s * Math.sin(TAU * iw.x[j]));
      const r = iw.y[j] - f; if (r < lo) lo = r; if (r > hi) hi = r;
    }
    // phase of the fundamental current relative to the fundamental voltage (positive = lagging)
    const lag = Math.atan2(vspec.im[Q], vspec.re[Q]) - Math.atan2(s, c);
    const phiLag = Math.atan2(Math.sin(lag), Math.cos(lag));
    return {
      I1, I0: ispec.re[0], Irms: rms, THD: I1 > 0 ? Math.sqrt(dist) / (I1 / Math.SQRT2) : NaN,
      ripple: hi - lo, lag: phiLag,
      P1: vspec.A[Q] * I1 / 2 * Math.cos(phiLag),     // fundamental active power of this load branch
    };
  }

  // Active power of one load branch from the exact spectra: P = mean(v·i) = V0·I0 + Σ_k 2·Re(c_v,k · conj(c_i,k)).
  // fund: the fundamental's share alone. The current lines fall as 1/h², so the sum to kmax is converged.
  function activePower(vspec, ispec) {
    const Q = vspec.Q;
    let P = vspec.re[0] * ispec.re[0];
    for (let k = 1; k <= Math.min(vspec.kmax, ispec.kmax); k++) P += 2 * (vspec.re[k] * ispec.re[k] + vspec.im[k] * ispec.im[k]);
    const fund = 2 * (vspec.re[Q] * ispec.re[Q] + vspec.im[Q] * ispec.im[Q]);
    return { P, P1: fund };
  }

  const api = { impedance, current, currentSpectrum, currentMetrics, activePower, ivAtBreakpoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Circuit = api;
})(typeof self !== 'undefined' ? self : this);
