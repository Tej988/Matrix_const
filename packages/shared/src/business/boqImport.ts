import { UNITS, UNIT_LABELS, type Paise, type Unit } from '@mc/types'
import { parseRupees, sum } from '../money/index'
import { contractAmount, roundQty } from './boqCalculator'

/**
 * Bulk rate-card entry: a spreadsheet paste turned into BOQ rows.
 *
 * A real bill of quantities is dozens of lines. Entering them one form at a
 * time is how data entry gets abandoned half way through, and a half-entered
 * rate card is worse than none - every measurement afterwards is checked
 * against an incomplete contract. So the rate card is accepted in the shape it
 * already exists in: a block of cells copied out of Excel.
 *
 * Pure text in, data out. Nothing here creates anything; the caller decides
 * what to do with the rows it gets back. Money stays integer paise throughout
 * (ADR-004), and the amount column of the source sheet is deliberately ignored.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The columns a paste can carry. `code` is optional; the rest are required. */
export type BoqColumn = 'code' | 'name' | 'unit' | 'quantity' | 'rate'

export type BoqRowError =
  /** The column is absent from the paste, or the cell is blank. */
  | { reason: 'MISSING_FIELD'; field: BoqColumn }
  | { reason: 'UNKNOWN_UNIT'; value: string }
  | { reason: 'BAD_QUANTITY'; value: string }
  | { reason: 'BAD_RATE'; value: string }
  /** qty x rate is past the Rs 1,000 crore ceiling - a typo, not a contract. */
  | { reason: 'AMOUNT_TOO_LARGE'; contractQty: number; ratePaise: Paise }

export type BoqRowWarning =
  | { reason: 'DUPLICATE_IN_PASTE'; field: 'name' | 'code'; value: string; firstRowNumber: number }
  | { reason: 'ALREADY_ON_RATE_CARD'; field: 'name' | 'code'; value: string }

export interface ParsedBoqRow {
  /**
   * 1-based line number in the pasted text, counting the header and blank
   * lines. "Row 7 has no rate" has to point at the line the user can see.
   */
  rowNumber: number
  code?: string
  name: string
  unit: Unit
  contractQty: number
  ratePaise: Paise
  contractAmountPaise: Paise
  /** Non-fatal. The row is still importable; the user decides. */
  warnings: BoqRowWarning[]
}

export interface RejectedBoqRow {
  rowNumber: number
  /** The line exactly as pasted, so the preview can show what was rejected. */
  raw: string
  errors: BoqRowError[]
}

export type BoqImportRow = ({ ok: true } & ParsedBoqRow) | ({ ok: false } & RejectedBoqRow)

export interface BoqImportResult {
  /** Every non-blank data line, in paste order. The preview table renders this. */
  rows: BoqImportRow[]
  /** The importable rows, in paste order - exactly what a confirm button submits. */
  valid: ParsedBoqRow[]
  /** Valid rows only. A total that silently included unparseable lines would be a lie. */
  totalPaise: Paise
  /** True when the first line was read as a header and skipped. */
  hasHeader: boolean
  /** A tab for an Excel paste, a comma for CSV. Surfaced so a confused paste can be diagnosed. */
  delimiter: string
  errorCount: number
  warningCount: number
}

export interface BoqImportOptions {
  /** Names already on the rate card. Re-adding one is nearly always a mistake. */
  existingNames?: readonly string[]
  /** Codes already on the rate card, checked when the paste carries a code column. */
  existingCodes?: readonly string[]
}

// ---------------------------------------------------------------------------
// Tolerant matching
// ---------------------------------------------------------------------------

/** Strips everything a human might type around a word: "Sq. Ft." -> "sqft". */
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Unit spellings seen in the wild. The canonical name and the display label are
 * added automatically below, so UNIT_LABELS always round-trips - only the
 * shapes a person types by hand need listing here.
 */
const UNIT_ALIASES: Record<Unit, readonly string[]> = {
  SQFT: ['sft', 'sqf', 'sqfeet', 'squarefeet', 'squarefoot', 'ft2'],
  SQM: ['sqmt', 'sqmtr', 'sqmeter', 'sqmetre', 'squaremeter', 'squaremetre', 'm2'],
  RMT: ['rm', 'rmtr', 'runningmeter', 'runningmetre', 'runningmtr', 'mtr', 'metre', 'meter', 'm'],
  NOS: ['no', 'nr', 'num', 'number', 'each', 'ea', 'pcs', 'pc', 'piece', 'set'],
  KG: ['kgs', 'kilo', 'kilogram'],
  MT: ['ton', 'tonne', 'metricton', 'mton', 't'],
  CUM: ['cbm', 'cumt', 'cumtr', 'cubicmeter', 'cubicmetre', 'm3'],
  LS: ['lumpsum', 'lump', 'lsum', 'job'],
  DAY: ['dy', 'manday', 'daily'],
}

