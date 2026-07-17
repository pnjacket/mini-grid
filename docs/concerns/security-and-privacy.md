---
artifact: product-doc
role: concern
concern-id: security-and-privacy
behavior: baseline
trigger: always
in-scope-subaspects: [trust-boundaries, threat-model, data-protection-mechanisms-per-sensitive-field]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Security & Privacy — mini-grid

> One-line: a client-side library with no auth/secrets/sessions of its own — its security surface is **content injection (XSS)** and **export formula-injection**, plus a set of contractual **negative assertions** (no egress, no secrets, no storage). Owns `SEC-*`; no `ROLE-*` (authorization is the host's job).

## Purpose & Scope

Owns the protection **mechanisms** and boundary/hygiene assertions (`SEC-*`) for a grid that renders host-/user-supplied data into the DOM. Governance owns the data-handling *policy*; Domain owns the *tags*; Security implements the *mechanism*. Because risk is minimal, the threat model's primary job here is to state **"X is not a threat, contractually"** (per spec DD#7), alongside the two real active controls (XSS, export injection).

## Non-goals / Out-of-scope
- `secrets-credential-handling` — *(absent → asserted negatively as `SEC-NO-SECRETS`)* holds no secrets/credentials.
- `authentication-mechanism` — *(absent)* no auth; the host authenticates.
- `authorization` — *(absent)* no roles/permissions; the grid is **not** a security boundary between end-users/tenants (see `SEC-TRUST-BOUNDARY`). No `ROLE-*`.
- `session-management` — *(absent)* no sessions.
- `encryption` — *(absent)* no data at rest/in transit owned by the grid; transport is the host's.

## Requirements

### Trust boundaries (`SEC-TRUST-BOUNDARY`)
- **Trusted:** the host application and its configured data source; developer-supplied config, editors, validators, formatters, comparators, renderer functions, **menu builders + custom menu-item renderers** (`SEC-MENU-CUSTOM-RENDER`) — all run with host privileges.
- **Untrusted:** cell **values/content**, **clipboard/paste** input, exported/imported file content, and end-user keyboard/pointer input.
- The grid **is not** a security boundary between different end-users or tenants — it renders whatever data the host supplies, under whatever permissions the host already enforced. Authn/authz are the host's responsibility (why those sub-aspects are out of scope).

### Threat model — active controls
| ID | Threat | Control |
|---|---|---|
| `SEC-ESCAPE-DEFAULT` | XSS via cell **content** | All values, headers, and pasted text rendered as **text** (`textContent`), never `innerHTML` of untrusted data. Realizes `PATTERN-ESCAPE-DEFAULT`. |
| `SEC-RENDERER-DOM-ONLY` | XSS via **custom renderers** | Renderers return a **DOM node / framework component**, or a **plain string rendered as text via `textContent`** — there is **no `innerHTML`/raw-HTML sink**, so HTML injection through a renderer is structurally impossible (zero-dependency). |
| `SEC-PASTE-UNTRUSTED` | XSS / active content via **paste/import** | Clipboard content parsed as **plain text (TSV)**; the `text/html` clipboard flavor is never rendered as HTML; pasted values flow through `SEC-ESCAPE-DEFAULT`; never evaluated. |
| `SEC-EXPORT-FORMULA-GUARD` | **CSV/xlsx formula-injection** | Export **neutralizes** values beginning with `= + - @` (and tab/CR) by prefixing — **on by default**, `exportOpts.sanitizeFormulas=false` to disable. *(v1.5 reconciled: with `CAP-FORMULA`, export emits a formula cell's **computed value** — formula strings never cross the export seam; this guard still neutralizes any literal `= + - @`-leading text data. Unchanged control, clarified scope.)* |
| `SEC-NO-EVAL` | code execution via data | The grid never uses `eval`/`new Function` on data; predicates/validators/formatters/comparators are developer-provided **functions**, not stringified expressions. |
| `SEC-MENU-CUSTOM-RENDER` | **developer-trust boundary** (a documented boundary, **not** an untrusted-data control) — custom **menu-item** DOM | A `MenuItem` of kind `custom` returns a `Node` the **developer** builds; the grid **mounts it as-is** and does **NOT** auto-escape it. This is **explicitly outside** the cell `SEC-RENDERER-DOM-ONLY` escape-by-default guarantee: menu items are authored by the trusted developer (like editors/validators/formatters/comparators), **not** derived from untrusted cell data. **The developer must not inject untrusted values into a custom menu item's DOM.** Item **labels/`labelKey`** resolve through the i18n bundle (`LIB-LOCALE`) as **text**. Contrast `SEC-RENDERER-DOM-ONLY` (untrusted cell data → structurally no HTML sink). |

### Threat model — negative / hygiene assertions (checkable `SEC-*`)
| ID | Assertion |
|---|---|
| `SEC-NO-EGRESS` | The grid makes **no network requests of its own** (no fetch/XHR/WebSocket) in v1. *(The v2 async DataSource adapter is host-provided code; egress there is the host's.)* |
| `SEC-NO-SECRETS` | Handles no credentials, tokens, or secrets. |
| `SEC-NO-PERSIST` | Writes nothing to `localStorage`/`sessionStorage`/cookies/IndexedDB/disk of its own; `serializeState()` **returns** state to the caller — persisting it is the host's choice. |
| `SEC-NO-LOG-VALUES` | Does not log cell values/content; error envelopes (`ERR-*`) reference cells by `(rowKey, columnId)`, never by value (protects potential PII). |
| `SEC-FORMULA-NO-EVAL` *(v1.5)* | Formulas are evaluated by an **AST interpreter**; the `formula/` module contains no `eval`/`new Function`/`Function(` — subsumed by the existing `SEC-NO-EVAL` static scan over the core bundle. Untrusted cell `=…` text can never execute. |
| `SEC-CSP-COMPAT` | Compatible with a strict CSP: no inline eval, no inline scripts, no untrusted `innerHTML` (Trusted-Types-compatible by construction — no untrusted sink). **Worker-loading contract:** the **default transport is in-process** (main thread, `InProcessTransport`) — **no worker at all**, so there is no worker CSP surface in the default configuration. To run the engine off-thread under a strict CSP, pass the `workerUrl` option (realized in `createTransport`): the grid loads a **same-origin module worker** via `new Worker(workerUrl, { type: 'module' })` (no `blob:`, no eval). The **UMD build inlines the worker as a `blob:`** (convenience) and is therefore **unusable under a `blob:`-forbidding CSP** — such hosts use ESM + `workerUrl` (`ADR-BUILD-TARGETS`). |

### Data-protection mechanisms per sensitive field (`data-protection-mechanisms-per-sensitive-field`)
mini-grid owns **no field-level classification tags** (host supplies the data shape — see Domain). Protection is therefore **uniform**: `SEC-ESCAPE-DEFAULT` + `SEC-NO-LOG-VALUES` apply to **every** value regardless of sensitivity. A host may pass sensitive/PII data; the uniform text-only, no-log treatment is the mechanism. Realizes the Governance data-handling policy (client-side, no transmit/store).

## Open Questions
- None blocking Contract-grade. (Worker-loading under strict CSP is now settled in `SEC-CSP-COMPAT` above.)
- Residual risk: a developer's own renderer/editor code could still call `innerHTML` with untrusted data **outside** the grid's API — addressed by **guidance**, not enforceable by the grid. Document prominently.
- Optional xlsx export lib is third-party code invoked at export time — supply-chain hygiene owned by Integrations (`DEP-*`) + Governance (license); Security notes it is opt-in and confined to the export path.

## Dependencies & Cross-references
- **Realizes:** `PATTERN-ESCAPE-DEFAULT` / `PATTERN-ERROR` (Architecture); the Governance **data-handling policy** (`POLICY-*`).
- **Applies to:** Interfaces `LIB-RENDERER-API` (DOM-only), `LIB-MENU`/`MenuItem` custom `render` (developer-trust boundary, `SEC-MENU-CUSTOM-RENDER`), `LIB-CLIPBOARD` (paste), `LIB-EXPORT` (formula guard), `ERR-*` (no value logging).
- **Consumes:** Domain classification stance (no tags → uniform treatment). **No** `PERSONA-*`→role mapping (no authz).

## Examples / Worked scenarios
- *Script-in-cell:* a cell value `"<img src=x onerror=alert(1)>"` renders as literal text (`SEC-ESCAPE-DEFAULT`); nothing executes.
- *Malicious paste:* pasting rich HTML from the clipboard inserts only its plain-text projection; no HTML is rendered (`SEC-PASTE-UNTRUSTED`).
- *Export guard:* a cell `"=HYPERLINK(...)"` exports as `"'=HYPERLINK(...)"` by default (`SEC-EXPORT-FORMULA-GUARD`).

## Design Decisions
| Decision | Rationale |
|---|---|
| Renderer escape hatch is DOM/components only, no HTML-string sink | Makes renderer XSS structurally impossible with zero dependency (operator-chosen). Supersedes the earlier "opt-in sanitized HTML" idea. |
| Custom menu-item DOM is a developer-trust boundary, mounted as-is, not auto-escaped (`SEC-MENU-CUSTOM-RENDER`) | Menu items are authored by the trusted developer (like editors/formatters), distinct from untrusted cell data (`SEC-RENDERER-DOM-ONLY`); auto-escaping developer-built menu DOM would break legitimate rich items. The developer must not inject untrusted values there (guidance, documented). |
| Formula-injection guard on by default, opt-out | Safe default; developers with known-safe intentional `=`-leading text can disable (operator-chosen). |
| Security surface is mostly `SEC-*` negative assertions | Minimal-risk client library: "no egress / no secrets / no storage" stated as checkable contracts, not left implicit (spec DD#7). |
| No `ROLE-*` / authz | The grid is not a cross-user boundary; the host owns authorization. |

## Contracts
Each `SEC-*` binds to an observable check (verified by Quality):
| `SEC-*` | Observable check |
|---|---|
| `SEC-ESCAPE-DEFAULT` | **page-governed** E2E: a `"<img src=x onerror=…>"` / `<script>` cell value renders as text and **does not execute in the page** (unit + DOM-E2E) |
| `SEC-RENDERER-DOM-ONLY` | type-level: the renderer signature returns `Node`/component, no string overload; runtime: a renderer returning a string is not injected as HTML |
| `SEC-MENU-CUSTOM-RENDER` | type/factual + runtime: a `custom` `MenuItem.render` returns a `Node` (the item schema has **no HTML-string sink**) that the grid mounts **as-is** — developer-controlled, **not** auto-escaped: the deliberate **contrast** to `SEC-RENDERER-DOM-ONLY`. A documented developer-trust boundary (partly factual, like `SEC-TRUST-BOUNDARY`); the runtime check asserts a developer `render` `Node` is mounted unchanged (menu labels/`labelKey` still resolve as text) |
| `SEC-PASTE-UNTRUSTED` | E2E: pasting `text/html` clipboard content inserts only its plain-text projection; no HTML rendered/executed |
| `SEC-EXPORT-FORMULA-GUARD` | unit: exporting `"=HYPERLINK()"` yields `"'=HYPERLINK()"` by default; `sanitizeFormulas:false` disables; *(v1.5)* a `CAP-FORMULA` cell exports its **computed value** (the formula string never crosses the export seam) |
| `SEC-NO-EVAL` | **static scan**: core bundle contains no `eval`/`new Function` on data paths |
| `SEC-FORMULA-NO-EVAL` | **static scan**: the `formula/` module contains no `eval`/`new Function`/`Function(` (subsumed by the `SEC-NO-EVAL` core-bundle scan) — the formula evaluator is an AST interpreter |
| `SEC-NO-EGRESS` | **static scan**: no `fetch`/`XMLHttpRequest`/`WebSocket` in core |
| `SEC-NO-SECRETS` | review/scan: no credential/token handling |
| `SEC-NO-PERSIST` | **static scan**: no `localStorage`/`sessionStorage`/`cookie`/`indexedDB` writes in core |
| `SEC-NO-LOG-VALUES` | scan/test: `GridError.context` carries `rowKey`/`columnId`, never cell values; no `console` of values |
| `SEC-CSP-COMPAT` | E2E under a strict CSP (no `unsafe-eval`, no `blob:`): ESM + `workerUrl` loads and functions; injected-script non-execution observed page-side |
| `SEC-TRUST-BOUNDARY` | factual boundary statement (no runtime check — asserted in this doc; **n/a** per Quality accountability) |

## Design decision — CSP worker loading
See `SEC-CSP-COMPAT` above: ESM same-origin module worker (`workerUrl`-overridable) is the strict-CSP path; UMD blob worker is the convenience path.

## Acceptance criteria
- **AC-XSS:** a script/`onerror` cell value never executes in the page (page-governed E2E, not harness-eval).
- **AC-STATIC-SCAN:** the core bundle contains no `fetch`/XHR/WebSocket, no storage writes, no `eval`/`new Function` (`SEC-NO-EGRESS`/`-NO-PERSIST`/`-NO-EVAL`).
- **AC-EXPORT-GUARD:** formula-leading values are neutralized on export by default; opt-out works.
- **AC-PASTE:** pasted HTML inserts only plain text; nothing executes.
- **AC-CSP:** the ESM build (+ `workerUrl`) loads and functions under a strict CSP; the UMD blob-worker limitation is documented.

