/* ModulationToy — topology schematics as inline SVG (theme-aware via CSS classes).
 * Node and switch names match the plots: P/N rails, midpoint O, switch nodes a/b,
 * switches S_a± / S_b±, outputs v_aO / v_ab. */
(function (root) {
  'use strict';

  const sub = (base, s, x, y, cls = '', after = '') =>
    `<text x="${x}" y="${y}" class="${cls}">${base}<tspan dy="4" font-size="10">${s}</tspan>` +
    (after ? `<tspan dy="-4">${after}</tspan>` : '') + '</text>';
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" class="node"/>`;
  const wire = (pts) => `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="wire"/>`;

  // Switch in a vertical branch from y0 to y1 at x: contacts, an open blade, gate label.
  function sw(x, y0, y1, leg, sign) {
    const a = y0 + 18, b = y1 - 18;
    return `<g class="leg-${leg}">` +
      wire([[x, y0], [x, a]]) + wire([[x, b], [x, y1]]) +
      `<circle cx="${x}" cy="${a}" r="2.2" class="contact"/><circle cx="${x}" cy="${b}" r="2.2" class="contact"/>` +
      `<line x1="${x}" y1="${b}" x2="${x + 15}" y2="${a + 4}" class="blade"/>` +
      sub('S', leg + sign, x + 22, (a + b) / 2 + 4, 'swlabel') + '</g>';
  }
  function cap(x, y0, y1) {
    const m = (y0 + y1) / 2;
    return wire([[x, y0], [x, m - 5]]) + wire([[x, m + 5], [x, y1]]) +
      `<line x1="${x - 13}" y1="${m - 5}" x2="${x + 13}" y2="${m - 5}" class="plate"/>` +
      `<line x1="${x - 13}" y1="${m + 5}" x2="${x + 13}" y2="${m + 5}" class="plate"/>`;
  }
  function load(x0, x1, y) {
    const m = (x0 + x1) / 2;
    return wire([[x0, y], [m - 28, y]]) + wire([[m + 28, y], [x1, y]]) +
      `<rect x="${m - 28}" y="${y - 11}" width="56" height="22" rx="3" class="load"/>` +
      `<text x="${m}" y="${y + 4}" text-anchor="middle" class="small">load</text>`;
  }
  function polarity(xp, xm, y, label) {
    return `<text x="${xp}" y="${y}" text-anchor="middle" class="pol">+</text>` +
      `<text x="${xm}" y="${y}" text-anchor="middle" class="pol">−</text>` + label;
  }
  const rails = (x0, x1) =>
    wire([[x0, 30], [x1, 30]]) + wire([[x0, 220], [x1, 220]]) +
    `<text x="${x0 - 6}" y="34" text-anchor="end">P</text><text x="${x0 - 6}" y="224" text-anchor="end">N</text>`;

  function halfBridge() {
    const xc = 70, xl = 250, yo = 125;
    return `<svg viewBox="0 0 330 250" role="img" aria-label="Half-bridge schematic">` +
      rails(xc, xl) +
      cap(xc, 30, yo) + cap(xc, yo, 220) +
      sub('V', 'dc', 16, 82, 'small', '/2') + sub('V', 'dc', 16, 178, 'small', '/2') +
      sw(xl, 30, yo, 'a', '+') + sw(xl, yo, 220, 'a', '−') +
      load(xc, xl, yo) + dot(xc, yo) + dot(xl, yo) +
      `<text x="${xc - 8}" y="${yo - 8}" text-anchor="end">O</text>` +
      `<text x="${xl - 8}" y="${yo - 8}" text-anchor="end" class="leg-a-text">a</text>` +
      polarity(xl - 16, xc + 16, yo + 26, sub('v', 'aO', (xc + xl) / 2 - 12, yo + 30, 'out')) +
      `</svg>`;
  }

  function fullBridge() {
    const xs = 60, xa = 170, xb = 330, yo = 125;
    return `<svg viewBox="0 0 400 250" role="img" aria-label="Full-bridge schematic">` +
      rails(xs, xb) +
      // split DC bus: O is the reference of the common-mode voltage v_cm = (v_aO + v_bO)/2
      cap(xs, 30, yo) + cap(xs, yo, 220) + dot(xs, yo) +
      `<text x="${xs - 8}" y="${yo - 8}" text-anchor="end">O</text>` +
      sub('V', 'dc', 6, 82, 'small', '/2') + sub('V', 'dc', 6, 178, 'small', '/2') +
      sw(xa, 30, yo, 'a', '+') + sw(xa, yo, 220, 'a', '−') +
      sw(xb, 30, yo, 'b', '+') + sw(xb, yo, 220, 'b', '−') +
      load(xa, xb, yo) + dot(xa, yo) + dot(xb, yo) +
      `<text x="${xa - 8}" y="${yo - 8}" text-anchor="end" class="leg-a-text">a</text>` +
      `<text x="${xb - 8}" y="${yo - 8}" text-anchor="end" class="leg-b-text">b</text>` +
      polarity(xa + 16, xb - 16, yo + 26, sub('v', 'ab', (xa + xb) / 2 - 10, yo + 30, 'out')) +
      `</svg>`;
  }

  // Horizontal wire at y from x0 to x1, hopping over the vertical wires at xs.
  function hopWire(x0, x1, y, xs) {
    let d = `M${x0},${y}`;
    xs.forEach((x) => { d += ` H${x - 5} A5,5 0 0 1 ${x + 5},${y}`; });
    return `<path d="${d} H${x1}" class="wire"/>`;
  }

  function threePhase() {
    const xc = 60, X = { a: 160, b: 250, c: 340 }, tap = { a: 112, b: 125, c: 138 };
    const xr = 400, xl = 450, xn = 520, yn = 125, row = { a: 60, b: 125, c: 190 };
    let s = `<svg viewBox="0 0 560 250" role="img" aria-label="Three-phase bridge schematic">` +
      rails(xc, X.c) +
      cap(xc, 30, yn) + cap(xc, yn, 220) + dot(xc, yn) +
      `<text x="${xc - 8}" y="${yn - 8}" text-anchor="end">O</text>` +
      sub('V', 'dc', 6, 82, 'small', '/2') + sub('V', 'dc', 6, 178, 'small', '/2');
    ['a', 'b', 'c'].forEach((k) => {
      const x = X[k], later = ['a', 'b', 'c'].filter((j) => X[j] > x).map((j) => X[j]);
      s += sw(x, 30, 105, k, '+') + sw(x, 145, 220, k, '−') +
        `<g class="leg-${k}">` + wire([[x, 105], [x, 145]]) +
        hopWire(x, xr, tap[k], later) + wire([[xr, tap[k]], [xr, row[k]], [xl - 26, row[k]]]) + '</g>' +
        dot(x, tap[k]) + `<text x="${x - 8}" y="${tap[k] + 15}" text-anchor="end" class="leg-${k}-text">${k}</text>` +
        `<rect x="${xl - 26}" y="${row[k] - 11}" width="52" height="22" rx="3" class="load"/>` +
        wire([[xl + 26, row[k]], [xn - 20, row[k]], [xn, yn]]);
    });
    s += `<text x="${xl}" y="${row.b + 4}" text-anchor="middle" class="small">load</text>` +
      `<text x="${xl}" y="${row.a + 4}" text-anchor="middle" class="small">load</text>` +
      `<text x="${xl}" y="${row.c + 4}" text-anchor="middle" class="small">load</text>` +
      dot(xn, yn) + `<text x="${xn + 8}" y="${yn + 4}">n</text></svg>`;
    return s;
  }

  const api = {
    svg: (topology) => (topology === 'FB' ? fullBridge() : topology === 'TP' ? threePhase() : halfBridge()),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schematic = api;
})(typeof self !== 'undefined' ? self : this);