const UNIT_LOOKUP: ReadonlyMap<string, Unit> = (() => {
  const map = new Map<string, Unit>()
  for (const unit of UNITS) {
    // First writer wins, so an alias can never shadow a canonical name.
    for (const key of [unit, UNIT_LABELS[unit], ...UNIT_ALIASES[unit]]) {
      const normalized = normalizeKey(key)
      if (!map.has(normalized)) map.set(normalized, unit)
    }
  }
  return map
})()

/** "sq.ft", "sqft", "SQ FT", "Sq.Ft" and "sqfts" all reach SQFT. */
export function parseUnit(input: string): Unit | null {
  const key = normalizeKey(input)
  if (key === '') return null
  const direct = UNIT_LOOKUP.get(key)
  if (direct !== undefined) return direct
  // Plurals last, so "nos" and "ls" match as themselves before being stripped.
  if (key.endsWith('s')) return UNIT_LOOKUP.get(key.slice(0, -1)) ?? null
  return null
}

/**
 * Quantities carry Indian digit grouping too ("1,20,000"). Zero and negatives
 * are rejected: a contract line for no work is a paste error, not a contract.
 */
export function parseQuantity(input: string): number | null {
  const cleaned = input.replace(/,/g, '').replace(/\s/g, '')
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  return roundQty(value)
}

/**
 * Header words, normalized. 'ignore' marks a column we recognise and skip:
 * real BOQ sheets carry an amount column, and we recompute it rather than trust
 * it - a stale total in someone's spreadsheet must not become the agreed
 * contract value.
 */
const HEADER_WORDS: Record<string, BoqColumn | 'ignore'> = {
  code: 'code',
  itemcode: 'code',
  sr: 'code',
  srno: 'code',
  sno: 'code',
  slno: 'code',
  serialno: 'code',

  name: 'name',
  item: 'name',
  itemname: 'name',
  workitem: 'name',
  work: 'name',
  description: 'name',
  descriptionofwork: 'name',
  itemdescription: 'name',
  desc: 'name',
  particulars: 'name',
  activity: 'name',

  unit: 'unit',
  units: 'unit',
  uom: 'unit',
  unitofmeasure: 'unit',
  unitofmeasurement: 'unit',
  measure: 'unit',

  qty: 'quantity',
  quantity: 'quantity',
  contractqty: 'quantity',
  contractquantity: 'quantity',
  totalqty: 'quantity',

  rate: 'rate',
  rateunit: 'rate',
  rateperunit: 'rate',
  unitrate: 'rate',
  price: 'rate',
  unitprice: 'rate',

  amount: 'ignore',
  total: 'ignore',
  totalamount: 'ignore',
  value: 'ignore',
}

type ColumnMap = Partial<Record<BoqColumn, number>>

/** No header: the order the single-item form asks for, and the order every sheet uses. */
const DEFAULT_COLUMNS: ColumnMap = { name: 0, unit: 1, quantity: 2, rate: 3 }

/**
 * Column positions if this line is a header, null if it is data.
 *
 * Two recognised words is the threshold. One is not enough - a work item can
 * genuinely be called "Rate" or "Total" - and two in one row do not happen by
 * accident.
 */
function readHeader(cells: readonly string[]): ColumnMap | null {
  const columns: ColumnMap = {}
  let recognised = 0
  let mapped = 0

  cells.forEach((cell, index) => {
    const column = HEADER_WORDS[normalizeKey(cell)]
    if (column === undefined) return
    recognised += 1
    if (column === 'ignore') return
    if (columns[column] === undefined) {
      columns[column] = index
      mapped += 1
    }
  })

  if (recognised < 2 || mapped === 0) return null
  return columns
}

