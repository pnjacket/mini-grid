// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';

import { Announcer } from './announcer.js';

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('A11Y-GRID Announcer (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates two visually-hidden live regions (polite + assertive), not focusable, not aria-hidden', () => {
    const el = container();
    const a = new Announcer(el);
    const polite = el.querySelector('[data-mg-live="polite"]') as HTMLElement;
    const assertive = el.querySelector('[data-mg-live="assertive"]') as HTMLElement;
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    expect(polite.getAttribute('aria-atomic')).toBe('true');
    // Never aria-hidden (assistive tech must read it) and never focusable.
    expect(polite.hasAttribute('aria-hidden')).toBe(false);
    expect(polite.hasAttribute('tabindex')).toBe(false);
    a.destroy();
    expect(el.querySelector('[data-mg-live]')).toBeNull();
  });

  it('announce() writes to the polite region WITHOUT moving focus', () => {
    const el = container();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);

    let pending: (() => void) | undefined;
    const a = new Announcer(el, { schedule: (cb) => (pending = cb) });
    a.announce('Sorted by Price descending, 1000 rows');
    pending?.();

    expect(a.politeText()).toBe('Sorted by Price descending, 1000 rows');
    // Focus never moved to the live region.
    expect(document.activeElement).toBe(btn);
  });

  it('routes assertive messages to the assertive region', () => {
    const el = container();
    let pending: (() => void) | undefined;
    const a = new Announcer(el, { schedule: (cb) => (pending = cb) });
    a.announce('Invalid: Must start with r', { assertive: true });
    pending?.();
    expect(a.assertiveText()).toBe('Invalid: Must start with r');
    expect(a.politeText()).toBe('');
  });

  it('coalesces a burst: 5 rapid announcements → 1 DOM write, final state only', () => {
    const el = container();
    let pending: (() => void) | undefined;
    const a = new Announcer(el, { schedule: (cb) => (pending = cb) });
    for (let i = 1; i <= 5; i++) a.announce(`update ${i}`);
    // Nothing written until the single scheduled flush runs.
    expect(a.writeCount).toBe(0);
    pending?.();
    expect(a.writeCount).toBe(1);
    expect(a.politeText()).toBe('update 5');
  });

  it('polite + assertive in one burst flush to their own regions (assertive not dropped)', () => {
    const el = container();
    let pending: (() => void) | undefined;
    const a = new Announcer(el, { schedule: (cb) => (pending = cb) });
    a.announce('Sorted by Name ascending, 3 rows');
    a.announce('Invalid: required', { assertive: true });
    pending?.();
    expect(a.writeCount).toBe(2);
    expect(a.politeText()).toBe('Sorted by Name ascending, 3 rows');
    expect(a.assertiveText()).toBe('Invalid: required');
  });

  it('default scheduler is a microtask (coalesces within a tick)', async () => {
    const el = container();
    const a = new Announcer(el);
    a.announce('a');
    a.announce('b');
    expect(a.writeCount).toBe(0);
    await Promise.resolve();
    expect(a.writeCount).toBe(1);
    expect(a.politeText()).toBe('b');
  });
});
