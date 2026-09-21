/**
 * AST for the Bases expression language (GRO-2130). `pos` is a 0-based
 * offset into the source: the token start for leaves, the operator for
 * unary/binary, the `.` / `[` for member/index/method, the name for calls.
 */

export type BinaryOp =
  | '||' | '&&'
  | '==' | '!='
  | '<' | '>' | '<=' | '>='
  | '+' | '-' | '*' | '/' | '%'

export type UnaryOp = '!' | '-'

export type Expr =
  | { type: 'str'; value: string; pos: number }
  | { type: 'num'; value: number; pos: number }
  | { type: 'bool'; value: boolean; pos: number }
  | { type: 'null'; pos: number }
  | { type: 'list'; items: Expr[]; pos: number }
  | { type: 'object'; entries: { key: string; value: Expr }[]; pos: number }
  | { type: 'regex'; pattern: string; flags: string; pos: number }
  | { type: 'ident'; name: string; pos: number }
  | { type: 'member'; object: Expr; name: string; pos: number }
  | { type: 'index'; object: Expr; index: Expr; pos: number }
  | { type: 'call'; name: string; args: Expr[]; pos: number }
  | { type: 'method'; object: Expr; name: string; args: Expr[]; pos: number }
  | { type: 'unary'; op: UnaryOp; operand: Expr; pos: number }
  | { type: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: number }
