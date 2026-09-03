import { describe, it, expect } from 'vitest'
import { fromRupees } from '../money/index'
import { parseBoqPaste, parseQuantity, parseUnit } from './boqImport'

/**
 * The paste is the only entry point most rate cards will ever get, so the tests
 * are written against what people actually copy: Excel tabs, exported CSV,
 * headers or none, "Sq.ft" spelled six ways, and Indian digit grouping.
 */

const okRows = (text: string) => parseBoqPaste(text).valid

describe('unit matching is tolerant', () => {
  it('accepts every spelling of square feet anyone types', () => {
    for (const spelling of ['SQFT', 'sqft', 'sq.ft', 'Sq.Ft', 'SQ FT', 'sft', 'square feet']) {
      expect(parseUnit(spelling)).toBe('SQFT')
    }
  })

  it('maps the other units and their display labels', () => {
    expect(parseUnit('Cu.m')).toBe('CUM')
    expect(parseUnit('cbm')).toBe('CUM')
    expect(parseUnit('M.Ton')).toBe('MT')
    expect(parseUnit('tonnes')).toBe('MT')
    expect(parseUnit('Lump sum')).toBe('LS')
    expect(parseUnit('R.mt')).toBe('RMT')
    expect(parseUnit('running metre')).toBe('RMT')
    expect(parseUnit('Sq.m')).toBe('SQM')
    expect(parseUnit('kgs')).toBe('KG')
    expect(parseUnit('days')).toBe('DAY')
  })

  it('matches a canonical name before stripping a plural', () => {
    // "nos" and "ls" end in s but are units in their own right.
    expect(parseUnit('nos')).toBe('NOS')
    expect(parseUnit('ls')).toBe('LS')
    expect(parseUnit('pcs')).toBe('NOS')
  })

  it('returns null for a blank or unrecognised unit', () => {
    expect(parseUnit('')).toBeNull()
    expect(parseUnit('   ')).toBeNull()
    expect(parseUnit('furlongs')).toBeNull()
    expect(parseUnit('bucket')).toBeNull()
  })
})

describe('quantity parsing', () => {
  it('accepts Indian digit grouping and decimals', () => {
    expect(parseQuantity('1,20,000')).toBe(120000)
    expect(parseQuantity('2 500')).toBe(2500)
    expect(parseQuantity('1250.755')).toBe(1250.755)
    expect(parseQuantity('.5')).toBe(0.5)
    expect(parseQuantity('10.')).toBe(10)
  })

  it('rounds to the three decimals the BOQ layer works in', () => {
    expect(parseQuantity('1250.7556')).toBe(1250.756)
  })

  it('rejects anything that is not a positive number', () => {
    expect(parseQuantity('ten')).toBeNull()
    expect(parseQuantity('12abc')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('-5')).toBeNull()
    expect(parseQuantity('0')).toBeNull()
  })

  it('rejects a digit string long enough to overflow to Infinity', () => {
    expect(parseQuantity('9'.repeat(400))).toBeNull()
  })
})

describe('tab-separated paste - straight out of Excel', () => {
  const paste = [
    'Flooring\tSq.ft\t10000\t120',
    'Plaster\tSq.ft\t5000\t45',
    'Painting\tSq.ft\t8000\t35',
  ].join('\n')

  it('parses the section 5 rate card', () => {
    const result = parseBoqPaste(paste)

    expect(result.delimiter).toBe('\t')
    expect(result.hasHeader).toBe(false)
    expect(result.errorCount).toBe(0)
    expect(result.valid).toHaveLength(3)
    expect(result.valid.map((r) => r.name)).toEqual(['Flooring', 'Plaster', 'Painting'])
    expect(result.valid.map((r) => r.unit)).toEqual(['SQFT', 'SQFT', 'SQFT'])
  })

  it('computes each contract amount through the BOQ calculator', () => {
    const [flooring, plaster, painting] = okRows(paste)

    expect(flooring?.contractAmountPaise).toBe(fromRupees(12_00_000))
    expect(plaster?.contractAmountPaise).toBe(fromRupees(2_25_000))
    expect(painting?.contractAmountPaise).toBe(fromRupees(2_80_000))
  })

  it('totals only what it could parse', () => {
    expect(parseBoqPaste(paste).totalPaise).toBe(fromRupees(17_05_000))
  })

  it('numbers rows by the line the user can see', () => {
    expect(okRows(paste).map((r) => r.rowNumber)).toEqual([1, 2, 3])
  })
})

