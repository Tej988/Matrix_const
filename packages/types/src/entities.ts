import type { DateKey, Paise, Period } from './index'

/**
 * Business entities. Field names match DATABASE.md exactly - if the two
 * disagree, DATABASE.md is the spec and this is the bug.
 */

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const CLIENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

export interface Client {
  id: string
  name: string
  contactPerson: string
  phone?: string
  email?: string
  billingAddress?: string
  city?: string
  state?: string
  /** For future IGST determination - ADR-003. Unused while tax is off. */
  stateCode?: string
  gstin?: string
  status: ClientStatus
  notes?: string
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const TAX_MODES = ['NONE', 'CGST_SGST', 'IGST'] as const
export type TaxMode = (typeof TAX_MODES)[number]

/** ADR-003 - present from day one, all zero and hidden until switched on. */
export interface TaxProfile {
  mode: TaxMode
  cgstRate: number
  sgstRate: number
  igstRate: number
  tdsRate: number
  retentionRate: number
}

export const NO_TAX: TaxProfile = {
  mode: 'NONE',
  cgstRate: 0,
  sgstRate: 0,
  igstRate: 0,
  tdsRate: 0,
  retentionRate: 0,
}

/** Assumption A4 - half a day is half a day's pay unless told otherwise. */
export interface WageRules {
  halfDayFactor: number
  leavePaid: boolean
  holidayPaid: boolean
}

export const DEFAULT_WAGE_RULES: WageRules = {
  halfDayFactor: 0.5,
  leavePaid: false,
  holidayPaid: false,
}

export interface Project {
  id: string
  name: string
  code: string
  clientId: string
  /** Denormalised so a project list costs one read, not N+1 (R-10). */
  clientName: string
  siteAddress?: string
  city?: string
  state?: string
  contractValuePaise: Paise
  startDate: DateKey
  expectedEndDate?: DateKey
  status: ProjectStatus
  taxProfile: TaxProfile
  wageRules?: WageRules
}

// ---------------------------------------------------------------------------
// Project summary
// ---------------------------------------------------------------------------

/**
 * The denormalised figures every dashboard reads, so no screen ever scans raw
 * collections (spec section 23, R-10).
 *
 * Note there is no field called "profit" and no field called "outstanding".
 * Section 17 forbids the first without full cost accounting, and R-01 showed
 * the second means three different things to three different readers - so each
 * is named for exactly what it is.
 */
export interface ProjectSummary {
  projectId: string
  contractValuePaise: Paise
  totalBilledPaise: Paise
  totalReceivedPaise: Paise

  /** Billed but not yet paid. Money the client owes today. */
  receivablePaise: Paise
  /** Contract value not yet billed. Work still to invoice. */
  unbilledBalancePaise: Paise
  /** Contract value not yet collected. receivable + unbilled. */
  contractRemainingPaise: Paise

  approvedMeasuredPaise: Paise
  labourEarnedPaise: Paise
  labourPaidPaise: Paise
  labourPayablePaise: Paise
  otherExpensesPaise: Paise
  cashOutPaise: Paise
  /** Cash in minus cash out. NOT profit - see section 17. */
  netPositionPaise: Paise

