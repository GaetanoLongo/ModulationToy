# PWM Modulation Toy

Standalone interactive explorer for carrier-based PWM of half, full and three-phase bridges.
It is not part of the OpenPE course notebooks and follows none of their symbol or
review conventions; it only lives in this repo for convenience.

Open `index.html` in a browser. No build step. Plotly comes from the CDN; the
rest is plain JS. Some browsers block scripts from `file://` pages, so serve the
folder if needed, e.g. `python -m http.server` from the repo root, then open
`http://localhost:8000/ModulationToy/`.

## What it shows

| Plot | Content |
|---|---|
| Carrier and references | the carrier and one reference per compared leg, as the comparator sees them (held staircase when regular-sampled) |
| Gate signals | upper (+) and lower (−) switch of every leg: the complementary commands, or with dead time the actual gates (every turn-on delayed by *t*_d) |
| Output | the selected output voltage (the "Output shown" box: line-to-line, phase, pole or common mode), its fundamental, and its moving average over one carrier period |
| Spectrum | harmonic amplitudes of that output against order *h* = *f*/*f*₁; V, % of fundamental, or dB |
| Load current (with a load connected) | the current of every load branch (i_a, i_b, i_c in three-phase) and the fundamental of i_a |
| Space vector (three-phase, optional) | a floating panel (drag its title bar, resize from the corner): the hexagon of switching states, the SPWM and SVPWM linear-limit circles, the commanded fundamental, and the path of the carrier-period average of *v*_αβ |

Layout: sidebar (a Preset panel, then the controls) | plots |
readings. The plot column fills the window height. Presets set *V*_dc = 400 V and *f*₁ = 50 Hz, because their notes quote numbers for those
values. Every symbol, control label and
reading with a dotted underline has hover text (tap on touch), drawn from `glossary.js`.
The icon next to Topology opens the schematic, with the rail, node and switch names used
in the plots.

The three time plots share one x axis: zooming any of them zooms all three.
They always open on one fundamental period, so the time scale does not change with
*m*_f. With non-integer *m*_f the analysis window spans *Q* periods, and you can zoom out to see
all of it. A zoom you set is kept while you change other controls, except *f*₁. The unit is
ms, or µs when *T*₁ < 1 ms.
The URL hash carries the whole setup, so every configuration is a shareable link.

## Architecture

```
settings
  → strategy        per leg: reference r(x) + carrier     (model.js)
  → sampler         natural | regular1 | regular2          (pwm.js)
  → comparator      exact crossings → edges { s0, toggles[] } per leg
  → probe algebra   v = offset + Σ coef_k · s_k  → piecewise-constant waveform
  → analysis        exact Fourier series, THD/WTHD, moving average
  → load            R–L–e per branch: exact current + current spectrum   (circuit.js)
  → dead time       (load + t_d > 0) gates delayed; diodes and zero-current clamping
                    decide the leg voltages; exact switched steady state (deadtime.js),
                    whose leg voltages then feed the same probe/analysis/load stages
```

| File | Role |
|---|---|
| `pwm.js` | core pipeline, no DOM, runs in Node and the browser |
| `model.js` | references, strategies, topologies, `compute(settings)` |
| `circuit.js` | the R–L–e load: exact periodic current and its spectrum |
| `deadtime.js` | dead time: gate timelines, event-driven exact switched simulation, periodic steady state |
| `presets.js` | guided presets, named [HB]/[FB]/[3P] + the parameter they highlight: partial settings + what to look for (`{id}` = glossary symbol) |
| `glossary.js` | every symbol shown in the UI and its hover text |
| `schematic.js` | half-bridge, full-bridge and three-phase schematics as inline SVG |
| `app.js` | state ↔ controls ↔ URL hash, Plotly rendering |
| `test/tests.js` | checks against closed forms and the brute-force reference (`test/index.html`, or `node test/tests.js`) |
| `test/bruteforce.py` | independent numpy reference (point-sampled comparator + FFT); regenerates `test/bruteforce_ref.js` (~8 min) |
| `test/bruteforce_deadtime.py` | independent fixed-step dead-time simulator (numba); regenerates `test/bruteforce_dt_ref.js` (~15 s) |

### Conventions

- **Time** is normalised to fundamental periods, *x* = *t*·*f*₁; *f*₁ only scales the axis.
- **Carrier and references** share the unit range [−1, 1]. A leg is ON (upper switch closed)
  while reference > carrier. *M* is the reference's fundamental amplitude in carrier units.
- **Carrier shapes** within one period τ ∈ [0, 1): triangle −1 → +1 → −1 (valley at τ = 0,
  centre-aligned); rising sawtooth −1 → +1 (trailing-edge); falling sawtooth +1 → −1
  (leading-edge). The carrier spec also carries `phase`, `scale` and `offset`, reserved for
  phase-shifted and level-shifted multi-carrier schemes.
- **Sampling**: *natural* compares the reference itself. *regular1* samples the reference
  at the start of each carrier period (the triangle valley) and holds it for the period
  (symmetric regular sampling). *regular2* samples at each half period (asymmetric).
- **Window**: *m*_f is quantised to 0.1, so the pattern repeats after *Q* ∈ {1, 2, 5, 10}
  fundamental periods. Spectrum bins sit at orders *k*/*Q*, so sub- and inter-harmonics
  of asynchronous PWM are exact, not leakage.

