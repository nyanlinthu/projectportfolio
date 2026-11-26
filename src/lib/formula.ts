// Spreadsheet formulas for table elements. Pure functions, no React, no stores: the table UI, global search and the
// AI tool layer all read computed values through here.
//
// Cells hold raw strings. A cell starting with "=" is a formula. References are Excel-style: A1 is column A,
// first data row (the header row is not counted). Ranges: A1:B3, whole columns: A:A.
// Supported: + - * / ^ %, & (join text), = <> < > <= >=, and the functions listed in FUNCTION_HELP below.
// The host may add zero-argument functions (see `Env`), which is how a table reads the card it lives on.

/** What IMAGE(url) returns: the cell shows the picture instead of text. */
export class ImageValue {
  constructor(public src: string) {}
}
export type Value = number | string | boolean | ImageValue
/** Extra functions supplied by whoever evaluates the grid, e.g. PROGRESS() of the owning card. */
export type Env = Record<string, () => Value>

/** Shown as a hint while a formula is being typed. One line per function: signature, then what it does. */
export const FUNCTION_HELP: Record<string, string> = {
  SUM: 'SUM(range, …) — add up the numbers',
  AVERAGE: 'AVERAGE(range, …) — mean of the numbers',
  MIN: 'MIN(range, …) — smallest number',
  MAX: 'MAX(range, …) — largest number',
  COUNT: 'COUNT(range, …) — how many cells hold numbers',
  COUNTA: 'COUNTA(range, …) — how many cells are not empty',
  PRODUCT: 'PRODUCT(range, …) — multiply the numbers',
  SUBTOTAL: 'SUBTOTAL(code, range) — 1 average, 2 count, 3 counta, 4 max, 5 min, 9 sum',
  SUMIF: 'SUMIF(range, test, [sum_range]) — add where the test holds, e.g. ">100" or "Done"',
  COUNTIF: 'COUNTIF(range, test) — count where the test holds',
  VLOOKUP: 'VLOOKUP(value, range, column, [approximate]) — find value in the first column, return that row\'s column',
  IF: 'IF(test, then, else)',
  AND: 'AND(a, b, …)', OR: 'OR(a, b, …)', NOT: 'NOT(a)',
  ROUND: 'ROUND(number, [digits])', ABS: 'ABS(number)',
  CONCAT: 'CONCAT(a, b, …) — join text', LEN: 'LEN(text)', UPPER: 'UPPER(text)', LOWER: 'LOWER(text)',
  TODAY: 'TODAY() — today\'s date',
  IMAGE: 'IMAGE("https://…") — show a picture in the cell',
  PROGRESS: 'PROGRESS() — percent complete of the card this table sits on',
  TASKS: 'TASKS() — number of tasks under that card',
  DONE: 'DONE() — how many of them are done',
  CARD: 'CARD() — that card\'s name',
}
export class FormulaError extends Error {
  constructor(public code: string) { super(code) }
}
export type Cell = Value | FormulaError

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))
      if (!m) throw new FormulaError('#ERROR!')
      out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue
    }
    if (ch === '"') {
      let j = i + 1, s = ''
      while (j < src.length && src[j] !== '"') s += src[j++]
      if (j >= src.length) throw new FormulaError('#ERROR!')
      out.push({ t: 'str', v: s }); i = j + 1; continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i)) as RegExpExecArray
      out.push({ t: 'id', v: m[0].toUpperCase().replace(/\$/g, '') }); i += m[0].length; continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/^&=<>(),:%'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue }
    throw new FormulaError('#ERROR!')
  }
  return out
}

const CELL = /^([A-Z]{1,2})(\d+)$/, COL = /^[A-Z]{1,2}$/
const colIndex = (letters: string): number => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
/** 0 -> A, 25 -> Z, 26 -> AA */
export const colLetter = (i: number): string => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))

const blank = (v: Value): boolean => v === ''
const toNum = (v: Value): number => {
  if (v instanceof ImageValue) throw new FormulaError('#VALUE!')
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v.trim() === '') return 0
  const n = Number(v)
  if (Number.isNaN(n)) throw new FormulaError('#VALUE!')
  return n
}
const toBool = (v: Value): boolean => (typeof v === 'string' ? v.trim() !== '' && v.toUpperCase() !== 'FALSE' : !!v)
const toText = (v: Value): string => (v instanceof ImageValue ? v.src : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))

