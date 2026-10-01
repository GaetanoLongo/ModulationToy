"""Brute-force reference spectra for the ModulationToy cross-check.

Independent of the JS code: the waveform is built by point-sampling the
comparator (reference > carrier) on a dense grid and transformed with an FFT.
No switching instants, no exact Fourier sums.

Error bound stored per case (the tolerance in test/tests.js): sampling at cell
midpoints is exact for the waveform with its edges snapped to cell boundaries,
and snapping moves each jump dL by at most half a cell (1/2N of the window),
which changes each amplitude by at most |dL|/N. Summed over all jumps:
|dA| <= TV(v)/N, TV = total variation over the window. The zero-order-hold
(sinc) factor adds about A(pi k/N)^2/6, below 1e-9 here.

Writes test/bruteforce_ref.js. Run from the repo root or anywhere:
    python test/bruteforce.py
"""
import json
import math
import os
import time

import numpy as np

N = 2 ** 22  # grid points per analysis window

# Mirrors the definitions in README.md (conventions and strategy table),
# re-implemented from the text, not from the JS.


def window(mf):
    p = round(mf * 10)
    Q = 10 // math.gcd(p, 10)
    return p / 10, Q


def hmax(mf):
    return max(40, math.ceil(4.5 * mf))


def carrier(shape, tau):
    if shape == 'triangle':
        return np.where(tau < 0.5, -1 + 4 * tau, 3 - 4 * tau)
    if shape == 'saw-up':
        return -1 + 2 * tau
    if shape == 'saw-down':
        return 1 - 2 * tau
    raise ValueError(shape)


def modulation(ref, M, k3, x):
    w = 2 * np.pi
    if ref == 'dc':
        return np.full_like(x, M), np.zeros_like(x)
    m = M * np.sin(w * x)
    cm = M * k3 * np.sin(3 * w * x) if ref == 'sine3' else np.zeros_like(x)
    return m, cm


def leg_refs(strategy, m, cm):
    """References per compared leg; None marks the bipolar complement leg."""
    if strategy == 'single':
        return [m + cm]
    if strategy == 'bipolar':
        return [m + cm, None]
    if strategy == 'unipolar':
        return [m + cm, -m + cm]
    if strategy == 'hybrid':
        mm = m + cm
        return [np.where(mm >= 0, 2 * mm - 1, 2 * mm + 1), np.where(mm >= 0, -1.1, 1.1)]
    raise ValueError(strategy)


PHI = np.array([0.0, -2 * np.pi / 3, 2 * np.pi / 3])   # phases a, b, c


def three_phase_refs(strategy, M, k3, xs):
    """Pole references r_x = M sin(theta + phi_x) + z, z = zero-sequence (README table)."""
    th = 2 * np.pi * xs
    r = M * np.sin(th[None, :] + PHI[:, None])            # shape (3, n)
    if strategy == 'sixstep':
        return np.where(np.sin(th[None, :] + PHI[:, None]) >= 0, 1.1, -1.1)
    if strategy == 'spwm':
        z = np.zeros_like(th)
    elif strategy == 'thipwm':
        z = M * k3 * np.sin(3 * th)
    elif strategy == 'svpwm':
        z = -(r.max(axis=0) + r.min(axis=0)) / 2
    elif strategy == 'dpwmmax':
        z = 1 - r.max(axis=0)
    elif strategy == 'dpwmmin':
        z = -1 - r.min(axis=0)
    else:   # DPWM0/1/2: clamp the phase whose reference delayed by psi is largest in magnitude
        psi = {'dpwm0': -np.pi / 6, 'dpwm1': 0.0, 'dpwm2': np.pi / 6}[strategy]
        d = np.sin(th[None, :] + PHI[:, None] - psi)
        k = np.argmax(np.abs(d), axis=0)
        cols = np.arange(th.size)
        z = np.where(d[k, cols] >= 0, 1 - r[k, cols], -1 - r[k, cols])
    return r + z[None, :]


def commands(case, n):
    """Leg command states s_k (1 = upper switch commanded on) on the midpoint grid."""
    mf, Q = window(case['mf'])
    x = (np.arange(n) + 0.5) * (Q / n)          # cell midpoints: no ties with edges
    tau = np.mod(mf * x, 1.0)
    c = carrier(case['carrier'], tau)
    if case['sampling'] == 'natural':
        xs = x
    elif case['sampling'] == 'regular1':
        xs = np.floor(mf * x) / mf
    else:
        xs = np.floor(2 * mf * x) / (2 * mf)
    if case['topology'] == 'TP':
        R = three_phase_refs(case['strategy'], case['M'], case['k3'], xs)
        return [(R[k] > c).astype(float) for k in range(3)]
    m, cm = modulation(case['reference'], case['M'], case['k3'], xs)
    s = []
    for r in leg_refs(case['strategy'], m, cm):
        s.append(1.0 - s[0] if r is None else (r > c).astype(float))
    return s


