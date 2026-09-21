import type { Expr } from './ast'
import { compile } from './compile'
import { FUNCTIONS, hasFunction } from './functions'
import { callMethod, getField } from './methods'
import { ArgError, binaryOp, toNumber } from './ops'
import { DurationValue, ErrorValue, RegexValue, type Scope, type Value, fromYaml, isTruthy, typeOf } from './values'

/** Bindings introduced by list lambdas (`value`, `index`, `acc`). */
type Locals = Record<string, Value> | null

const LAMBDA_METHODS = new Set(['filter', 'map', 'reduce'])
const hasOwn = (o: object, k: string) => Object.hasOwn(o, k)

class Evaluator {
  private readonly memo = new Map<string, Value>()
  private readonly inProgress = new Set<string>()

  constructor(private readonly scope: Scope) {}

  eval(e: Expr, locals: Locals): Value {
    switch (e.type) {
      case 'str': case 'num': case 'bool': return e.value
      case 'null': return null
      case 'list': return this.evalArgs(e.items, locals)
      case 'object': {
        const out: { [k: string]: Value } = {}
        for (const { key, value } of e.entries) {
          const v = this.eval(value, locals)
          if (v instanceof ErrorValue) return v
          out[key] = v
        }
        return out
      }
      case 'regex':
        try {
          return new RegexValue(new RegExp(e.pattern, e.flags))
        } catch (err) {
          return new ErrorValue(`invalid regex: ${err instanceof Error ? err.message : String(err)}`)
        }
      case 'ident': return this.ident(e.name, locals)
      case 'member': return this.member(e, locals)
      case 'index': return this.index(e, locals)
      case 'call': return this.call(e, locals)
      case 'method': return this.method(e, locals)
      case 'unary': {
        const v = this.eval(e.operand, locals)
        if (v instanceof ErrorValue) return v
        if (e.op === '!') return !isTruthy(v)
        if (v instanceof DurationValue) return new DurationValue(-v.ms)
        const n = toNumber(v)
        return n instanceof ErrorValue ? n : -n
      }
      case 'binary': {
        const left = this.eval(e.left, locals)
        if (left instanceof ErrorValue) return left
        if (e.op === '&&') return isTruthy(left) ? this.eval(e.right, locals) : left
        if (e.op === '||') return isTruthy(left) ? left : this.eval(e.right, locals)
        const right = this.eval(e.right, locals)
        if (right instanceof ErrorValue) return right
        return binaryOp(e.op, left, right, this.scope.resolve)
      }
    }
  }

  /** Evaluates in order; the first ErrorValue wins. */
  private evalArgs(args: Expr[], locals: Locals): Value[] | ErrorValue {
    const out: Value[] = []
    for (const a of args) {
      const v = this.eval(a, locals)
      if (v instanceof ErrorValue) return v
      out.push(v)
    }
    return out
  }

  private prop(name: string): Value {
    return fromYaml(hasOwn(this.scope.note, name) ? this.scope.note[name] : undefined)
  }

  private ident(name: string, locals: Locals): Value {
    if (locals && hasOwn(locals, name)) return locals[name]
    switch (name) {
      case 'file': return this.scope.file
      case 'this': return this.scope.this
      case 'note': return fromYaml(this.scope.note)
      case 'formula': return new ErrorValue('formula needs a name: formula.<name>')
    }
    const extra = this.scope.extra
    if (extra && hasOwn(extra, name)) return extra[name]
    if (hasFunction(name)) return new ErrorValue(`${name} is a function; call it as ${name}()`)
    return this.prop(name)
  }

  /** `note` / `formula` as the object of a member or index are namespaces, not values. */
  private namespace(e: Expr, locals: Locals): 'note' | 'formula' | null {
    if (e.type !== 'ident' || (locals && hasOwn(locals, e.name))) return null
    return e.name === 'note' || e.name === 'formula' ? e.name : null
  }

  private lookup(ns: 'note' | 'formula', name: string): Value {
    return ns === 'note' ? this.prop(name) : this.formula(name)
  }

  private member(e: Extract<Expr, { type: 'member' }>, locals: Locals): Value {
    const ns = this.namespace(e.object, locals)
    if (ns) return this.lookup(ns, e.name)
    return getField(this.eval(e.object, locals), e.name)
  }

