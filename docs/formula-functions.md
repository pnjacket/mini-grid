---
artifact: product-doc
role: feature-spec-appendix
feature-id: formula-support
parent: docs/formula-support.md
delta: v1.6
current-rung: contract-grade
status: built
version: 1.6.0
---

# Formula function catalog — mini-grid (`CAP-FORMULA-FN`)

The exhaustive, named function catalog for `CAP-FORMULA` — the single source for
which Excel functions mini-grid offers. Companion to
[`formula-support.md`](formula-support.md) (the engine + capability contracts).

**Tag legend**
| Tag | Meaning |
|---|---|
| ✅ | **Built** — implemented in the `FUNCTIONS` registry (or, for `LET`/`LAMBDA`/`MAP`/…, as an evaluator special form) with a passing unit test |
| ◻ | **Specified, not yet built** — a documented gap deferred to a later batch |
| ✗ | **Absent** — architecturally impossible (see `formula-support.md` Non-goals) |

**Counts (as built):** **475** registry functions + **9** evaluator special forms
(`LET LAMBDA MAP REDUCE SCAN BYROW BYCOL MAKEARRAY ISOMITTED`) — up from v1.5's ~70. The
**v1.7 catalog completion is done**: buckets A–D (`MODE.MULT` `PROB` `AREAS` `ARRAYTOTEXT`,
multi-return `XLOOKUP`; array math `TREND`/`GROWTH`/`LINEST`/`LOGEST` + `MINVERSE`/`MDETERM`/`MUNIT`;
bonds `ACCRINT`/`PRICEMAT`/`YIELDMAT` + odd-period `ODDF*`/`ODDL*`; `GROUPBY`/`PIVOTBY`) + the
implicit-intersection `@` operator + `ISOMITTED`. **No ◻ remain** — the catalog is complete
except the **✗ ~30** absent by design (`INFO` is among them; see below).

Operators (built ✅): `+ - * / ^` · unary `- +` · postfix `%` · text `&` ·
comparison `= <> < > <= >=` · parentheses · range `:` · **spill-ref `#` (`A1#`)** ✅.
**implicit-intersection `@`** ✅ (built v1.7 — `CAP-FORMULA-INTERSECT`).

---

## Math & trigonometry (~75)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| SUM | ✅ | SUMIF | ✅ | SUMIFS | ✅ |
| PRODUCT | ✅ | SUMPRODUCT | ✅ | SUMSQ | ✅ |
| ABS | ✅ | SIGN | ✅ | MOD | ✅ |
| ROUND / ROUNDUP / ROUNDDOWN | ✅ | MROUND | ✅ | TRUNC / INT | ✅ |
| CEILING / FLOOR | ✅ | CEILING.MATH / FLOOR.MATH | ✅ | CEILING.PRECISE / FLOOR.PRECISE / ISO.CEILING | ✅ |
| POWER | ✅ | SQRT | ✅ | SQRTPI | ✅ |
| EXP | ✅ | LN / LOG / LOG10 | ✅ | — | — |
| PI | ✅ | DEGREES / RADIANS | ✅ | — | — |
| SIN / COS / TAN | ✅ | ASIN / ACOS / ATAN / ATAN2 | ✅ | SINH / COSH / TANH | ✅ |
| ASINH / ACOSH / ATANH | ✅ | SEC / CSC / COT | ✅ | SECH / CSCH / COTH | ✅ |
| ACOT / ACOTH | ✅ | — | — | — | — |
| GCD / LCM | ✅ | QUOTIENT | ✅ | EVEN / ODD | ✅ |
| FACT / FACTDOUBLE | ✅ | COMBIN / COMBINA | ✅ | PERMUT / PERMUTATIONA | ✅ |
| MULTINOMIAL | ✅ | GAMMALN / GAMMALN.PRECISE | ✅ | SERIESSUM | ✅ |
| SUMX2MY2 / SUMX2PY2 / SUMXMY2 | ✅ | ROMAN / ARABIC | ✅ | BASE / DECIMAL | ✅ |
| SUBTOTAL | ✅ | AGGREGATE | ✅ | — | — |
| RAND | ✅ | RANDBETWEEN | ✅ | RANDARRAY | ✅ |
| SEQUENCE | ✅ | MMULT | ✅ | MINVERSE / MDETERM / MUNIT | ✅ |

*(`SUBTOTAL`/`AGGREGATE` honor the ignore-hidden/ignore-nested-subtotal option
codes; `AGGREGATE` additionally ignores errors per its option.)*

