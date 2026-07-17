import { describe, expect, it } from 'vitest';

import { EventBus } from './event-bus.js';

/**
 * Bus mechanics (`EVT-*` infra). Uses a test-local event map so the vetoable +
 * notify machinery is exercised generically (the product maps are empty of
 * before-events in Slice 2).
 */
type AfterMap = { acted: { value: number } };
type BeforeMap = { willAct: { value: number } };

function makeBus(): EventBus<AfterMap, BeforeMap> {
  return new EventBus<AfterMap, BeforeMap>();
}

/** A guarded action modelling the before/after pattern a real op follows. */
function runAction(
  bus: EventBus<AfterMap, BeforeMap>,
  value: number,
  performed: number[],
): boolean {
  const vetoed = bus.emitVetoable('willAct', { value });
  if (vetoed) return false;
  performed.push(value); // the action
  bus.emit('acted', { value }); // notify after
  return true;
}

describe('EventBus — AC-VETO (vetoable before + notify after)', () => {
  it('preventDefault() in a before-handler → emitVetoable returns vetoed=true and the action is NOT performed', () => {
    const bus = makeBus();
    const performed: number[] = [];
    const afterSeen: number[] = [];
    bus.on('acted', (e) => afterSeen.push(e.value));
    bus.on('willAct', (e) => {
      expect(e.defaultPrevented).toBe(false);
      e.preventDefault();
      expect(e.defaultPrevented).toBe(true);
    });

    const ok = runAction(bus, 42, performed);
    expect(ok).toBe(false);
    expect(performed).toEqual([]); // action aborted
    expect(afterSeen).toEqual([]); // no after fires on veto
  });

  it('without preventDefault → proceeds and the notify after-event fires', () => {
    const bus = makeBus();
    const performed: number[] = [];
    const afterSeen: number[] = [];
    bus.on('acted', (e) => afterSeen.push(e.value));
    let beforeSeen = 0;
    bus.on('willAct', (e) => {
      beforeSeen++;
      expect(e.type).toBe('willAct');
      expect(e.defaultPrevented).toBe(false);
    });

    const ok = runAction(bus, 7, performed);
    expect(ok).toBe(true);
    expect(beforeSeen).toBe(1);
    expect(performed).toEqual([7]); // action performed
    expect(afterSeen).toEqual([7]); // after fired (not vetoed)
  });

  it('emitVetoable with no subscribers is not vetoed (returns false)', () => {
    const bus = makeBus();
    expect(bus.emitVetoable('willAct', { value: 1 })).toBe(false);
  });

  it('on returns an unsubscribe; off also removes the handler', () => {
    const bus = makeBus();
    const seen: number[] = [];
    const handler = (e: { value: number }): void => {
      seen.push(e.value);
    };
    const off = bus.on('acted', handler);
    bus.emit('acted', { value: 1 });
    off();
    bus.emit('acted', { value: 2 });
    bus.on('acted', handler);
    bus.off('acted', handler);
    bus.emit('acted', { value: 3 });
    expect(seen).toEqual([1]); // only the emit while subscribed
  });
});
