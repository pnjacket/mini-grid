// @vitest-environment jsdom
/**
 * `PERF-FRAME-STEADY` micro-benchmark (P5) — `renderGroupOutline` runs on every
 * refresh (incl. scroll-only). Pre-P5 it did `container.textContent = ''` then
 * `createElement` + ~7 `setAttribute` + `appendChild` per group EVERY frame; P5
 * reuses a persistent button per group id and only repositions it. Models both.
 */
import { bench, describe } from 'vitest';

const M = 20; // group toggles
const groups = Array.from({ length: M }, (_, i) => ({
  id: `g${i}`,
  level: i % 3,
  collapsed: i % 2 === 0,
}));

function build(btn: HTMLButtonElement, g: (typeof groups)[number]): void {
  btn.setAttribute('aria-expanded', String(!g.collapsed));
  btn.setAttribute('aria-label', g.collapsed ? 'expand' : 'collapse');
  btn.textContent = g.collapsed ? '+' : '-';
  btn.style.top = `${g.level * 14 + 2}px`;
}

describe('PERF-FRAME-STEADY · group outline per-frame render (P5)', () => {
  const c1 = document.createElement('div');
  bench('baseline (pre-P5) · teardown + recreate all', () => {
    c1.textContent = '';
    for (const g of groups) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mg-group-toggle';
      btn.setAttribute('data-mg-group-toggle', '');
      btn.setAttribute('data-group-id', g.id);
      btn.setAttribute('data-group-axis', 'row');
      build(btn, g);
      c1.appendChild(btn);
    }
  });

  const c2 = document.createElement('div');
  const nodes = new Map<string, HTMLButtonElement>();
  bench('production · reuse + reposition', () => {
    for (const g of groups) {
      let btn = nodes.get(g.id);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mg-group-toggle';
        btn.setAttribute('data-mg-group-toggle', '');
        btn.setAttribute('data-group-id', g.id);
        btn.setAttribute('data-group-axis', 'row');
        nodes.set(g.id, btn);
      }
      build(btn, g);
      if (!btn.parentNode) c2.appendChild(btn);
    }
  });
});