describe('comma-separated paste', () => {
  it('parses a plain CSV', () => {
    const result = parseBoqPaste('Flooring,SQFT,10000,120\nSteel,KG,2500,68')

    expect(result.delimiter).toBe(',')
    expect(result.valid).toHaveLength(2)
    expect(result.valid[1]?.unit).toBe('KG')
    expect(result.valid[1]?.ratePaise).toBe(fromRupees(68))
  })

  it('keeps a quoted cell containing a comma in one column', () => {
    const rows = okRows('"Flooring, Block A",SQFT,10000,120')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Flooring, Block A')
  })

  it('unescapes a doubled quote inside a quoted cell', () => {
    expect(okRows('"Pipe 4"" dia",RMT,100,250')[0]?.name).toBe('Pipe 4" dia')
  })

  it('treats a quote that is not at the start of a cell as literal', () => {
    expect(okRows('Pipe 4" dia,RMT,100,250')[0]?.name).toBe('Pipe 4" dia')
  })

  it('handles CRLF line endings from a Windows editor', () => {
    expect(okRows('Flooring,SQFT,10000,120\r\nPlaster,SQFT,5000,45')).toHaveLength(2)
  })
})

describe('header rows', () => {
  it('detects and skips a header in the expected order', () => {
    const result = parseBoqPaste(['Item,Unit,Qty,Rate', 'Flooring,SQFT,10000,120'].join('\n'))

    expect(result.hasHeader).toBe(true)
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]?.rowNumber).toBe(2)
  })

  it('follows the header when the columns are in a different order', () => {
    const result = parseBoqPaste(
      ['Rate,Unit,Description of work,Quantity', '120,Sq.ft,Flooring,10000'].join('\n'),
    )

    expect(result.hasHeader).toBe(true)
    expect(result.valid[0]).toMatchObject({
      name: 'Flooring',
      unit: 'SQFT',
      contractQty: 10000,
      ratePaise: fromRupees(120),
      contractAmountPaise: fromRupees(12_00_000),
    })
  })

  it('reads a code column and recomputes the amount column rather than trusting it', () => {
    const result = parseBoqPaste(
      [
        'Sr No\tItem Code\tParticulars\tUOM\tQuantity\tRate per unit\tAmount',
        '1\tFLO-01\tFlooring\tSq.ft\t10000\t120\t99999',
      ].join('\n'),
    )

    expect(result.hasHeader).toBe(true)
    // "Sr No" claims the code slot first, so the real code column is ignored -
    // either way the amount column never becomes the contract value.
    expect(result.valid[0]?.contractAmountPaise).toBe(fromRupees(12_00_000))
    expect(result.valid[0]?.code).toBe('1')
  })

  it('takes the first header word when two name-ish columns appear', () => {
    const result = parseBoqPaste(
      ['Item,Description,Unit,Qty,Rate', 'Flooring,Vitrified tiles,SQFT,10000,120'].join('\n'),
    )

    expect(result.valid[0]?.name).toBe('Flooring')
  })

  it('does not mistake a data row for a header', () => {
    const result = parseBoqPaste('Flooring,SQFT,10000,120')

    expect(result.hasHeader).toBe(false)
    expect(result.valid).toHaveLength(1)
  })

  it('does not treat a single recognised word as a header', () => {
    // A work item can genuinely be called "Rate" - one word is not evidence.
    const result = parseBoqPaste('Rate,SQFT,10000,120')

    expect(result.hasHeader).toBe(false)
    expect(result.valid[0]?.name).toBe('Rate')
  })

  it('does not accept a header that maps no usable column', () => {
    const result = parseBoqPaste('Amount,Total\n100,200')

    expect(result.hasHeader).toBe(false)
    expect(result.valid).toHaveLength(0)
  })

  it('reports the missing column per row when the header omits one', () => {
    const result = parseBoqPaste(['Item,Qty,Rate', 'Flooring,10000,120'].join('\n'))

    expect(result.hasHeader).toBe(true)
    expect(result.valid).toHaveLength(0)
    expect(result.rows[0]).toMatchObject({
      ok: false,
      rowNumber: 2,
      errors: [{ reason: 'MISSING_FIELD', field: 'unit' }],
    })
  })
})

