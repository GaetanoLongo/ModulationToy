/* ModulationToy — dead time with an R–L–e load: exact switched simulation.
 * No DOM: runs in Node and the browser.
 *
 * Each turn-on is delayed by t_d, so after every command edge both switches of that leg
 * are off. A leg is then in one of three electrical states:
 *   switch   — its gate is on: v_kN = V_dc (upper) or 0 (lower);
 *   diode    — both gates off, current ≠ 0: the current picks the diode,
 *              out of the node (i > 0) → lower diode, v = 0;  into the node → upper, v = V_dc;
 *   floating — both gates off and the current has reached zero: it stays at zero
 *              (zero-current clamping) and the node voltage follows the load, as long as
 *              that voltage lies between the rails; otherwise the diode at the violated
 *              rail conducts.
 * Within an interval with fixed states the currents are exact (constant voltage +
 * sinusoidal back-EMF into R–L). Events (current zero crossings, a floating node reaching
 * a rail) are located by bracketing and bisection. The periodic steady state is found by
 * Newton iteration on the initial currents; the map is piecewise affine, so it converges
 * in a few steps once the sequence of states settles.
 *
 * Assumptions where the circuit leaves a voltage undetermined:
 *   full bridge, both legs floating (i = 0): the node voltages split the back-EMF evenly
 *   around V_dc/2; three-phase, all three legs floating: the star point sits at V_dc/2.
 *   These only affect the common-mode voltage.
 */
