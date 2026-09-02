/**
 * The shared layer. Business logic, money, dates - everything deterministic.
 *
 * Namespaced rather than flat, because `Money.sum(...)` and `Dates.todayKey()`
 * read better at the call site than a hundred bare exports, and it keeps the
 * boundary between "arithmetic" and "app" visible.
 */

export * as Money from './money/index'
export * as Dates from './datetime/index'

export {
  can,
  canInProject,
  canSeeMoney,
  permissionsFor,
  PERMISSIONS,
  type Permission,
} from './business/permissions'

export {
  calculateOutstanding,
  headlineAmount,
  isOverBilled,
  isOverPaid,
  HEADLINE_FIGURES,
  type Outstanding,
  type HeadlineFigure,
} from './business/outstanding'

export {
  contractAmount,
  remainingQty,
  unbilledQty,
  completionPercent,
  validateQuantity,
  boqTotals,
  contractCoverage,
  suggestCode,
  roundQty,
  type QuantityCheck,
  type QuantityInput,
  type QuantityRejection,
  type BoqTotals,
} from './business/boqCalculator'

export {
  validateMeasurement,
  canTransition,
  canPerformTransition,
  isBillable,
  completedQtyDeltas,
  type DraftLine,
  type ValidatedLine,
  type MeasurementValidation,
  type LineRejection,
} from './business/measurementValidator'

export {
  consolidateLines,
  calculateBill,
  formatBillNumber,
  counterIdFor,
  paymentStatus,
  canTransitionBill,
  isBillEditable,
  billOutstanding,
  type BillLine,
  type BillTotals,
} from './business/billCalculator'

export {
  payableUnitsFor,
  calculateWage,
  quickWage,
  labourLedger,
  unmarkedLabour,
  summariseDay,
  isMarkableDate,
  type WageBreakdown,
  type LabourLedger,
  type AttendanceSummary,
} from './business/wageCalculator'

export { csvCell, toCsv, csvAmount, csvBlobParts, UTF8_BOM } from './business/csv'

export {
  AI_TOOLS,
  READ_TOOLS,
  WRITE_PROPOSAL_TOOLS,
  toolByName,
  canUseTool,
  AI_SAFETY_RULES,
  AI_STATUS,
  type ToolDefinition,
  type ToolName,
} from './ai/tools'

export { clientPaymentKey, labourPaymentKey, needsDisambiguation } from './business/idempotency'

export {
  computeProjectSummary,
  emptySummary,
  detectDrift,
  hasDrift,
  type SummarySources,
  type SummaryDrift,
} from './business/projectSummary'

export {
  parseBoqPaste,
  parseUnit,
  parseQuantity,
  type BoqColumn,
  type BoqImportOptions,
  type BoqImportResult,
  type BoqImportRow,
  type BoqRowError,
  type BoqRowWarning,
  type ParsedBoqRow,
  type RejectedBoqRow,
} from './business/boqImport'

export type { Paise, DateKey, Period } from '@mc/types'
