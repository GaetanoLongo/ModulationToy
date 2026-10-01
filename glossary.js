/* ModulationToy — glossary: every symbol shown in the UI, with its hover text.
 * Text written as {id} is rendered as the symbol with its tooltip (see sym()). */
(function (root) {
  'use strict';
  const S = {
    M: ['<i>M</i>', 'Modulation index: amplitude of the reference\'s fundamental, in carrier units (the carrier spans ±1). Linear range: M ≤ 1. With a DC reference, M is the constant reference level.'],
    mf: ['<i>m</i><sub>f</sub>', 'Frequency ratio m<sub>f</sub> = f<sub>c</sub>/f<sub>1</sub>: carrier periods per fundamental period.'],
    fc: ['<i>f</i><sub>c</sub>', 'Carrier frequency: each compared leg switches on and off once per carrier period, so f<sub>c</sub> is the switching frequency of a PWM leg.'],
    f1: ['<i>f</i><sub>1</sub>', 'Fundamental frequency: frequency of the reference and of the wanted output component. It only scales the time axis.'],
    T1: ['<i>T</i><sub>1</sub>', 'Fundamental period, T<sub>1</sub> = 1/f<sub>1</sub>.'],
    Tc: ['<i>T</i><sub>c</sub>', 'Carrier period, T<sub>c</sub> = 1/f<sub>c</sub>.'],
    Vdc: ['<i>V</i><sub>dc</sub>', 'DC-bus voltage between the positive rail P and the negative rail N.'],
    k3: ['<i>k</i><sub>3</sub>', 'Third-harmonic injection ratio: m(θ) = M(sin θ + k<sub>3</sub> sin 3θ). k<sub>3</sub> = 1/6 minimises the peak of the reference (to √3/2 · M).'],
    h: ['<i>h</i>', 'Harmonic order, h = f/f<sub>1</sub>. Non-integer orders appear when m<sub>f</sub> is not an integer.'],
    d: ['<i>d</i>', 'Duty cycle of leg a: fraction of the carrier period with the upper switch S<sub>a+</sub> on. With a DC reference, d = (1 + M)/2.'],
    V1: ['<i>V</i><sub>1</sub>', 'Peak amplitude of the fundamental (h = 1) of the output voltage, from its exact Fourier series.'],
    V0: ['<i>V</i><sub>0</sub>', 'DC component (average over the window) of the output voltage.'],
    THD: ['THD', 'Total harmonic distortion of the output voltage: RMS of everything except the fundamental and DC, divided by the RMS of the fundamental. Exact (from the waveform RMS, no truncation). Every two-level waveform with the same V<sub>1</sub> has the same THD.'],
    WTHD: ['WTHD', 'Weighted THD: each harmonic divided by its order h before summing, √Σ(V<sub>h</sub>/h)² / V<sub>1</sub>. Into an inductive load the current harmonic is V<sub>h</sub>/(hω<sub>1</sub>L), so WTHD tracks the current distortion.'],
    vaO: ['<i>v</i><sub>aO</sub>', 'Half-bridge output: voltage of switch node a with respect to the DC-bus midpoint O. Two levels, ±V<sub>dc</sub>/2.'],
    vab: ['<i>v</i><sub>ab</sub>', 'Full-bridge output: voltage of node a with respect to node b. Up to three levels: +V<sub>dc</sub>, 0, −V<sub>dc</sub>.'],
    ra: ['<i>r</i><sub>a</sub>', 'Reference of leg a, compared with the carrier: S<sub>a+</sub> is on while r<sub>a</sub> > carrier.'],
    rb: ['<i>r</i><sub>b</sub>', 'Reference of leg b, compared with the carrier: S<sub>b+</sub> is on while r<sub>b</sub> > carrier.'],
    Sa: ['<i>S</i><sub>a±</sub>', 'Upper (+) and lower (−) switch of leg a. They are driven complementarily: exactly one is on.'],
    Sb: ['<i>S</i><sub>b±</sub>', 'Upper (+) and lower (−) switch of leg b. They are driven complementarily: exactly one is on.'],
    O: ['O', 'Midpoint of the DC bus, at V<sub>dc</sub>/2 above the negative rail N (the junction of two equal capacitors). It is the reference for the pole voltages v<sub>aO</sub> and for the common-mode voltage. If the bus has a single capacitor, O is a virtual point; referring to N instead only shifts those voltages by V<sub>dc</sub>/2 (DC).'],
    // three-phase and common mode
    van: ['<i>v</i><sub>an</sub>', 'Phase voltage: node a with respect to the load star point n, i.e. the voltage across phase a of the load. Five levels: 0, ±V<sub>dc</sub>/3, ±2V<sub>dc</sub>/3.'],
    vnO: ['<i>v</i><sub>nO</sub>', 'Common-mode voltage of the three-phase bridge: load star point n with respect to the DC midpoint O, = (v<sub>aO</sub> + v<sub>bO</sub> + v<sub>cO</sub>)/3. Levels ±V<sub>dc</sub>/6 and ±V<sub>dc</sub>/2 (the zero vectors 111 and 000). It drives currents through stray capacitances to ground (bearing currents, EMI).'],
    vcm: ['<i>v</i><sub>cm</sub>', 'Common-mode voltage of the full bridge: average of the two switch nodes with respect to the DC midpoint O (see the schematic), = (v<sub>aO</sub> + v<sub>bO</sub>)/2 = (v<sub>aN</sub> + v<sub>bN</sub>)/2 − V<sub>dc</sub>/2. It does not reach a floating load, but it drives leakage current through stray capacitance to ground (e.g. PV panels).'],
    n: ['n', 'Star point (neutral) of the three-phase load; not connected to the DC bus.'],
    Sc: ['<i>S</i><sub>c±</sub>', 'Upper (+) and lower (−) switch of leg c. They are driven complementarily: exactly one is on.'],
    rc: ['<i>r</i><sub>c</sub>', 'Reference of leg c, compared with the carrier: S<sub>c+</sub> is on while r<sub>c</sub> > carrier.'],
    z: ['<i>z</i>', 'Zero-sequence (common-mode) signal added to all three references. It changes every pole voltage but cancels in the line-to-line and phase voltages; choosing z is what distinguishes SPWM, THIPWM, SVPWM and the DPWM family.'],
    SPWM: ['SPWM', 'Sinusoidal PWM: plain sine references, nothing added (z = 0). Linear up to M = 1.'],
    THIPWM: ['THIPWM', 'Third-harmonic injection PWM: z = k<sub>3</sub>·M·sin 3θ. With k<sub>3</sub> = 1/6 the linear range extends to M = 2/√3 ≈ 1.155.'],
    SVPWM: ['SVPWM', 'Space-vector PWM. Treats the three leg states as one voltage vector (8 states: 6 active, 2 zero). Its carrier-based form adds z = −(max + min)/2, which shares each carrier period equally between the zero vectors 000 and 111. Linear up to M ≈ 1.155.'],
    DPWM: ['DPWM', 'Discontinuous PWM: z clamps one phase at a time to a DC rail, so each leg stops switching for 120° of every period (one third fewer switchings). DPWM1: 60° windows centred on the reference peaks; DPWM0/DPWM2: windows 30° earlier/later; DPWMMAX/DPWMMIN: always the positive/negative rail.'],
    R: ['<i>R</i>', 'Load resistance per phase.'],
    L: ['<i>L</i>', 'Load inductance per phase. It filters the switched voltage: the current ripple scales with 1/(L f<sub>c</sub>).'],
    E: ['<i>E</i>', 'Amplitude of the sinusoidal back-EMF in series with each phase (a motor\'s induced voltage, or the grid). 0 = plain R–L load.'],
    delta: ['<i>δ</i>', 'Phase of the back-EMF relative to the reference fundamental: e = E sin(θ + δ). With E close to the converter voltage, δ < 0 (EMF lagging) makes power flow into the EMF, as in a grid-tied inverter.'],
    i: ['<i>i</i>', 'Load current (phase a in three-phase), from L di/dt + R i = v − e with v the voltage across the load branch.'],
    I1: ['<i>I</i><sub>1</sub>', 'Peak amplitude of the fundamental of the load current.'],
    phi: ['<i>φ</i><sub>1</sub>', 'Lag of the fundamental current behind the fundamental of the voltage across the load branch (positive = current lags). Without back-EMF it equals the impedance angle atan(ωL/R).'],
    ripple: ['Δ<i>i</i><sub>pp</sub>', 'Largest peak-to-peak deviation of the current from its DC + fundamental over the window: the switching ripple (plus any low-order distortion).'],
    P: ['<i>P</i>', 'Total active power delivered to the load, mean(v·i) summed over the load branches: DC, fundamental and every harmonic, P = V<sub>0</sub>I<sub>0</sub> + Σ ½V<sub>h</sub>I<sub>h</sub> cos φ<sub>h</sub>. With ideal switches this is also the power drawn from the DC bus. Negative: power flows from the back-EMF into the DC bus. With a DC reference (buck leg) almost all of it is the DC term V<sub>0</sub>I<sub>0</sub>.'],
    P1: ['<i>P</i><sub>1</sub>', 'The share of P carried by the fundamental, V<sub>1</sub>·I<sub>1</sub>·cos φ<sub>1</sub>/2 per load branch, summed over the branches. The rest is DC power and power in the switching harmonics (ripple losses in R).'],
    td: ['<i>t</i><sub>d</sub>', 'Dead time: every turn-on is delayed by t<sub>d</sub> so the two switches of a leg are never on together. During it both are off and the load current picks a diode: current out of the node → lower diode (v = 0), into the node → upper diode (v = V<sub>dc</sub>). A current that reaches zero stays there until the next turn-on (zero-current clamping).'],
    dV1: ['Δ<i>V</i><sub>1</sub>', 'Dead-time error of the fundamental: magnitude of the phasor difference between the fundamental with and without dead time. Classic estimate at high current: (4/π)·V<sub>dc</sub>·t<sub>d</sub>·f<sub>c</sub> per leg (the average error is a square wave of height V<sub>dc</sub>·t<sub>d</sub>·f<sub>c</sub> that follows the sign of the current).'],
    clamp: ['clamped', 'Fraction of the period during which the phase-a current sits at zero because it reached zero during a dead time (both switches off, both diodes blocking).'],
    alphabeta: ['<i>v</i><sub>αβ</sub>', 'Space vector: v<sub>α</sub> + j v<sub>β</sub> = (2/3)(v<sub>a</sub> + a v<sub>b</sub> + a² v<sub>c</sub>), a = e<sup>j120°</sup> (amplitude-invariant Clarke transform). The six active states sit on a hexagon of radius 2V<sub>dc</sub>/3.'],
  };

  function sym(id, inner) {
    const e = S[id];
    if (!e) return inner || id;
    return `<span class="sym" tabindex="0" data-tip="${e[1].replace(/"/g, '&quot;')}">${inner || e[0]}</span>`;
  }
  // Replace {id} tokens with hoverable symbols.
  function render(text) { return text.replace(/\{(\w+)\}/g, (m, id) => (S[id] ? sym(id) : m)); }
  // A formula or result with its own explanation.
  function tip(html, text) { return `<span class="sym" tabindex="0" data-tip="${text.replace(/"/g, '&quot;')}">${html}</span>`; }

  const api = { S, sym, render, tip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Glossary = api;
})(typeof self !== 'undefined' ? self : this);