/** A range keeps its shape (rows of cells) because VLOOKUP and SUMIF need it. */
class Range {
  constructor(public rows: Value[][]) {}
  get flat(): Value[] { return this.rows.flat() }
}
type Arg = Value | Range
const flat = (args: Arg[]): Value[] => args.flatMap((a) => (a instanceof Range ? a.flat : [a]))
/** numbers inside ranges count only if they are numbers (blank and text are skipped, like a spreadsheet) */
const nums = (args: Arg[]): number[] => args.flatMap((a) => (a instanceof Range ? a.flat.filter((v): v is number => typeof v === 'number') : [toNum(a)]))
const scalar = (a: Arg | undefined): Value => { if (a === undefined || a instanceof Range) throw new FormulaError('#VALUE!'); return a }
const range = (a: Arg | undefined): Range => { if (!(a instanceof Range)) throw new FormulaError('#VALUE!'); return a }
const sum = (n: number[]): number => n.reduce((x, y) => x + y, 0)
const average = (n: number[]): number => { if (!n.length) throw new FormulaError('#DIV/0!'); return sum(n) / n.length }
const loose = (a: Value, b: Value): boolean => (typeof a === 'string' || typeof b === 'string' ? toText(a).toLowerCase() === toText(b).toLowerCase() : toNum(a) === toNum(b))

/** A SUMIF/COUNTIF test: ">10", "<=5", "<>Done", or a plain value to match. */
function criterion(test: Value): (v: Value) => boolean {
  const m = typeof test === 'string' ? /^(<=|>=|<>|<|>|=)(.*)$/.exec(test.trim()) : null
  if (!m) return (v) => !blank(v) && loose(v, test)
  const want = literal(m[2])
  return (v) => {
    if (m[1] === '=') return loose(v, want)
    if (m[1] === '<>') return !loose(v, want)
    if (typeof v !== 'number' || typeof want !== 'number') return false
    return m[1] === '<' ? v < want : m[1] === '>' ? v > want : m[1] === '<=' ? v <= want : v >= want
  }
}

const SUBTOTALS: Record<number, (a: Arg[]) => Value> = {
  1: (a) => average(nums(a)), 2: (a) => nums(a).length, 3: (a) => flat(a).filter((v) => !blank(v)).length,
  4: (a) => Math.max(0, ...nums(a)), 5: (a) => Math.min(...(nums(a).length ? nums(a) : [0])), 9: (a) => sum(nums(a)),
}

const FUNCS: Record<string, (args: Arg[]) => Value> = {
  SUM: (a) => sum(nums(a)),
  AVERAGE: (a) => average(nums(a)),
  MIN: (a) => { const n = nums(a); return n.length ? Math.min(...n) : 0 },
  MAX: (a) => { const n = nums(a); return n.length ? Math.max(...n) : 0 },
  PRODUCT: (a) => nums(a).reduce((x, y) => x * y, 1),
  COUNT: (a) => flat(a).filter((v) => typeof v === 'number').length,
  COUNTA: (a) => flat(a).filter((v) => !blank(v)).length,
  // 101-111 are the same functions in Excel (they differ only for hidden rows, which do not exist here)
  SUBTOTAL: (a) => { const fn = SUBTOTALS[toNum(scalar(a[0])) % 100]; if (!fn) throw new FormulaError('#VALUE!'); return fn(a.slice(1)) },
  COUNTIF: (a) => range(a[0]).flat.filter(criterion(scalar(a[1]))).length,
  SUMIF: (a) => {
    const test = criterion(scalar(a[1])), where = range(a[0]).flat, what = a.length > 2 ? range(a[2]).flat : where
    return where.reduce<number>((t, v, i) => (test(v) && typeof what[i] === 'number' ? t + (what[i] as number) : t), 0)
  },
  VLOOKUP: (a) => {
    const key = scalar(a[0]), table = range(a[1]).rows, col = toNum(scalar(a[2])) - 1
    if (col < 0 || col >= (table[0]?.length ?? 0)) throw new FormulaError('#REF!')
    const approximate = a.length > 3 && toBool(scalar(a[3]))
    let hit = table.find((r) => !blank(r[0]) && loose(r[0], key))
    // approximate: the last row whose first cell is not above the value (the column must be sorted ascending)
    if (!hit && approximate && typeof key === 'number') hit = [...table].reverse().find((r) => typeof r[0] === 'number' && r[0] <= key)
    if (!hit) throw new FormulaError('#N/A')
    return hit[col]
  },
  IF: (a) => (toBool(scalar(a[0])) ? scalar(a[1]) : a.length > 2 ? scalar(a[2]) : false),
  ROUND: (a) => { const k = 10 ** (a.length > 1 ? toNum(scalar(a[1])) : 0); return Math.round(toNum(scalar(a[0])) * k) / k },
  ABS: (a) => Math.abs(toNum(scalar(a[0]))),
  AND: (a) => flat(a).every(toBool),
  OR: (a) => flat(a).some(toBool),
  NOT: (a) => !toBool(scalar(a[0])),
  CONCAT: (a) => flat(a).map(toText).join(''),
  LEN: (a) => toText(scalar(a[0])).length,
  UPPER: (a) => toText(scalar(a[0])).toUpperCase(),
  LOWER: (a) => toText(scalar(a[0])).toLowerCase(),
  TODAY: () => new Date().toISOString().slice(0, 10),
  IMAGE: (a) => {
    const src = toText(scalar(a[0])).trim()
    // pictures only from the web or pasted data; never javascript: or other schemes
    if (!/^(https:\/\/|data:image\/)/i.test(src)) throw new FormulaError('#VALUE!')
    return new ImageValue(src)
  },
}
FUNCS.AVG = FUNCS.AVERAGE