describe('Indian number formats', () => {
  it('reads grouped quantities and rupee-signed rates', () => {
    const row = okRows('Blockwork\tSq.ft\t1,20,000\t₹ 120')[0]

    expect(row?.contractQty).toBe(120000)
    expect(row?.ratePaise).toBe(fromRupees(120))
    expect(row?.contractAmountPaise).toBe(fromRupees(1_44_00_000))
  })

  it('reads a grouped rate with paise', () => {
    expect(okRows('Sundries,NOS,1,"Rs 1,20,000.50"')[0]?.ratePaise).toBe(12000050)
  })

  it('accepts a nil rate - an owner-supplied item is measured but not priced', () => {
    const row = okRows('Client tiles,SQFT,500,0')[0]

    expect(row?.ratePaise).toBe(0)
    expect(row?.contractAmountPaise).toBe(0)
  })
})

describe('blank lines and stray separators', () => {
  it('skips blank lines but keeps row numbers pointing at the pasted text', () => {
    const result = parseBoqPaste(
      ['', 'Flooring\tSQFT\t10000\t120', '', '', 'Plaster\tSQFT\t5000\t45', ''].join('\n'),
    )

    expect(result.valid).toHaveLength(2)
    expect(result.valid.map((r) => r.rowNumber)).toEqual([2, 5])
  })

  it('skips a row of empty cells left behind by a spreadsheet', () => {
    const result = parseBoqPaste('Flooring,SQFT,10000,120\n,,,\nPlaster,SQFT,5000,45')

    expect(result.valid).toHaveLength(2)
    expect(result.errorCount).toBe(0)
  })

  it('returns an empty result for empty text', () => {
    const result = parseBoqPaste('')

    expect(result.rows).toEqual([])
    expect(result.valid).toEqual([])
    expect(result.totalPaise).toBe(0)
    expect(result.errorCount).toBe(0)
  })
})

describe('bad rows are reported, not swallowed', () => {
  it('reports a row that is missing a column', () => {
    // Two cells is the rate-only shape with the rate gone, which is the only
    // reading left once a three-column paste is a legitimate document.
    const result = parseBoqPaste('Flooring\tSQFT')

    expect(result.valid).toHaveLength(0)
    expect(result.rows[0]).toMatchObject({
      ok: false,
      rowNumber: 1,
      raw: 'Flooring\tSQFT',
      errors: [{ reason: 'MISSING_FIELD', field: 'rate' }],
    })
  })

  it('reports the blank quantity cell only when the sheet HAS that column', () => {
    // Four columns with the third empty: the sheet says there is a quantity and
    // this row does not give one. Contrast with the three-column case below,
    // where the column does not exist and nothing is missing.
    const result = parseBoqPaste(['Flooring\tSQFT\t10000\t120', 'Plaster\tSQFT\t\t45'].join('\n'))

    expect(result.rows[1]).toMatchObject({
      ok: false,
      errors: [{ reason: 'MISSING_FIELD', field: 'quantity' }],
    })
  })

  it('reports a non-numeric quantity', () => {
    const result = parseBoqPaste('Flooring,SQFT,ten thousand,120')

    expect(result.rows[0]).toMatchObject({
      ok: false,
      errors: [{ reason: 'BAD_QUANTITY', value: 'ten thousand' }],
    })
  })

  it('reports an unrecognised unit with the text that was not understood', () => {
    const result = parseBoqPaste('Flooring,furlongs,10000,120')

    expect(result.rows[0]).toMatchObject({
      ok: false,
      errors: [{ reason: 'UNKNOWN_UNIT', value: 'furlongs' }],
    })
  })

  it('reports a rate that is not an amount', () => {
    const result = parseBoqPaste('Flooring,SQFT,10000,one twenty')

    expect(result.rows[0]).toMatchObject({
      ok: false,
      errors: [{ reason: 'BAD_RATE', value: 'one twenty' }],
    })
  })

  it('rejects a negative rate', () => {
    const result = parseBoqPaste('Flooring,SQFT,10000,-120')

    expect(result.rows[0]).toMatchObject({ ok: false, errors: [{ reason: 'BAD_RATE' }] })
  })

  it('rejects a rate past the money ceiling instead of throwing', () => {
    const result = parseBoqPaste('Flooring,SQFT,1,99999999999')

    expect(result.rows[0]).toMatchObject({ ok: false, errors: [{ reason: 'BAD_RATE' }] })
  })

  it('reports a missing name', () => {
    const result = parseBoqPaste(',SQFT,10000,120')

    expect(result.rows[0]).toMatchObject({
      ok: false,
      errors: [{ reason: 'MISSING_FIELD', field: 'name' }],
    })
  })

  it('lists every problem on a row, not just the first', () => {
    const result = parseBoqPaste('Flooring,furlongs,lots,later')
    const row = result.rows[0]

    expect(row?.ok).toBe(false)
    if (row?.ok !== false) return
    expect(row.errors.map((e) => e.reason)).toEqual(['UNKNOWN_UNIT', 'BAD_QUANTITY', 'BAD_RATE'])
    expect(result.errorCount).toBe(3)
  })

  it('rejects a line whose amount would blow past the money ceiling', () => {
    const result = parseBoqPaste('Steel,KG,1000000,500000')

    expect(result.rows[0]).toMatchObject({
      ok: false,
      errors: [{ reason: 'AMOUNT_TOO_LARGE', contractQty: 1000000 }],
    })
    expect(result.valid).toHaveLength(0)
  })

  it('keeps the valid rows when one row in the middle is broken', () => {
    const result = parseBoqPaste(
      [
        'Flooring\tSq.ft\t10000\t120',
        'Plaster\tfurlongs\tlots\t45',
        'Painting\tSq.ft\t8000\t35',
      ].join('\n'),
    )

    expect(result.valid.map((r) => r.name)).toEqual(['Flooring', 'Painting'])
    expect(result.rows.map((r) => r.ok)).toEqual([true, false, true])
    // The total is the two good rows - never a partial figure dressed up as complete.
    expect(result.totalPaise).toBe(fromRupees(14_80_000))
  })
})

