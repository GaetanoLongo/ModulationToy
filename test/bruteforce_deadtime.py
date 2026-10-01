"""Brute-force reference for dead time with an R-L-e load.

Independent of the JS event-driven solver: a fixed-step time march (N steps per
window) with the physical rules applied step by step, and the periodic steady
state reached by simply repeating windows until the currents repeat.

Rules (README "Dead time"):
- a gate turns on only once its command has been steady for t_d;
- both gates off: current out of the node -> lower diode (v = 0), into the node ->
  upper diode (v = V_dc);
- a current that crosses zero while its leg is in dead time is clamped at zero
  and the node floats at the voltage that keeps it there, while that voltage is
  between the rails; otherwise the diode at the violated rail conducts.
Floating-node voltages (from the circuit equations):
  half bridge  v_aN = V_dc/2 + e
  full bridge  one leg floating: v_aN = v_bN + e  or  v_bN = v_aN - e;
               both: V_dc/2 +- e/2 (assumed even split)
  three-phase  one floating (x): v_xN = (v_yN + v_zN)/2 + 1.5 e_x
               two floating: v_nN = v_zN - e_z, v_xN = v_nN + e_x
               three floating: v_nN = V_dc/2 (assumed)

Writes test/bruteforce_dt_ref.js. Run: python ModulationToy/test/bruteforce_deadtime.py
"""
import json
import math
import os
import time

import numpy as np
from numba import njit

import bruteforce as bf

N = 2 ** 20


@njit(cache=True)
def gates_from(s, m_td):
    """+1 upper on, -1 lower on, 0 both off: on once the command is steady for m_td steps."""
    n = s.size
    cnt = np.zeros(2 * n)
    for j in range(2 * n):
        jj = j % n
        if j > 0 and s[jj] == s[(j - 1) % n]:
            cnt[j] = cnt[j - 1] + 1
        else:
            cnt[j] = 1
    g = np.zeros(n, np.int8)
    for j in range(n):
        c = cnt[n + j]
        if c - 0.5 >= m_td:
            g[j] = 1 if s[j] > 0.5 else -1
    return g


