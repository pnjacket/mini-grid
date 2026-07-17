import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  FeatureRegistry,
  resolveFeatureFlags,
} from './features.js';

describe('FeatureRegistry — AC-FLAG-COST (PATTERN-FEATURE-FLAGS)', () => {
  it('every flag defaults to true, except the opt-in `formula` capability', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      // `CAP-FORMULA` reinterprets `=`-leading cell values, so it defaults OFF
      // (explicit opt-in); every other capability is on by default.
      expect(DEFAULT_FEATURE_FLAGS[key]).toBe(key !== 'formula');
    }
    expect(resolveFeatureFlags().sorting).toBe(true);
    expect(resolveFeatureFlags().formula).toBe(false);
    expect(resolveFeatureFlags({ formula: true }).formula).toBe(true);
  });

  it('a disabled flag → module not registered, no setup, no entry; enabled → present', () => {
    const registry = new FeatureRegistry({ sorting: false });

    // Disabled: isEnabled false, register is a no-op, setup never runs.
    const disabledSetup = vi.fn();
    expect(registry.isEnabled('sorting')).toBe(false);
    const registeredDisabled = registry.register({
      flag: 'sorting',
      setup: disabledSetup,
    });
    expect(registeredDisabled).toBe(false);
    expect(disabledSetup).not.toHaveBeenCalled();
    expect(registry.has('sorting')).toBe(false); // no affordance/cost
    expect(registry.get('sorting')).toBeUndefined();

    // Enabled (default true): registers, setup runs, entry present.
    const enabledSetup = vi.fn();
    expect(registry.isEnabled('editing')).toBe(true);
    const registeredEnabled = registry.register({
      flag: 'editing',
      setup: enabledSetup,
    });
    expect(registeredEnabled).toBe(true);
    expect(enabledSetup).toHaveBeenCalledTimes(1);
    expect(registry.has('editing')).toBe(true);
    expect(registry.registeredFlags()).toEqual(['editing']);
  });
});