### Topologies = legs + probes

Each leg is a two-level switch node, *v*_k = *s*_k·*V*_dc from the negative rail. A
topology lists its legs and its output probes, as linear combinations of the leg states.

| Topology | Legs | Output probe |
|---|---|---|
| Half bridge | a | *v*_aO = *V*_dc·*s*_a − *V*_dc/2 (load to the DC midpoint O) |
| Full bridge | a, b | *v*_ab = *V*_dc·(*s*_a − *s*_b); common mode *v*_cm = *V*_dc·(*s*_a + *s*_b)/2 − *V*_dc/2 |
| Three-phase | a, b, c | *v*_ab = *V*_dc·(*s*_a − *s*_b); phase *v*_an = *V*_dc·(2*s*_a − *s*_b − *s*_c)/3; pole *v*_aO = *V*_dc·*s*_a − *V*_dc/2; common mode *v*_nO = *V*_dc·(*s*_a + *s*_b + *s*_c)/3 − *V*_dc/2 |

The three-phase load is star-connected with an isolated star point n. The space vector
uses the amplitude-invariant Clarke transform: *v*_α = *V*_dc·(2*s*_a − *s*_b − *s*_c)/3,
*v*_β = *V*_dc·(*s*_b − *s*_c)/√3. Common-mode voltages are referred to O, so they have zero
average; referred to N they shift by *V*_dc/2.

### Strategies

With *m*(*x*) the modulation function and *cm*(*x*) the common-mode injection (the 3rd
harmonic of "Sine + 3rd"):

| Strategy | Leg a | Leg b |
|---|---|---|
| single (half bridge) | *m* + *cm* vs carrier | — |
| bipolar | *m* + *cm* vs carrier | complement of a |
| unipolar | *m* + *cm* vs carrier | −*m* + *cm* vs the same carrier |
| hybrid | 2*m* − 1 (*m* ≥ 0) or 2*m* + 1 (*m* < 0) | −1.1 or +1.1 (saturated: switches at *f*₁) |

Note: an earlier design sketch had these the wrong way round. The correct pairing is that
−*m* against the *same* carrier gives unipolar, and the complement gives bipolar.

**Three-phase modulations.** Every one is *r*_x = *M* sin(θ + φ_x) + *z*, with φ = 0, −120°,
+120° for a, b, c, and the same zero-sequence *z* added to all three legs. It cancels in the
line-to-line and phase voltages:

| Modulation | *z* | Linear up to *M* = |
|---|---|---|
| SPWM (sinusoidal) | 0 | 1 |
| THIPWM (third-harmonic injection) | *k*₃·*M*·sin 3θ | 1.155 at *k*₃ = 1/6 |
| SVPWM (space vector, carrier-based form) | −(max + min)/2 | 2/√3 ≈ 1.155 |
| DPWM1 (discontinuous) | clamp the phase with the largest \|*r*\| to its rail: *z* = ±1 − *r*_k | 1.155 |
| DPWM0 / DPWM2 | as DPWM1, deciding on the references delayed by ψ = −30° / +30° (windows 30° earlier / later) | 1.155 |
| DPWMMAX / DPWMMIN | 1 − max / −1 − min | 1.155 |
| Six-step | none: each leg is on while its sine is positive | — (square wave) |

The DPWM names follow the common Hava–Kerkman–Lipo family; the tool defines them by the
windows stated above, which is what is implemented and tested.

### Load

Each load branch is R + L in series with a back-EMF *e* = *E* sin(θ + δ + φ_x): across
*v*_aO (half bridge), *v*_ab (full bridge), or *v*_an, *v*_bn, *v*_cn (three-phase star; the
phase voltages already include the neutral shift). With
*L* d*i*/d*t* + *R i* = *v* − *e*:

- **Time domain, exact:** *i* = *i*_v + *i*_e. Here *i*_e = −(*E*/|*Z*₁|) sin(θ + δ − ∠*Z*₁) is the
  sinusoidal steady state for −*e*, and *i*_v is the exponential response to the
  piecewise-constant *v*, segment by segment. The periodic steady state solves
  *i*(*Q*) = *i*(0), which is linear in *i*(0): no simulated start-up transient. With *R* = 0 the
  current is integrated and made zero-mean.
- **Spectrum, exact:** *I*_h = (*V*_h − *E*_h)/*Z*(*h*), *Z*(*h*) = *R* + j*h*ω₁*L*, from the exact voltage
  spectrum.
- **Readings:** *I*₁ and its lag φ₁ behind *V*₁; RMS; current THD (summed to *h*_max; the
  current lines fall as 1/*h*²); peak-to-peak ripple around DC + fundamental; total active
  power *P* = mean(*v·i*) summed over the branches (time domain, so DC power and ripple
  losses are included; negative when power flows back into the DC bus), and its
  fundamental share *P*₁ = Σ *V*₁*I*₁ cos φ₁/2. With a DC reference (buck leg) there is no
  fundamental: the DC current *I*₀ is shown instead of *I*₁, lag, THD and *P*₁.

### Dead time

Dead time needs the load, because the load current decides which diode conducts. Each
turn-on is delayed by *t*_d (a command pulse shorter than *t*_d never turns its switch on).
In every interval, each leg is in one of three states:

| Leg state | When | Node voltage *v*_kN |
|---|---|---|
| switch | its gate is on | *V*_dc (upper) or 0 (lower) |
| diode | both gates off, current ≠ 0 | 0 if the current flows out of the node (lower diode), *V*_dc if into it (upper diode) |
| floating | both gates off and the current has reached zero | whatever keeps the current at zero, while that lies between the rails (else the diode at that rail conducts) |

The floating-node voltages follow from the circuit:
- half bridge: *V*_dc/2 + *e*;
- full bridge, one leg floating: *v*_aN = *v*_bN + *e* (or *v*_bN = *v*_aN − *e*);
- three-phase, one leg floating: *v*_xN = (*v*_yN + *v*_zN)/2 + 1.5·*e*_x;
- three-phase, two floating: *v*_nN = *v*_zN − *e*_z and *v*_xN = *v*_nN + *e*_x.

Two cases leave the voltage undetermined and use an assumption. They affect only the
common-mode voltage:
- both full-bridge legs floating: an even split *V*_dc/2 ± *e*/2;
- all three legs floating: star point at *V*_dc/2.

