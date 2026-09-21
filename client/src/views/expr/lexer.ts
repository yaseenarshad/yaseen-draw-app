/**
 * Tokenizer for the Bases expression language (GRO-2130). Regex vs division
 * is decided by the previous token: `/` starts a regex literal only where an
 * operand is expected (start of input, or after an operator / `(` `[` `{` `,` `:`).
 */

export type Token =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'str'; value: string; pos: number }
  | { kind: 'ident'; value: string; pos: number }
  | { kind: 'regex'; pattern: string; flags: string; pos: number }
  | { kind: 'op'; value: string; pos: number }
  | { kind: 'eof'; pos: number }

export class ExprSyntaxError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message)
    this.name = 'ExprSyntaxError'
  }
}

const TWO_CHAR = ['<=', '>=', '==', '!=', '&&', '||']
const ONE_CHAR = '()[]{},:.+-*/%!<>'
const ESCAPES: Record<string, string> = { n: '\n', t: '\t' }

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c)
const isIdentChar = (c: string) => /[A-Za-z0-9_]/.test(c)
const isDigit = (c: string) => c >= '0' && c <= '9'

/** True when the token before `/` ends an operand, making `/` a division. */
function endsOperand(prev: Token | undefined): boolean {
  if (!prev) return false
  if (prev.kind === 'op') return prev.value === ')' || prev.value === ']' || prev.value === '}'
  return prev.kind !== 'eof'
}

export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const pos = i
    if (isDigit(c)) {
      while (i < src.length && isDigit(src[i])) i++
      if (src[i] === '.' && isDigit(src[i + 1] ?? '')) {
        i++
        while (i < src.length && isDigit(src[i])) i++
      }
      out.push({ kind: 'num', value: Number(src.slice(pos, i)), pos })
      continue
    }
    if (isIdentStart(c)) {
      while (i < src.length && isIdentChar(src[i])) i++
      out.push({ kind: 'ident', value: src.slice(pos, i), pos })
      continue
    }
    if (c === '"' || c === "'") {
      let value = ''
      i++
      for (;;) {
        if (i >= src.length) throw new ExprSyntaxError('unterminated string', pos)
        const ch = src[i++]
        if (ch === c) break
        if (ch === '\\') {
          if (i >= src.length) throw new ExprSyntaxError('unterminated string', pos)
          const esc = src[i++]
          value += ESCAPES[esc] ?? esc
        } else {
          value += ch
        }
      }
      out.push({ kind: 'str', value, pos })
      continue
    }
    if (c === '/' && !endsOperand(out[out.length - 1])) {
      i++
      let inClass = false
      for (;;) {
        if (i >= src.length || src[i] === '\n') throw new ExprSyntaxError('unterminated regex', pos)
        const ch = src[i]
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) break
        i++
      }
      const pattern = src.slice(pos + 1, i)
      i++
      const flagStart = i
      while (i < src.length && /[a-z]/.test(src[i])) i++
      out.push({ kind: 'regex', pattern, flags: src.slice(flagStart, i), pos })
      continue
    }
    const two = src.slice(i, i + 2)
    if (TWO_CHAR.includes(two)) {
      out.push({ kind: 'op', value: two, pos })
      i += 2
      continue
    }
    if (ONE_CHAR.includes(c)) {
      out.push({ kind: 'op', value: c, pos })
      i++
      continue
    }
    throw new ExprSyntaxError(`unexpected character ${JSON.stringify(c)}`, pos)
  }
  out.push({ kind: 'eof', pos: src.length })
  return out
}