/**
 * Quote-aware split. Excel pastes tabs, but a CSV round-tripped through our own
 * export quotes any cell containing a comma, and "Flooring, Block A" must not
 * arrive as two columns.
 */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i)
    if (quoted) {
      if (ch !== '"') {
        current += ch
      } else if (line.charAt(i + 1) === '"') {
        current += '"'
        i += 1
      } else {
        quoted = false
      }
    } else if (ch === '"' && current.trim() === '') {
      // A quote only opens a field at its start; anywhere else it is literal.
      quoted = true
      current = ''
    } else if (ch === delimiter) {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  cells.push(current.trim())
  return cells
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export function parseBoqPaste(text: string, options: BoqImportOptions = {}): BoqImportResult {
  // One delimiter for the whole paste, decided by whether Excel put tabs in it.
  // Deciding per line would split two rows of the same sheet differently.
  const delimiter = text.includes('\t') ? '\t' : ','

  const existingNames = new Set((options.existingNames ?? []).map(normalizeKey))
  const existingCodes = new Set((options.existingCodes ?? []).map(normalizeKey))
  const seenNames = new Map<string, number>()
  const seenCodes = new Map<string, number>()

  let columns = DEFAULT_COLUMNS
  let hasHeader = false
  let sawFirstLine = false

  const rows: BoqImportRow[] = []
  const valid: ParsedBoqRow[] = []
  let errorCount = 0
  let warningCount = 0

  for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
    const rowNumber = index + 1
    if (line.trim() === '') continue

    const cells = splitLine(line, delimiter)
    // ",,," is a blank row an editor left behind, not a row missing every field.
    if (cells.every((c) => c === '')) continue

    if (!sawFirstLine) {
      sawFirstLine = true
      const header = readHeader(cells)
      if (header !== null) {
        columns = header
        hasHeader = true
        continue
      }
    }

    const cell = (column: BoqColumn): string => {
      const at = columns[column]
      return at === undefined ? '' : (cells[at] ?? '')
    }

    const errors: BoqRowError[] = []

    const name = cell('name')
    if (name === '') errors.push({ reason: 'MISSING_FIELD', field: 'name' })

    const unitText = cell('unit')
    let unit: Unit | null = null
    if (unitText === '') {
      errors.push({ reason: 'MISSING_FIELD', field: 'unit' })
    } else {
      unit = parseUnit(unitText)
      if (unit === null) errors.push({ reason: 'UNKNOWN_UNIT', value: unitText })
    }

    const qtyText = cell('quantity')
    let contractQty: number | null = null
    if (qtyText === '') {
      errors.push({ reason: 'MISSING_FIELD', field: 'quantity' })
    } else {
      contractQty = parseQuantity(qtyText)
      if (contractQty === null) errors.push({ reason: 'BAD_QUANTITY', value: qtyText })
    }

    const rateText = cell('rate')
    let ratePaise: Paise | null = null
    if (rateText === '') {
      errors.push({ reason: 'MISSING_FIELD', field: 'rate' })
    } else {
      try {
        const parsed = parseRupees(rateText)
        // A nil rate is legitimate - an owner-supplied item is measured but not
        // priced. A negative one is always a paste error.
        if (parsed < 0) errors.push({ reason: 'BAD_RATE', value: rateText })
        else ratePaise = parsed
      } catch {
        errors.push({ reason: 'BAD_RATE', value: rateText })
      }
    }

    // Every field is checked before bailing out. A row missing its unit AND its
    // rate should say both, not send the user round the loop twice.
    if (unit === null || contractQty === null || ratePaise === null || errors.length > 0) {
      errorCount += errors.length
      rows.push({ ok: false, rowNumber, raw: line, errors })
      continue
    }

    let contractAmountPaise: Paise
    try {
      contractAmountPaise = contractAmount(contractQty, ratePaise)
    } catch {
      // Money.paise guards at Rs 1,000 crore. One absurd line must not throw out
      // of the parser and take the other forty rows with it.
      errorCount += 1
      rows.push({
        ok: false,
        rowNumber,
        raw: line,
        errors: [{ reason: 'AMOUNT_TOO_LARGE', contractQty, ratePaise }],
      })
      continue
    }

    // Duplicates warn rather than reject. A BOQ legitimately repeats "Flooring"
    // across two blocks, so refusing the row would throw away real data - but
    // the user has to see it before it is saved.
    const warnings: BoqRowWarning[] = []
    const nameKey = normalizeKey(name)
    const firstNameRow = seenNames.get(nameKey)
    if (firstNameRow === undefined) {
      seenNames.set(nameKey, rowNumber)
    } else {
      warnings.push({
        reason: 'DUPLICATE_IN_PASTE',
        field: 'name',
        value: name,
        firstRowNumber: firstNameRow,
      })
    }
    if (existingNames.has(nameKey)) {
      warnings.push({ reason: 'ALREADY_ON_RATE_CARD', field: 'name', value: name })
    }

    const code = cell('code').toUpperCase()
    if (code !== '') {
      const codeKey = normalizeKey(code)
      const firstCodeRow = seenCodes.get(codeKey)
      if (firstCodeRow === undefined) {
        seenCodes.set(codeKey, rowNumber)
      } else {
        warnings.push({
          reason: 'DUPLICATE_IN_PASTE',
          field: 'code',
          value: code,
          firstRowNumber: firstCodeRow,
        })
      }
      if (existingCodes.has(codeKey)) {
        warnings.push({ reason: 'ALREADY_ON_RATE_CARD', field: 'code', value: code })
      }
    }
    warningCount += warnings.length

    const row: ParsedBoqRow = {
      rowNumber,
      ...(code !== '' ? { code } : {}),
      name,
      unit,
      contractQty,
      ratePaise,
      contractAmountPaise,
      warnings,
    }
    valid.push(row)
    rows.push({ ok: true, ...row })
  }

  return {
    rows,
    valid,
    totalPaise: sum(valid.map((r) => r.contractAmountPaise)),
    hasHeader,
    delimiter,
    errorCount,
    warningCount,
  }
}