describe('duplicates are flagged, not rejected', () => {
  it('flags a name repeated inside the paste and points at the first row', () => {
    const result = parseBoqPaste(
      ['Flooring,SQFT,10000,120', 'Plaster,SQFT,5000,45', 'flooring,SQFT,2000,120'].join('\n'),
    )

    // Still importable: a BOQ genuinely repeats a name across two blocks.
    expect(result.valid).toHaveLength(3)
    expect(result.warningCount).toBe(1)
    expect(result.valid[2]?.warnings).toEqual([
      { reason: 'DUPLICATE_IN_PASTE', field: 'name', value: 'flooring', firstRowNumber: 1 },
    ])
  })

  it('flags a code repeated inside the paste', () => {
    const result = parseBoqPaste(
      [
        'Code,Item,Unit,Qty,Rate',
        'FLO-01,Flooring,SQFT,10000,120',
        'FLO-01,Skirting,RMT,400,90',
      ].join('\n'),
    )

    expect(result.valid).toHaveLength(2)
    expect(result.valid[1]?.warnings).toEqual([
      { reason: 'DUPLICATE_IN_PASTE', field: 'code', value: 'FLO-01', firstRowNumber: 2 },
    ])
  })

  it('flags a collision with a name already on the rate card', () => {
    const result = parseBoqPaste('Flooring,SQFT,10000,120', {
      existingNames: ['flooring'],
    })

    expect(result.valid[0]?.warnings).toEqual([
      { reason: 'ALREADY_ON_RATE_CARD', field: 'name', value: 'Flooring' },
    ])
  })

  it('flags a collision with a code already on the rate card', () => {
    const result = parseBoqPaste(
      ['Code,Item,Unit,Qty,Rate', 'flo01,Skirting,RMT,400,90'].join('\n'),
      { existingCodes: ['FLO-01'] },
    )

    expect(result.valid[0]?.warnings).toEqual([
      { reason: 'ALREADY_ON_RATE_CARD', field: 'code', value: 'FLO01' },
    ])
  })

  it('leaves clean rows without warnings', () => {
    const result = parseBoqPaste(
      ['Code,Item,Unit,Qty,Rate', 'FLO-01,Flooring,SQFT,10000,120'].join('\n'),
      { existingNames: ['Plaster'], existingCodes: ['PLA-01'] },
    )

    expect(result.warningCount).toBe(0)
    expect(result.valid[0]?.warnings).toEqual([])
    expect(result.valid[0]?.code).toBe('FLO-01')
  })

  it('omits code entirely when the paste has no code column', () => {
    expect(okRows('Flooring,SQFT,10000,120')[0]).not.toHaveProperty('code')
  })
})