Within an interval of fixed states the currents are exact (constant voltage plus
sinusoidal EMF into R–L). Current zero crossings and floating nodes reaching a rail are
events, located by bracketing and bisection. The periodic steady state is solved by Newton
iteration on the initial currents, with a finite-difference Jacobian and backtracking; it
typically converges in 1–2 iterations. While a current is clamped, the floating node
follows the back-EMF, so leg voltages can contain sinusoidal pieces. `pwm.js` handles
segments of the form *L* + *A* cos 2π*x* + *B* sin 2π*x* exactly (Fourier series, RMS,
moving average). *R* = 0 has no unique steady state with dead time, so it is raised to
0.1 % of ω₁*L* (the readings say so).

**Readings:**
- *ΔV*₁: the phasor difference of the fundamental with and without dead time, shown
  next to the classic estimate *n*·(4/π)·*V*_dc·*t*_d·*f*_c, where *n* = 1 leg for a pole or
  phase voltage, 2 for the full-bridge *v*_ab, and √3 for the three-phase *v*_ab;
- the fraction of the period with the current clamped at zero.

### Spectrum and metrics

The output is piecewise constant, so its Fourier coefficients follow exactly from its
jumps: *c*_k = 1/(j2π*k*) · Σ ΔL_i e^{−j2π*k* b_i/*Q*}. There is no FFT, no leakage and
no time-grid error. THD is computed from the exact waveform RMS,
√(*V*²_rms − *V*₀² − *V*₁²/2) / (*V*₁/√2), so it has no truncation. The readings show both the
**fundamental RMS** *V*₁/√2 (what textbook formulas give, e.g. √(3/2)·*M*·*V*_dc/2 line-to-line
for three-phase SPWM) and the **total RMS** of the PWM waveform (what a true-RMS meter
reads). For three-phase SPWM line-to-line the total is *V*_dc·√(√3·*M*/π), e.g. 445.6 V
against 367.4 V fundamental at *M* = 1, *V*_dc = 600 V; for any two-level output it is
*V*_dc/2 whatever *M*. WTHD sums
(*A*_h/*h*)² up to order max(40, 4.5·*m*_f).

## Verification (test/tests.js, 30 tests, all pass)

Two independent references are used.

**1. Brute force (all modes).** `test/bruteforce.py` rebuilds every waveform from the
definitions in this README, with no code shared with the JS. It point-samples the
comparator on 2²² points per window and takes an FFT. It produces 1,347 spectra:
- half and full bridge: 4 topology/strategy pairs × 3 carriers × 3 samplings ×
  {sine *M* = 0.9, sine+3rd *M* = 0.8, DC *M* = 0.4, overmodulated sine *M* = 1.2} ×
  *m*_f ∈ {3, 4.5, 21}, plus *m*_f = 7.3 (a 10-period window) and the full-bridge
  common-mode probe;
- three-phase: all 9 modulations × 2 carriers × 3 samplings × *M* ∈ {0.8, 1.2} ×
  *m*_f ∈ {9, 21}, each with all four probes.

Every bin up to the plotted *h*_max must agree within the brute force's rigorous error
bound, TV(*v*)/*N*. The largest disagreement is 1.0e-5·*V*_dc, and the worst case used 66 %
of its bound. Refining a worst case's grid 4× and 16× shrinks the gap from 5.8e-7 to
1.3e-7 to 1.3e-8, converging onto the JS values, so the residual is the brute force's own
discretisation.

**2. Closed forms (exact, to 1e-9).** These use the double-Fourier (Bessel) solution for a
half bridge with a sine reference, at *h* = *m*·*m*_f + *n*, with *q* = *m* + *n*/*m*_f and
peak amplitude *A*_mn of that line (half-bridge output ±*V*_dc/2):

| Carrier, sampling | *A*_mn |
|---|---|
| triangle, natural | (2*V*_dc/π*m*) · \|sin((*m*+*n*)π/2) J_n(*m*π*M*/2)\| |
| sawtooth (either), natural | (*V*_dc/π*m*) · \|J_n(*m*π*M*)\| for *n* ≠ 0; (*V*_dc/π*m*) · \|1 − (−1)^*m* J_0(*m*π*M*)\| for *n* = 0 |
| triangle, regular symmetric | (2*V*_dc/π*q*) · \|sin((*q*−*n*)π/2) J_n(*q*π*M*/2)\| |
| triangle, regular asymmetric | (2*V*_dc/π*q*) · \|sin((*m*+*n*)π/2) J_n(*q*π*M*/2)\| |

These were derived for this tool's conventions: sample at the triangle valley and hold
for the period, with the symmetric pulse centred half a period later. For the regular
forms, write the output as a train of pulses whose widths depend on the held samples,
expand each width with Jacobi–Anger, and sum over carrier periods (Poisson). Only
magnitudes are compared, so the reference phase (sin vs cos) does not matter. Textbook
statements differ in where they sample and centre the pulse, and that changes the sine
factor. In particular, symmetric regular sampling has **even** baseband harmonics
(sin((*q*−*n*)π/2) ≠ 0 for even *n*); asymmetric sampling has none. The test's Bessel routine
is itself checked against `scipy.special.jv`.

Tested at *m*_f = 101 (natural) and *m*_f = 21 (regular), so that neighbouring carrier groups
do not add onto the tested orders (overlap < 1e-12).

**Preset notes.** Every number and statement quoted in the preset notes is re-measured by
the "preset claims" test, with the preset's own settings and to the rounding the text
uses; a preset without a check fails the test.

**Identities and consistency checks:**

- A naturally sampled sine–triangle half bridge has fundamental exactly *M*·*V*_dc/2 and
  nothing else below the carrier.
- Parseval: the harmonic power converges to RMS², and the missing tail halves when *K* doubles.
- A bipolar full bridge is exactly 2 × the half-bridge output.
- A unipolar full bridge gives fundamental *M*·*V*_dc, cancels the whole group around
  *m*_f, and each leg switches 2*m*_f times per period.
- A DC reference gives mean *M*·*V*_dc/2 for every carrier × sampling combination.
- Common-mode 3rd harmonic: it cancels in the unipolar *v*_ab but appears in the half bridge.
- Overmodulation (*M* = 1.2): the fundamental is between 1 and *M* (in *V*_dc/2 units) and a 3rd harmonic appears.
- Three-phase SPWM: fundamentals of *v*_ab, *v*_an, *v*_aO are exactly (√3/2)*M·V*_dc, *M·V*_dc/2,
  *M·V*_dc/2; six-step *v*_ab is √3·(4/π)·*V*_dc/2.
- Three-phase, *m*_f a multiple of 3, every modulation: all triplen orders vanish in *v*_ab and
  *v*_an, and *v*_nO contains only triplen orders (the carrier repeats every *T*₁/3, so
  *v*_bO(*t*) = *v*_aO(*t* − *T*₁/3)).
- Linear ranges: SPWM overmodulates at *M* = 1.15; THIPWM, SVPWM and every DPWM stay
  within the carrier; the SVPWM reference peak is (√3/2)*M*.
- DPWM: 28 ± 3 switchings per leg per period at *m*_f = 21 (2/3 of 42). DPWMMAX never
  uses the zero vector 000, DPWMMIN never 111; six-step common mode is ±*V*_dc/6 only.
- The fundamental of *v*_α and *v*_β equals the phase-voltage fundamental.
- Full-bridge common mode: identically 0 for bipolar; levels {−*V*_dc/2, 0, +*V*_dc/2} for unipolar.
- Load current:
  - the time-domain solution equals the harmonic synthesis Σ(*V*_h − *E*_h)/*Z*(*h*), which
    converges onto it as 1/*K* (0.92 → 0.21 → 0.054 → 0.013 A for *K* = 95 … 6400);
  - *I*₁ = *V*₁/|*Z*| and φ₁ = atan(ω*L*/*R*) exactly without back-EMF;
  - energy balance mean(*v·i*) = *R*·mean(*i*²) + mean(*e·i*) to 2e-3, including back-EMF cases;
  - peak-to-peak ripple at *m*_f = 101 within 1 % of *V*_dc/(4*Lf*_c) (half bridge),
    *V*_dc/(2*Lf*_c) (bipolar) and *V*_dc/(8*Lf*_c) (unipolar);
  - total power *P* equals the energy balance *R*·Σ mean(*i*²) + Σ mean(*e·i*) to 2e-4, and the
    spectral sum to *h*_max to 1e-3, for a DC buck (with and without dead time), a half
    bridge, a full bridge with back-EMF and three-phase cases; the buck carries
    *V*₀²/*R* = 2 kW at DC with *P*₁ = 0;
  - *R* = 0: zero-mean current, 90° lag, no active power;
  - three-phase: *i*_a + *i*_b + *i*_c = 0;
  - back-EMF power flow reverses with the sign of δ.
- Dead time (independent reference: `test/bruteforce_deadtime.py`). A fixed-step time
  march with 2²⁰ steps per window applies the rules of the table above step by step, with
  gates from the independently generated commands, and repeats windows until the currents
  repeat. It covers 12 cases, including soft commutation, clamping in the full bridge
  (unipolar, hybrid) and in three-phase (with and without back-EMF), regular sampling
  with a sawtooth, and a two-period window. All 31 probe spectra agree within the brute
  force's bound 2·TV(*v*)/*N* (worst case 13 % of it); *I*₁ agrees to 1e-4; the clamped
  fraction agrees to 2e-5 of the period.
- Dead time *t*_d → 0 reproduces the ideal solution. At high current and *m*_f = 101 the loss
  of fundamental matches *n*·(4/π)·*V*_dc·*t*_d·*f*_c within 3 % (half bridge, full bridge,
  three-phase phase voltage).
- Soft commutation: with the current reversing in every carrier period (half bridge,
  light load, large ripple), dead time costs exactly nothing.

Observations behind the preset texts, measured at *M* = 0.8:

- At *m*_f = 21 the THD is 145.8 % for **every** two-level scheme (triangle, both
  sawtooths, bipolar). Any two-level waveform with the same fundamental has the same
  RMS, so THD cannot rank them. WTHD: bipolar 5.47 %, hybrid 3.06 %, unipolar 1.50 %.
- Unipolar with even vs odd *m*_f gives the same magnitudes, shifted. The *m*_f parity
  lesson belongs to the two-level case: even *m*_f puts the second group on even orders.
- Regular symmetric sampling at *m*_f = 9: the fundamental lags by 20° (half a carrier
  period), comes out 1.75 % low, and a 2nd harmonic appears. Asymmetric sampling lags 10°.
- In a full bridge, the common-mode 3rd harmonic raises one leg's reference peak to 1.17 *M*
  while lowering the other's. The linear range therefore *shrinks* to *M* ≈ 0.86; the
  1.155 gain exists only line-to-line in three-phase.
- Three-phase at *m*_f = 21, *M* = 0.8: WTHD of *v*_ab is 2.39 % (SPWM), 2.16 % (SVPWM),
  3.45 % (DPWM1, with 30 instead of 42 switchings per leg).
- DPWM with natural sampling: *z* jumps at every clamp-window edge. A jump that lands
  mid-slope on the carrier cuts a pulse short. At *m*_f = 21 the DPWM1 jumps fall on
  carrier peaks and valleys (harmless), but the DPWM0/2 jumps fall mid-slope: *V*₁ is 9 %
  off and 5th/7th harmonics appear. The error falls as 1/*m*_f, vanishes at *m*_f = 24 or 30
  (jumps back on the extremes), and vanishes with regular sampling. The brute force
  reproduces it, so it is physics of natural sampling, not a code artefact.

## Backlog

- Phase-shifted and level-shifted multi-carrier (multilevel) schemes, and a
  randomised carrier frequency.
