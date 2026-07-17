import { describe, expect, it } from 'vitest';

import { compileValidation } from './validation.js';
import type { ValidationContext } from './validation.js';

const ctx = (type: ValidationContext['type'] = 'text'): ValidationContext => ({
  rowKey: 1,
  columnId: 'c',
  field: 'c',
  type,
  data: {},
});

describe('LIB-VALIDATOR-API — compileValidation built-in rules', () => {
  it('an empty rule set is always valid', () => {
    expect(compileValidation(undefined)('x', ctx())).toBe(true);
    expect(compileValidation([])('', ctx())).toBe(true);
  });

  it('required rejects empty/null and accepts a value', () => {
    const v = compileValidation([{ kind: 'required' }]);
    expect(v('', ctx())).not.toBe(true);
    expect(v(null, ctx())).not.toBe(true);
    expect(v('x', ctx())).toBe(true);
  });

  it('range enforces min/max on numbers; empty passes', () => {
    const v = compileValidation([{ kind: 'range', min: 0, max: 120 }]);
    expect(v(45, ctx('number'))).toBe(true);
    expect(v(200, ctx('number'))).not.toBe(true);
    expect(v(-1, ctx('number'))).not.toBe(true);
    expect(v('', ctx('number'))).toBe(true);
  });

  it('regex matches string values', () => {
    const v = compileValidation([{ kind: 'regex', pattern: '^r' }]);
    expect(v('row-1', ctx())).toBe(true);
    expect(v('x', ctx())).not.toBe(true);
  });

  it('oneOf restricts to a list', () => {
    const v = compileValidation([{ kind: 'oneOf', values: ['a', 'b'] }]);
    expect(v('a', ctx('select'))).toBe(true);
    expect(v('z', ctx('select'))).not.toBe(true);
  });

  it('type validates against the column type', () => {
    const v = compileValidation([{ kind: 'type' }]);
    expect(v(3, ctx('number'))).toBe(true);
    expect(v('nope', ctx('number'))).not.toBe(true);
    expect(v(true, ctx('boolean'))).toBe(true);
  });

  it('a custom validator is invoked and its error returned', () => {
    const v = compileValidation([
      { kind: 'custom', validate: (value) => (value === 'ok' ? true : { message: 'bad' }) },
    ]);
    expect(v('ok', ctx())).toBe(true);
    expect(v('no', ctx())).toEqual({ message: 'bad' });
  });

  it('returns the FIRST failing rule', () => {
    const v = compileValidation([
      { kind: 'required', message: 'req' },
      { kind: 'range', min: 0, message: 'rng' },
    ]);
    expect(v('', ctx('number'))).toEqual({ message: 'req' });
  });
});