  private index(e: Extract<Expr, { type: 'index' }>, locals: Locals): Value {
    const ns = this.namespace(e.object, locals)
    const obj = ns ? null : this.eval(e.object, locals)
    if (obj instanceof ErrorValue) return obj
    const key = this.eval(e.index, locals)
    if (key instanceof ErrorValue) return key
    if (ns) return typeof key === 'string' ? this.lookup(ns, key) : new ErrorValue(`${ns}[...] needs a string key`)
    if (obj === null) return null
    if (typeof obj === 'string' || Array.isArray(obj)) {
      if (typeof key !== 'number') return new ErrorValue(`${typeOf(obj)} index must be a number, got ${typeOf(key)}`)
      const i = key < 0 ? obj.length + key : key
      return i >= 0 && i < obj.length ? obj[i] : null
    }
    if (typeof key !== 'string') return new ErrorValue(`${typeOf(obj)} key must be a string, got ${typeOf(key)}`)
    if (typeOf(obj) === 'object' || typeOf(obj) === 'file') return getField(obj, key)
    return new ErrorValue(`cannot index ${typeOf(obj)}`)
  }

  private formula(name: string): Value {
    const hit = this.memo.get(name)
    if (hit !== undefined) return hit
    if (this.inProgress.has(name)) return new ErrorValue(`formula cycle: ${name}`)
    if (!hasOwn(this.scope.formulas, name)) return new ErrorValue(`unknown formula ${name}`)
    const compiled = compile(this.scope.formulas[name])
    if (compiled.error) return new ErrorValue(`formula ${name}: ${compiled.error.message}`)
    this.inProgress.add(name)
    const v = this.eval(compiled.expr, null)
    this.inProgress.delete(name)
    this.memo.set(name, v)
    return v
  }

  private call(e: Extract<Expr, { type: 'call' }>, locals: Locals): Value {
    if (e.name === 'if') {
      if (e.args.length < 2 || e.args.length > 3) return new ErrorValue('if() takes 2 or 3 arguments')
      const cond = this.eval(e.args[0], locals)
      if (cond instanceof ErrorValue) return cond
      if (isTruthy(cond)) return this.eval(e.args[1], locals)
      return e.args.length === 3 ? this.eval(e.args[2], locals) : null
    }
    if (!hasFunction(e.name)) return new ErrorValue(`unknown function ${e.name}`)
    const args = this.evalArgs(e.args, locals)
    if (args instanceof ErrorValue) return args
    return guard(() => FUNCTIONS[e.name](args, this.scope))
  }

  private method(e: Extract<Expr, { type: 'method' }>, locals: Locals): Value {
    const recv = this.eval(e.object, locals)
    if (recv instanceof ErrorValue) {
      if (e.name === 'isEmpty') return true
      if (e.name === 'isTruthy') return false
      return recv
    }
    if (Array.isArray(recv) && LAMBDA_METHODS.has(e.name)) return this.lambda(recv, e, locals)
    const args = this.evalArgs(e.args, locals)
    if (args instanceof ErrorValue) return args
    return guard(() => callMethod(recv, e.name, args, this.scope))
  }

  /** `filter/map/reduce`: the first argument is an expression run with `value`, `index` (and `acc`) bound. */
  private lambda(list: Value[], e: Extract<Expr, { type: 'method' }>, locals: Locals): Value {
    const body = e.args[0]
    if (!body) return new ErrorValue(`${e.name}() needs an expression`)
    if (e.name === 'reduce') {
      if (e.args.length < 2) return new ErrorValue('reduce() needs an expression and an initial value')
      let acc = this.eval(e.args[1], locals)
      for (let index = 0; index < list.length && !(acc instanceof ErrorValue); index++) {
        acc = this.eval(body, { ...locals, value: list[index], index, acc })
      }
      return acc
    }
    const out: Value[] = []
    for (let index = 0; index < list.length; index++) {
      const value = list[index]
      const r = this.eval(body, { ...locals, value, index })
      if (r instanceof ErrorValue) return r
      if (e.name === 'map') out.push(r)
      else if (isTruthy(r)) out.push(value)
    }
    return out
  }
}

/** Builtins signal bad arguments by throwing ArgError; surface it as a value. */
function guard(run: () => Value): Value {
  try {
    return run()
  } catch (err) {
    if (err instanceof ArgError) return new ErrorValue(err.message)
    throw err
  }
}

/** Evaluates `expr` against `scope`; never throws, returns ErrorValue instead (GRO-2131). */
export function evaluate(expr: Expr, scope: Scope): Value {
  try {
    return new Evaluator(scope).eval(expr, null)
  } catch (err) {
    return new ErrorValue(err instanceof Error ? err.message : String(err))
  }
}