## Statistical (~75 offered of Excel's ~100)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| AVERAGE / AVG | ✅ | AVERAGEA | ✅ | AVERAGEIF | ✅ |
| AVERAGEIFS | ✅ | COUNT / COUNTA | ✅ | COUNTBLANK | ✅ |
| COUNTIF | ✅ | COUNTIFS | ✅ | — | — |
| MAX / MIN | ✅ | MAXA / MINA | ✅ | MAXIFS / MINIFS | ✅ |
| MEDIAN | ✅ | MODE.SNGL | ✅ | MODE.MULT | ✅ |
| LARGE / SMALL | ✅ | RANK.EQ / RANK.AVG | ✅ | PERCENTRANK.INC / .EXC | ✅ |
| PERCENTILE.INC / .EXC | ✅ | QUARTILE.INC / .EXC | ✅ | TRIMMEAN | ✅ |
| STDEV.S / STDEV.P | ✅ | STDEVA / STDEVPA | ✅ | VAR.S / VAR.P | ✅ |
| VARA / VARPA | ✅ | DEVSQ | ✅ | AVEDEV | ✅ |
| GEOMEAN / HARMEAN | ✅ | STANDARDIZE | ✅ | KURT / SKEW / SKEW.P | ✅ |
| CORREL / PEARSON | ✅ | COVARIANCE.P / .S | ✅ | RSQ | ✅ |
| SLOPE / INTERCEPT / STEYX | ✅ | FORECAST.LINEAR | ✅ | TREND / GROWTH / LINEST / LOGEST | ✅ |
| FREQUENCY | ✅ | PROB | ✅ | FISHER / FISHERINV | ✅ |
| GAUSS / PHI | ✅ | CONFIDENCE.NORM / .T | ✅ | — | — |
| NORM.DIST / .INV / .S.DIST / .S.INV | ✅ | BINOM.DIST / .INV | ✅ | POISSON.DIST | ✅ |
| EXPON.DIST | ✅ | T.DIST(.2T/.RT) / T.INV(.2T) | ✅ | F.DIST(.RT) / F.INV(.RT) | ✅ |
| CHISQ.DIST(.RT) / .INV(.RT) | ✅ | GAMMA / GAMMA.DIST / .INV | ✅ | BETA.DIST / .INV | ✅ |
| HYPGEOM.DIST | ✅ | NEGBINOM.DIST | ✅ | LOGNORM.DIST / .INV | ✅ |
| WEIBULL.DIST | ✅ | Z.TEST / T.TEST / F.TEST / CHISQ.TEST | ✅ | FORECAST.ETS(.SEASONALITY/.STAT/.CONFINT) | ✅ |

*(The `.DIST`/`.INV` distribution family + ~24 legacy **Compatibility** aliases
(`NORMDIST`, `BETAINV`, `STDEVP`, `MODE`, `RANK`, `QUARTILE`, …) are built.
`FORECAST.ETS` uses additive Holt-Winters triple exponential smoothing with
autocorrelation-based seasonality detection. `PROB` + `MODE.MULT` are built (v1.7);
`TREND`/`GROWTH`/`LINEST`/`LOGEST` (array-result regression) are built (v1.7) —
`LINEST`/`LOGEST` return the coefficient row `[m…, b]`, or the full 5-row stats block (se, R², F, df, ss) when `stats`=TRUE (v1.7). `AVG` is a mini-grid
convenience **alias** of `AVERAGE` — not a standard Excel name, offered for ergonomics.)*

## Financial (~46 built)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| PMT / IPMT / PPMT | ✅ | PV / FV | ✅ | NPER / RATE | ✅ |
| NPV / XNPV | ✅ | IRR / MIRR / XIRR | ✅ | FVSCHEDULE | ✅ |
| CUMIPMT / CUMPRINC | ✅ | ISPMT / PDURATION / RRI | ✅ | EFFECT / NOMINAL | ✅ |
| SLN / SYD / DB / DDB / VDB | ✅ | AMORLINC / AMORDEGRC | ✅ | DOLLARDE / DOLLARFR | ✅ |
| DURATION / MDURATION | ✅ | ACCRINTM | ✅ | DISC / INTRATE / RECEIVED | ✅ |
| PRICE / PRICEDISC | ✅ | YIELD / YIELDDISC | ✅ | TBILLEQ/TBILLPRICE/TBILLYIELD | ✅ |
| COUPDAYBS/COUPDAYS/COUPDAYSNC/COUPNCD/COUPNUM/COUPPCD | ✅ | ACCRINT / PRICEMAT / YIELDMAT | ✅ | ODDFPRICE/ODDFYIELD/ODDLPRICE/ODDLYIELD | ✅ |

