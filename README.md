# PWM Modulation Toy

An interactive browser tool for exploring carrier-based PWM in half-bridge, full-bridge
and three-phase inverters.

**Open it here: <https://gaetanolongo.github.io/ModulationToy/>**

<!-- Screenshot: save one as docs/screenshot.png and uncomment the next line.
![PWM Modulation Toy](docs/screenshot.png)
-->

Pick a topology and a modulation, move the sliders, and everything follows as you drag:
the carrier and the references, the gate signals, the output voltage, its harmonic
spectrum and, if you connect a load, the load current.

It is not a circuit simulator and doesn't try to be one. The switches are ideal, there is
nothing to set up and nothing to converge. The idea is to play with it, notice something
odd, and then go and work out why it happens. It is meant for students who would rather
not draw PWM waveforms by hand, and for anyone who teaches the subject and needs figures.

## What you can explore

| | |
|---|---|
| **Topologies** | half bridge, full bridge, three-phase bridge (star load) |
| **Full-bridge strategies** | bipolar, unipolar, hybrid (one leg switching at the fundamental) |
| **Three-phase modulations** | SPWM, third-harmonic injection, SVPWM, DPWM0/1/2, DPWMMAX/MIN, six-step |
| **Carrier** | triangle (centre-aligned), rising or falling sawtooth (trailing/leading edge) |
| **Sampling** | natural, regular symmetric (1 sample per carrier period), regular asymmetric (2 samples) |
| **Reference** | sine, sine + 3rd harmonic, DC (turns a leg into a DC-DC switch node) |
| **Outputs** | line-to-line, phase, pole and common-mode voltage; harmonic spectrum in V, % or dB; THD and WTHD |
| **Load** (optional) | series R–L with a sinusoidal back-EMF; load current, its spectrum, ripple and power |
| **Dead time** (optional) | delayed turn-on with diode conduction and zero-current clamping |
| **Space vector** (three-phase) | a floating panel with the switching-state hexagon and the averaged voltage vector |

## How to use it

- **Presets.** The menu at the top left loads ready-made setups, each with a short note on
  what to look for. They are named after what they show: `[HB]`, `[FB]` or `[3P]`, then the
  parameter in focus.
- **Hover.** Every dotted-underlined symbol, label and reading explains itself when you hover
  over it (tap on touch screens). The icon next to *Topology* opens the schematic with the
  node and switch names used in the plots.
- **Zoom.** The three time plots share one time axis, so zooming one zooms all three. Drag a
  box to zoom both axes; double-click to reset.
- **Export.** Hover over any plot and use its toolbar: the camera saves a PNG at 2× resolution,
  and the clipboard icon copies the image, ready to paste into slides. Copying needs the
  online version (or `localhost`); opened from disk, the button downloads the image instead.
- **Share.** The whole setup lives in the page address, so a copied link reopens exactly what
  you are looking at.

## A few things to try

- Why does the unipolar full bridge have a quarter of the current ripple of the bipolar one at
  the same switching frequency? (preset *[FB] Load: unipolar vs bipolar ripple*)
- Why does third-harmonic injection give 15 % more voltage in a three-phase inverter
  (*[3P] Modulation: 3rd-harmonic injection*) but make things worse in a full bridge? Set
  *Reference* to *Sine + 3rd harmonic* on a unipolar full bridge and watch the reference peak.
- What happens to the spectrum when you push the modulation index past 1?
  (*[HB] Modulation index: overmodulation*)
- Why does switching faster leave the voltage THD exactly where it is, while the current THD
  keeps falling? Connect a load and move the frequency ratio.
- Where does the harmonic at the switching frequency go in a three-phase inverter? Compare
  the line-to-line and the common-mode output (*[3P] Modulation: SPWM*).

## How it computes

Everything is computed exactly rather than simulated with a time step:

- **Switching instants** are the exact crossings of each reference with the carrier.
- **Spectra** are exact Fourier series of the resulting piecewise waveforms: no FFT, no
  leakage, no time-grid error. A non-integer frequency ratio is handled by analysing the
  exact number of fundamental periods after which the pattern repeats.
- **Load currents** are the exact periodic steady state of the R–L–e load, with no start-up
  transient; the current spectrum is (V<sub>h</sub> − E<sub>h</sub>)/Z(h).
- **Dead time** is an event-driven switched solution: during a dead time the load current
  decides which diode conducts, and a current that reaches zero stays clamped while the
  floating node remains between the rails. The steady state is found by Newton iteration.

**Assumptions:** ideal switches and diodes (no voltage drops, no switching transients), a
stiff DC bus, a linear R–L–e load. Where the circuit leaves a voltage undetermined (both
full-bridge legs, or all three legs, floating at once during dead time), the common-mode
voltage assumes an even split around the DC midpoint.

## Verification

The `test/` folder runs in the browser: open `test/index.html`, or
<https://gaetanolongo.github.io/ModulationToy/test/>. All 30 tests should pass. They compare
the tool against:

- **closed-form double-Fourier (Bessel) spectra** for natural, sawtooth and regular
  sampling, to 1e-9;
- **independent brute-force references** written separately in Python: a point-sampled
  comparator with an FFT (1,347 spectra across every topology, modulation, carrier and
  sampling mode), and a fixed-step dead-time simulator (12 cases, including zero-current
  clamping);
- **physical identities:** energy balance, ripple formulas, triplen cancellation, linear
  modulation limits, dead-time loss of fundamental;
- **every number quoted in the preset notes**, re-measured with each preset's own settings.

To regenerate the brute-force references (Python with numpy; numba for the dead-time one):

```bash
python test/bruteforce.py
```

```bash
python test/bruteforce_deadtime.py
```

## Run it locally

No build step and no installation: it is plain HTML and JavaScript, with Plotly loaded from
its CDN. Some browsers block scripts on pages opened straight from disk, so serve the folder:

```bash
python -m http.server 8000
```

and open <http://localhost:8000/>.

| File | Role |
|---|---|
| `index.html`, `style.css`, `app.js` | page, layout, controls and plots |
| `pwm.js` | carriers, sampling, comparator, exact Fourier series |
| `model.js` | references, strategies, topologies, outputs |
| `circuit.js` | R–L–e load: exact currents and power |
| `deadtime.js` | dead-time switched simulation |
| `presets.js`, `glossary.js`, `schematic.js` | presets, hover texts, schematics |
| `test/` | browser test suite and the Python brute-force references |

## Feedback

Found something odd, wrong, or confusing? Please open an issue. Questions from students are
especially welcome: if a preset note or a hover text didn't help, that is worth fixing.