interface Sheet { rows: number; cols: number; at: (r: number, c: number) => Value; env: Env }

function run(src: string, sheet: Sheet): Value {
  const toks = tokenize(src)
  let p = 0
  const peek = (): Tok | undefined => toks[p]
  const isOp = (v: string): boolean => { const t = toks[p]; return !!t && t.t === 'op' && t.v === v }
  const eat = (v: string): void => { if (!isOp(v)) throw new FormulaError('#ERROR!'); p++ }

  const cellAt = (ref: string): Value => {
    const m = CELL.exec(ref) as RegExpExecArray
    const c = colIndex(m[1]), r = Number(m[2]) - 1
    if (r < 0 || r >= sheet.rows || c >= sheet.cols) throw new FormulaError('#REF!')
    return sheet.at(r, c)
  }
  const rangeOf = (a: string, b: string): Range => {
    let r0: number, r1: number, c0: number, c1: number
    if (COL.test(a) && COL.test(b)) { r0 = 0; r1 = sheet.rows - 1; c0 = colIndex(a); c1 = colIndex(b) }
    else {
      const ma = CELL.exec(a), mb = CELL.exec(b)
      if (!ma || !mb) throw new FormulaError('#ERROR!')
      r0 = Number(ma[2]) - 1; r1 = Number(mb[2]) - 1; c0 = colIndex(ma[1]); c1 = colIndex(mb[1])
    }
    if (r0 > r1) [r0, r1] = [r1, r0]
    if (c0 > c1) [c0, c1] = [c1, c0]
    if (r0 < 0 || c1 >= sheet.cols) throw new FormulaError('#REF!')
    const out: Value[][] = []
    for (let r = r0; r <= Math.min(r1, sheet.rows - 1); r++) { const row: Value[] = []; for (let c = c0; c <= c1; c++) row.push(sheet.at(r, c)); out.push(row) }
    return new Range(out)
  }

  const arg = (): Arg => {
    const a = toks[p], b = toks[p + 1], c = toks[p + 2]
    if (a?.t === 'id' && b?.t === 'op' && b.v === ':' && c?.t === 'id') { p += 3; return rangeOf(a.v, c.v) }
    return expr()
  }
  const primary = (): Value => {
    const t = peek()
    if (!t) throw new FormulaError('#ERROR!')
    p++
    if (t.t === 'num' || t.t === 'str') return t.v
    if (t.t === 'op') {
      if (t.v === '(') { const v = expr(); eat(')'); return v }
      throw new FormulaError('#ERROR!')
    }
    if (isOp('(')) {
      const fn = FUNCS[t.v] ?? (sheet.env[t.v] ? (): Value => sheet.env[t.v]() : undefined)
      if (!fn) throw new FormulaError('#NAME?')
      p++
      const args: Arg[] = []
      if (!isOp(')')) { args.push(arg()); while (isOp(',')) { p++; args.push(arg()) } }
      eat(')')
      return fn(args)
    }
    if (t.v === 'TRUE') return true
    if (t.v === 'FALSE') return false
    if (CELL.test(t.v)) return cellAt(t.v)
    throw new FormulaError('#NAME?')
  }
  const postfix = (): Value => { let v = primary(); while (isOp('%')) { p++; v = toNum(v) / 100 } return v }
  const unary = (): Value => {
    if (isOp('-')) { p++; return -toNum(unary()) }
    if (isOp('+')) { p++; return toNum(unary()) }
    return postfix()
  }
  const power = (): Value => { const b = unary(); if (isOp('^')) { p++; return toNum(b) ** toNum(power()) } return b }
  const mult = (): Value => {
    let v = power()
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as Tok).v, r = toNum(power())
      if (op === '/' && r === 0) throw new FormulaError('#DIV/0!')
      v = op === '*' ? toNum(v) * r : toNum(v) / r
    }
    return v
  }
  const add = (): Value => {
    let v = mult()
    while (isOp('+') || isOp('-')) { const op = (toks[p++] as Tok).v, r = toNum(mult()); v = op === '+' ? toNum(v) + r : toNum(v) - r }
    return v
  }
  const concat = (): Value => { let v = add(); while (isOp('&')) { p++; v = toText(v) + toText(add()) } return v }
  const cmp = (a: Value, b: Value): number => {
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0
    if (typeof a === 'string' || typeof b === 'string') return toText(a).toLowerCase() === toText(b).toLowerCase() ? 0 : 1 // "Done" = 5 is simply false
    return toNum(a) - toNum(b)
  }
  function expr(): Value {
    let v = concat()
    for (;;) {
      const t = peek()
      if (!t || t.t !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(t.v)) return v
      p++
      const d = cmp(v, concat())
      v = t.v === '=' ? d === 0 : t.v === '<>' ? d !== 0 : t.v === '<' ? d < 0 : t.v === '>' ? d > 0 : t.v === '<=' ? d <= 0 : d >= 0
    }
  }
  const v = expr()
  if (p < toks.length) throw new FormulaError('#ERROR!')
  return v
}

