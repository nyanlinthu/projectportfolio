import { closeBrackets, display, evaluateGrid, functionAtCaret, ImageValue, wantsReference } from '../src/lib/formula'

let failed = 0
const check = (name: string, got: unknown, want: unknown): void => {
  if (got !== want) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}
//            A        B      C
const g = evaluateGrid([
  ['Desk',  '120',  '2'],                        // 1
  ['Chair', '45.5', '4'],                        // 2
  ['Lamp',  '',     '1'],                        // 3
  ['Total', '=SUM(B1:B3)', '=SUM(C:C)'],         // 4  (C:C includes itself -> cycle)
  ['=B1*C1', '=B2*C2+1', '=A5+B5'],              // 5
  ['=IF(B4>100,"big","small")', '=ROUND(AVERAGE(B1:B3),1)', '=COUNT(B1:B3)&" priced"'],  // 6
  ['=1/0', '=NOPE(1)', '=Z9'],                   // 7
  ['=A8', '=-2^2', '=10%+MAX(C1:C3)'],           // 8
  ['=AND(B1>100,C1=2)', '=LEN(A1)', '=COUNTA(A1:B3)'],  // 9
  ['=(1+2)*3', '=A1&"-"&A2', '=MIN(B1:B2)'],     // 10
]).map((r) => r.map(display))

check('sum range', g[3][1], '165.5')
check('whole column incl self is a cycle', g[3][2], '#CYCLE!')
check('multiply', g[4][0], '240')
check('precedence', g[4][1], '183')
check('chain', g[4][2], '423')
check('if + text', g[5][0], 'big')
check('round average skips blank', g[5][1], '82.8')
check('count + concat', g[5][2], '2 priced')
check('div by zero', g[6][0], '#DIV/0!')
check('unknown function', g[6][1], '#NAME?')
check('bad ref', g[6][2], '#REF!')
check('self reference', g[7][0], '#CYCLE!')
check('unary minus binds tighter than ^ operand', g[7][1], '4')
check('percent + max', g[7][2], '4.1')
check('and', g[8][0], 'TRUE')
check('len', g[8][1], '4')
check('counta', g[8][2], '5')
check('parens', g[9][0], '9')
check('text join', g[9][1], 'Desk-Chair')
check('min', g[9][2], '45.5')

// --- second sheet: lookups, conditional maths, pictures, and reading the owning card
//             A         B       C
const raw = [
  ['Desk',   '120',  'Office'],                                   // 1
  ['Chair',  '45.5', 'Office'],                                   // 2
  ['Laptop', '900',  'IT'],                                       // 3
  ['=VLOOKUP("chair",A1:C3,2)', '=SUBTOTAL(9,B1:B3)', '=SUBTOTAL(1,B1:B3)'],        // 4
  ['=SUMIF(C1:C3,"Office",B1:B3)', '=COUNTIF(B1:B3,">100")', '=SUMIF(B1:B3,">=120")'],  // 5
  ['=VLOOKUP("Sofa",A1:C3,2)', '=VLOOKUP(100,B1:C3,2,TRUE)', '=IMAGE("https://example.com/a.png")'],  // 6
  ['=IMAGE("javascript:alert(1)")', '=PROGRESS()&"% of "&CARD()', '=DONE()/TASKS()'],   // 7
  ['=sum(b1:b3)', '=PRODUCT(2,3,4)', '=UPPER(A1)&LOWER(C3)'],     // 8
  ['=SUBTOTAL(109,B1:B3)', '=COUNTA(A1:C3)', '=IF(C1="Office","y","n")'],            // 9
]
const cells = evaluateGrid(raw, { PROGRESS: () => 40, CARD: () => 'Mobile app', TASKS: () => 5, DONE: () => 2 })
const h = cells.map((r) => r.map(display))
check('vlookup exact, case-insensitive', h[3][0], '45.5')
check('subtotal sum', h[3][1], '1,065.5')
check('subtotal average', h[3][2], '355.1667')
check('sumif with sum range', h[4][0], '165.5')
check('countif comparison', h[4][1], '2')
check('sumif on itself', h[4][2], '1,020')
check('vlookup miss', h[5][0], '#N/A')
check('vlookup approximate', h[5][1], 'Office')
check('image value', cells[5][2] instanceof ImageValue && cells[5][2].src, 'https://example.com/a.png')
check('image refuses a script url', h[6][0], '#VALUE!')
check('reads the owning card', h[6][1], '40% of Mobile app')
check('card task maths', h[6][2], '0.4')
check('lowercase function and refs', h[7][0], '1,065.5')
check('product', h[7][1], '24')
check('upper/lower', h[7][2], 'DESKit')
check('subtotal 109', h[8][0], '1,065.5')
check('counta', h[8][1], '9')
check('text comparison', h[8][2], 'y')
check('closes forgotten brackets', closeBrackets('=SUM(A1:A3'), '=SUM(A1:A3)')
check('closes nested brackets', closeBrackets('=ROUND(SUM(A1:A3'), '=ROUND(SUM(A1:A3))')
check('leaves text alone', closeBrackets('(hello'), '(hello')
check('reference wanted after bracket', wantsReference('=sum('), true)
check('reference wanted after operator', wantsReference('=A1+'), true)
check('reference not wanted mid-name', wantsReference('=su'), false)
check('hint while typing a name', functionAtCaret('=vlo'), 'VLO')
check('hint inside brackets', functionAtCaret('=VLOOKUP(A1,'), 'VLOOKUP')

console.log(failed ? `${failed} formula test(s) FAILED` : 'all formula tests passed')
process.exit(failed ? 1 : 0)
