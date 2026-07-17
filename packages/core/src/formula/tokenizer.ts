/**
 * `CAP-FORMULA` front-end — the lexer. Turns a formula body (the text AFTER the
 * leading `=`) into a flat token stream for the Pratt parser. No evaluation, no
 * grid access — pure string → tokens.
 */

export type TokenType =
  | 'num'
  | 'str'
  | 'name' // function name, cell ref, range endpoint, TRUE/FALSE — classified by the parser
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

/** Thrown on a malformed token (unterminated string, stray char). */
export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

const MULTI_OPS = ['<=', '>=', '<>'];
const SINGLE_OPS = new Set(['+', '-', '*', '/', '^', '&', '=', '<', '>', '%', '@']);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i] as string;

    // Whitespace.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Error literal (`#REF!`, `#DIV/0!`, …) — lexed whole as a `name` token.
    // A bare `#` (not an error code) is the spill-reference operator (`A1#`).
    if (ch === '#') {
      const code = matchErrorLiteral(input, i);
      if (code) {
        tokens.push({ type: 'name', value: code, pos: i });
        i += code.length;
        continue;
      }
      tokens.push({ type: 'op', value: '#', pos: i });
      i++;
      continue;
    }

    // String literal ("" escapes an embedded quote).
    if (ch === '"') {
      const start = i;
      i++;
      let s = '';
      let closed = false;
      while (i < n) {
        const c = input[i] as string;
        if (c === '"') {
          if (input[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        s += c;
        i++;
      }
      if (!closed) throw new FormulaSyntaxError('Unterminated string literal', start);
      tokens.push({ type: 'str', value: s, pos: start });
      continue;
    }

    // Number literal (integer / decimal / scientific).
    if ((ch >= '0' && ch <= '9') || (ch === '.' && isDigit(input[i + 1]))) {
      const start = i;
      while (i < n && isNumberChar(input[i])) i++;
      // Scientific: 1e5 / 1E-5.
      if ((input[i] === 'e' || input[i] === 'E') && (isDigit(input[i + 1]) || ((input[i + 1] === '+' || input[i + 1] === '-') && isDigit(input[i + 2])))) {
        i++;
        if (input[i] === '+' || input[i] === '-') i++;
        while (i < n && isDigit(input[i])) i++;
      }
      tokens.push({ type: 'num', value: input.slice(start, i), pos: start });
      continue;
    }

    // Name: function id / cell ref / range endpoint / boolean. Allows a leading
    // `$` and interior `$`/letters/digits/`.` so `$A$1` and dotted names lex whole.
    if (isNameStart(ch)) {
      const start = i;
      while (i < n && isNameChar(input[i])) i++;
      tokens.push({ type: 'name', value: input.slice(start, i), pos: start });
      continue;
    }

    if (ch === '(') { tokens.push({ type: 'lparen', value: ch, pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ch, pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', value: ch, pos: i }); i++; continue; }
    if (ch === ':') { tokens.push({ type: 'colon', value: ch, pos: i }); i++; continue; }

    // Operators (multi-char first).
    const two = input.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) { tokens.push({ type: 'op', value: two, pos: i }); i += 2; continue; }
    if (SINGLE_OPS.has(ch)) { tokens.push({ type: 'op', value: ch, pos: i }); i++; continue; }

    throw new FormulaSyntaxError(`Unexpected character '${ch}'`, i);
  }

  return tokens;
}

const ERROR_LITERALS = ['#DIV/0!', '#VALUE!', '#NAME?', '#REF!', '#N/A', '#NUM!', '#CIRC!'];
function matchErrorLiteral(input: string, at: number): string | null {
  const upper = input.slice(at, at + 8).toUpperCase();
  for (const code of ERROR_LITERALS) {
    if (upper.startsWith(code)) return input.slice(at, at + code.length);
  }
  return null;
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}
function isNumberChar(c: string | undefined): boolean {
  return c !== undefined && ((c >= '0' && c <= '9') || c === '.');
}
function isNameStart(c: string): boolean {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '$' || c === '_';
}
function isNameChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  return (
    (c >= 'A' && c <= 'Z') ||
    (c >= 'a' && c <= 'z') ||
    (c >= '0' && c <= '9') ||
    c === '$' ||
    c === '_' ||
    c === '.'
  );
}