@njit(cache=True)
def run(topo, G, E, Vdc, R, L, f1, h, cur0, record, VO, IO):
    """One window. topo 0 = HB, 1 = FB, 2 = TP. G: (legs, n) gates; E: (phases, n) back-EMF."""
    n = G.shape[1]
    a = math.exp(-(h / f1) * R / L)
    eps = 1e-12 * Vdc
    cur = cur0.copy()
    fixed = np.zeros(3)
    diode = np.zeros(3, np.bool_)
    flt = np.zeros(3, np.bool_)
    fv = np.zeros(3)
    for j in range(n):
        nleg = 1 if topo == 0 else (2 if topo == 1 else 3)
        # leg currents out of the node
        lc = np.zeros(3)
        if topo == 0:
            lc[0] = cur[0]
        elif topo == 1:
            lc[0] = cur[0]; lc[1] = -cur[0]
        else:
            lc[0] = cur[0]; lc[1] = cur[1]; lc[2] = cur[2]
        for k in range(nleg):
            diode[k] = False; flt[k] = False
            g = G[k, j]
            if g == 1:
                fixed[k] = Vdc
            elif g == -1:
                fixed[k] = 0.0
            elif lc[k] > eps:
                fixed[k] = 0.0; diode[k] = True
            elif lc[k] < -eps:
                fixed[k] = Vdc; diode[k] = True
            else:
                flt[k] = True
        # floating voltages, dropping the worst infeasible leg until consistent
        for guard in range(4):
            nf = 0
            for k in range(nleg):
                if flt[k]:
                    nf += 1
            if nf == 0:
                break
            if topo == 0:
                fv[0] = Vdc / 2 + E[0, j]
            elif topo == 1:
                if flt[0] and flt[1]:
                    fv[0] = Vdc / 2 + E[0, j] / 2; fv[1] = Vdc / 2 - E[0, j] / 2
                elif flt[0]:
                    fv[0] = fixed[1] + E[0, j]
                else:
                    fv[1] = fixed[0] - E[0, j]
            else:
                if nf == 1:
                    for k in range(3):
                        if flt[k]:
                            y = (k + 1) % 3; z = (k + 2) % 3
                            fv[k] = (fixed[y] + fixed[z]) / 2 + 1.5 * E[k, j]
                elif nf == 2:
                    zz = 0
                    for k in range(3):
                        if not flt[k]:
                            zz = k
                    vn = fixed[zz] - E[zz, j]
                    for k in range(3):
                        if flt[k]:
                            fv[k] = vn + E[k, j]
                else:
                    for k in range(3):
                        fv[k] = Vdc / 2 + E[k, j]
            worst = -1; over = 1e-9 * Vdc
            for k in range(nleg):
                if flt[k]:
                    o = max(-fv[k], fv[k] - Vdc)
                    if o > over:
                        over = o; worst = k
            if worst < 0:
                break
            fixed[worst] = Vdc if fv[worst] > Vdc else 0.0
            diode[worst] = True; flt[worst] = False
        v = np.zeros(3)
        nf = 0
        for k in range(nleg):
            if flt[k]:
                v[k] = fv[k]; nf += 1
            else:
                v[k] = fixed[k]
        # advance the currents over one step (exact exponential update, EMF at the midpoint)
        new = cur.copy()
        if topo < 2:
            if nf > 0:
                new[0] = 0.0
            else:
                u = (v[0] - Vdc / 2 - E[0, j]) if topo == 0 else (v[0] - v[1] - E[0, j])
                new[0] = u / R + (cur[0] - u / R) * a
                dio = diode[0] or (topo == 1 and diode[1])
                if dio and cur[0] != 0.0 and (new[0] > 0) != (cur[0] > 0):
                    new[0] = 0.0
        else:
            if nf == 0:
                vn = (v[0] + v[1] + v[2]) / 3
                for k in range(3):
                    u = v[k] - vn - E[k, j]
                    new[k] = u / R + (cur[k] - u / R) * a
                zero = -1
                for k in range(3):
                    if diode[k] and cur[k] != 0.0 and (new[k] > 0) != (cur[k] > 0):
                        zero = k
                if zero >= 0:
                    y = (zero + 1) % 3; z = (zero + 2) % 3
                    iy = (new[y] - new[z]) / 2
                    new[zero] = 0.0; new[y] = iy; new[z] = -iy
            elif nf == 1:
                x = 0
                for k in range(3):
                    if flt[k]:
                        x = k
                y = (x + 1) % 3; z = (x + 2) % 3
                u = (v[y] - v[z]) / 2 - (E[y, j] - E[z, j]) / 2
                i0 = (cur[y] - cur[z]) / 2
                iy = u / R + (i0 - u / R) * a
                if (diode[y] or diode[z]) and i0 != 0.0 and (iy > 0) != (i0 > 0):
                    iy = 0.0
                new[x] = 0.0; new[y] = iy; new[z] = -iy
            else:
                new[0] = 0.0; new[1] = 0.0; new[2] = 0.0
        if record:
            for k in range(nleg):
                VO[k, j] = v[k]
            for p in range(3):
                IO[p, j] = 0.5 * (cur[p] + new[p])
        cur = new
    return cur