(function (root) {
  'use strict';
  const TAU = 2 * Math.PI;

  // Gate timeline of one leg from its command edges: g = +1 upper on, −1 lower on, 0 both off.
  function gateTimeline(e, td) {
    const Q = e.Q, tg = [];
    let s = e.s0;
    if (e.sEnd !== e.s0) tg.push([0, e.s0]);        // wrap-around command edge at x = 0
    for (const t of e.toggles) { s = !s; tg.push([t, s]); }
    if (tg.length === 0) return { x: [0], g: [e.s0 ? 1 : -1], Q };
    const pts = [];
    for (let i = 0; i < tg.length; i++) {
      const a = tg[i][0], b = i + 1 < tg.length ? tg[i + 1][0] : tg[0][0] + Q;
      pts.push([a, 0]);
      if (a + td < b) pts.push([a + td, tg[i][1] ? 1 : -1]);   // shorter pulses never turn on
    }
    const norm = pts.map(([x, g]) => [x >= Q ? x - Q : x, g]).sort((p, q) => p[0] - q[0]);
    const x = [0], g = [norm[norm.length - 1][1]];
    for (const [xx, gg] of norm) {
      if (xx < 1e-15) { g[0] = gg; continue; }
      if (gg === g[g.length - 1]) continue;
      x.push(xx); g.push(gg);
    }
    return { x, g, Q };
  }

  // L di/dt + R i = V + P cos θ + S sin θ,  θ = 2πx, t = x/f1;  i(x0) = i0.
  function branch(ld, f1, V, P, S, x0, i0) {
    const zr = ld.R, zi = TAU * f1 * ld.L, d = zr * zr + zi * zi;
    const ur = (P * zr - S * zi) / d, ui = (-S * zr - P * zi) / d;    // (P − jS)/Z
    const isin = (x) => ur * Math.cos(TAU * x) - ui * Math.sin(TAU * x);
    if (ld.R > 0) {
      const tau = ld.L * f1 / ld.R, k = i0 - V / ld.R - isin(x0);
      return (x) => V / ld.R + isin(x) + k * Math.exp(-(x - x0) / tau);
    }
    const c = i0 - isin(x0);
    return (x) => c + isin(x) + V * (x - x0) / (ld.L * f1);
  }

  const sv = (c, A = 0, B = 0) => ({ c, A, B });             // c + A cos θ + B sin θ
  const at = (v, x) => v.c + v.A * Math.cos(TAU * x) + v.B * Math.sin(TAU * x);

  // Electrical states for one interval: leg voltages, current functions, event watchers.
  function resolve(cfg, g, cur, x) {
    const { topo, Vdc, eAB, epsI } = cfg;
    const nLeg = g.length;
    const legCur = topo === 'FB' ? [cur[0], -cur[0]] : cur.slice(0, nLeg);
    const fixed = new Array(nLeg).fill(null), diode = new Array(nLeg).fill(false);
    let F = [];
    for (let k = 0; k < nLeg; k++) {
      if (g[k] === 1) fixed[k] = Vdc;
      else if (g[k] === -1) fixed[k] = 0;
      else if (legCur[k] > epsI) { fixed[k] = 0; diode[k] = true; }
      else if (legCur[k] < -epsI) { fixed[k] = Vdc; diode[k] = true; }
      else F.push(k);
    }
    const e = (k) => eAB[k];                               // [A, B] of the back-EMF of phase k (single-phase: k = 0)
    const floatV = () => {
      const v = {};
      if (topo === 'HB') { if (F.length) v[0] = sv(Vdc / 2, e(0)[0], e(0)[1]); }
      else if (topo === 'FB') {
        if (F.length === 2) { v[0] = sv(Vdc / 2, e(0)[0] / 2, e(0)[1] / 2); v[1] = sv(Vdc / 2, -e(0)[0] / 2, -e(0)[1] / 2); }
        else if (F[0] === 0) v[0] = sv(fixed[1], e(0)[0], e(0)[1]);
        else if (F[0] === 1) v[1] = sv(fixed[0], -e(0)[0], -e(0)[1]);
      } else {
        if (F.length === 1) {
          const k = F[0], o = [0, 1, 2].filter((j) => j !== k);
          v[k] = sv((fixed[o[0]] + fixed[o[1]]) / 2, 1.5 * e(k)[0], 1.5 * e(k)[1]);
        } else if (F.length === 2) {
          const z = [0, 1, 2].find((j) => !F.includes(j));
          F.forEach((k) => { v[k] = sv(fixed[z], e(k)[0] - e(z)[0], e(k)[1] - e(z)[1]); });
        } else if (F.length === 3) F.forEach((k) => { v[k] = sv(Vdc / 2, e(k)[0], e(k)[1]); });
      }
      return v;
    };
    // Drop infeasible floating legs (their node would leave the rails): the diode conducts.
    const xp = x + cfg.dx;
    let fv = floatV();
    for (let guard = 0; guard < 4 && F.length; guard++) {
      let worst = null, over = 0;
      F.forEach((k) => {
        const val = at(fv[k], xp), o = Math.max(-val, val - Vdc);
        if (o > cfg.tolV && o > over) { over = o; worst = k; }
      });
      if (worst === null) break;
      fixed[worst] = at(fv[worst], xp) > Vdc ? Vdc : 0; diode[worst] = true;
      F = F.filter((k) => k !== worst);
      fv = floatV();
    }

    const legV = [], watchers = [];
    for (let k = 0; k < nLeg; k++) legV.push(F.includes(k) ? fv[k] : sv(fixed[k]));
    F.forEach((k) => {
      watchers.push({ kind: 'rail', f: (xx) => at(fv[k], xx) });
      watchers.push({ kind: 'rail', f: (xx) => Vdc - at(fv[k], xx) });
    });

    const { ld, f1 } = cfg;
    let curFn;
    if (topo !== 'TP') {
      if (F.length) curFn = () => [0];
      else {
        const V = topo === 'HB' ? fixed[0] - Vdc / 2 : fixed[0] - fixed[1];
        const br = branch(ld, f1, V, -e(0)[0], -e(0)[1], x, cur[0]);
        curFn = (xx) => [br(xx)];
        if (diode[0]) watchers.push({ kind: 'zero', f: br });
        if (topo === 'FB' && diode[1]) watchers.push({ kind: 'zero', f: br });
      }
    } else if (F.length === 0) {
      const vn = (fixed[0] + fixed[1] + fixed[2]) / 3;
      const brs = [0, 1, 2].map((k) => branch(ld, f1, fixed[k] - vn, -e(k)[0], -e(k)[1], x, cur[k]));
      curFn = (xx) => brs.map((b) => b(xx));
      [0, 1, 2].forEach((k) => { if (diode[k]) watchers.push({ kind: 'zero', f: brs[k] }); });
    } else if (F.length === 1) {
      const k = F[0], [y, z] = [0, 1, 2].filter((j) => j !== k);
      const br = branch(ld, f1, (fixed[y] - fixed[z]) / 2, -(e(y)[0] - e(z)[0]) / 2, -(e(y)[1] - e(z)[1]) / 2, x, (cur[y] - cur[z]) / 2);
      curFn = (xx) => { const c = [0, 0, 0], v = br(xx); c[y] = v; c[z] = -v; return c; };
      if (diode[y] || diode[z]) watchers.push({ kind: 'zero', f: br });
    } else curFn = () => [0, 0, 0];

    return { legV, curFn, watchers };
  }

  // First sign change of f in (xa, xb]; the sign at the start is taken just after xa.
  function firstRoot(f, xa, xb, cfg) {
    const x0 = xa + Math.min(cfg.dx, (xb - xa) * 1e-3);
    let fa = f(x0);
    const n = Math.max(4, Math.ceil((xb - x0) / cfg.probe));
    let xl = x0;
    for (let i = 1; i <= n; i++) {
      const xr = x0 + (xb - x0) * i / n, fr = f(xr);
      if (fa === 0) { fa = fr; xl = xr; continue; }
      if ((fa > 0) !== (fr > 0) && fr !== 0) {
        let a = xl, b = xr;
        for (let j = 0; j < 60; j++) { const m = 0.5 * (a + b); if ((f(m) > 0) === (fa > 0)) a = m; else b = m; }
        return 0.5 * (a + b);
      }
      xl = xr; fa = fr;
    }
    return null;
  }

  // One window from initial currents. record: also return leg voltages and current samples.
  function simulate(cfg, init, record) {
    const { gates, Q } = cfg, nLeg = gates.length, nPh = cfg.topo === 'TP' ? 3 : 1;
    let cur = init.slice();
    const xs = [];
    gates.forEach((t) => t.x.forEach((x) => xs.push(x)));
    xs.push(Q); xs.sort((p, q) => p - q);
    const bps = [0];
    for (const x of xs) if (x > bps[bps.length - 1] + 1e-14) bps.push(x);
    if (bps[bps.length - 1] < Q) bps.push(Q); else bps[bps.length - 1] = Q;
    const gp = gates.map(() => 0);
    const out = record ? { legs: gates.map(() => ({ b: [], L: [], A: [], B: [] })), cur: Array.from({ length: nPh }, () => ({ x: [], y: [] })) } : null;
    let steps = 0;
    for (let s = 0; s + 1 < bps.length; s++) {
      const xa = bps[s], xb = bps[s + 1];
      const g = gates.map((t, k) => { while (gp[k] + 1 < t.x.length && t.x[gp[k] + 1] <= xa + 1e-14) gp[k]++; return t.g[gp[k]]; });
      let x = xa;
      while (x < xb - 1e-14) {
        if (++steps > 200000) throw new Error('dead-time simulation did not progress');
        const sys = resolve(cfg, g, cur, x);
        let xe = xb, ev = null;
        for (const w of sys.watchers) { const r = firstRoot(w.f, x, xe, cfg); if (r !== null && r < xe) { xe = r; ev = w; } }
        if (record) {
          sys.legV.forEach((v, k) => { const o = out.legs[k]; o.b.push(x); o.L.push(v.c); o.A.push(v.A); o.B.push(v.B); });
          const m = Math.max(1, Math.ceil((xe - x) / cfg.sample));
          for (let j = 0; j < m; j++) {
            const xx = x + (xe - x) * j / m, c = sys.curFn(xx);
            for (let p = 0; p < nPh; p++) { out.cur[p].x.push(xx); out.cur[p].y.push(c[p]); }
          }
        }
        cur = sys.curFn(xe);
        if (ev && ev.kind === 'zero') {
          // snap the current that reached zero (three-phase pair: both)
          if (nPh === 1) cur = [0];
          else {
            const v = cur.map(Math.abs), k = v.indexOf(Math.min(...v));
            cur[k] = 0;
            const o = [0, 1, 2].filter((j) => j !== k);
            if (Math.abs(cur[o[0]] + cur[o[1]]) < cfg.epsI * 10) { /* pair: fine */ }
          }
        }
        if (nPh === 3) { const d = (cur[0] + cur[1] + cur[2]) / 3; cur = cur.map((c) => c - d); }
        x = xe;
      }
    }
    if (record) {
      out.legs = out.legs.map((o) => { o.b.push(Q); return Object.assign({ Q }, mergeSeg(o)); });
      out.cur.forEach((c) => { c.x.push(Q); c.y.push(cur[out.cur.indexOf(c)]); });
    }
    return { end: cur, out };
  }

  function mergeSeg(o) {
    const b = [o.b[0]], L = [], A = [], B = [];
    for (let i = 0; i < o.L.length; i++) {
      const m = L.length - 1;
      if (o.b[i + 1] - o.b[i] <= 0) continue;
      if (m >= 0 && L[m] === o.L[i] && A[m] === o.A[i] && B[m] === o.B[i]) b[b.length - 1] = o.b[i + 1];
      else { L.push(o.L[i]); A.push(o.A[i]); B.push(o.B[i]); b.push(o.b[i + 1]); }
    }
    return { b, L, A, B };
  }

  // Periodic steady state: Newton on the initial currents (1 unknown single-phase, 2 three-phase).
  function steadyState(cfg, guess) {
    const tp = cfg.topo === 'TP';
    const pack = (u) => (tp ? [u[0], u[1], -u[0] - u[1]] : [u[0]]);
    const unpack = (c) => (tp ? [c[0], c[1]] : [c[0]]);
    const Fn = (u) => { const e = unpack(simulate(cfg, pack(u), false).end); return e.map((v, i) => v - u[i]); };
    const norm = (r) => Math.max(...r.map(Math.abs));
    let u = unpack(guess), r = Fn(u), it = 0;
    const tol = 1e-10 * cfg.Iscale, h = 1e-6 * cfg.Iscale;
    for (; it < 40 && norm(r) > tol; it++) {
      const n = u.length, J = [];
      for (let j = 0; j < n; j++) {
        const up = u.slice(); up[j] += h;
        const rp = Fn(up); J.push(rp.map((v, i) => (v - r[i]) / h));    // column j
      }
      let step;
      if (n === 1) step = [-r[0] / J[0][0]];
      else {
        const a = J[0][0], b = J[1][0], c = J[0][1], d = J[1][1], det = a * d - b * c;   // J = [[a b],[c d]] rows = r index
        step = [-(d * r[0] - b * r[1]) / det, -(-c * r[0] + a * r[1]) / det];
      }
      if (!step.every(isFinite)) break;
      let lam = 1, un, rn;
      for (let k = 0; k < 12; k++) {
        un = u.map((v, i) => v + lam * step[i]); rn = Fn(un);
        if (norm(rn) < norm(r)) break;
        lam /= 2;
      }
      u = un; r = rn;
    }
    // fallback: plain fixed-point (contracting when R > 0)
    for (let k = 0; k < 400 && norm(r) > tol; k++) { u = u.map((v, i) => v + r[i]); r = Fn(u); it++; }
    return { init: pack(u), residual: norm(r), iterations: it, converged: norm(r) <= 1e-6 * cfg.Iscale };
  }

  // Public entry: edges per leg (from pwm.compare / complement), td in fundamental periods.
  function solve({ topo, edges, td, Vdc, ld, f1, phis, guess }) {
    const Q = edges[0].Q;
    const nPh = topo === 'TP' ? 3 : 1;
    const Z1 = Math.hypot(ld.R, TAU * f1 * ld.L);
    const cfg = {
      topo, Vdc, ld, f1, Q,
      gates: edges.map((e) => gateTimeline(e, td)),
      eAB: phis.slice(0, nPh).map((p) => [ld.E * Math.sin(p), ld.E * Math.cos(p)]),
      Iscale: Vdc / Z1, epsI: 1e-12 * Vdc / Z1, tolV: 1e-9 * Vdc,
      dx: 1e-11 * Q, probe: Q / 4000, sample: Q / 3000,
    };
    const ss = steadyState(cfg, guess);
    const { out } = simulate(cfg, ss.init, true);
    return { legV: out.legs, currents: out.cur, gates: cfg.gates, converged: ss.converged, residual: ss.residual, iterations: ss.iterations };
  }

  const api = { gateTimeline, branch, solve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeadTime = api;
})(typeof self !== 'undefined' ? self : this);
