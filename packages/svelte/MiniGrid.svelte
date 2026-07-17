<!--
  `@mini-grid/svelte` — `MiniGrid.svelte` (COMPONENT-ADAPTER-SVELTE).

  A thin `.svelte` wrapper over the `miniGrid` action for hosts with a Svelte
  toolchain. Shipped as raw source (`@mini-grid/svelte/MiniGrid.svelte`) so the
  consumer's compiler handles it — the adapter's own build stays compiler-light.
  Works with Svelte 4 and 5 (DEP-SVELTE). Delegates entirely to the action, so
  it never touches core internals (AC-BOUNDARY).
-->
<script>
  import { miniGrid } from './dist/index.js';

  /** @type {import('./dist/index.js').MiniGridParams['columns']} */
  export let columns;
  /** @type {import('./dist/index.js').MiniGridParams['data']} */
  export let data = undefined;
  /** @type {import('./dist/index.js').MiniGridParams['options']} */
  export let options = undefined;
  /** @type {import('./dist/index.js').MiniGridParams['events']} */
  export let events = undefined;
  /** @type {import('@mini-grid/core').Grid | null} */
  export let grid = null;

  const onReady = (g) => {
    grid = g;
  };
</script>

<div use:miniGrid={{ columns, data, options, events, onReady }}></div>