def solve(case):
    mf, Q = bf.window(case['mf'])
    topo = {'HB': 0, 'FB': 1, 'TP': 2}[case['topology']]
    s = bf.commands(case, N)
    h = Q / N
    m_td = case['tdus'] * 1e-6 * case['f1'] / h
    G = np.array([gates_from(sk, m_td) for sk in s])
    x = (np.arange(N) + 0.5) * h
    nph = 3 if topo == 2 else 1
    phis = [math.radians(case['delta']) + (bf.PHI[k] if topo == 2 else 0.0) for k in range(nph)]
    E = np.array([case['E'] * np.sin(2 * np.pi * x + p) for p in phis])
    Vdc, R, L, f1 = case['Vdc'], case['R'], case['Lmh'] / 1000, case['f1']
    Iscale = Vdc / math.hypot(R, 2 * math.pi * f1 * L)
    cur = np.zeros(3)
    VO = np.zeros((len(s), N)); IO = np.zeros((3, N))
    for w in range(2000):
        end = run(topo, G, E, Vdc, R, L, f1, h, cur, False, VO, IO)
        if np.max(np.abs(end - cur)) < 1e-11 * Iscale:
            cur = end
            break
        cur = end
    run(topo, G, E, Vdc, R, L, f1, h, cur, True, VO, IO)
    if topo == 0:
        probes = {'vaO': VO[0] - Vdc / 2}
    elif topo == 1:
        probes = {'vab': VO[0] - VO[1], 'vcm': (VO[0] + VO[1]) / 2 - Vdc / 2}
    else:
        m = VO.mean(axis=0)
        probes = {'vab': VO[0] - VO[1], 'van': VO[0] - m, 'vaO': VO[0] - Vdc / 2, 'vcm': m - Vdc / 2}
    out = {}
    for pid, v in probes.items():
        A, bound = bf.spectrum(v, mf, Q, N)
        out[pid] = dict(A=[float(f'{a:.8g}') for a in A], bound=2 * bound)   # edges quantised to one step
    Ic = np.fft.rfft(IO[0])[: Q + 1] / N
    I1 = 2 * abs(Ic[Q])
    clamp = float(np.mean(IO[0] == 0.0))
    return out, dict(I1=I1, argI1=float(np.angle(Ic[Q])), clamp=clamp, windows=w + 1)


def cases():
    b = dict(carrier='triangle', sampling='natural', reference='sine', M=0.8, k3=1 / 6, mf=21, f1=50, Vdc=400,
             E=0, delta=0, strategy='single')
    yield dict(b, topology='HB', R=5, Lmh=10, tdus=3)
    yield dict(b, topology='HB', R=40, Lmh=5, tdus=5)                                     # soft commutation
    yield dict(b, topology='HB', R=5, Lmh=10, tdus=3, carrier='saw-up', sampling='regular1')
    yield dict(b, topology='FB', strategy='bipolar', R=5, Lmh=10, tdus=3)
    yield dict(b, topology='FB', strategy='unipolar', R=40, Lmh=5, tdus=5)                # clamping
    yield dict(b, topology='FB', strategy='unipolar', R=0.5, Lmh=5, E=300, delta=-15, tdus=4)
    yield dict(b, topology='FB', strategy='hybrid', R=20, Lmh=5, tdus=5)
    yield dict(b, topology='TP', strategy='spwm', R=5, Lmh=10, tdus=3)
    yield dict(b, topology='TP', strategy='spwm', R=40, Lmh=5, tdus=5)                    # clamping
    yield dict(b, topology='TP', strategy='svpwm', R=20, Lmh=5, E=150, delta=10, tdus=5)  # clamping + EMF
    yield dict(b, topology='TP', strategy='dpwm1', R=5, Lmh=10, tdus=3)
    yield dict(b, topology='TP', strategy='svpwm', R=60, Lmh=2, tdus=10, mf=9.5)          # long dead time, Q = 2


def main():
    res, t0 = [], time.time()
    for case in cases():
        t1 = time.time()
        spectra, cur = solve(case)
        res.append(dict(case=case, spectra=spectra, current=cur))
        print(f"{case['topology']} {case['strategy']:8s} R={case['R']:<5} L={case['Lmh']:<3} E={case['E']:<4} "
              f"td={case['tdus']}us: I1={cur['I1']:.4f} clamp={cur['clamp']:.5f} "
              f"windows={cur['windows']} ({time.time() - t1:.1f} s)")
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'bruteforce_dt_ref.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* Generated by test/bruteforce_deadtime.py — do not edit. Dead-time brute force:\n'
                f' * fixed-step march, N = {N} per window. bound = 2·TV(v)/N per spectrum. */\n')
        f.write('(function (root) {\n  const REF = ')
        json.dump(res, f, separators=(',', ':'))
        f.write(';\n  if (typeof module !== "undefined" && module.exports) module.exports = REF;\n'
                '  else root.BRUTE_DT_REF = REF;\n})(typeof self !== "undefined" ? self : this);\n')
    print(f'{len(res)} cases in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