  computedAt: Date
  computedBy: string
  schemaVersion: number
}

export const SUMMARY_SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// BOQ / rate card
// ---------------------------------------------------------------------------

/** Units a construction item can be measured in. */
export const UNITS = ['SQFT', 'SQM', 'RMT', 'NOS', 'KG', 'MT', 'CUM', 'LS', 'DAY'] as const
export type Unit = (typeof UNITS)[number]

export const UNIT_LABELS: Record<Unit, string> = {
  SQFT: 'Sq.ft',
  SQM: 'Sq.m',
  RMT: 'R.mt',
  NOS: 'Nos',
  KG: 'Kg',
  MT: 'M.Ton',
  CUM: 'Cu.m',
  LS: 'Lump sum',
  DAY: 'Day',
}

export const BOQ_STATUSES = ['ACTIVE', 'CLOSED'] as const
export type BoqStatus = (typeof BOQ_STATUSES)[number]

/**
 * A priced line of work. Section 5 - rates are configurable per project and
 * never hardcoded into business logic.
 *
 * `completedQty` is the most contended field in the schema: it is only ever
 * moved inside the transaction that APPROVES a measurement, and the
 * over-quantity check runs against its live value at that moment, not against
 * whatever a draft was typed against (R-13).
 */
export interface BoqItem {
  id: string
  projectId: string
  code: string
  name: string
  description?: string
  unit: Unit
  contractQty: number
  ratePaise: Paise
  contractAmountPaise: Paise
  /** Approved measured quantity to date. */
  completedQty: number
  /** Quantity already pulled into a bill. Never exceeds completedQty. */
  billedQty: number
  hsnSac?: string
  sortOrder: number
  status: BoqStatus
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export const MEASUREMENT_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number]

/**
 * A monthly measurement sheet. Section 6.
 *
 * Only APPROVED measurements are billable, and approval is the moment
 * `boqItems.completedQty` moves - never before.
 */
export interface Measurement {
  id: string
  projectId: string
  period: Period
  date: DateKey
  title: string
  status: MeasurementStatus
  totalAmountPaise: Paise
  enteredBy: string
  enteredByName: string
  submittedAt?: Date
  approvedBy?: string
  approvedAt?: Date
  rejectionReason?: string
  /** Set when this measurement is pulled into a bill. */
  billId?: string
}

/** A line on a measurement sheet, held as a subcollection of its measurement. */
export interface MeasurementItem {
  id: string
  boqItemId: string
  boqItemName: string
  location: string
  description?: string
  unit: Unit
  ratePaise: Paise
  /** Snapshot of completedQty at approval - what "previous" meant at the time. */
  previousQty: number
  currentQty: number
  totalQty: number
  amountPaise: Paise
  isChangeOrder: boolean
  changeOrderApprovedBy?: string
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export const BILL_STATUSES = [
  'DRAFT',
  'GENERATED',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
] as const
export type BillStatus = (typeof BILL_STATUSES)[number]

/** ADR-003. All zero unless the project's tax profile is switched on. */
export interface BillTax {
  mode: TaxMode
  cgstRate: number
  cgstAmountPaise: Paise
  sgstRate: number
  sgstAmountPaise: Paise
  igstRate: number
  igstAmountPaise: Paise
}

export interface BillDeductions {
  tdsRate: number
  tdsAmountPaise: Paise
  retentionRate: number
  retentionAmountPaise: Paise
  otherLabel?: string
  otherAmountPaise: Paise
}

export interface Bill {
  id: string
  projectId: string
  projectName: string
  clientId: string
  clientName: string
  billNumber: string
  billDate: DateKey
  periodFrom: DateKey
  periodTo: DateKey
  measurementIds: string[]
  subtotalPaise: Paise
  tax: BillTax
  deductions: BillDeductions
  netAmountPaise: Paise
  amountReceivedPaise: Paise
  status: BillStatus
  pdfDocumentId?: string
  cancelledBy?: string
  cancellationReason?: string
}

/**
 * A frozen snapshot of what was billed. Name, unit, rate and quantity are
 * copied at generation - a later rate card change must never retroactively
 * alter an issued bill.
 */
export interface BillItem {
  id: string
  boqItemId: string
  name: string
  unit: Unit
  ratePaise: Paise
  quantity: number
  amountPaise: Paise
}

// ---------------------------------------------------------------------------
// Labour
// ---------------------------------------------------------------------------

export const LABOUR_ROLES = [
  'MASON',
  'HELPER',
  'CARPENTER',
  'ELECTRICIAN',
  'PLUMBER',
  'PAINTER',
  'BAR_BENDER',
  'OPERATOR',
  'SUPERVISOR',
  'OTHER',
] as const
export type LabourRole = (typeof LABOUR_ROLES)[number]

export const LABOUR_STATUSES = ['ACTIVE', 'INACTIVE'] as const
export type LabourStatus = (typeof LABOUR_STATUSES)[number]

/**
 * A worker. Section 10 says avoid unnecessary sensitive data - so no Aadhaar,
 * no ID scans, no photograph. This system has no reason to hold them.
 */
export interface Labour {
  id: string
  name: string
  phone?: string
  role: LabourRole
  skillLevel?: string
  defaultDailyWagePaise: Paise
  overtimeHourlyPaise?: Paise
  status: LabourStatus
  joiningDate?: DateKey
  notes?: string
}

/**
 * Section 11 - a labourer reaches a project only through an assignment, never
 * by a projectId stored on the labour record. Storing it there would destroy
 * history the moment Ramesh moved sites.
 */
export interface LabourAssignment {
  id: string
  labourId: string
  labourName: string
  projectId: string
  startDate: DateKey
  endDate?: DateKey
  /** Project-specific rate, overriding the labourer's default. */
  dailyRatePaise: Paise
  status: 'ACTIVE' | 'ENDED'
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

/**
 * One labourer, one project, one day.
 *
 * The document ID is `{projectId}_{labourId}_{dateKey}` (ADR-006), which makes
 * a duplicate physically the same document rather than a validation problem -
 * and makes an offline replay idempotent for free.
 */
export interface Attendance {
  id: string
  projectId: string
  labourId: string
  labourName: string
  dateKey: DateKey
  status: AttendanceStatus
  hours?: number
  /** Snapshotted at marking. Raising a wage must not restate last month. */
  dailyRatePaise: Paise
  /** Computed from status and the project's wage rules. */
  payableUnits: number
  markedBy: string
  /** Device clock, kept beside the server time so skew is detectable (R-12). */
  clientCreatedAt?: Date
  syncSource: 'ONLINE' | 'OFFLINE_SYNC'
  editedBy?: string
  editReason?: string
  wagePeriodId?: string
}

export function attendanceId(projectId: string, labourId: string, dateKey: DateKey): string {
  return `${projectId}_${labourId}_${dateKey}`
}

// ---------------------------------------------------------------------------
// Wages and labour payments
// ---------------------------------------------------------------------------

export const WAGE_PERIOD_STATUSES = ['DRAFT', 'LOCKED'] as const
export type WagePeriodStatus = (typeof WAGE_PERIOD_STATUSES)[number]

/**
 * A labourer's earnings for a date range, computed from attendance.
 *
 * Locking freezes the figures and is what promotes them into
 * summary.labourEarnedPaise. Attendance inside a locked period becomes
 * immutable - it has been paid against.
 */
export interface WagePeriod {
  id: string
  projectId: string
  labourId: string
  labourName: string
  periodFrom: DateKey
  periodTo: DateKey
  presentDays: number
  halfDays: number
  absentDays: number
  leaveDays: number
  payableDays: number
  dailyRatePaise: Paise
  earnedAmountPaise: Paise
  status: WagePeriodStatus
  lockedBy?: string
}

export const PAYMENT_METHODS = ['PHONEPE', 'CASH', 'BANK_TRANSFER', 'UPI', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const LABOUR_PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'REVERSED'] as const
export type LabourPaymentStatus = (typeof LABOUR_PAYMENT_STATUSES)[number]

/** Section 15. Records a payment; never initiates one. */
export interface LabourPayment {
  id: string
  labourId: string
  labourName: string
  projectId: string
  wagePeriodId?: string
  amountPaise: Paise
  date: DateKey
  method: PaymentMethod
  phonepeTransactionId?: string
  bankTransactionId?: string
  documentId?: string
  status: LabourPaymentStatus
  idempotencyKey: string
  notes?: string
}

// ---------------------------------------------------------------------------
// Client payments
// ---------------------------------------------------------------------------

export const CLIENT_PAYMENT_METHODS = [
  'NEFT',
  'RTGS',
  'IMPS',
  'UPI',
  'CHEQUE',
  'CASH',
  'OTHER',
] as const
export type ClientPaymentMethod = (typeof CLIENT_PAYMENT_METHODS)[number]

export const CLIENT_PAYMENT_STATUSES = [
  'PENDING',
  'SUGGESTED',
  'CONFIRMED',
  'REJECTED',
  'REVERSED',
] as const
export type ClientPaymentStatus = (typeof CLIENT_PAYMENT_STATUSES)[number]

export const PAYMENT_SOURCES = ['MANUAL', 'STATEMENT_IMPORT', 'SCREENSHOT_OCR'] as const
export type PaymentSource = (typeof PAYMENT_SOURCES)[number]

/**
 * Money in from the client. Section 8.
 *
 * Only CONFIRMED payments count toward totalReceived. Anything AI- or
 * import-derived enters as SUGGESTED and needs a human transition (section 9,
 * section 34) - which is what keeps an OCR misread out of the books.
 */
export interface ClientPayment {
  id: string
  projectId: string
  clientId: string
  billId?: string
  amountPaise: Paise
  date: DateKey
  method: ClientPaymentMethod
  bankReference?: string
  transactionId?: string
  source: PaymentSource
  documentId?: string
  status: ClientPaymentStatus
  idempotencyKey: string
  notes?: string
  confirmedBy?: string
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = [
  'LABOUR',
  'MATERIAL',
  'TRANSPORT',
  'EQUIPMENT',
  'FOOD',
  'ACCOMMODATION',
  'MISC',
  'OTHER',
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface Expense {
  id: string
  projectId: string
  category: ExpenseCategory
  amountPaise: Paise
  date: DateKey
  description: string
  paymentMethod: PaymentMethod
  vendorName?: string
  documentId?: string
  status: 'RECORDED' | 'REVERSED'
  createdBy: string
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const TRANSACTION_TYPES = [
  'BILL',
  'CLIENT_PAYMENT',
  'LABOUR_PAYMENT',
  'EXPENSE',
  'ADJUSTMENT',
  'REVERSAL',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/** Section 18. Append-only; a correction is a new opposing entry (ADR-007). */
export interface LedgerTransaction {
  id: string
  projectId: string
  type: TransactionType
  direction: 'IN' | 'OUT' | 'ACCRUAL'
  amountPaise: Paise
  date: DateKey
  refType: string
  refId: string
  description: string
  status: 'ACTIVE' | 'REVERSED'
  reversalOf?: string
  createdBy: string
}

// ---------------------------------------------------------------------------
// Project membership
// ---------------------------------------------------------------------------

/**
 * Which supervisors may see which projects. Document ID is
 * `{projectId}_{uid}` so Security Rules can check membership with a single
 * exists() and no query (DATABASE.md).
 */
export interface ProjectMember {
  id: string
  projectId: string
  uid: string
  displayName: string
  addedBy: string
}