*(Bond math uses a shared `dayCountFrac` (basis 0-4) + `couponSchedule`; `YIELD` is
bisection over the monotone price. `ACCRINT` (periodic) + `PRICEMAT`/`YIELDMAT`
(interest-at-maturity, exact inverses) are built (v1.7). `ODDF*`/`ODDL*` (odd first/last
coupon) are built (v1.7) — priced by the standard discounted-cash-flow method (the
odd first/last coupon accrued over its actual period); validated against the published
reference values (`ODDFPRICE`≈113.60, `ODDLPRICE`≈99.878). `ODDF*` land within ~0.002 — a known
day-count-convention sensitivity for odd-first bonds.)*

## Date & time (~19 built)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| DATE | ✅ | YEAR / MONTH / DAY | ✅ | TODAY | ✅ (volatile) |
| NOW | ✅ (volatile) | TIME | ✅ | HOUR / MINUTE / SECOND | ✅ |
| DATEVALUE / TIMEVALUE | ✅ | DATEDIF | ✅ | DAYS / DAYS360 | ✅ |
| EDATE / EOMONTH | ✅ | WEEKDAY / WEEKNUM / ISOWEEKNUM | ✅ | YEARFRAC | ✅ |
| WORKDAY / WORKDAY.INTL | ✅ | NETWORKDAYS / NETWORKDAYS.INTL | ✅ | — | — |

*(`TODAY`/`NOW` are correctly **volatile** under `CAP-FORMULA-VOLATILE`. Serial-date
math runs on UTC to stay timezone-stable.)*

## Text (~40)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| CONCAT / CONCATENATE | ✅ | TEXTJOIN | ✅ | LEN | ✅ |
| LEFT / RIGHT / MID | ✅ | UPPER / LOWER / PROPER | ✅ | TRIM | ✅ |
| FIND / SEARCH | ✅ | REPLACE / SUBSTITUTE | ✅ | REPT | ✅ |
| EXACT | ✅ | CHAR / CODE | ✅ | VALUE | ✅ |
| TEXT | ✅ | FIXED | ✅ | DOLLAR | ✅ |
| NUMBERVALUE | ✅ | CLEAN | ✅ | T | ✅ |
| UNICHAR / UNICODE | ✅ | TEXTBEFORE / TEXTAFTER | ✅ | VALUETOTEXT | ✅ |
| REGEXEXTRACT / REGEXREPLACE / REGEXTEST | ✅ | TEXTSPLIT | ✅ | ARRAYTOTEXT | ✅ |

*(REGEX* map to JS `RegExp` (not `eval` — `SEC-NO-EVAL` unaffected). `TEXT`/`FIXED`/
`DOLLAR` respect the active `COMPONENT-I18N` locale via `Intl.NumberFormat` — built.)*

## Logical (~17)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| IF | ✅ | IFS | ✅ | IFERROR / IFNA | ✅ |
| AND / OR / NOT / XOR | ✅ | SWITCH | ✅ | TRUE / FALSE | ✅ |
| LET | ✅ | LAMBDA | ✅ | MAP / REDUCE / SCAN / BYROW / BYCOL / MAKEARRAY | ✅ |
| ISOMITTED | ✅ | — | — | — | — |

*(`LET`/`LAMBDA` and the iteration family are evaluator **special forms** — a lexical
scope + first-class `LambdaValue` closures, not registry functions.)*

## Lookup & reference (~35)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| VLOOKUP / HLOOKUP | ✅ | INDEX (value form) | ✅ | MATCH | ✅ |
| CHOOSE | ✅ | ROW / COLUMN | ✅ | ROWS / COLUMNS | ✅ |
| LOOKUP (vector) | ✅ | XMATCH | ✅ | XLOOKUP (single-result) | ✅ |
| ADDRESS | ✅ | FORMULATEXT | ✅ *(reads the sidecar `src`)* | AREAS | ✅ |
| OFFSET | ✅ (volatile) | INDIRECT | ✅ (volatile) | INDEX (reference form) | ✅ |
| XLOOKUP (array return) | ✅ | FILTER / SORT / SORTBY / UNIQUE | ✅ | TRANSPOSE | ✅ |
| TAKE / DROP / EXPAND | ✅ | HSTACK / VSTACK | ✅ | TOROW / TOCOL / WRAPROWS / WRAPCOLS | ✅ |
| CHOOSEROWS / CHOOSECOLS | ✅ | GROUPBY / PIVOTBY | ✅ *(named reducer or LAMBDA)* | — | — |
| HYPERLINK | ✅ *(returns the friendly/display text)* | GETPIVOTDATA | ✗ | — | — |

