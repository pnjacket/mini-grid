/**
 * `COMPONENT-STATE-SERDE` (`CAP-PERSIST-STATE`, `LIB-STATE`) — the serializable
 * grid **layout** state (NOT the row data).
 *
 * `serializeState()` snapshots the layout — column order + widths, sort/filter
 * specs, freeze pane, merge regions, group nodes, the cell-style overlay, and
 * conditional rules — as a `GridState` carrying an integer schema `version`.
 * `restoreState(state)` applies it back.
 *
 * **Versioning** (Interfaces "Versioning & compatibility"): `GridState.version`
 * starts at `1`. `restoreState` accepts the current version and any documented
 * prior versions, migrating forward. An **unknown future** version yields an
 * `INVALID_OPTIONS` warning (`severity:'warning'`) and best-effort applies the
 * recognized fields, dropping unknown ones.
 */
import { GridError } from '../errors.js';
import type {
  CellStyle,
  ColumnId,
  FilterSpec,
  FreezePane,
  GroupNode,
  MergeRegion,
  RowKey,
  SortSpec,
} from '../types.js';
import type { ConditionalRule } from '../format/conditional.js';

/** Current `GridState` schema version (`GridState.version` starts at 1). */
export const GRID_STATE_VERSION = 1;

/** Column order + width entry. */
export interface GridStateColumn {
  id: ColumnId;
  width?: number;
}

/** One `(rowKey, columnId)` cell-style overlay entry. */
export interface GridStateCellStyle {
  rowKey: RowKey;
  columnId: ColumnId;
  style: CellStyle;
}

/** The serialized grid layout state (`LIB-STATE`). */
export interface GridState {
  /** Integer schema version (see Versioning). */
  version: number;
  /** Column order + widths. */
  columns: GridStateColumn[];
  /** `ENTITY-SORT-SPEC`. */
  sort: SortSpec;
  /** `ENTITY-FILTER` (predicates are live functions — in-memory round-trip). */
  filter: FilterSpec;
  /** `ENTITY-FREEZE-PANE`. */
  frozen: FreezePane;
  /** `ENTITY-MERGE-REGION[]`. */
  merges: MergeRegion[];
  /** `ENTITY-GROUP-NODE[]`. */
  groups: GroupNode[];
  /** Sparse cell-style overlay (`ENTITY-CELL-STYLE`). */
  cellStyles: GridStateCellStyle[];
  /** `ENTITY-CONDITIONAL-RULE[]`. */
  conditionalRules: ConditionalRule[];
}

/** Result of validating an incoming `GridState.version`. */
export interface StateVersionCheck {
  /** Whether restore should proceed (best-effort even for a future version). */
  ok: boolean;
  /** A warning to surface when the version is unknown (future). */
  warning?: GridError;
}

/**
 * Validate `state.version`. Version `1` (current) is accepted outright. A higher,
 * unknown version is accepted **best-effort** with an `INVALID_OPTIONS` warning
 * (recognized fields applied, unknown ones dropped). A non-integer / `< 1`
 * version is rejected (a hard warning; restore is skipped).
 */
export function checkStateVersion(version: unknown): StateVersionCheck {
  if (version === GRID_STATE_VERSION) return { ok: true };
  if (typeof version === 'number' && Number.isInteger(version) && version > GRID_STATE_VERSION) {
    return {
      ok: true,
      warning: new GridError(
        'INVALID_OPTIONS',
        `restoreState received a future GridState.version (${version}); ` +
          `this build understands version ${GRID_STATE_VERSION}. Applying recognized fields; ` +
          `unknown fields are ignored.`,
        { source: 'config', severity: 'warning' },
      ),
    };
  }
  return {
    ok: false,
    warning: new GridError(
      'INVALID_OPTIONS',
      `restoreState received an invalid GridState.version (${String(version)}); expected ${GRID_STATE_VERSION}.`,
      { source: 'config', severity: 'warning' },
    ),
  };
}