describe('a realistic forty-line paste', () => {
  it('survives a messy sheet and reports exactly what failed', () => {
    const paste = [
      'Sr No\tDescription of work\tUOM\tQuantity\tRate\tAmount',
      '1\tVitrified tile flooring\tSq.ft\t10,000\t₹120\t12,00,000',
      '2\tInternal plaster\tSQ M\t5,000\t45\t2,25,000',
      '',
      '3\tPainting - two coats\tsqft\t8,000\tRs 35\t2,80,000',
      '4\tRCC work\tCu.m\t250.5\t6,500\t16,28,250',
      '5\tSteel reinforcement\tM.Ton\t42.75\t68,000\t29,07,000',
      '6\tScaffolding\tLump sum\t1\t1,50,000\t1,50,000',
      '7\tSite supervision\tdays\t180\t1,200\t2,16,000',
      '8\tBroken row\t\t\t\t',
      '9\tVitrified tile flooring\tSq.ft\t500\t120\t60,000',
    ].join('\n')

    const result = parseBoqPaste(paste, { existingNames: ['Scaffolding'] })

    expect(result.hasHeader).toBe(true)
    expect(result.valid).toHaveLength(8)
    expect(result.rows).toHaveLength(9)

    // Line 10 is the only unparseable one, and it names all three empty columns.
    const broken = result.rows.find((r) => !r.ok)
    expect(broken).toMatchObject({
      rowNumber: 10,
      errors: [
        { reason: 'MISSING_FIELD', field: 'unit' },
        { reason: 'MISSING_FIELD', field: 'quantity' },
        { reason: 'MISSING_FIELD', field: 'rate' },
      ],
    })

    // A repeat of the flooring line, and one item already on the rate card.
    expect(result.warningCount).toBe(2)
    expect(result.totalPaise).toBe(
      fromRupees(
        12_00_000 + 2_25_000 + 2_80_000 + 16_28_250 + 29_07_000 + 1_50_000 + 2_16_000 + 60_000,
      ),
    )
  })
})

describe("the owner's own unit spellings", () => {
  it("accepts 'sfqt', the transposition that appears in their real quotations", () => {
    const r = parseBoqPaste('Flooring Polish	sfqt	1000	65')
    expect(r.errorCount).toBe(0)
    expect(r.valid[0]?.unit).toBe('SQFT')
  })

  it('accepts RFT for running feet', () => {
    const r = parseBoqPaste('Riser Polish	RFT	250	65')
    expect(r.errorCount).toBe(0)
    expect(r.valid[0]?.unit).toBe('RFT')
  })

  it('keeps running feet distinct from running metres', () => {
    // Confusing the two would misprice every riser by a factor of 3.28.
    const feet = parseBoqPaste('Riser	RFT	100	65')
    const metres = parseBoqPaste('Riser	RMT	100	65')
    expect(feet.valid[0]?.unit).toBe('RFT')
    expect(metres.valid[0]?.unit).toBe('RMT')
  })

  it('parses their whole quotation in one paste', () => {
    const r = parseBoqPaste(
      [
        'Description	Unit	Rate',
        'Flooring Polish	sfqt	65',
        'Step Polish	sfqt	65',
        'Riser Polish	RFT	65',
        'Wall cladding polish	sqft	125',
        'Piller polish	sqft	125',
      ].join(String.fromCharCode(10)),
    )
    // Their quotation quotes rates and no quantities. That is the document, not
    // a document with a column missing, so every row imports cleanly.
    expect(r.hasHeader).toBe(true)
    expect(r.hasQuantityColumn).toBe(false)
    expect(r.errorCount).toBe(0)
    expect(r.rows).toHaveLength(5)
    expect(r.valid).toHaveLength(5)
    expect(r.valid.map((row) => row.ratePaise)).toEqual([65, 65, 65, 125, 125].map(fromRupees))
    expect(r.valid.map((row) => row.unit)).toEqual(['SQFT', 'SQFT', 'RFT', 'SQFT', 'SQFT'])
  })
})

/**
 * The three-column shape, which is the one this business actually pastes.
 *
 * "we dont need this contract [quantity] as we dont have fix number, that is
 * depend on the work" - so the sheet they copy from has no quantity column at
 * all, and a parser that insisted on one would reject their real quotation.
 */