/** A typed cell that is not a formula: numbers become numbers, true/false booleans, the rest stays text. */
export function literal(raw: string): Value {
  const t = raw.trim()
  if (t === '') return ''
  if (!Number.isNaN(Number(t))) return Number(t)
  if (/^true$/i.test(t)) return true
  if (/^false$/i.test(t)) return false
  return raw
}

/** Compute every cell of a grid of raw strings. Each formula is evaluated once; loops come back as #CYCLE!. */
export function evaluateGrid(grid: string[][], env: Env = {}): Cell[][] {
  const rows = grid.length, cols = Math.max(0, ...grid.map((r) => r.length))
  const done = new Map<number, Cell>()
  const busy = new Set<number>()
  const at = (r: number, c: number): Value => {
    const key = r * 1000 + c
    const hit = done.get(key)
    if (hit !== undefined) { if (hit instanceof FormulaError) throw hit; return hit }
    const raw = grid[r]?.[c] ?? ''
    if (!raw.startsWith('=')) { const v = literal(raw); done.set(key, v); return v }
    if (busy.has(key)) throw new FormulaError('#CYCLE!')
    busy.add(key)
    try {
      const v = run(raw.slice(1), { rows, cols, at, env })
      done.set(key, v)
      return v
    } catch (e) {
      const err = e instanceof FormulaError ? e : new FormulaError('#ERROR!')
      done.set(key, err)
      throw err
    } finally { busy.delete(key) }
  }
  return grid.map((row, r) => Array.from({ length: cols }, (_, c) => { void row; try { return at(r, c) } catch (e) { return e instanceof FormulaError ? e : new FormulaError('#ERROR!') } }))
}

/** How a computed cell reads on screen and in search. */
export function display(v: Cell): string {
  if (v instanceof FormulaError) return v.code
  if (v instanceof ImageValue) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '#NUM!'
  return v
}

/** Excel closes brackets you forgot. `=SUM(A1:A3` becomes `=SUM(A1:A3)`. */
export function closeBrackets(raw: string): string {
  if (!raw.startsWith('=')) return raw
  let open = 0, inText = false
  for (const ch of raw) { if (ch === '"') inText = !inText; else if (!inText) { if (ch === '(') open++; else if (ch === ')') open-- } }
  return open > 0 ? raw + ')'.repeat(open) : raw
}

/** Would a cell reference make sense at this point of the formula? (after "=", "(", ",", an operator or ":") */
export const wantsReference = (rawUpToCaret: string): boolean => rawUpToCaret.startsWith('=') && /[=(,+\-*/^&<>:]\s*$/.test(rawUpToCaret)

/** The function name being typed just before the caret, for the hint line. */
export function functionAtCaret(rawUpToCaret: string): string | null {
  if (!rawUpToCaret.startsWith('=')) return null
  const typing = /([A-Za-z]+)$/.exec(rawUpToCaret)
  if (typing) return typing[1].toUpperCase()
  // inside the brackets of a function: the innermost unclosed one
  let depth = 0
  for (let i = rawUpToCaret.length - 1; i >= 0; i--) {
    const ch = rawUpToCaret[i]
    if (ch === ')') depth++
    else if (ch === '(') { if (depth === 0) { const m = /([A-Za-z]+)$/.exec(rawUpToCaret.slice(0, i)); return m ? m[1].toUpperCase() : null } depth-- }
  }
  return null
}
