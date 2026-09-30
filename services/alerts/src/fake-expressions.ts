// Test helper: evaluates the small subset of DynamoDB condition and update
// expressions the Alerts handler writes, so its tests exercise the real
// claim conditions against a stored row instead of matching strings.
//
// Conditions: attribute_exists(a), attribute_not_exists(a), a = :v, a < :v,
// AND, OR and parentheses. Updates: SET a = :v, ... and REMOVE a, ...
// Anything else throws, so a new expression form fails loudly.

type Item = Record<string, unknown>;
type Values = Record<string, unknown>;

export function evaluateCondition(expr: string, item: Item | undefined, values: Values): boolean {
  const tokens = expr.match(/\(|\)|[A-Za-z_][A-Za-z0-9_]*\([A-Za-z0-9_]+\)|:[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*|=|</g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function primary(): boolean {
    const t = next();
    if (t === '(') {
      const v = or();
      if (next() !== ')') throw new Error(`unbalanced parentheses in ${expr}`);
      return v;
    }
    const fn = /^(attribute_exists|attribute_not_exists)\(([A-Za-z0-9_]+)\)$/.exec(t ?? '');
    if (fn) {
      const present = item !== undefined && item[fn[2]] !== undefined;
      return fn[1] === 'attribute_exists' ? present : !present;
    }
    const op = next();
    const rhs = next();
    if (!rhs?.startsWith(':') || !(rhs in values)) throw new Error(`unsupported operand ${rhs} in ${expr}`);
    const left = item?.[t as string];
    const right = values[rhs];
    if (op === '=') return left !== undefined && left === right;
    if (op === '<') return typeof left === 'number' && typeof right === 'number' && left < right;
    throw new Error(`unsupported operator ${op} in ${expr}`);
  }
  function and(): boolean {
    let v = primary();
    while (peek() === 'AND') {
      next();
      const r = primary();
      v = v && r;
    }
    return v;
  }
  function or(): boolean {
    let v = and();
    while (peek() === 'OR') {
      next();
      const r = and();
      v = v || r;
    }
    return v;
  }
  const result = or();
  if (i !== tokens.length) throw new Error(`trailing tokens in ${expr}`);
  return result;
}

export function applyUpdate(expr: string, item: Item, values: Values): void {
  for (const clause of expr.split(/\s+(?=SET |REMOVE )/)) {
    const m = /^(SET|REMOVE)\s+(.+)$/.exec(clause.trim());
    if (!m) throw new Error(`unsupported update ${expr}`);
    for (const part of m[2].split(',').map((p) => p.trim())) {
      if (m[1] === 'REMOVE') {
        delete item[part];
        continue;
      }
      const set = /^([A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)$/.exec(part);
      if (!set || !(set[2] in values)) throw new Error(`unsupported SET ${part}`);
      item[set[1]] = values[set[2]];
    }
  }
}
