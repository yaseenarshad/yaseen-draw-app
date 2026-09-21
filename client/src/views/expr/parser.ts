import type { BinaryOp, Expr } from './ast'
import { ExprSyntaxError, type Token, tokenize } from './lexer'

export { ExprSyntaxError }

/** Binary precedence, JS order; all left-associative (GRO-2130). */
const PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
}

function describe(t: Token): string {
  if (t.kind === 'eof') return 'end of input'
  if (t.kind === 'op' || t.kind === 'ident') return JSON.stringify(t.value)
  return t.kind === 'regex' ? 'regex' : t.kind === 'str' ? 'string' : 'number'
}

class Parser {
  private i = 0
  constructor(private readonly toks: Token[]) {}

  parse(): Expr {
    const e = this.expr(0)
    if (this.peek().kind !== 'eof') throw this.unexpected()
    return e
  }

  private peek(): Token {
    return this.toks[this.i]
  }

  private next(): Token {
    return this.toks[this.i++]
  }

  private isOp(value: string): boolean {
    const t = this.peek()
    return t.kind === 'op' && t.value === value
  }

  private unexpected(): ExprSyntaxError {
    const t = this.peek()
    return new ExprSyntaxError(`unexpected ${describe(t)}`, t.pos)
  }

  private expect(value: string): Token {
    if (!this.isOp(value)) {
      const t = this.peek()
      if (t.kind === 'eof') throw this.unexpected()
      throw new ExprSyntaxError(`expected "${value}" but got ${describe(t)}`, t.pos)
    }
    return this.next()
  }

  /** Pratt loop: `left op right` while `op` binds at least as tightly as `minPrec`. */
  private expr(minPrec: number): Expr {
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'op') break
      const prec = PREC[t.value]
      if (prec === undefined || prec < minPrec) break
      this.next()
      const right = this.expr(prec + 1)
      left = { type: 'binary', op: t.value as BinaryOp, left, right, pos: t.pos }
    }
    return left
  }

  private unary(): Expr {
    if (this.isOp('!') || this.isOp('-')) {
      const t = this.next() as Extract<Token, { kind: 'op' }>
      return { type: 'unary', op: t.value as '!' | '-', operand: this.unary(), pos: t.pos }
    }
    return this.postfix(this.primary())
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      if (this.isOp('.')) {
        const dot = this.next()
        const name = this.peek()
        if (name.kind !== 'ident') throw new ExprSyntaxError(`expected property name but got ${describe(name)}`, name.pos)
        this.next()
        e = this.isOp('(')
          ? { type: 'method', object: e, name: name.value, args: this.args(), pos: dot.pos }
          : { type: 'member', object: e, name: name.value, pos: dot.pos }
      } else if (this.isOp('[')) {
        const open = this.next()
        const index = this.expr(0)
        this.expect(']')
        e = { type: 'index', object: e, index, pos: open.pos }
      } else {
        return e
      }
    }
  }

  /** Parses `( a, b, )`; the opening paren must be the current token. */
  private args(): Expr[] {
    this.expect('(')
    return this.sequence(')', () => this.expr(0))
  }

  /** Comma-separated items up to `close`; a trailing comma is allowed. */
  private sequence<T>(close: string, item: () => T): T[] {
    const items: T[] = []
    while (!this.isOp(close)) {
      items.push(item())
      if (!this.isOp(',')) break
      this.next()
    }
    this.expect(close)
    return items
  }

  private primary(): Expr {
    const t = this.peek()
    switch (t.kind) {
      case 'num':
        this.next()
        return { type: 'num', value: t.value, pos: t.pos }
      case 'str':
        this.next()
        return { type: 'str', value: t.value, pos: t.pos }
      case 'regex':
        this.next()
        return { type: 'regex', pattern: t.pattern, flags: t.flags, pos: t.pos }
      case 'ident':
        this.next()
        if (t.value === 'true' || t.value === 'false') return { type: 'bool', value: t.value === 'true', pos: t.pos }
        if (t.value === 'null') return { type: 'null', pos: t.pos }
        if (this.isOp('(')) return { type: 'call', name: t.value, args: this.args(), pos: t.pos }
        return { type: 'ident', name: t.value, pos: t.pos }
      case 'op':
        if (t.value === '(') {
          this.next()
          const e = this.expr(0)
          this.expect(')')
          return e
        }
        if (t.value === '[') {
          this.next()
          return { type: 'list', items: this.sequence(']', () => this.expr(0)), pos: t.pos }
        }
        if (t.value === '{') {
          this.next()
          const entries = this.sequence('}', () => {
            const k = this.next()
            if (k.kind !== 'str' && k.kind !== 'ident') throw new ExprSyntaxError(`expected object key but got ${describe(k)}`, k.pos)
            this.expect(':')
            return { key: k.value, value: this.expr(0) }
          })
          return { type: 'object', entries, pos: t.pos }
        }
        throw this.unexpected()
      case 'eof':
        throw this.unexpected()
    }
  }
}

/** Parses one expression; throws `ExprSyntaxError { message, pos }` (GRO-2130). */
export function parse(src: string): Expr {
  return new Parser(tokenize(src)).parse()
}
