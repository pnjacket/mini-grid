/**
 * `A11Y-GRID` accessible-announcement contract — the live-region announcer.
 *
 * Ambient/async grid updates (sort/filter settle, row/column insert/delete,
 * validation errors) are announced through a pair of **visually-hidden ARIA
 * live regions** — one `aria-live="polite"`, one `aria-live="assertive"` —
 * **without stealing focus** (the regions are never focused and never focusable).
 *
 * The regions are appended to the grid's **container** (a sibling of the
 * `role="grid"` root), so they stay OUTSIDE the grid ARIA tree (which may only
 * contain rows/rowgroups/cells) and axe stays clean.
 *
 * **Burst coalescing:** rapid `announce()` calls within one scheduling window
 * collapse to the **final state** — a single DOM write per politeness — so a
 * bulk operation announces once, not per micro-step. The scheduler defaults to a
 * microtask; tests may inject a manual one and call `flush()` deterministically.
 *
 * **Named exclusions (silent, by provenance):** scroll-driven virtualization
 * repaint, drag previews, per-keystroke selection movement, and placeholder→
 * filled window arrival are simply never routed here (the wiring in
 * `COMPONENT-API` subscribes only to the eligible after-events), so they produce
 * no announcement.
 */
export interface AnnouncerOptions {
  /**
   * Coalescing scheduler — invoked once per burst to flush the pending final
   * state. Defaults to a microtask (`queueMicrotask`). A manual scheduler makes
   * the coalescing window deterministic in tests.
   */
  schedule?: (cb: () => void) => void;
}

export interface AnnounceOptions {
  /** Route to the `assertive` region (validation errors). Default: `polite`. */
  assertive?: boolean;
}

export class Announcer {
  private readonly polite: HTMLElement;
  private readonly assertive: HTMLElement;
  private pendingPolite: string | undefined;
  private pendingAssertive: string | undefined;
  private scheduled = false;
  private readonly schedule: (cb: () => void) => void;
  /** Count of DOM writes actually performed — coalescing evidence (test hook). */
  private writes = 0;

  constructor(container: HTMLElement, opts: AnnouncerOptions = {}) {
    const doc = container.ownerDocument;
    this.schedule = opts.schedule ?? ((cb): void => queueMicrotask(cb));
    this.polite = this.makeRegion(doc, 'polite');
    this.assertive = this.makeRegion(doc, 'assertive');
    container.appendChild(this.polite);
    container.appendChild(this.assertive);
  }

  private makeRegion(doc: Document, politeness: 'polite' | 'assertive'): HTMLElement {
    const el = doc.createElement('div');
    el.setAttribute('data-mg-live', politeness);
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    // Visually-hidden (sr-only) — see the `[data-mg-live]` rule in the injected
    // base stylesheet. NOT `aria-hidden` (assistive tech must read it), NOT
    // focusable (announcing never steals focus).
    return el;
  }

  /**
   * Announce `message` on the polite region (or the assertive one when
   * `assertive` is set). Coalesced to the final state within the scheduling
   * window; never moves focus.
   */
  announce(message: string, opts: AnnounceOptions = {}): void {
    if (!message) return;
    if (opts.assertive) this.pendingAssertive = message;
    else this.pendingPolite = message;
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => this.flush());
  }

  /** Flush the pending (coalesced) final state to the live region(s). */
  flush(): void {
    this.scheduled = false;
    if (this.pendingPolite !== undefined) {
      this.write(this.polite, this.pendingPolite);
      this.pendingPolite = undefined;
    }
    if (this.pendingAssertive !== undefined) {
      this.write(this.assertive, this.pendingAssertive);
      this.pendingAssertive = undefined;
    }
  }

  private write(region: HTMLElement, message: string): void {
    region.textContent = message;
    this.writes++;
  }

  /** Number of DOM writes performed since construction (coalescing evidence). */
  get writeCount(): number {
    return this.writes;
  }

  /** Current polite-region text (test hook). */
  politeText(): string {
    return this.polite.textContent ?? '';
  }

  /** Current assertive-region text (test hook). */
  assertiveText(): string {
    return this.assertive.textContent ?? '';
  }

  /** Remove both live regions from the DOM (`LIB-DESTROY`). */
  destroy(): void {
    this.polite.remove();
    this.assertive.remove();
  }
}
