/**
 * `CAP-FORMULA` front-end — a precedence-climbing (Pratt) parser: tokens → AST.
 * Excel operator precedence, right-associative `^`, unary `-`/`+` binding tighter
 * than `^` (so `-2^2 = 4`, matching Excel), postfix `%`, and `ref:ref` ranges.
 */
import type { BinaryOp, FormulaNode } from './ast.js';
import { parseA1, looksLikeA1 } from './references.js';
import type { CellRefA1 } from './references.js';
import { FormulaSyntaxError, tokenize } from './tokenizer.js';
import type { Token } from './tokenizer.js';
import type { FormulaErrorCode } from './values.js';

const ERROR_LITERALS = new Set<string>(['#DIV/0!', '#VALUE!', '#NAME?', '#REF!', '#N/A', '#NUM!', '#CIRC!']);

// Binary operator binding powers (higher = tighter). Comparison loosest.
const BINARY_BP: Record<BinaryOp, number> = {
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 5,
};

/** Parse a full formula (the text may include the leading `=`). */
export function parseFormula(input: string): FormulaNode {
  const body = input.startsWith('=') ? input.slice(1) : input;
  const tokens = tokenize(body);
  const p = new Parser(tokens, body);
  const node = p.parseExpression(0);
  p.expectEnd();
  return node;
}

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }
  private next(): Token | undefined {
    return this.tokens[this.i++];
  }

  expectEnd(): void {
    if (this.i < this.tokens.length) {
      const t = this.tokens[this.i] as Token;
      throw new FormulaSyntaxError(`Unexpected token '${t.value}'`, t.pos);
    }
  }

  /** Precedence-climbing expression parse. */
  parseExpression(minBp: number): FormulaNode {
    let left = this.parseUnary();

    for (;;) {
      const t = this.peek();
      if (!t || t.type !== 'op') break;
      const op = t.value as BinaryOp;
      const bp = BINARY_BP[op];
      if (bp === undefined || bp < minBp) break;
      this.next();
      // `^` is right-associative; everything else left-associative.
      const nextMin = op === '^' ? bp : bp + 1;
      const right = this.parseExpression(nextMin);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  /** Prefix unary (`-`/`+`) — binds tighter than `^`. */
  private parseUnary(): FormulaNode {
    const t = this.peek();
    if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      const operand = this.parseUnary();
      return { kind: 'unary', op: t.value, operand };
    }
    // `@expr` — implicit-intersection prefix (CAP-FORMULA-INTERSECT). Applies to the
    // range/reference that follows (`@A1:A3` = intersect the whole range).
    if (t && t.type === 'op' && t.value === '@') {
      this.next();
      return { kind: 'intersect', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  /** Postfix `%`. */
  private parsePostfix(): FormulaNode {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t && t.type === 'op' && t.value === '%') {
        this.next();
        node = { kind: 'percent', operand: node };
      } else {
        break;
      }
    }
    return node;
  }

  private parsePrimary(): FormulaNode {
    const t = this.next();
    if (!t) throw new FormulaSyntaxError('Unexpected end of formula', this.src.length);

    switch (t.type) {
      case 'num': {
        const v = Number(t.value);
        if (!Number.isFinite(v)) throw new FormulaSyntaxError(`Invalid number '${t.value}'`, t.pos);
        return { kind: 'num', value: v };
      }
      case 'str':
        return { kind: 'str', value: t.value };
      case 'lparen': {
        const inner = this.parseExpression(0);
        this.expect('rparen', ')');
        return inner;
      }
      case 'name':
        return this.parseNameLed(t);
      case 'op':
        // An error literal is lexed as ops+name (e.g. `#REF!`) — reassemble.
        if (t.value === '#') {
          return this.parseErrorLiteral(t);
        }
        throw new FormulaSyntaxError(`Unexpected operator '${t.value}'`, t.pos);
      default:
        throw new FormulaSyntaxError(`Unexpected token '${t.value}'`, t.pos);
    }
  }

  /** A `name` token: function call, cell ref, range endpoint, boolean, or error literal. */
  private parseNameLed(t: Token): FormulaNode {
    const upper = t.value.toUpperCase();

    // Error literal that lexed as a single name (rare; usually split by `#`).
    if (ERROR_LITERALS.has(upper)) return { kind: 'error', code: upper as FormulaErrorCode };

    // Function call — a name immediately followed by `(`.
    const nxt = this.peek();
    if (nxt && nxt.type === 'lparen') {
      this.next(); // consume '('
      const args = this.parseArgs();
      this.expect('rparen', ')');
      return { kind: 'call', name: upper, args };
    }

    // Boolean literals.
    if (upper === 'TRUE') return { kind: 'bool', value: true };
    if (upper === 'FALSE') return { kind: 'bool', value: false };

    // Cell reference, possibly the start of a range `A1:B2` or a spill ref `A1#`.
    if (looksLikeA1(t.value)) {
      const startRef = parseA1(t.value) as CellRefA1;
      const after = this.peek();
      if (after && after.type === 'colon') {
        this.next(); // consume ':'
        const endTok = this.next();
        if (!endTok || endTok.type !== 'name' || !looksLikeA1(endTok.value)) {
          throw new FormulaSyntaxError('Expected a cell reference after ":"', endTok?.pos ?? t.pos);
        }
        const endRef = parseA1(endTok.value) as CellRefA1;
        return { kind: 'range', range: { start: startRef, end: endRef } };
      }
      // Spill-reference operator `A1#` — the range that spilled from the anchor.
      if (after && after.type === 'op' && after.value === '#') {
        this.next(); // consume '#'
        return { kind: 'spillref', ref: startRef };
      }
      return { kind: 'ref', ref: startRef };
    }

    // Otherwise a bare identifier — a LET/LAMBDA variable, resolved at eval time
    // (unbound → #NAME?). Preserving the name is what makes LET/LAMBDA possible.
    return { kind: 'name', name: upper };
  }

  /** Reassemble an error literal that lexed as `#` op + trailing tokens. */
  private parseErrorLiteral(hash: Token): FormulaNode {
    // Consume following name/op/num tokens until we can form a known code.
    let text = '#';
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i] as Token;
      // Stop at a boundary token.
      if (t.type === 'lparen' || t.type === 'rparen' || t.type === 'comma' || t.type === 'colon') break;
      text += t.value;
      this.i++;
      if (ERROR_LITERALS.has(text.toUpperCase())) {
        return { kind: 'error', code: text.toUpperCase() as FormulaErrorCode };
      }
      if (text.length > 8) break;
    }
    throw new FormulaSyntaxError(`Unrecognized error literal '${text}'`, hash.pos);
  }

  private parseArgs(): FormulaNode[] {
    const args: FormulaNode[] = [];
    if (this.peek()?.type === 'rparen') return args; // zero-arg call
    for (;;) {
      const t = this.peek();
      // An omitted argument (`,,` or a trailing comma) → a `missing` node.
      if (t && (t.type === 'comma' || t.type === 'rparen')) args.push({ kind: 'missing' });
      else args.push(this.parseExpression(0));
      const nt = this.peek();
      if (nt && nt.type === 'comma') {
        this.next();
        continue;
      }
      break;
    }
    return args;
  }

  private expect(type: Token['type'], label: string): void {
    const t = this.next();
    if (!t || t.type !== type) {
      throw new FormulaSyntaxError(`Expected '${label}'`, t?.pos ?? this.src.length);
    }
  }
}