*(`OFFSET`/`INDIRECT`/`INDEX`-ref return a `ReferenceValue` (`CAP-FORMULA-REFVAL`);
`OFFSET`/`INDIRECT` are volatile. The `A1#` spill-reference operator tracks the live
spill extent (`CAP-FORMULA-ARRAY`).)*

## Information (~14 offered)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| ISNUMBER / ISTEXT / ISBLANK | ✅ | ISERROR / ISERR / ISNA | ✅ | N / NA | ✅ |
| ISNONTEXT / ISLOGICAL | ✅ | ISODD / ISEVEN | ✅ | ISREF | ✅ |
| ISFORMULA | ✅ *(reads the sidecar)* | TYPE / ERROR.TYPE | ✅ | — | — |
| CELL (data info-types) | ✅ *(`row`/`col`/`address`/`contents`/`type`/`width`)* | CELL (file/format info-types) | ✗ | INFO | ✗ *(no host context)* |
| SHEET / SHEETS | ✗ *(no worksheets)* | ISOMITTED | ✅ | — | — |

## Engineering (~55 built)

| Function | Tag | Function | Tag | Function | Tag |
|---|---|---|---|---|---|
| DEC2BIN / DEC2OCT / DEC2HEX | ✅ | BIN2DEC / BIN2OCT / BIN2HEX | ✅ | OCT2* / HEX2* | ✅ |
| BITAND / BITOR / BITXOR | ✅ | BITLSHIFT / BITRSHIFT | ✅ | DELTA / GESTEP | ✅ |
| CONVERT | ✅ *(mass/dist/time/pressure/force/energy/power/mag/vol/area/speed + SI prefixes)* | COMPLEX | ✅ | IMABS/IMREAL/IMAGINARY/IMARGUMENT/IMCONJUGATE | ✅ |
| IMSUM/IMSUB/IMPRODUCT/IMDIV/IMPOWER/IMSQRT/IMEXP/IMLN/IMLOG10/IMLOG2 | ✅ | IMSIN/IMCOS/IMTAN/IMSINH/IMCOSH/IMSEC/IMCSC/IMCOT/IMSECH/IMCSCH | ✅ | ERF / ERFC / ERF.PRECISE / ERFC.PRECISE | ✅ |
| BESSELI / BESSELJ / BESSELK / BESSELY | ✅ | — | — | — | — |

*(Bitwise ops use `BigInt` (≤ 2⁴⁸, past JS's 32-bit native operators); base conversions
use 10-digit two's-complement; `BESSEL*` use the Abramowitz & Stegun (public-domain)
polynomial/rational approximations + stable recurrence.)*

## Database (~12 built)

`DSUM DCOUNT DCOUNTA DGET DMAX DMIN DPRODUCT DAVERAGE DSTDEV DSTDEVP DVAR DVARP`
— all ✅. Each takes a `(database range, field, criteria range)` and reduces the
matching rows over the existing range + criteria machinery.

## Absent — architecturally impossible (✗)

Enumerated in `formula-support.md` Non-goals with the blocking fact. Summary: **web/
network** (`WEBSERVICE RTD STOCKHISTORY IMAGE DETECTLANGUAGE TRANSLATE`
+ Stocks/Geography data types) — `SEC-NO-EGRESS`; **cube** (`CUBE*`) — no OLAP;
**pivot** (`GETPIVOTDATA`) — no pivot tables; **cross-sheet** (`SHEET SHEETS`,
`Sheet2!A1`) — no worksheets; **host/file** (most `CELL`/`INFO` info-types) — no
workbook context; **phonetic** (`PHONETIC`) — no furigana metadata; **locale-niche**
(`DBCS ASC BAHTTEXT JIS`).

*(`ENCODEURL` (pure URL-encode) and `FILTERXML` (pure XPath over an XML string via
`DOMParser`) are technically implementable — no network — but low-value; a
`[FUTURE-SCOPE]` maybe-batch, not part of the core catalog.)*

---
<!-- Status markers: [GAP] [ASSUMPTION] [REVISIT] [FUTURE-SCOPE] -->