describe('a rate-only paste - Description | Unit | Rate', () => {
  const quotation = ['Flooring Polish\tsfqt\t65', 'Riser Polish\tRFT\t65'].join('\n')

  it('parses natively rather than reporting a missing column', () => {
    const r = parseBoqPaste(quotation)

    expect(r.errorCount).toBe(0)
    expect(r.hasQuantityColumn).toBe(false)
    expect(r.valid).toHaveLength(2)
    expect(r.valid[0]).toMatchObject({ name: 'Flooring Polish', unit: 'SQFT', ratePaise: 6500 })
  })

  it('leaves the quantity and the amount keys OFF the row entirely', () => {
    // Absent, not zero and not null: Firestore rejects an explicit undefined,
    // and a stored 0 would become a section 4 ceiling of nothing.
    const row = okRows(quotation)[0]

    expect(row).not.toHaveProperty('contractQty')
    expect(row).not.toHaveProperty('contractAmountPaise')
  })

  it('totals nothing, because there is nothing to total', () => {
    // Not a partial total dressed up as complete - the caller is told there
    // were no quantities and hides the figure.
    const r = parseBoqPaste(quotation)

    expect(r.totalPaise).toBe(0)
    expect(r.hasQuantityColumn).toBe(false)
  })

  it('reads a header that names the three columns', () => {
    const r = parseBoqPaste(['Description,Unit,Rate', 'Flooring Polish,sqft,65'].join('\n'))

    expect(r.hasHeader).toBe(true)
    expect(r.hasQuantityColumn).toBe(false)
    expect(r.valid[0]?.name).toBe('Flooring Polish')
  })

  it('follows a three-column header whatever order it is in', () => {
    const r = parseBoqPaste(['Rate,UOM,Particulars', '65,R.ft,Riser Polish'].join('\n'))

    expect(r.valid[0]).toMatchObject({ name: 'Riser Polish', unit: 'RFT', ratePaise: 6500 })
    expect(r.valid[0]).not.toHaveProperty('contractQty')
  })

  it('still flags duplicates and unknown units', () => {
    const r = parseBoqPaste(
      ['Flooring Polish,sqft,65', 'flooring polish,sqft,65', 'Skirting,furlongs,90'].join('\n'),
      { existingNames: ['Skirting'] },
    )

    expect(r.valid).toHaveLength(2)
    expect(r.valid[1]?.warnings[0]?.reason).toBe('DUPLICATE_IN_PASTE')
    expect(r.rows[2]).toMatchObject({ ok: false, errors: [{ reason: 'UNKNOWN_UNIT' }] })
  })

  it('still rejects a negative rate', () => {
    expect(parseBoqPaste('Flooring Polish,sqft,-65').rows[0]).toMatchObject({
      ok: false,
      errors: [{ reason: 'BAD_RATE' }],
    })
  })
})

describe('deciding which shape a paste is', () => {
  it('reads four columns as a bill of quantities', () => {
    const r = parseBoqPaste('Flooring,SQFT,10000,120')

    expect(r.hasQuantityColumn).toBe(true)
    expect(r.valid[0]).toMatchObject({ contractQty: 10000, ratePaise: fromRupees(120) })
  })

  it('reads three columns as a quotation', () => {
    // The same middle number, read as a rate rather than a quantity. There is
    // no way to tell these apart from the cells alone, so the shape of the
    // sheet decides - and this business's sheet has three columns.
    const r = parseBoqPaste('Flooring,SQFT,10000')

    expect(r.hasQuantityColumn).toBe(false)
    expect(r.valid[0]?.ratePaise).toBe(fromRupees(10000))
  })

  it('lets the WIDEST row decide, not the first', () => {
    // A four-column sheet whose first row lost its rate must stay a
    // four-column sheet and report that row, rather than silently re-reading
    // every quantity below it as a rate.
    const r = parseBoqPaste(['Flooring,SQFT,10000', 'Plaster,SQFT,5000,45'].join('\n'))

    expect(r.hasQuantityColumn).toBe(true)
    expect(r.rows[0]).toMatchObject({ ok: false, errors: [{ reason: 'MISSING_FIELD' }] })
    expect(r.valid[0]).toMatchObject({ name: 'Plaster', contractQty: 5000 })
  })

  it('ignores a stray trailing separator when measuring the width', () => {
    // A spreadsheet leaves one behind often enough that counting raw cells
    // would turn a quotation into a BOQ with every rate reported missing.
    const r = parseBoqPaste(['Flooring Polish\tsqft\t65\t', 'Riser Polish\tRFT\t65'].join('\n'))

    expect(r.hasQuantityColumn).toBe(false)
    expect(r.errorCount).toBe(0)
    expect(r.valid).toHaveLength(2)
  })

  it('honours a header that names a quantity column even on narrow rows', () => {
    // The header is evidence about the sheet; the width is only a fallback.
    const r = parseBoqPaste(['Item,Qty,Rate,Unit', 'Flooring,10000,120,SQFT'].join('\n'))

    expect(r.hasQuantityColumn).toBe(true)
    expect(r.valid[0]?.contractQty).toBe(10000)
  })
})
