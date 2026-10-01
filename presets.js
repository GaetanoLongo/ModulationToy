/* ModulationToy — presets. Each is a partial settings object plus what to
 * look for; {id} tokens render as glossary symbols with hover text (glossary.js).
 * Every number and claim in `look` is checked by the "preset claims" test in test/tests.js. */
(function (root) {
  'use strict';
  const BASE = { topology: 'HB', strategy: 'bipolar', carrier: 'triangle', sampling: 'natural',
    reference: 'sine', M: 0.8, k3: 1 / 6, mf: 21, probe: '', load: false, R: 5, Lmh: 10, E: 0, delta: 0, tdus: 0,
    Vdc: 400, f1: 50 };          // the notes quote numbers for these values, so every preset sets them

  const PRESETS = [
    { id: 'spwm', name: '[HB] Sine PWM: baseline', set: {},
      look: 'The fundamental is exactly {V1} = {M}·{Vdc}/2 = 160 V, and nothing else appears until the sideband group around {mf} (the first line above 1 V is at {h} = 17). Further groups sit around 2{mf} and 3{mf}. With {mf} odd, no even order appears at all.' },
    { id: 'saw', name: '[HB] Carrier: sawtooth', set: { carrier: 'saw-up' },
      look: 'Single-edge (trailing-edge) modulation: around {mf} the sidebands now fall on even as well as odd orders (20 and 22 next to 19 and 23). {THD} is still 145.8 %, exactly as with the triangle: any two-level waveform with the same fundamental has the same RMS, so {THD} cannot rank two-level schemes.' },
    { id: 'regular', name: '[HB] Sampling: regular, low frequency ratio', set: { mf: 9, sampling: 'regular1' },
      look: 'The reference is sampled once per carrier period and held: the fundamental lags by half a carrier period (20° at {mf} = 9), comes out 1.8 % short of {M}·{Vdc}/2, and a 2nd harmonic of 3.8 V appears. With two samples per period (regular asymmetric) the lag halves to 10° and every even order disappears.' },
    { id: 'overmod', name: '[HB] Modulation index: overmodulation', set: { M: 1.2 },
      look: 'At {M} = 1.2 the reference exceeds the carrier peak, so pulses are dropped: 26 switchings per period instead of 42. {V1} reaches 221 V instead of {M}·{Vdc}/2 = 240 V, and harmonics appear below the carrier: 3rd 14 V, 5th 7.2 V, 7th 1.4 V.' },
    { id: 'async', name: '[HB] Frequency ratio: non-integer', set: { mf: 4.5 },
      look: '{mf} = 4.5 is not an integer, so the pattern repeats only every 2 fundamental periods and sidebands land on non-integer orders {h}, including a sub-harmonic at 0.5·{f1} (1.5 V, −40 dB: switch the spectrum to dB to see it). The time plots open on one fundamental period: zoom out, or use Autoscale in the plot toolbar, to see the whole 2-period window.' },
    { id: 'dc', name: '[HB] Reference: DC (buck leg)', set: { reference: 'dc', M: 0.5, mf: 10 },
      look: 'A constant reference turns the leg into a DC–DC switch node with duty {d} = (1 + {M})/2. The output is DC plus harmonics at multiples of {mf} only; {f1} now just sets the window.' },
    { id: 'hb-load', name: '[HB] Load: current ripple', set: { load: true },
      look: 'The load current is the output voltage filtered by {L}. Its ripple is largest where the reference crosses zero (duty 0.5), where theory gives {ripple} = {Vdc}/(4·{L}·{fc}) = 9.5 A. The tool measures 9.6 A: the formula assumes the duty is constant within a carrier period, and here the reference still moves noticeably during one (at {mf} = 100 the two agree within 0.4 %). The current THD, 10.3 %, is 14 times smaller than the voltage THD.' },
    { id: 'hb-dt', name: '[HB] Dead time: lost volts, low-order harmonics', set: { load: true, mf: 100, tdus: 5 },
      look: 'At {fc} ≈ 5 kHz a 5 µs dead time is 2.5 % of every carrier period. While the current flows out of the leg, the delayed turn-on of the upper switch leaves the lower diode conducting, so the leg loses {Vdc}·{td} per period with the sign of the current. {V1} drops from 160 to 149 V ({dV1} = 12.7 V, as the estimate (4/π)·{Vdc}·{td}·{fc} = 12.7 V) and 3rd, 5th, 7th harmonics appear (4.2, 2.5, 1.8 V). Set {td} = 0 to compare.' },
    { id: 'bipolar', name: '[FB] Strategy: bipolar', set: { topology: 'FB', strategy: 'bipolar' },
      look: 'Leg b is the complement of leg a, so {vab} = 2{vaO}: two levels (±{Vdc}), the half-bridge spectrum at twice the amplitude.' },
    { id: 'unipolar', name: '[FB] Strategy: unipolar', set: { topology: 'FB', strategy: 'unipolar' },
      look: 'Three levels. The whole group around {mf} cancels; the first harmonics sit around 2{mf}, strongest at 2{mf} ± 1 (41 and 43, 126 V each), so the output ripple is at twice the rate each leg switches. {WTHD} drops from 5.47 % (bipolar) to 1.50 %.' },
    { id: 'hybrid', name: '[FB] Strategy: hybrid', set: { topology: 'FB', strategy: 'hybrid' },
      look: 'Leg b switches only twice per fundamental period; leg a carries all the PWM. Same fundamental (320 V) and three levels as unipolar, but the group around {mf} is back (184 V at {h} = 21).' },
    { id: 'fb-load', name: '[FB] Load: unipolar vs bipolar ripple', set: { topology: 'FB', strategy: 'unipolar', load: true },
      look: 'Same fundamental current as bipolar, but a 4 times smaller ripple: {Vdc}/(8·{L}·{fc}) = 4.8 A, against {Vdc}/(2·{L}·{fc}) = 19 A for bipolar (switch the strategy to compare). The output steps are half as tall and come twice as often.' },
    { id: 'fb-grid', name: '[FB] Load: back-EMF (grid-tie)', set: { topology: 'FB', strategy: 'unipolar', load: true, R: 0.1, Lmh: 5, E: 300, delta: -15 },
      look: 'A back-EMF of 300 V, close to {V1} = 320 V, takes most of the voltage; the current is set by the small difference across {L}. With the EMF lagging ({delta} = −15°), 8 kW flow into it; set {delta} = +15° and the power reverses (−7.7 kW, back into the DC bus). This is how a grid-tied inverter steers power with the phase of its voltage.' },
    { id: 'cm-fb', name: '[FB] Output: common-mode voltage', set: { topology: 'FB', strategy: 'unipolar', probe: 'vcm' },
      look: '{vcm} = ({vaO} + v<sub>bO</sub>)/2 is the average of the two switch nodes, measured from the DC-bus midpoint {O} (open the schematic). Unipolar: {vcm} jumps between −{Vdc}/2, 0 and +{Vdc}/2 as both legs switch. It does not reach the load, but through stray capacitance to ground it drives leakage current (the problem of transformerless PV inverters). Switch the strategy to bipolar: {vcm} stays at 0.' },
    { id: 'tp-spwm', name: '[3P] Modulation: SPWM', set: { topology: 'TP', strategy: 'spwm' },
      look: 'Line-to-line {vab} has fundamental √3/2·{M}·{Vdc} = 277 V and three levels. The tallest line of every pole voltage, the one at {fc} itself (164 V), comes from the carrier, which all three legs share: it is identical in a, b and c, so it cancels line-to-line for any {mf} (try 22), while its sidebands at 19 and 23 remain. Switch the output to Pole (a–O) to see it, and to Common mode (n–O) to see where it went.' },
    { id: 'tp-thi', name: '[3P] Modulation: 3rd-harmonic injection', set: { topology: 'TP', strategy: 'thipwm', M: 1.1 },
      look: 'At {M} = 1.1 plain {SPWM} would overmodulate (reference peak 1.1); with {k3} = 1/6 the peak is only 0.95. The 3rd harmonic is in every pole voltage (36.7 V: switch the output to Pole (a–O)) but cancels in {vab} and {van}.' },
    { id: 'tp-svpwm', name: '[3P] Modulation: SVPWM at the linear limit', set: { topology: 'TP', strategy: 'svpwm', M: 1.15 },
      look: 'The dashed zero-sequence {z} = −(max + min)/2 flattens the references: at {M} = 1.15 their peak is 0.996, just inside the carrier (the limit is 2/√3 ≈ 1.155). Turn on the space-vector view: the averaged vector follows the circle inscribed in the hexagon (radius {Vdc}/√3 = 231 V) to within a few percent.' },
    { id: 'tp-dpwm1', name: '[3P] Modulation: DPWM1', set: { topology: 'TP', strategy: 'dpwm1' },
      look: 'Each leg rests at a rail twice per period, for the 60° around each peak of its reference (the flat stretches in the gate plot look about 66° long because the full-width pulses next to them merge in): 30 switchings per leg instead of 42. Same fundamental, but at the same carrier frequency {WTHD} rises from 2.39 % ({SPWM}) to 3.45 %.' },
    { id: 'tp-dpwm-jump', name: '[3P] Sampling: DPWM2 with natural sampling', set: { topology: 'TP', strategy: 'dpwm2' },
      look: 'The references of DPWM2 jump at the edges of its clamp windows. At {mf} = 21 the jumps land mid-slope on the carrier, where natural sampling cuts pulses short: {V1} comes out 9.4 % high and about 28 V each of 5th and 7th appear in {vab}. With regular asymmetric sampling (as a digital PWM does) {V1} is back within 0.1 % and the 5th and 7th fall to 7–9 V; with {mf} = 24 the jumps land on carrier peaks and valleys instead, and the 5th and 7th fall below 1 V.' },
    { id: 'tp-load', name: '[3P] Load: current distortion by modulation', set: { topology: 'TP', strategy: 'spwm', load: true },
      look: 'At the same {fc} the current THD is 4.5 % with {SPWM}, 4.1 % with {SVPWM} and 6.5 % with DPWM1, which however switches each leg 30 instead of 42 times per period. Switch the modulation and watch the THD of {i} and the ripple.' },
    { id: 'tp-dt', name: '[3P] Dead time: 5th and 7th harmonics', set: { topology: 'TP', strategy: 'spwm', load: true, mf: 100, tdus: 5, probe: 'van' },
      look: 'Each phase loses about (4/π)·{Vdc}·{td}·{fc} = 12.7 V of fundamental (measured {dV1} = 12.6 V on {van}). The error voltage is a square wave that follows each phase current, so it adds 5th and 7th harmonics (2.6 and 1.8 V) that the star connection cannot cancel; only the triplens cancel. Switch the spectrum to the load current in dB.' },
    { id: 'tp-cm', name: '[3P] Output: common-mode voltage', set: { topology: 'TP', strategy: 'spwm', probe: 'vcm' },
      look: '{vnO} steps between ±{Vdc}/6 and ±{Vdc}/2; ±{Vdc}/2 are the zero vectors (all legs up, or all down). Its spectrum holds exactly what cancels line-to-line: the carrier line at {fc} (164 V) and the sidebands a multiple of 3 orders away from it; with {mf} = 21 these all fall on multiples of 3. Try DPWMMAX, which never reaches −{Vdc}/2, and six-step, which stays at ±{Vdc}/6.' },
    { id: 'tp-six', name: '[3P] Modulation: six-step', set: { topology: 'TP', strategy: 'sixstep' },
      look: 'Square-wave poles: the largest possible fundamental, (4/π)·{Vdc}/2 per pole (27 % above {SPWM} at {M} = 1), with only 2 switchings per leg per period. The price: 5th, 7th, 11th, 13th … harmonics (orders 6k ± 1) in {vab}.' },
  ];

  const api = { BASE, PRESETS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Presets = api;
})(typeof self !== 'undefined' ? self : this);