def simulate(case, n):
    """Probe waveforms {id: v} on the midpoint grid (V_dc = 1)."""
    s = commands(case, n)
    if case['topology'] == 'TP':
        vO = [sk - 0.5 for sk in s]                      # pole voltages v_xO
        vn = (vO[0] + vO[1] + vO[2]) / 3                 # load neutral n wrt O
        return {'vab': vO[0] - vO[1], 'van': vO[0] - vn, 'vaO': vO[0], 'vcm': vn}
    if case['topology'] == 'HB':
        return {'vaO': s[0] - 0.5}
    return {'vab': s[0] - s[1], 'vcm': (s[0] + s[1]) / 2 - 0.5}


def spectrum(v, mf, Q, n):
    kmax = hmax(mf) * Q
    C = np.fft.rfft(v)[: kmax + 1] / n
    A = 2 * np.abs(C)
    A[0] = abs(C[0].real)
    tv = float(np.sum(np.abs(np.diff(np.append(v, v[0])))))
    return A, tv / n


def cases():
    """(case, probes) pairs; one simulation serves every listed probe."""
    topo = [('HB', 'single'), ('FB', 'bipolar'), ('FB', 'unipolar'), ('FB', 'hybrid')]
    refs = [('sine', 0.9), ('sine3', 0.8), ('dc', 0.4), ('sine', 1.2)]
    for t, st in topo:
        probes = ['vaO'] if t == 'HB' else ['vab']
        for car in ('triangle', 'saw-up', 'saw-down'):
            for smp in ('natural', 'regular1', 'regular2'):
                for ref, M in refs:
                    for mf in (3, 4.5, 21):
                        p = probes + (['vcm'] if t == 'FB' and ref == 'sine' and M == 0.9 else [])
                        yield dict(topology=t, strategy=st, carrier=car, sampling=smp,
                                   reference=ref, M=M, k3=1 / 6, mf=mf), p
                if st in ('single', 'unipolar'):   # long asynchronous window (Q = 10)
                    yield dict(topology=t, strategy=st, carrier=car, sampling=smp,
                               reference='sine', M=0.9, k3=1 / 6, mf=7.3), probes
    tp = ['spwm', 'thipwm', 'svpwm', 'dpwm0', 'dpwm1', 'dpwm2', 'dpwmmax', 'dpwmmin', 'sixstep']
    for st in tp:
        for car in ('triangle', 'saw-up'):
            for smp in ('natural', 'regular1', 'regular2'):
                for M in ((0.8,) if st == 'sixstep' else (0.8, 1.2)):
                    for mf in (9, 21):
                        yield dict(topology='TP', strategy=st, carrier=car, sampling=smp,
                                   reference='sine', M=M, k3=1 / 6, mf=mf), ['vab', 'van', 'vaO', 'vcm']


def main():
    out, t0 = [], time.time()
    for case, probes in cases():
        mf, Q = window(case['mf'])
        v = simulate(case, N)
        for p in probes:
            A, bound = spectrum(v[p], mf, Q, N)
            out.append(dict(case=dict(case, probe=p), bound=bound, A=[float(f'{a:.8g}') for a in A]))
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'bruteforce_ref.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* Generated by test/bruteforce.py — do not edit. Brute-force spectra\n'
                f' * (point-sampled comparator, N = {N} per window, FFT), V_dc = 1.\n'
                ' * bound = TV(v)/N, a rigorous bound on the brute-force amplitude error. */\n')
        f.write('(function (root) {\n  const REF = ')
        json.dump(out, f, separators=(',', ':'))
        f.write(';\n  if (typeof module !== "undefined" && module.exports) module.exports = REF;\n'
                '  else root.BRUTE_REF = REF;\n})(typeof self !== "undefined" ? self : this);\n')
    b = [o['bound'] for o in out]
    print(f'{len(out)} spectra in {time.time() - t0:.0f} s; '
          f'error bound median {np.median(b):.2e}, max {max(b):.2e}')


if __name__ == '__main__':
    main()
