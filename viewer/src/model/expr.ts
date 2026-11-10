// Arithmetic over table columns, e.g. "energy / sigmaNoise" or "hypot(x, y) < 50 && layer == 26".
// The text is parsed into a tree that only admits numbers, column names, operators and a fixed list of Math
// functions; the tree is then printed as one JavaScript loop over the rows, so evaluation runs at JIT speed.
// Nothing typed is executed as written: columns become array references, numbers are re-printed from their value.

const FUNCTIONS: Record<string, [number, number]> = { // name -> [min, max] number of arguments
  abs: [1, 1], sqrt: [1, 1], cbrt: [1, 1], exp: [1, 1], log: [1, 1], log10: [1, 1], log2: [1, 1],
  sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1], sinh: [1, 1], cosh: [1, 1], tanh: [1, 1],
  floor: [1, 1], ceil: [1, 1], round: [1, 1], sign: [1, 1], atan2: [2, 2], pow: [2, 2], hypot: [1, 8], min: [1, 8], max: [1, 8],
};
const CONSTANTS: Record<string, number> = { pi: Math.PI };
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

type Node =
  | { k: "num"; v: number }
  | { k: "col"; name: string }
  | { k: "op"; op: string; args: Node[] } // unary when one argument
  | { k: "call"; f: string; args: Node[] };

export interface Compiled {
  columns: string[]; // the columns it reads, in argument order of run()
  boolean: boolean; // a comparison or logical expression: 1 or 0 per row
  run(columns: ArrayLike<number>[], n: number): Float32Array;
}

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(\*\*|<=|>=|==|!=|&&|\|\||[-+*/%^<>!(),]))/y;
const LEVELS = [["||"], ["&&"], ["==", "!="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"]]; // loosest first
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const LOGICAL = new Set(["||", "&&", "==", "!=", "<", "<=", ">", ">=", "!"]);

/** Parse `src` against the available column names; throws an Error with a readable message. */
export function compile(src: string, available: Iterable<string>): Compiled {
  const known = new Set(available);
  const tokens: string[] = [];
  for (let at = 0; /\S/.test(src.slice(at)); at = TOKEN.lastIndex) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(at).trim()[0]}"`);
    tokens.push(m[0].trim());
  }
  if (!tokens.length) throw new Error("empty expression");
  let pos = 0;
  const peek = () => tokens[pos], next = () => tokens[pos++];
  const expect = (t: string) => { if (next() !== t) throw new Error(`expected "${t}"`); };

  const binary = (level: number): Node => {
    if (level === LEVELS.length) return unary();
    let a = binary(level + 1);
    while (LEVELS[level].includes(peek())) a = { k: "op", op: next(), args: [a, binary(level + 1)] };
    return a;
  };
  const unary = (): Node => (peek() === "-" || peek() === "!" || peek() === "+" ? { k: "op", op: next(), args: [unary()] } : power());
  const power = (): Node => { // right-associative, tighter than unary minus: -x^2 = -(x^2)
    const a = primary();
    return peek() === "^" || peek() === "**" ? (next(), { k: "op", op: "**", args: [a, unary()] }) : a;
  };
  const primary = (): Node => {
    const t = next();
    if (t === undefined) throw new Error("incomplete expression");
    if (t === "(") { const e = binary(0); expect(")"); return e; }
    if (/^[\d.]/.test(t)) return { k: "num", v: Number(t) };
    if (!/^[A-Za-z_]/.test(t)) throw new Error(`unexpected "${t}"`);
    if (peek() === "(") {
      if (!own(FUNCTIONS, t)) throw new Error(`unknown function "${t}"`);
      next();
      const args: Node[] = [];
      if (peek() !== ")") do args.push(binary(0)); while (peek() === "," && next());
      expect(")");
      const [lo, hi] = FUNCTIONS[t];
      if (args.length < lo || args.length > hi) throw new Error(`${t}() takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi > 1 ? "s" : ""}`);
      return { k: "call", f: t, args };
    }
    if (known.has(t)) return { k: "col", name: t };
    if (own(CONSTANTS, t)) return { k: "num", v: CONSTANTS[t] };
    throw new Error(`no column "${t}" in this table`);
  };

  const tree = binary(0);
  if (pos < tokens.length) throw new Error(`unexpected "${tokens[pos]}"`);

  const columns: string[] = [];
  const js = (n: Node): string => {
    switch (n.k) {
      case "num": return `(${n.v})`;
      case "col": { let i = columns.indexOf(n.name); if (i < 0) i = columns.push(n.name) - 1; return `c${i}[i]`; }
      case "call": return `M.${n.f}(${n.args.map(js).join(", ")})`;
      case "op": {
        const [a, b] = n.args.map(js);
        if (n.args.length === 1) return n.op === "!" ? `(${a} ? 0 : 1)` : `(${n.op}${a})`;
        const op = n.op === "==" ? "===" : n.op === "!=" ? "!==" : n.op;
        return LOGICAL.has(n.op) ? `((${a} ${op} ${b}) ? 1 : 0)` : `(${a} ${op} ${b})`;
      }
    }
  };
  const body = js(tree);
  const loop = new Function("cols", "n", "M", `"use strict"; const [${columns.map((_, i) => `c${i}`).join(", ")}] = cols;
    const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = ${body}; return o;`) as (c: ArrayLike<number>[], n: number, m: Math) => Float32Array;
  return { columns, boolean: tree.k === "op" && LOGICAL.has(tree.op), run: (cols, n) => loop(cols, n, Math) };
}
