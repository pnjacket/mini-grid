import { describe, expect, it } from 'vitest';

import { VERSION, createGrid, IndexEngine, GridError } from './index.js';

describe('@mini-grid/core public surface', () => {
  it('exposes the package version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('exports the core symbols', () => {
    expect(typeof createGrid).toBe('function');
    expect(typeof IndexEngine).toBe('function');
    expect(typeof GridError).toBe('function');
  });
});
