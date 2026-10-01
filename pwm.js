/* ModulationToy — core PWM pipeline. No DOM: runs unchanged in Node and the browser.
 *
 * Time x is normalised to fundamental periods (x = t·f1). The carrier runs at
 * mf periods per fundamental period. Carrier and references share the unit
 * range [-1, 1]; a leg is ON (upper switch closed) while reference > carrier.
 *
 * Pipeline (see README.md):
 *   carrier segments → sampled reference → comparator → leg edges
 *   → probe algebra (piecewise-constant waveform) → exact Fourier / metrics
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Analysis window: mf is quantised to 0.1 so the pattern repeats after Q
  // fundamental periods (Q ∈ {1, 2, 5, 10}); N = mf·Q carrier periods.
  function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return Math.abs(a); }

  function windowFor(mf) {
    const p = Math.round(mf * 10);
    if (p < 1) throw new Error('mf must be ≥ 0.1');
    const Q = 10 / gcd(p, 10);
    return { mf: p / 10, Q, N: (p * Q) / 10 };
  }

  // ---------------------------------------------------------------------------
  // Carrier: { shape: 'triangle' | 'saw-up' | 'saw-down', invert, phase, scale, offset }
  // phase is in carrier periods; scale/offset exist for level-shifted carriers (v2+).
  // Within one carrier period τ ∈ [0, 1):
  //   triangle  −1 → +1 → −1 (valley at τ = 0: centre-aligned)
  //   saw-up    −1 → +1, reset at τ = 1 (trailing-edge modulation)
  //   saw-down  +1 → −1, reset at τ = 1 (leading-edge modulation)
  const CARRIER_DEFAULTS = { shape: 'triangle', invert: false, phase: 0, scale: 1, offset: 0 };

  function carrierOf(spec) { return Object.assign({}, CARRIER_DEFAULTS, spec); }

  // Split [0, Q) into half carrier periods. On each piece the carrier is linear,
  // a regular-sampled reference is constant, and the sample instants are fixed.
  function segments(car, mf, Q) {
    const phi = car.phase;
    const xs = [0];
    const jMin = Math.floor(2 * phi) + 1;
    const jMax = Math.ceil(2 * (mf * Q + phi)) - 1;
    for (let j = jMin; j <= jMax; j++) {
      const x = (j / 2 - phi) / mf;
      if (x > 1e-14 && x < Q - 1e-14) xs.push(x);
    }
    xs.push(Q);

    const sgn = car.invert ? -1 : 1;
    const out = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      const u = mf * 0.5 * (x0 + x1) + phi;
      const k = Math.floor(u);
      const half = (u - k) >= 0.5 ? 1 : 0;
      let a, b; // carrier = a + b·τ on this piece
      if (car.shape === 'triangle') { if (half) { a = 3; b = -4; } else { a = -1; b = 4; } }
      else if (car.shape === 'saw-up') { a = -1; b = 2; }
      else if (car.shape === 'saw-down') { a = 1; b = -2; }
      else throw new Error('unknown carrier shape ' + car.shape);
      const A = car.offset + car.scale * sgn * (a + b * (phi - k));
      const B = car.scale * sgn * b * mf;
      out.push({
        x0, x1,
        c: (x) => A + B * x,
        // sample instants: one per carrier period (period start) or two (each half)
        xs1: (k - phi) / mf,
        xs2: (k + 0.5 * half - phi) / mf,
      });
    }
    return out;
  }

  // Reference as seen by the comparator on one segment.
  //   natural   — the reference itself
  //   regular1  — sampled once per carrier period, held (symmetric regular sampling)
  //   regular2  — sampled every half period, held (asymmetric regular sampling)
  function sampledRef(ref, seg, sampling) {
    if (sampling === 'natural') return ref;
    const xs = sampling === 'regular1' ? seg.xs1 : seg.xs2;
    const r = ref(xs);
    return () => r;
  }

  // ---------------------------------------------------------------------------
  // Comparator: returns leg edges { s0, toggles[] } on [0, Q).
  // s0 is the state just after x = 0; toggles are the switching instants in (0, Q).
  // The waveform is periodic in Q, so a wrap-around transition at x = 0 is implied
  // when the state at the end of the window differs from s0.
  const EPS_X = 1e-12;

  function bisect(g, a, b, ga) {
    const pa = ga > 0;
    for (let i = 0; i < 64; i++) {
      const m = 0.5 * (a + b);
      if (m <= a || m >= b) break;
      if ((g(m) > 0) === pa) a = m; else b = m;
    }
    return 0.5 * (a + b);
  }

  function compare(ref, car, sampling, mf, Q) {
    const segs = segments(car, mf, Q);
    // brackets per segment: enough to catch multiple crossings at low mf
    const K = sampling === 'natural' ? Math.max(16, Math.ceil(4000 / segs.length)) : 1;
    const toggles = [];
    let s0 = null, prev = null;
    for (const seg of segs) {
      const r = sampledRef(ref, seg, sampling);
      const g = (x) => r(x) - seg.c(x);
      let xa = seg.x0, ga = g(xa);
      const start = ga > 0;
      if (prev === null) s0 = start;
      else if (start !== prev) toggles.push(seg.x0);
      for (let i = 1; i <= K; i++) {
        const xb = i === K ? seg.x1 : seg.x0 + (seg.x1 - seg.x0) * i / K;
        const gb = g(xb);
        if ((ga > 0) !== (gb > 0)) toggles.push(bisect(g, xa, xb, ga));
        xa = xb; ga = gb;
      }
      prev = ga > 0;
    }
    return cleanEdges({ s0, toggles, sEnd: prev }, Q);
  }

  // Drop zero-width pulses (reference touching the carrier).
  function cleanEdges(e, Q) {
    const t = e.toggles.slice().sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i < t.length; i++) {
      if (i + 1 < t.length && t[i + 1] - t[i] < EPS_X) { i++; continue; }
      out.push(t[i]);
    }
    const sEnd = (out.length % 2 === 0) ? e.s0 : !e.s0;
    return { s0: e.s0, toggles: out, sEnd, Q };
  }

  function complement(e) {
    return { s0: !e.s0, toggles: e.toggles.slice(), sEnd: !e.sEnd, Q: e.Q };
  }

  // Transitions per fundamental period, including the wrap-around one.
  function switchingsPerPeriod(e) {
    return (e.toggles.length + (e.sEnd !== e.s0 ? 1 : 0)) / e.Q;
  }

  // ---------------------------------------------------------------------------
  // Piecewise-constant waveform { Q, b[0..n], L[0..n-1] }: level L[i] on [b[i], b[i+1]).
  // probe(): v = offset + Σ coef[k]·s_k over legs.
  function probe(legs, coef, offset, Q) {
    const ev = [];
    legs.forEach((e, k) => e.toggles.forEach((t) => ev.push([t, k])));
    ev.sort((p, q) => p[0] - q[0]);
    const s = legs.map((e) => (e.s0 ? 1 : 0));
    const level = () => s.reduce((acc, sk, k) => acc + coef[k] * sk, offset);
    const b = [0], L = [level()];
    let i = 0;
    while (i < ev.length) {
      const t = ev[i][0];
      while (i < ev.length && ev[i][0] - t < 1e-13) { const k = ev[i][1]; s[k] = 1 - s[k]; i++; }
      const v = level();
      if (Math.abs(v - L[L.length - 1]) < 1e-12) continue;   // no net change
      if (t - b[b.length - 1] < 1e-13) { L[L.length - 1] = v; continue; }
      b.push(t); L.push(v);
    }
    b.push(Q);
    return { Q, b, L };
  }

  function legWave(e, high, low) { return probe([e], [high - low], low, e.Q); }

  // ---------------------------------------------------------------------------
  // Generalised waveforms. A waveform may carry optional arrays A, B: on segment i
  //   v(x) = L[i] + A[i] cos 2πx + B[i] sin 2πx
  // (the sinusoid is at the fundamental). This is what a leg voltage looks like while a
  // current is clamped at zero during dead time: the floating node follows the back-EMF.
  const TAU = 2 * Math.PI;
  const hasSin = (w, i) => !!w.A && (w.A[i] !== 0 || w.B[i] !== 0);
  function sinInt(A, B, x0, x1) {                 // ∫ A cos 2πx + B sin 2πx dx
    return (A * (Math.sin(TAU * x1) - Math.sin(TAU * x0)) - B * (Math.cos(TAU * x1) - Math.cos(TAU * x0))) / TAU;
  }
  function valueAt(w, i, x) {
    return w.L[i] + (hasSin(w, i) ? w.A[i] * Math.cos(TAU * x) + w.B[i] * Math.sin(TAU * x) : 0);
  }

  function mean(w) {
    let a = 0;
    for (let i = 0; i < w.L.length; i++) {
      a += w.L[i] * (w.b[i + 1] - w.b[i]);
      if (hasSin(w, i)) a += sinInt(w.A[i], w.B[i], w.b[i], w.b[i + 1]);
    }
    return a / w.Q;
  }

  function rms(w) {
    let a = 0;
    for (let i = 0; i < w.L.length; i++) {
      const x0 = w.b[i], x1 = w.b[i + 1], d = x1 - x0, L = w.L[i];
      a += L * L * d;
      if (hasSin(w, i)) {
        const A = w.A[i], B = w.B[i];
        const c2 = (Math.sin(2 * TAU * x1) - Math.sin(2 * TAU * x0)) / (2 * TAU);          // ∫cos 2θ-type term
        const sc = (Math.sin(TAU * x1) ** 2 - Math.sin(TAU * x0) ** 2) / TAU;              // 2∫sin cos
        a += 2 * L * sinInt(A, B, x0, x1) + A * A * (d / 2 + c2 / 2) + B * B * (d / 2 - c2 / 2) + A * B * sc;
      }
    }
    return Math.sqrt(a / w.Q);
  }

  // Linear combination of generalised waveforms on a common breakpoint grid.
  function combine(waves, weights, offset, Q) {
    const xs = [];
    waves.forEach((w) => w.b.forEach((x) => xs.push(x)));
    xs.sort((p, q) => p - q);
    const b = [0];
    for (const x of xs) if (x > b[b.length - 1] + 1e-13 && x < Q - 1e-13) b.push(x);
    b.push(Q);
    const n = b.length - 1, L = new Float64Array(n), A = new Float64Array(n), B = new Float64Array(n);
    const ptr = waves.map(() => 0);
    for (let i = 0; i < n; i++) {
      const xm = 0.5 * (b[i] + b[i + 1]);
      let l = offset, a = 0, c = 0;
      waves.forEach((w, k) => {
        while (ptr[k] + 1 < w.L.length && w.b[ptr[k] + 1] <= xm) ptr[k]++;
        const j = ptr[k];
        l += weights[k] * w.L[j];
        if (hasSin(w, j)) { a += weights[k] * w.A[j]; c += weights[k] * w.B[j]; }
      });
      L[i] = l; A[i] = a; B[i] = c;
    }
    // merge identical neighbours
    const ob = [0], oL = [], oA = [], oB = [];
    for (let i = 0; i < n; i++) {
      const m = oL.length - 1;
      if (m >= 0 && Math.abs(oL[m] - L[i]) < 1e-12 && Math.abs(oA[m] - A[i]) < 1e-12 && Math.abs(oB[m] - B[i]) < 1e-12) {
        ob[ob.length - 1] = b[i + 1];
      } else { oL.push(L[i]); oA.push(A[i]); oB.push(B[i]); ob.push(b[i + 1]); }
    }
    const anySin = oA.some((v) => v !== 0) || oB.some((v) => v !== 0);
    return anySin ? { Q, b: ob, L: oL, A: oA, B: oB } : { Q, b: ob, L: oL };
  }

  // ---------------------------------------------------------------------------
  // Exact Fourier series of a piecewise-constant waveform.
  //   c_k = 1/(jωQ) · Σ_i ΔL_i e^{-jω b_i},  ω = 2πk/Q,  ΔL_i = L_i − L_{i−1} (cyclic)
  // Bin k sits at harmonic order h = k/Q. Returns one-sided peak amplitudes A_k = 2|c_k|
  // (A_0 is the mean) and phases, for k = 0 … kmax.
  function fourier(w, kmax) {
    const n = w.L.length;
    const dL = new Float64Array(n), pr = new Float64Array(n), pi = new Float64Array(n);
    const zr = new Float64Array(n), zi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      dL[i] = w.L[i] - w.L[(i - 1 + n) % n];
      const th = -2 * Math.PI * w.b[i] / w.Q;
      pr[i] = zr[i] = Math.cos(th); pi[i] = zi[i] = Math.sin(th);
    }
    const A = new Float64Array(kmax + 1), phase = new Float64Array(kmax + 1);
    const re = new Float64Array(kmax + 1), im = new Float64Array(kmax + 1);
    A[0] = mean(w); re[0] = A[0];
    for (let k = 1; k <= kmax; k++) {
      let sr = 0, si = 0;
      for (let i = 0; i < n; i++) {
        if (dL[i] !== 0) { sr += dL[i] * zr[i]; si += dL[i] * zi[i]; }
        const r = zr[i] * pr[i] - zi[i] * pi[i];
        zi[i] = zr[i] * pi[i] + zi[i] * pr[i]; zr[i] = r;
      }
      // divide by jωQ = j·2πk
      const d = 2 * Math.PI * k;
      re[k] = si / d; im[k] = -sr / d;
      A[k] = 2 * Math.hypot(re[k], im[k]);
      phase[k] = Math.atan2(im[k], re[k]);
    }
    // Sinusoidal pieces (clamp intervals): add their integrals directly.
    //   A cos θ + B sin θ = ((A − jB)/2) e^{jθ} + ((A + jB)/2) e^{−jθ},  θ = 2πx
    if (w.A) {
      const G = (al, x0, x1) => {                  // ∫_{x0}^{x1} e^{j al x} dx  → [re, im]
        if (Math.abs(al) < 1e-12) return [x1 - x0, 0];
        return [(Math.sin(al * x1) - Math.sin(al * x0)) / al, -(Math.cos(al * x1) - Math.cos(al * x0)) / al];
      };
      for (let i = 0; i < n; i++) {
        if (!hasSin(w, i)) continue;
        const a = w.A[i], bb = w.B[i], x0 = w.b[i], x1 = w.b[i + 1];
        for (let k = 1; k <= kmax; k++) {
          const wk = TAU * k / w.Q, g1 = G(TAU - wk, x0, x1), g2 = G(-TAU - wk, x0, x1);
          // (a − j bb)/2 · g1 + (a + j bb)/2 · g2
          re[k] += ((a * g1[0] + bb * g1[1]) + (a * g2[0] - bb * g2[1])) / 2 / w.Q;
          im[k] += ((a * g1[1] - bb * g1[0]) + (a * g2[1] + bb * g2[0])) / 2 / w.Q;
        }
      }
      for (let k = 1; k <= kmax; k++) { A[k] = 2 * Math.hypot(re[k], im[k]); phase[k] = Math.atan2(im[k], re[k]); }
    }
    return { Q: w.Q, kmax, A, phase, re, im };
  }

  // Distortion metrics. THD is exact (from the waveform RMS, no truncation);
  // WTHD = √Σ(A_h/h)² / A_1 is summed up to kmax.
  function metrics(w, spec) {
    const Q = w.Q, A1 = spec.A[Q], V0 = spec.A[0], Vr = rms(w);
    const distRms2 = Math.max(0, Vr * Vr - V0 * V0 - A1 * A1 / 2);
    const hasFund = A1 > 1e-9 * Math.max(...w.L.map(Math.abs));   // relative: V_dc-independent
    let wsum = 0;
    for (let k = 1; k <= spec.kmax; k++) {
      if (k === Q) continue;
      const h = k / Q; wsum += (spec.A[k] / h) ** 2;
    }
    return {
      V1: A1, V0, Vrms: Vr,
      THD: hasFund ? Math.sqrt(distRms2) / (A1 / Math.SQRT2) : NaN,
      WTHD: hasFund ? Math.sqrt(wsum) / A1 : NaN,
    };
  }

  // Centred moving average over a window of width wd (one carrier period), sampled at xs.
  function movingAverage(w, wd, xs) {
    const n = w.L.length, F = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      F[i + 1] = F[i] + w.L[i] * (w.b[i + 1] - w.b[i]) + (hasSin(w, i) ? sinInt(w.A[i], w.B[i], w.b[i], w.b[i + 1]) : 0);
    }
    const FQ = F[n];
    const cum = (x) => {                      // ∫_0^x v, periodic extension
      const p = Math.floor(x / w.Q), r = x - p * w.Q;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (w.b[m] <= r) lo = m; else hi = m - 1; }
      return p * FQ + F[lo] + w.L[lo] * (r - w.b[lo]) + (hasSin(w, lo) ? sinInt(w.A[lo], w.B[lo], w.b[lo], r) : 0);
    };
    return xs.map((x) => (cum(x + wd / 2) - cum(x - wd / 2)) / wd);
  }

  // ---------------------------------------------------------------------------
  // Display helpers (exact vertices, so plots show what the comparator sees).
  function carrierTrace(car, mf, Q) {
    const x = [], y = [];
    for (const s of segments(car, mf, Q)) { x.push(s.x0, s.x1); y.push(s.c(s.x0), s.c(s.x1)); }
    return { x, y };
  }

  function refTrace(ref, car, sampling, mf, Q) {
    const segs = segments(car, mf, Q);
    const n = sampling === 'natural' ? Math.max(3, Math.ceil(3000 / segs.length)) : 1;
    const x = [], y = [];
    for (const s of segs) {
      const r = sampledRef(ref, s, sampling);
      for (let i = 0; i <= n; i++) {
        const xx = s.x0 + (s.x1 - s.x0) * i / n;
        x.push(xx); y.push(r(xx));
      }
    }
    return { x, y };
  }

  // Trace for Plotly (line.shape = 'linear'): both ends of every segment, so steps are
  // vertical, plus interior samples on sinusoidal pieces.
  function stepTrace(w, scale = 1, shift = 0) {
    const x = [], y = [], dx = w.Q / 2000;
    for (let i = 0; i < w.L.length; i++) {
      const x0 = w.b[i], x1 = w.b[i + 1];
      const m = hasSin(w, i) ? Math.max(1, Math.ceil((x1 - x0) / dx)) : 1;
      for (let j = 0; j <= m; j++) {
        const xx = x0 + (x1 - x0) * j / m;
        x.push(xx); y.push(valueAt(w, i, xx) * scale + shift);
      }
    }
    return { x, y };
  }

  const api = {
    windowFor, carrierOf, segments, compare, complement, switchingsPerPeriod,
    probe, legWave, combine, mean, rms, fourier, metrics, movingAverage, valueAt,
    carrierTrace, refTrace, stepTrace,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PWM = api;
})(typeof self !== 'undefined' ? self : this);
