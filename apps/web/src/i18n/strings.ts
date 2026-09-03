import type { Locale } from '@mc/types'

/**
 * Translations. Section 29.
 *
 * A plain typed object rather than i18next: the requirement is two languages
 * and no complex plural rules, and a 40 KB library to look up keys in a record
 * would be weight for nothing. `Strings` is derived from the English table, so
 * a missing Hindi key is a TYPE ERROR - which is what actually keeps
 * translations honest as the app grows.
 *
 * Hindi is Devanagari (assumption A8). The register is deliberately plain
 * spoken Hindi, not literary or bureaucratic - "लेना बाक़ी" reads naturally to
 * someone running a construction business, where "प्राप्य" would not.
 * Hinglish matters for voice input later, not for the interface.
 */

export const en = {
  // ---- shell ----
  appName: 'Matrix Construction',
  signOut: 'Sign out',
  signInWithGoogle: 'Sign in with Google',
  loading: 'Loading…',
  cancel: 'Cancel',
  save: 'Save',
  add: 'Add',
  tryAgain: 'Try again',
  back: 'Back',
  next: 'Next',
  skip: 'Skip',
  close: 'Close',
  search: 'Search',
  total: 'Total',
  status: 'Status',
  notes: 'Notes',
  optional: 'optional',
  none: 'None',
  edit: 'Edit',
  active: 'Active',

  // ---- nav ----
  navDashboard: 'Dashboard',
  navAttendance: 'Attendance',
  navProjects: 'Projects',
  navLabour: 'Labour',
  navWages: 'Wages',
  navReports: 'Reports',
  navClients: 'Clients',
  navUsers: 'Users',
  navSettings: 'Settings',

  // ---- dashboard ----
  greeting: 'Namaste',
  today: 'Today',
  needsAttention: 'Needs attention',
  activeSites: 'Active sites',
  noActiveProjects: 'No active projects yet.',
  todayAttendance: "Today's attendance",
  attendanceNotMarked: 'Attendance not marked today',
  attendancePartial: 'Attendance incomplete',
  attendanceDone: 'Attendance marked',
  markAttendance: 'Mark attendance',
  recentPayments: 'Recent payments',
  noPaymentsYet: 'No payments recorded yet.',
  pendingBills: 'Unpaid bills',
  noPendingBills: 'No unpaid bills.',
  measurementsAwaitingApproval: 'Measurements waiting for approval',
  labourToPay: 'Labour still to be paid',
  viewAll: 'View all',
  acrossProjects: 'across all projects',

  // ---- attendance ----
  attendanceTitle: 'Attendance',
  project: 'Project',
  date: 'Date',
  present: 'Present',
  absent: 'Absent',
  halfDay: 'Half day',
  leave: 'Leave',
  holiday: 'Holiday',
  marked: 'marked',
  allMarked: 'All marked',
  remaining: 'left',
  offlineTitle: 'You are offline.',
  offlineBody: 'Attendance is saved on this phone and will sync by itself when there is signal.',
  noLabourAssigned: 'No labourers assigned to this project yet.',
  assignFromLabourPage: 'Assign them from the Labour page.',
  futureDate: 'Attendance can only be marked up to today.',
  notAssignedToProject: 'You are not assigned to any project yet.',

  // ---- money ----
  contractValue: 'Contract value',
  billed: 'Billed',
  received: 'Received',
  receivable: 'Receivable',
  receivableHint: 'Billed but not yet paid — owed to you today',
  unbilledBalance: 'Unbilled balance',
  unbilledHint: 'Contract value still to invoice',
  contractRemaining: 'Contract remaining',
  contractRemainingHint: 'Still to collect in total',
  labourEarned: 'Labour earned',
  labourPaid: 'Labour paid',
  labourPayable: 'Labour payable',
  otherExpenses: 'Other expenses',
  cashPosition: 'Cash position',
  cashPositionHint:
    'Received minus cash out. Not profit — material and overhead costs are not tracked.',
  amount: 'Amount',
  rate: 'Rate',
  method: 'Method',
  reference: 'Reference',

  // ---- projects ----
  projectsTitle: 'Projects',
  newProject: 'New project',
  noProjectsYet: 'No projects yet.',
  addFirstProject: 'Add the first project',
  projectName: 'Project name',
  shortCode: 'Short code',
  client: 'Client',
  startDate: 'Start date',
  siteAddress: 'Site address',
  chooseClient: 'Choose a client…',
  createProject: 'Create project',
  addClientFirst: 'Add a client first — every project belongs to one.',
  whatIsOutstanding: 'What is outstanding',
  labourAndCosts: 'Labour and costs',
  contractValueOptional: 'Contract value (only if there is a fixed amount)',
  contractValueOptionalHint:
    'Leave blank if the amount depends on measured work — most projects do. Bills are then built from measurements, and "receivable" is what you are owed.',
  noContractValue: 'No fixed contract amount',
  noContractValueHint: 'Billed on measured work',
  onlyReceivableApplies:
    'This project has no agreed total, so there is no "still to bill" figure. What the client owes you today is the receivable above.',
  noMoneyForRole: 'Financial figures are not shown for your role.',
  overBilled:
    'Billing exceeds the contract value. That is legitimate after a change order, but worth confirming.',
  overPaid: 'The client has paid more than has been billed — an advance.',
  figuresComputed: 'Figures last computed',

  // ---- project tabs ----
  projectSections: 'Project sections',
  tabOverview: 'Overview',
  tabBills: 'Bills',
  tabMoney: 'Money in & out',
  tabRateCard: 'Rate card',
  tabMeasurements: 'Measurements',

  // ---- clients ----
  clientsTitle: 'Clients',
  newClient: 'New client',
  noClientsYet: 'No clients yet.',
  clientName: 'Client name',
  contactPerson: 'Contact person',
  phone: 'Phone',
  city: 'City',
  addClient: 'Add client',
  inactive: 'inactive',

  // ---- rate card ----
  rateCard: 'Rate card (BOQ)',
  addWorkItem: 'Add work item',
  noWorkItems: 'No work items yet.',
  rateCardHint: 'Add the agreed items and rates — measurements and bills are built from these.',
  workItem: 'Work item',
  unit: 'Unit',
  contractQty: 'Contract quantity',
  ratePerUnit: 'Rate per unit',
  done: 'Done',
  left: 'Left',
  rateCardTotal: 'Rate card total',
  completeByValue: 'complete by value',
  pasteFromSheet: 'Paste from a spreadsheet',

  // ---- measurements ----
  measurementBook: 'Measurement book',
  newMeasurement: 'New measurement',
  noMeasurements: 'No measurements yet.',
  measurementsHint: 'Record work done against the rate card. Only approved sheets can be billed.',
  title: 'Title',
  workMeasured: 'Work measured',
  addLine: 'Add line',
  location: 'Location',
  chooseWorkItem: 'Choose work item…',
  sheetTotal: 'Sheet total',
  saveAsDraft: 'Save as draft',
  savedAsDraftHint: 'Saved as a draft. Submit it, then the owner approves before it can be billed.',
  submit: 'Submit',
  approve: 'Approve',
  reject: 'Reject',
  rejected: 'Rejected',
  cannotApproveOwn:
    'Submitted sheets are waiting for the owner to approve. You cannot approve your own measurements.',

  // ---- bills ----
  billsTitle: 'Bills',
  createBill: 'Create bill',
  noBills: 'No bills yet.',
  approveFirst: 'Approve a measurement first — only approved work can be billed.',
  readyToBill: 'Approved measurements are ready to bill.',
  chooseMeasurements: 'Choose the approved measurements to bill. Each can only be billed once.',
  billTotal: 'Bill total',
  generateBill: 'Generate bill',
  print: 'Print',
  markSent: 'Mark sent',
  due: 'due',

  // ---- payments and expenses ----
  paymentsAndExpenses: 'Payments and expenses',
  moneyReceived: 'Money received',
  addExpense: 'Add expense',
  expenses: 'Expenses',
  amountReceived: 'Amount received',
  againstBill: 'Against bill',
  notLinkedToBill: 'Not linked to a bill',
  recordReceipt: 'Record receipt',
  category: 'Category',
  whatWasItFor: 'What was it for',
  paidBy: 'Paid by',
  recordExpense: 'Record expense',
  noReferenceWarning:
    'Without a reference, a repeat of this exact amount on this date cannot be told apart from a duplicate entry.',
  labourExpenseWarning:
    "Labour-category expenses are excluded from the project's expense total, because wage payments are counted separately. Record wages on the Wages page instead.",

  // ---- labour ----
  labourTitle: 'Labour',
  addPerson: 'Add person',
  noLabourYet: 'No labourers yet.',
  name: 'Name',
  work: 'Work',
  dailyWage: 'Daily wage',
  assign: 'Assign',
  assignTo: 'Assign to project',
  rateOnProject: 'Rate on this project',
  rateVariesHint:
    'The rate can differ per project. Attendance snapshots whichever rate applies on the day.',
  privacyNote:
    'Only name, phone, role and wage are stored. No Aadhaar or ID documents — this system has no reason to hold them.',
  perDay: '/ day',

  // ---- wages ----
  wagesTitle: 'Wages',
  month: 'Month',
  days: 'Days',
  earned: 'Earned',
  paid: 'Paid',
  payable: 'Payable',
  pay: 'Pay',
  payAdvance: 'Pay advance',
  advance: 'advance',
  advanceTitle: 'Advance payment',
  advanceExplain:
    'Money paid before it has been earned. It will be set against future wages automatically.',
  advanceOutstanding: 'Advance outstanding',
  advanceRecovered: 'Advance recovered',
  netPayable: 'Net payable',
  mixed: 'mixed',
  recordPayment: 'Record payment',
  doesNotSendMoney: 'This records a payment you have already made. It does not send money.',
  deterministicNote:
    'Every figure here is computed from attendance records by a deterministic function. Nothing on this page is estimated.',
  cashNoReferenceWarning:
    'A cash payment with no reference cannot be told apart from a repeat of itself later. Add a note or receipt number if you can.',

  // ---- reports ----
  reportsTitle: 'Reports',
  reportsHint: 'PDF to print or share. Spreadsheet to work with the numbers.',
  download: 'Download',
  preparing: 'Preparing…',
  excel: 'Excel',

  // ---- settings ----
  settingsTitle: 'Settings',
  language: 'Language',
  checkTheFigures: 'Check the figures',
  introduction: 'Introduction',
  showTourAgain: 'Show the introduction again',
  aiAssistant: 'AI assistant',

  // ---- access ----
  waitingForAccess: 'Waiting for access',
  yourAccountId: 'Your account ID',
  signedInAs: 'Signed in as',
  copyMyDetails: 'Copy my details',
  copied: 'Copied',
  sendOnWhatsApp: 'Send on WhatsApp',

  // ---- attachments ----
  paymentProof: 'Payment proof',
  proofHint: 'Photo or PDF. The payment is saved even if the attachment fails.',
  proofFailedBanner:
    'Payment saved. The proof did not upload — the money is recorded either way. Attach it here when you can.',
  attachProof: 'Attach proof',
  viewProof: 'Proof',

  // ---- business details ----
  businessDetails: 'Business details',
  businessDetailsHint: 'The letterhead printed on every bill, quotation and report.',
  businessName: 'Business name',
  tagline: 'Line under the name',
  address: 'Address — one line per row',
  email: 'Email',
  gstin: 'GST number',
  signatory: 'Authorized signatory',
  billPrefix: 'Bill number prefix',
  businessNotSet:
    'Business details are not filled in yet — bills will print without a letterhead. Add them in Settings.',
  businessSaved: 'Saved. New bills and quotations will use these details.',
  setUp: 'Set up',
  setUpClientsHint: 'Who you bill. Names appear on every invoice.',
  setUpUsersHint: 'Who can sign in, and what each of them may see.',
  setUpWagesHint: 'Payroll across every project in one table.',

  // ---- quotation ----
  quotation: 'Quotation',
  workQuoted: 'Work quoted',
  terms: 'Terms & Conditions — one per line',
  quotationHint: 'A quotation lists rates only, without quantities or totals.',
  ref: 'Ref',

  // ---- labour detail ----
  labourNotFound: 'This person is not in the records, or you do not have access.',
  notOnAnySite: 'Not on any site right now.',
  assignFirst: 'Assign them to a project first.',
  paymentHistory: 'Payment history',
  noAttendanceYet: 'No attendance recorded yet.',
  showFormerWorkers: 'Show people no longer working with us',
  hideFormerWorkers: 'Hide people no longer working with us',
  noLongerWithUs: 'No longer working with us',
  noLongerWithUsHint:
    'Takes them off the roster and off attendance. All their past attendance, wages and payments are kept.',
  confirmLeft: 'Yes, they have left',
  workingAgain: 'Working with us again',
  formerWorker: 'No longer working with us',
  formerWorkerBanner:
    'No longer working with us. Everything below stays in the records and in past reports — they are only off the roster and off attendance marking.',
  noAttendanceNoSite: 'No attendance yet — they have not been assigned to a site.',
  assignBeforePaying: 'Assign them to a project first — a payment is always booked against one.',

  // ---- attendance view ----
  dayView: 'Day',
  monthView: 'Month',

  // ---- reports ----
  view: 'View',
  shareOnWhatsApp: 'Share on WhatsApp',
  reportHeader: 'Report header',
  reportHeaderHint:
    'These come from your saved business details. Changes here apply to this document only.',
  generatePdf: 'Make PDF',

  // ---- progress states ----
  creating: 'Creating…',
  adding: 'Adding…',
  assigning: 'Assigning…',
  generating: 'Generating…',
  saving: 'Saving…',
  recording: 'Recording…',
  checking: 'Checking…',
  correcting: 'Correcting…',
  signingIn: 'Signing in…',

  // ---- counts. {n} is substituted; _one is used when n === 1. ----
  countProjects: '{n} projects',
  countProjects_one: '{n} project',
  countClients: '{n} clients',
  countClients_one: '{n} client',
  countPeople: '{n} people',
  countPeople_one: '{n} person',
  countBills: '{n} bills',
  countBills_one: '{n} bill',
  countSheets: '{n} sheets',
  countSheets_one: '{n} sheet',
  countSheetsReady: '{n} approved sheets ready to bill',
  countSheetsReady_one: '{n} approved sheet ready to bill',
  generateBillFor: 'Generate bill for {n} sheets',
  generateBillFor_one: 'Generate bill for {n} sheet',
  countRecordsRead: 'Read {n} financial records.',
  countRecordsRead_one: 'Read {n} financial record.',
  countFiguresDisagree: '{n} figures disagree with the underlying records.',
  countFiguresDisagree_one: '{n} figure disagrees with the underlying records.',
  totalContractAcross: 'Total contract value across {n} projects:',
  totalContractAcross_one: 'Total contract value across {n} project:',

  // ---- misc labels ----
  backToProjects: 'Back to projects',
  started: 'started',
  check: 'Check',
  correctStoredFigures: 'Correct the stored figures',
  figure: 'Figure',
  stored: 'Stored',
  correct: 'Correct',
  difference: 'Difference',
  monthForAttendance: 'Month (attendance and wages)',
  noExpensesYet: 'No expenses recorded yet.',
  removeLine: 'Remove line',
  projectNotFound: 'Project not found, or you do not have access to it.',
  accessTurnedOff: 'Your access has been turned off',
  accessDisabledBody: 'Your account exists but has been disabled. Ask the owner to re-enable it.',
  awaitingAccessBody:
    'You are signed in to Google, but this account has not been given access yet. Send the details below to the owner.',
  signInTagline: 'Projects, billing, labour and payments',
  addRateCardFirst: 'Add rate card items first — measurements are recorded against them.',
  beforeTaxAndDeductions: '(before tax and deductions)',
  everythingMatches: 'Everything matches. The stored totals agree with the underlying records.',
  reconcileExplain:
    "Recalculates a project's totals from every underlying bill, payment, wage and expense, and shows anything that disagrees with what is stored. Nothing is written until you confirm.",
  tourHint: 'The walkthrough shown on first sign-in.',
  notAvailable: 'Not available.',
  popupBlocked: 'Your browser blocked the print window. Allow pop-ups for this site and try again.',

  // ---- validation and prompts ----
  enterAmountLike: 'Enter an amount like 18,50,000',
  formIncomplete: 'Form is incomplete',
  enterDailyWage: 'Enter a daily wage',
  chooseProjectAndRate: 'Choose a project and rate',
  nothingToApply: 'Nothing to apply',
  whyCancelBill: 'Why is this bill being cancelled?',
  whyReject: 'Why is this being rejected?',
  enterRateLike: 'Enter a rate like 120',
  enterBusinessName: 'Enter the business name.',
  enterValidDate: 'Enter a valid date.',
  futurePaymentDate: 'A payment cannot be dated later than today.',

  // ---- small words reused across screens ----
  you: 'you',
  role: 'Role',
  enable: 'Enable',
  disable: 'Disable',
  code: 'Code',
  subtitle: 'Subtitle',
  payments: 'Payments',
  closed: 'closed',
  qtyShort: 'Qty',
  contractShort: 'Contract',
  maxQty: 'max {n}',
  /** Sentence-final punctuation. Devanagari uses a danda, not a full stop. */
  fullStop: '.',

  // ---- failed queries ----
  retryingIn: 'retrying in {n}s',
  couldNotLoad: 'Could not load {what}.',
  thisData: 'this',
  errSettingUpTitle: 'Setting up',
  errSettingUpBody:
    'The database is finishing a one-time setup step for this screen. It usually takes a minute or two — this will clear on its own.',
  errOfflineTitle: 'You are offline',
  errOfflineBody: 'Showing what was saved on this device. New entries need a connection.',
  errNotAllowedTitle: 'Not allowed',
  errNotAllowedBody: 'Your role does not have access to this. Ask the owner if you need it.',
  errSignedOutTitle: 'Signed out',
  errSignedOutBody: 'Your session ended. Sign in again to continue.',
  errQuotaTitle: 'Daily limit reached',
  errQuotaBody: 'The free database quota for today is used up. It resets at midnight Pacific time.',
  errSlowTitle: 'Took too long',
  errSlowBody: 'The connection is slow. Try again in a moment.',
  errUnknownTitle: 'Something went wrong',
  errUnknownBody: 'Unknown error',

  // ---- startup screens ----
  setupNeeded: 'Setup needed',
  firebaseConfigIncomplete: 'Firebase configuration is incomplete',
  envVarsMissing: 'These environment variables are missing or empty:',
  setupCopy: 'Copy',
  setupTo: 'to',
  setupIn: 'in',
  setupFillConfig: 'Fill in the Firebase web config. The fastest way is',
  setupRestart: 'Restart the dev server.',
  setupWalkthroughIn: 'Full walkthrough in',
  setupWalkthroughRest:
    ', sections 2 and 4. None of these values are secret — security comes from Firestore Rules, not from hiding the config.',
  appCouldNotStart: 'The app could not start',
  componentTree: 'Component tree',
  thingsWorthChecking: 'Things worth checking:',
  fatalCheckSignIn:
    'Is Google sign-in enabled in the Firebase console under Authentication → Sign-in method?',
  fatalCheckEnvDoes: 'Does',
  fatalCheckEnvMatch: 'match the current Firebase project?',
  fatalCheckSdk: 'Only one copy of the Firebase SDK should be installed — run',
  reload: 'Reload',

  // ---- users ----
  countPeopleWithAccess: '{n} people with access',
  countPeopleWithAccess_one: '{n} person with access',
  countPermissions: '{n} permissions',
  countPermissions_one: '{n} permission',
  roleFor: 'Role for {name}',
  accountIdUid: 'Account ID (UID)',
  accountIdWord: 'account ID',
  addUserHintBefore: 'Ask the person to sign in first. Their',
  addUserHintAfter: 'is shown on the waiting-for-access screen — paste it below.',
  driveWarningTitle: 'When you disable someone, also remove them from the Drive folder.',
  driveWarningBody:
    'Drive permissions live outside this app and cannot be revoked from here, so a disabled user keeps access to shared files until you unshare the folder (RISKS.md R-07).',

  // ---- rate card entry ----
  countItems: '{n} items',
  countItems_one: '{n} item',
  rateCardTotalsIs: 'The rate card totals',
  butContractValueIs: ', but the contract value is',
  aDifferenceOf: ' — a difference of',
  coverageEnd: '.',
  someWorkNotItemised: 'Some contract work may not be itemised yet.',
  rateCardOverContract: 'The rate card exceeds the agreed contract.',
  quotationPrints:
    'Prints the {n} open rate card items as a quotation — description, unit and rate. Quantities and totals are left off deliberately.',
  quotationPrints_one:
    'Prints the {n} open rate card item as a quotation — description, unit and rate. Quantities and totals are left off deliberately.',
  pasteFromSheetHint:
    'Copy the item, unit, quantity and rate columns out of your sheet and paste them below. A header row is fine, and so is a comma-separated file.',
  rowsOfTotal: '{ok} of {all} rows',
  countRowsRejected:
    '{n} rows could not be read and will be skipped. Fix them above and they will appear here.',
  countRowsRejected_one:
    '{n} row could not be read and will be skipped. Fix it above and it will appear here.',
  partiallySaved:
    ' — {saved} of {total} items were already saved. Remove those lines before trying again.',
  addingNofM: 'Adding {done} of {total}…',
  addItems: 'Add {n} items',
  addItems_one: 'Add {n} item',
  boqMissingField: '{field} is missing',
  boqUnknownUnit: '"{value}" is not a unit we know',
  boqBadQuantity: '"{value}" is not a quantity',
  boqBadRate: '"{value}" is not a rate',
  boqAmountTooLarge: 'Quantity × rate is beyond the amount limit — check for an extra zero',
  boqDuplicateInPaste: 'Same {what} as row {row}',
  boqAlreadyOnRateCard: 'This {what} is already on the rate card',
  wordCode: 'code',
  wordName: 'name',

  // ---- measurements ----
  approvalShortfall: '{item}: asked for {asked}, only {left} left',
  exceedsContractLine:
    'at {location}: only {allowed} left against the contract, {excess} too many.',
  invalidQuantity: 'has an invalid quantity.',

  // ---- wages and labour ----
  proofFailedFor:
    'Payment saved for {name}. The proof did not upload — the money is recorded either way. Attach it here when you can.',
  confirmLeftExplain:
    '{name} comes off the roster and out of attendance marking. Every day worked and every rupee paid stays exactly where it is — nothing is deleted, and they can be brought back at any time.',

  // ---- report actions ----
  editHeader: 'Edit header',
  downloadPdf: 'Download PDF',
  sendSheetAsFile: 'Send spreadsheet as a file',
  pdfDownloadedNotice:
    '{file} has been downloaded and WhatsApp is opening in a new tab. Attach that file to the chat — this browser cannot attach it for you.',
  pdfExplainMake:
    'turns the sheet above into a PDF — the letterhead, the table and the signature block exactly as shown. A long register takes a few seconds. The button then becomes',
  pdfExplainShare:
    ', which sends the PDF itself, not a summary of it. Two taps, because a browser only lets a page hand a file to another app during the tap — it cannot still be building the file at that moment.',
  pdfExplainWhere:
    'On a phone that opens WhatsApp with the PDF already attached. On a desktop, where no browser can pass a file to another application, the PDF downloads and WhatsApp opens with a covering message — attach the downloaded file to the chat yourself.',
  pdfExplainPrint:
    'opens the browser’s own print view instead. Use it when the text has to be selectable or searchable: the shared PDF is a picture of the page, which is exactly what makes Hindi names come out right.',
  reportsOpenHint:
    'Open a report to read it on screen. The PDF, WhatsApp and the spreadsheet are all offered from there.',
  backupLabel: 'Backup (§41).',
  backupHint:
    'These downloads are the backup mechanism. There is no automatic off-site backup, because that needs a scheduled job the free plan cannot run. Download the outstanding, billing and payment reports periodically and keep them safe.',
  openPrintView: 'Open print view',
  useTheseDetails: 'Use these details',
  documentHeaderHint: 'Printed at the top of this report. Changes apply to this document only —',
  editSavedDetailsInSettings: 'edit your saved details in Settings',
  letterheadNotSetUp:
    'Your business details have not been set up yet, so there is nothing to print as a letterhead. Fill in at least the business name below, or set it once under Settings → Business details.',
  resetToSavedDetails: 'Reset to my saved details',
  showingFirstRows:
    'Showing the first {shown} of {all} rows. The PDF and the spreadsheet contain all of them.',

  // ---- settings ----
  aiToolLayerNote:
    'The tool layer is built and tested — when billing is enabled, connecting a provider is an adapter, not a rewrite.',

  // ---- payments ----
  utrNumber: 'UTR number',

  // ---- tour ----
  tourGreetingName: 'there',
  tourSupIntroBody:
    'This app replaces the attendance register and the measurement diary. Two screens cover almost everything you do.',
  tourSupAttendanceBody: 'Pick the project and the date, then tap P, ½, A or L against each name.',
  tourSupAttendanceDetail:
    'It works with no internet. Marks are saved on your phone and sync by themselves when signal comes back — nothing is ever lost.',
  tourSupMeasureBody:
    'Record work done against the rate card — item, location, quantity. The app shows the amount as you type.',
  tourSupMeasureDetail:
    'If a quantity would go past the agreed contract, it tells you immediately and says how much is left. You submit; the owner approves.',
  tourSupHiddenTitle: 'What you will not see',
  tourSupHiddenBody:
    'Bills, payments and wages are hidden for your role. That is deliberate, not a fault.',
  tourOwnerIntroBody:
    'This is your construction business in one place — projects, work done, bills, money in, labour and wages.',
  tourFlowTitle: 'How work becomes money',
  tourFlowBody: 'Client → Project → Rate card → Measurement → Approval → Bill → Payment.',
  tourFlowDetail:
    'Each step feeds the next. Nothing can be billed until it has been measured and approved, and every figure on the dashboard is computed from those records — never typed in by hand.',
  tourProjectsBody:
    'Open a project to see everything about it: contract value, what is billed, what is received, and what is still owed.',
  tourProjectsDetail:
    '"Outstanding" is shown as three separate numbers, because it means three different things — money invoiced and unpaid, work still to bill, and the total left to collect.',
  tourRateCardTitle: 'Rate card and measurements',
  tourRateCardBody:
    'Set your agreed items and rates once. Site staff record work against them each month.',
  tourRateCardDetail:
    'The app will not let anyone measure past the contract quantity without an explicit change order.',
  tourBillsTitle: 'Bills and payments',
  tourBillsBody:
    'Generate a bill from approved measurements, print it or save it as PDF, then record payments as they arrive.',
  tourBillsDetail:
    'Bills are never deleted. A mistake is cancelled and reissued, so the trail always stays intact.',
  tourLabourTitle: 'Labour and wages',
  tourLabourBody:
    'Wages are calculated from attendance — days present, half days, and the rate on the day.',
  tourLabourDetail:
    'Earned, paid and payable are tracked separately, so an advance shows up as an advance.',
  tourReportsBody: 'Every report downloads as PDF or a spreadsheet.',
  tourReportsDetail:
    'These are also your backup. There is no automatic off-site backup on the free plan, so download them from time to time.',
  tourStart: 'Start using it',
  tourProgress: '{step} of {total} · you can reopen this from Settings',
} as const

export type StringKey = keyof typeof en
export type Strings = Record<StringKey, string>

export const hi: Strings = {
  appName: 'मैट्रिक्स कंस्ट्रक्शन',
  signOut: 'साइन आउट',
  signInWithGoogle: 'Google से साइन इन करें',
  loading: 'लोड हो रहा है…',
  cancel: 'रहने दो',
  save: 'सेव करो',
  add: 'जोड़ो',
  tryAgain: 'दोबारा करो',
  back: 'पीछे',
  next: 'आगे',
  skip: 'छोड़ें',
  close: 'बंद करें',
  search: 'ढूँढो',
  total: 'कुल',
  status: 'स्थिति',
  notes: 'टिप्पणी',
  optional: 'वैकल्पिक',
  none: 'कोई नहीं',
  edit: 'बदलो',
  active: 'चालू',

  navDashboard: 'डैशबोर्ड',
  navAttendance: 'हाज़िरी',
  navProjects: 'प्रोजेक्ट',
  navLabour: 'मज़दूर',
  navWages: 'मज़दूरी',
  navReports: 'रिपोर्ट',
  navClients: 'क्लाइंट',
  navUsers: 'यूज़र',
  navSettings: 'सेटिंग',

  greeting: 'नमस्ते',
  today: 'आज',
  needsAttention: 'ध्यान देने योग्य',
  activeSites: 'चालू साइट',
  noActiveProjects: 'अभी कोई चालू प्रोजेक्ट नहीं है।',
  todayAttendance: 'आज की हाज़िरी',
  attendanceNotMarked: 'आज हाज़िरी दर्ज नहीं हुई',
  attendancePartial: 'हाज़िरी अधूरी है',
  attendanceDone: 'हाज़िरी दर्ज हो गई',
  markAttendance: 'हाज़िरी लगाओ',
  recentPayments: 'हाल के भुगतान',
  noPaymentsYet: 'अभी कोई भुगतान दर्ज नहीं है।',
  pendingBills: 'बकाया बिल',
  noPendingBills: 'कोई बिल बकाया नहीं है।',
  measurementsAwaitingApproval: 'मंज़ूरी के इंतज़ार में माप',
  labourToPay: 'मज़दूरी देना बाक़ी',
  viewAll: 'सब देखो',
  acrossProjects: 'सभी प्रोजेक्ट मिलाकर',

  attendanceTitle: 'हाज़िरी',
  project: 'प्रोजेक्ट',
  date: 'तारीख़',
  present: 'हाज़िर',
  absent: 'ग़ैरहाज़िर',
  halfDay: 'आधा दिन',
  leave: 'छुट्टी',
  holiday: 'अवकाश',
  marked: 'दर्ज',
  allMarked: 'सब दर्ज हो गए',
  remaining: 'बाक़ी',
  offlineTitle: 'आप ऑफ़लाइन हैं।',
  offlineBody: 'हाज़िरी इसी फ़ोन में सेव हो रही है और नेटवर्क आते ही अपने आप भेज दी जाएगी।',
  noLabourAssigned: 'इस प्रोजेक्ट में अभी कोई मज़दूर नहीं जोड़ा गया है।',
  assignFromLabourPage: 'मज़दूर पेज से उन्हें जोड़ें।',
  futureDate: 'हाज़िरी आज तक की ही दर्ज हो सकती है।',
  notAssignedToProject: 'आपको अभी किसी प्रोजेक्ट पर नहीं लगाया गया है।',

  contractValue: 'ठेके का पैसा',
  billed: 'बिल बना दिया',
  received: 'पैसा आया',
  receivable: 'लेना बाक़ी है',
  receivableHint: 'बिल तो बन गया पर पैसा नहीं आया — अभी इतना लेना है',
  unbilledBalance: 'बिल बनाना बाक़ी',
  unbilledHint: 'इतने का बिल अभी बनाना है',
  contractRemaining: 'ठेके में इतना बाक़ी',
  contractRemainingHint: 'सब मिलाकर इतना लेना है',
  labourEarned: 'मज़दूरी कमाई',
  labourPaid: 'पैसे दे दिए',
  labourPayable: 'पैसे देने बाक़ी',
  otherExpenses: 'बाक़ी ख़र्चा',
  cashPosition: 'हाथ में पैसा',
  cashPositionHint:
    'जो पैसा आया, उसमें से जो गया वो घटा दिया। ये फ़ायदा नहीं है — सामान और ऊपर का ख़र्चा इसमें नहीं जुड़ा।',
  amount: 'कितना',
  rate: 'रेट',
  method: 'कैसे',
  reference: 'नंबर',

  projectsTitle: 'प्रोजेक्ट',
  newProject: 'नया प्रोजेक्ट',
  noProjectsYet: 'अभी कोई प्रोजेक्ट नहीं है।',
  addFirstProject: 'पहला प्रोजेक्ट जोड़ें',
  projectName: 'प्रोजेक्ट का नाम',
  shortCode: 'छोटा नाम',
  client: 'क्लाइंट',
  startDate: 'कब शुरू हुआ',
  siteAddress: 'साइट कहाँ है',
  chooseClient: 'क्लाइंट चुनो…',
  createProject: 'प्रोजेक्ट बनाओ',
  addClientFirst: 'पहले क्लाइंट जोड़ें — हर प्रोजेक्ट किसी न किसी क्लाइंट का होता है।',
  whatIsOutstanding: 'क्या बाक़ी है',
  labourAndCosts: 'मज़दूरी और ख़र्च',
  contractValueOptional: 'ठेके का पैसा (अगर रकम तय है तभी)',
  contractValueOptionalHint:
    'अगर पैसा नाप के हिसाब से बनता है तो खाली छोड़ दो — ज़्यादातर प्रोजेक्ट ऐसे ही होते हैं। फिर बिल नाप से बनता है, और जो लेना बाक़ी है वही असल आंकड़ा है।',
  noContractValue: 'ठेके की रकम तय नहीं',
  noContractValueHint: 'नाप के हिसाब से बिल बनता है',
  onlyReceivableApplies:
    'इस प्रोजेक्ट में कोई कुल रकम तय नहीं है, इसलिए “बिल बनाना बाक़ी” वाला आंकड़ा नहीं बनता। क्लाइंट से आज जो लेना है, वो ऊपर वाला आंकड़ा है।',
  noMoneyForRole: 'आपकी भूमिका के लिए पैसों के आंकड़े नहीं दिखाए जाते।',
  overBilled:
    'बिल ठेके की राशि से ज़्यादा हो गया है। चेंज ऑर्डर के बाद यह सही है, पर एक बार देख लें।',
  overPaid: 'क्लाइंट ने बिल से ज़्यादा पैसा दे दिया है — यह अग्रिम है।',
  figuresComputed: 'आंकड़े आख़िरी बार गिने गए',

  projectSections: 'प्रोजेक्ट के हिस्से',
  tabOverview: 'एक नज़र में',
  tabBills: 'बिल',
  tabMoney: 'पैसा आया-गया',
  tabRateCard: 'रेट कार्ड',
  tabMeasurements: 'नाप',

  clientsTitle: 'क्लाइंट',
  newClient: 'नया क्लाइंट',
  noClientsYet: 'अभी कोई क्लाइंट नहीं है।',
  clientName: 'क्लाइंट का नाम',
  contactPerson: 'किससे बात होती है',
  phone: 'फ़ोन',
  city: 'शहर',
  addClient: 'क्लाइंट जोड़ो',
  inactive: 'निष्क्रिय',

  rateCard: 'रेट कार्ड (BOQ)',
  addWorkItem: 'काम जोड़ो',
  noWorkItems: 'अभी कोई काम दर्ज नहीं है।',
  rateCardHint: 'तय किए गए काम और दरें जोड़ें — माप और बिल इन्हीं से बनते हैं।',
  workItem: 'काम',
  unit: 'नाप',
  contractQty: 'कुल कितना काम',
  ratePerUnit: 'एक का रेट',
  done: 'हो गया',
  left: 'बाक़ी',
  rateCardTotal: 'रेट कार्ड कुल',
  completeByValue: 'राशि के हिसाब से पूरा',
  pasteFromSheet: 'शीट से पेस्ट करें',

  measurementBook: 'नाप की कॉपी',
  newMeasurement: 'नई नाप',
  noMeasurements: 'अभी कोई माप दर्ज नहीं है।',
  measurementsHint:
    'रेट कार्ड के हिसाब से किया गया काम दर्ज करें। सिर्फ़ मंज़ूर की गई माप का बिल बनता है।',
  title: 'शीर्षक',
  workMeasured: 'जो काम हुआ',
  addLine: 'और लाइन जोड़ो',
  location: 'कहाँ',
  chooseWorkItem: 'काम चुनो…',
  sheetTotal: 'कुल',
  saveAsDraft: 'ड्राफ़्ट में रखो',
  savedAsDraftHint: 'ड्राफ़्ट सेव हो गया। इसे भेजें, फिर मालिक मंज़ूरी देंगे, तब बिल बनेगा।',
  submit: 'भेज दो',
  approve: 'मंज़ूर करो',
  reject: 'वापस करो',
  rejected: 'वापस करो',
  cannotApproveOwn:
    'भेजी गई माप मालिक की मंज़ूरी के इंतज़ार में है। अपनी माप आप ख़ुद मंज़ूर नहीं कर सकते।',

  billsTitle: 'बिल',
  createBill: 'बिल बनाओ',
  noBills: 'अभी कोई बिल नहीं है।',
  approveFirst: 'पहले कोई माप मंज़ूर करें — सिर्फ़ मंज़ूर काम का बिल बनता है।',
  readyToBill: 'मंज़ूर की गई माप का बिल बनाने के लिए तैयार है।',
  chooseMeasurements: 'बिल बनाने के लिए मंज़ूर माप चुनें। हर माप का बिल एक ही बार बनता है।',
  billTotal: 'बिल कुल',
  generateBill: 'बिल बनाओ',
  print: 'प्रिंट करो',
  markSent: 'भेज दिया',
  due: 'बाक़ी',

  paymentsAndExpenses: 'भुगतान और ख़र्च',
  moneyReceived: 'पैसा आया',
  addExpense: 'ख़र्चा जोड़ो',
  expenses: 'ख़र्चा',
  amountReceived: 'कितना पैसा आया',
  againstBill: 'किस बिल का',
  notLinkedToBill: 'किसी बिल से नहीं जोड़ा',
  recordReceipt: 'लिख लो',
  category: 'किस चीज़ का',
  whatWasItFor: 'किस चीज़ का ख़र्चा',
  paidBy: 'कैसे दिया',
  recordExpense: 'ख़र्चा लिखो',
  noReferenceWarning:
    'संदर्भ के बिना, इसी तारीख़ को इतनी ही रकम दोबारा आने पर उसे दोहराव से अलग नहीं पहचाना जा सकेगा।',
  labourExpenseWarning:
    'मज़दूरी श्रेणी के ख़र्च प्रोजेक्ट के कुल ख़र्च में नहीं गिने जाते, क्योंकि मज़दूरी अलग से गिनी जाती है। मज़दूरी, मज़दूरी पेज पर दर्ज करें।',

  labourTitle: 'मज़दूर',
  addPerson: 'आदमी जोड़ो',
  noLabourYet: 'अभी कोई मज़दूर नहीं है।',
  name: 'नाम',
  work: 'काम',
  dailyWage: 'दिन का रेट',
  assign: 'लगाओ',
  assignTo: 'प्रोजेक्ट पर लगाओ',
  rateOnProject: 'इस प्रोजेक्ट पर दर',
  rateVariesHint: 'हर प्रोजेक्ट पर दर अलग हो सकती है। हाज़िरी उसी दिन की दर सेव कर लेती है।',
  privacyNote:
    'सिर्फ़ नाम, फ़ोन, काम और मज़दूरी रखी जाती है। आधार या कोई पहचान पत्र नहीं — इनकी ज़रूरत नहीं है।',
  perDay: '/ दिन',

  wagesTitle: 'मज़दूरी',
  month: 'महीना',
  days: 'दिन',
  earned: 'कमाई',
  paid: 'दे दिए',
  payable: 'बाक़ी',
  pay: 'पैसे दो',
  payAdvance: 'एडवांस दो',
  advance: 'एडवांस',
  advanceTitle: 'एडवांस पैसा',
  advanceExplain: 'कमाई से पहले दिया पैसा। आगे की मज़दूरी में से अपने आप कट जाएगा।',
  advanceOutstanding: 'एडवांस बाक़ी',
  advanceRecovered: 'एडवांस कट गया',
  netPayable: 'कुल देना है',
  mixed: 'अलग-अलग',
  recordPayment: 'पैसे दे दिए, दर्ज करो',
  doesNotSendMoney: 'ये सिर्फ़ लिखने के लिए है कि आपने पैसे दे दिए। यहाँ से पैसा नहीं जाता।',
  deterministicNote: 'यहाँ का हर हिसाब हाज़िरी से बना है। कुछ भी अंदाज़े से नहीं।',
  cashNoReferenceWarning:
    'बिना संदर्भ के नक़द भुगतान को बाद में दोहराव से अलग नहीं पहचाना जा सकता। कोई रसीद नंबर या टिप्पणी जोड़ दें।',

  reportsTitle: 'रिपोर्ट',
  reportsHint: 'PDF प्रिंट या भेजने के लिए। शीट आंकड़ों पर काम करने के लिए।',
  download: 'डाउनलोड',
  preparing: 'तैयार हो रहा है…',
  excel: 'शीट',

  settingsTitle: 'सेटिंग',
  language: 'भाषा',
  checkTheFigures: 'आंकड़े जाँचें',
  introduction: 'परिचय',
  showTourAgain: 'फिर से समझाओ',
  aiAssistant: 'AI सहायक',

  waitingForAccess: 'अनुमति का इंतज़ार',
  yourAccountId: 'आपकी खाता आईडी',
  signedInAs: 'साइन इन',
  copyMyDetails: 'मेरी जानकारी कॉपी करें',
  copied: 'कॉपी हो गया',
  sendOnWhatsApp: 'WhatsApp पर भेजें',

  paymentProof: 'पेमेंट का सबूत',
  proofHint: 'फोटो या PDF। सबूत न चढ़े तब भी पेमेंट सेव हो जाएगा।',
  proofFailedBanner:
    'पेमेंट सेव हो गया। सबूत नहीं चढ़ा — पैसा फिर भी दर्ज है। जब हो सके यहाँ लगा दो।',
  attachProof: 'सबूत लगाओ',
  viewProof: 'सबूत',

  businessDetails: 'अपनी फ़र्म की डिटेल',
  businessDetailsHint: 'ये हर बिल, कोटेशन और रिपोर्ट के ऊपर छपेगा।',
  businessName: 'फ़र्म का नाम',
  tagline: 'नाम के नीचे की लाइन',
  address: 'पता — हर लाइन अलग',
  email: 'ईमेल',
  gstin: 'GST नंबर',
  signatory: 'साइन किसके',
  billPrefix: 'बिल नंबर का शुरू',
  businessNotSet: 'फ़र्म की डिटेल अभी नहीं भरी — बिल बिना हेडर के छपेगा। सेटिंग में भर दो।',
  businessSaved: 'सेव हो गया। अब से बिल और कोटेशन में यही आएगा।',
  setUp: 'सेटअप',
  setUpClientsHint: 'जिनको बिल देते हो। नाम हर बिल पर आता है।',
  setUpUsersHint: 'कौन लॉगिन कर सकता है और किसको क्या दिखेगा।',
  setUpWagesHint: 'सब प्रोजेक्ट की मज़दूरी एक जगह।',

  quotation: 'कोटेशन',
  workQuoted: 'किस काम का कोटेशन',
  terms: 'शर्तें — हर लाइन अलग',
  quotationHint: 'कोटेशन में सिर्फ़ रेट लिखे जाते हैं, मात्रा या कुल नहीं।',
  ref: 'Ref',

  labourNotFound: 'ये आदमी रिकॉर्ड में नहीं है, या आपको देखने की अनुमति नहीं।',
  notOnAnySite: 'अभी किसी साइट पर नहीं है।',
  assignFirst: 'पहले किसी प्रोजेक्ट पर लगाओ।',
  paymentHistory: 'पहले दिए पैसे',
  noAttendanceYet: 'अभी हाज़िरी दर्ज नहीं है।',
  showFormerWorkers: 'जो छोड़ चुके हैं वो भी दिखाओ',
  hideFormerWorkers: 'जो छोड़ चुके हैं वो छुपाओ',
  noLongerWithUs: 'अब काम नहीं करता',
  noLongerWithUsHint: 'रोज़ की हाज़िरी से हट जाएगा। पुरानी हाज़िरी, मज़दूरी और पेमेंट सब रहेगा।',
  confirmLeft: 'हाँ, छोड़ दिया',
  workingAgain: 'फिर से काम कर रहा है',
  formerWorker: 'अब काम नहीं करता',
  formerWorkerBanner:
    'अब हमारे साथ काम नहीं करता। नीचे का सब कुछ रिकॉर्ड में और पुरानी रिपोर्ट में रहेगा — बस रोज़ की हाज़िरी से हट गया है।',
  noAttendanceNoSite: 'अभी हाज़िरी नहीं है — किसी साइट पर लगाया ही नहीं गया।',
  assignBeforePaying: 'पहले किसी प्रोजेक्ट पर लगाओ — पैसा हमेशा किसी प्रोजेक्ट के नाम से जाता है।',

  dayView: 'दिन',
  monthView: 'महीना',

  view: 'देखो',
  shareOnWhatsApp: 'WhatsApp पर भेजो',
  reportHeader: 'रिपोर्ट का हेडर',
  reportHeaderHint: 'ये आपकी सेव की हुई डिटेल से आया है। यहाँ बदलोगे तो सिर्फ़ इसी कागज़ पर लगेगा।',
  generatePdf: 'PDF बनाओ',

  creating: 'बन रहा है…',
  adding: 'जोड़ा जा रहा है…',
  assigning: 'लगाया जा रहा है…',
  generating: 'बन रहा है…',
  saving: 'सेव हो रहा है…',
  recording: 'दर्ज हो रहा है…',
  checking: 'जाँच हो रही है…',
  correcting: 'ठीक किया जा रहा है…',
  signingIn: 'साइन इन हो रहा है…',

  countProjects: '{n} प्रोजेक्ट',
  countProjects_one: '{n} प्रोजेक्ट',
  countClients: '{n} क्लाइंट',
  countClients_one: '{n} क्लाइंट',
  countPeople: '{n} लोग',
  countPeople_one: '{n} व्यक्ति',
  countBills: '{n} बिल',
  countBills_one: '{n} बिल',
  countSheets: '{n} माप',
  countSheets_one: '{n} माप',
  countSheetsReady: '{n} मंज़ूर माप बिल के लिए तैयार',
  countSheetsReady_one: '{n} मंज़ूर माप बिल के लिए तैयार',
  generateBillFor: '{n} माप का बिल बनाएँ',
  generateBillFor_one: '{n} माप का बिल बनाएँ',
  countRecordsRead: '{n} वित्तीय रिकॉर्ड पढ़े गए।',
  countRecordsRead_one: '{n} वित्तीय रिकॉर्ड पढ़ा गया।',
  countFiguresDisagree: '{n} आंकड़े रिकॉर्ड से मेल नहीं खाते।',
  countFiguresDisagree_one: '{n} आंकड़ा रिकॉर्ड से मेल नहीं खाता।',
  totalContractAcross: '{n} प्रोजेक्ट की कुल ठेका राशि:',
  totalContractAcross_one: '{n} प्रोजेक्ट की कुल ठेका राशि:',

  backToProjects: 'प्रोजेक्ट पर वापस',
  started: 'शुरू',
  check: 'जाँच करो',
  correctStoredFigures: 'हिसाब ठीक करो',
  figure: 'आंकड़ा',
  stored: 'सेव',
  correct: 'सही',
  difference: 'अंतर',
  monthForAttendance: 'महीना (हाज़िरी और मज़दूरी)',
  noExpensesYet: 'अभी कोई ख़र्च दर्ज नहीं है।',
  removeLine: 'लाइन हटाएँ',
  projectNotFound: 'प्रोजेक्ट नहीं मिला, या आपके पास इसकी अनुमति नहीं है।',
  accessTurnedOff: 'आपकी अनुमति बंद कर दी गई है',
  accessDisabledBody: 'आपका खाता है पर बंद कर दिया गया है। मालिक से दोबारा चालू करने को कहें।',
  awaitingAccessBody:
    'आप Google से साइन इन हैं, लेकिन इस खाते को अभी अनुमति नहीं मिली है। नीचे दी जानकारी मालिक को भेजें।',
  signInTagline: 'प्रोजेक्ट, बिल, मज़दूर और भुगतान',
  addRateCardFirst: 'पहले रेट कार्ड में काम जोड़ें — माप उन्हीं के हिसाब से दर्ज होती है।',
  beforeTaxAndDeductions: '(कर और कटौती से पहले)',
  everythingMatches: 'सब मेल खाता है। सेव किए गए आंकड़े रिकॉर्ड से मिलते हैं।',
  reconcileExplain:
    'प्रोजेक्ट के कुल आंकड़े हर बिल, भुगतान, मज़दूरी और ख़र्च से दोबारा गिने जाते हैं, और जो मेल न खाए वह दिखाया जाता है। आपकी पुष्टि के बिना कुछ नहीं बदला जाता।',
  tourHint: 'पहली बार साइन इन करने पर दिखने वाला परिचय।',
  notAvailable: 'उपलब्ध नहीं है।',
  popupBlocked:
    'आपके ब्राउज़र ने प्रिंट विंडो रोक दी। इस साइट के लिए पॉप-अप चालू करके फिर कोशिश करें।',

  enterAmountLike: 'ऐसे लिखो — 18,50,000',
  formIncomplete: 'कुछ छूट गया है',
  enterDailyWage: 'दिन का रेट लिखो',
  chooseProjectAndRate: 'प्रोजेक्ट और रेट चुनो',
  nothingToApply: 'लागू करने को कुछ नहीं है',
  whyCancelBill: 'यह बिल क्यों रद्द किया जा रहा है?',
  whyReject: 'यह क्यों नामंज़ूर किया जा रहा है?',
  enterRateLike: 'रेट ऐसे लिखो — 120',
  enterBusinessName: 'फ़र्म का नाम लिखो।',
  enterValidDate: 'सही तारीख़ लिखो।',
  futurePaymentDate: 'पेमेंट की तारीख़ आज से आगे की नहीं हो सकती।',

  you: 'आप',
  role: 'रोल',
  enable: 'चालू करो',
  disable: 'बंद करो',
  code: 'कोड',
  subtitle: 'नीचे की लाइन',
  payments: 'भुगतान',
  closed: 'बंद',
  qtyShort: 'कितना',
  contractShort: 'कुल काम',
  maxQty: 'ज़्यादा से ज़्यादा {n}',
  fullStop: '।',

  retryingIn: '{n} सेकंड में दोबारा कोशिश',
  couldNotLoad: '{what} नहीं खुल पाया।',
  thisData: 'ये',
  errSettingUpTitle: 'सेटअप चल रहा है',
  errSettingUpBody:
    'इस स्क्रीन के लिए डेटाबेस एक बार का सेटअप पूरा कर रहा है। एक-दो मिनट लगते हैं — अपने आप ठीक हो जाएगा।',
  errOfflineTitle: 'आप ऑफ़लाइन हैं',
  errOfflineBody: 'जो इस फ़ोन में सेव था वही दिख रहा है। नया कुछ डालने के लिए नेटवर्क चाहिए।',
  errNotAllowedTitle: 'इजाज़त नहीं है',
  errNotAllowedBody: 'आपके रोल को ये देखने की इजाज़त नहीं है। ज़रूरत हो तो मालिक से कहो।',
  errSignedOutTitle: 'साइन आउट हो गए',
  errSignedOutBody: 'सेशन ख़त्म हो गया। आगे चलने के लिए दोबारा साइन इन करो।',
  errQuotaTitle: 'आज की लिमिट पूरी हो गई',
  errQuotaBody:
    'आज का मुफ़्त डेटाबेस कोटा ख़त्म हो गया। पैसिफ़िक टाइम की रात 12 बजे फिर चालू हो जाएगा।',
  errSlowTitle: 'बहुत देर लग गई',
  errSlowBody: 'नेटवर्क धीमा है। थोड़ी देर बाद दोबारा करो।',
  errUnknownTitle: 'कुछ गड़बड़ हो गई',
  errUnknownBody: 'पता नहीं क्या गड़बड़ है',

  setupNeeded: 'सेटअप बाक़ी है',
  firebaseConfigIncomplete: 'Firebase की सेटिंग अधूरी है',
  envVarsMissing: 'ये environment variable ख़ाली हैं या हैं ही नहीं:',
  setupCopy: 'कॉपी करो',
  setupTo: 'को',
  setupIn: 'में, यहाँ:',
  setupFillConfig: 'Firebase का web config भर दो। सबसे आसान तरीक़ा ये है:',
  setupRestart: 'dev server दोबारा चालू करो।',
  setupWalkthroughIn: 'पूरी जानकारी',
  setupWalkthroughRest:
    ' में है, सेक्शन 2 और 4। इनमें से कोई भी वैल्यू गुप्त नहीं है — सुरक्षा Firestore Rules से आती है, config छुपाने से नहीं।',
  appCouldNotStart: 'ऐप चालू नहीं हो पाया',
  componentTree: 'कंपोनेंट ट्री',
  thingsWorthChecking: 'ये चीज़ें देख लो:',
  fatalCheckSignIn:
    'Firebase कंसोल में Authentication → Sign-in method के नीचे Google साइन इन चालू है क्या?',
  fatalCheckEnvDoes: 'क्या',
  fatalCheckEnvMatch: 'अभी वाले Firebase प्रोजेक्ट से मेल खाता है?',
  fatalCheckSdk: 'Firebase SDK की सिर्फ़ एक ही कॉपी लगी होनी चाहिए — ये चलाओ',
  reload: 'दोबारा लोड करो',

  countPeopleWithAccess: '{n} लोगों के पास पहुँच है',
  countPeopleWithAccess_one: '{n} आदमी के पास पहुँच है',
  countPermissions: '{n} इजाज़तें',
  countPermissions_one: '{n} इजाज़त',
  roleFor: '{name} का रोल',
  accountIdUid: 'अकाउंट आईडी (UID)',
  accountIdWord: 'अकाउंट आईडी',
  addUserHintBefore: 'पहले उस आदमी से साइन इन करवाओ। उसकी',
  addUserHintAfter: 'इंतज़ार वाली स्क्रीन पर दिखती है — वही नीचे पेस्ट कर दो।',
  driveWarningTitle: 'किसी को बंद करो तो उसे Drive फ़ोल्डर से भी हटा देना।',
  driveWarningBody:
    'Drive की इजाज़त इस ऐप के बाहर की चीज़ है, यहाँ से नहीं हटती। जब तक फ़ोल्डर की शेयरिंग नहीं हटाओगे, बंद किया हुआ आदमी शेयर की हुई फ़ाइलें देखता रहेगा (RISKS.md R-07)।',

  countItems: '{n} काम',
  countItems_one: '{n} काम',
  rateCardTotalsIs: 'रेट कार्ड का कुल',
  butContractValueIs: ' है, पर ठेके का पैसा',
  aDifferenceOf: ' है — फ़र्क़',
  coverageEnd: ' का।',
  someWorkNotItemised: 'हो सकता है ठेके का कुछ काम अभी लिस्ट में डाला ही न गया हो।',
  rateCardOverContract: 'रेट कार्ड तय हुए ठेके से ऊपर चला गया है।',
  quotationPrints:
    '{n} खुले काम कोटेशन में छपेंगे — काम, नाप और रेट। मात्रा और कुल जान-बूझकर नहीं डाले जाते।',
  quotationPrints_one:
    '{n} खुला काम कोटेशन में छपेगा — काम, नाप और रेट। मात्रा और कुल जान-बूझकर नहीं डाले जाते।',
  pasteFromSheetHint:
    'अपनी शीट से काम, नाप, कितना और रेट वाले कॉलम कॉपी करके नीचे पेस्ट कर दो। ऊपर हेडिंग वाली लाइन हो तो भी चलेगा, और कॉमा वाली फ़ाइल भी चलेगी।',
  rowsOfTotal: '{all} में से {ok} लाइन',
  countRowsRejected:
    '{n} लाइनें पढ़ी नहीं गईं, वो छूट जाएँगी। ऊपर ठीक कर दो, फिर यहाँ दिखने लगेंगी।',
  countRowsRejected_one:
    '{n} लाइन पढ़ी नहीं गई, वो छूट जाएगी। ऊपर ठीक कर दो, फिर यहाँ दिखने लगेगी।',
  partiallySaved:
    ' — {total} में से {saved} काम पहले ही सेव हो चुके हैं। दोबारा करने से पहले वो लाइनें हटा दो।',
  addingNofM: '{total} में से {done} जोड़ा जा रहा है…',
  addItems: '{n} काम जोड़ो',
  addItems_one: '{n} काम जोड़ो',
  boqMissingField: '{field} नहीं लिखा है',
  boqUnknownUnit: '"{value}" ऐसा कोई नाप नहीं है',
  boqBadQuantity: '"{value}" कोई मात्रा नहीं है',
  boqBadRate: '"{value}" कोई रेट नहीं है',
  boqAmountTooLarge: 'मात्रा × रेट रकम की हद से ऊपर है — कहीं एक ज़ीरो ज़्यादा तो नहीं लग गया',
  boqDuplicateInPaste: 'लाइन {row} जैसा ही {what}',
  boqAlreadyOnRateCard: 'ये {what} रेट कार्ड में पहले से है',
  wordCode: 'कोड',
  wordName: 'नाम',

  approvalShortfall: '{item}: माँगा {asked}, बचा सिर्फ़ {left}',
  exceedsContractLine: '{location} पर: ठेके में सिर्फ़ {allowed} बचा है, {excess} ज़्यादा है।',
  invalidQuantity: 'की मात्रा ग़लत है।',

  proofFailedFor:
    '{name} का पेमेंट सेव हो गया। सबूत नहीं चढ़ा — पैसा फिर भी दर्ज है। जब हो सके यहाँ लगा दो।',
  confirmLeftExplain:
    '{name} रोज़ की हाज़िरी और लिस्ट से हट जाएगा। जितने दिन काम किया और जितने पैसे दिए, सब वैसा का वैसा रहेगा — कुछ भी मिटता नहीं, और जब चाहो वापस ले सकते हो।',

  editHeader: 'हेडर बदलो',
  downloadPdf: 'PDF डाउनलोड करो',
  sendSheetAsFile: 'शीट को फ़ाइल बनाकर भेजो',
  pdfDownloadedNotice:
    '{file} डाउनलोड हो गई है और WhatsApp नए टैब में खुल रहा है। वो फ़ाइल ख़ुद चैट में लगा दो — ये ब्राउज़र आपके लिए नहीं लगा सकता।',
  pdfExplainMake:
    'दबाने पर ऊपर वाली शीट PDF बन जाती है — हेडर, टेबल और साइन वाला हिस्सा बिल्कुल जैसा दिख रहा है वैसा। लंबी लिस्ट में दो-चार सेकंड लगते हैं। फिर वही बटन',
  pdfExplainShare:
    ' बन जाता है, जो PDF ही भेजता है, उसका ख़ुलासा नहीं। दो बार दबाना पड़ता है क्योंकि ब्राउज़र फ़ाइल दूसरी ऐप को उसी दबाने के वक़्त ही दे सकता है — उस वक़्त फ़ाइल बन रही हो तो नहीं चलता।',
  pdfExplainWhere:
    'फ़ोन पर WhatsApp खुलेगा और PDF पहले से लगी होगी। कंप्यूटर पर कोई भी ब्राउज़र फ़ाइल दूसरी ऐप को नहीं दे सकता, इसलिए PDF डाउनलोड हो जाएगी और WhatsApp एक मैसेज के साथ खुलेगा — डाउनलोड हुई फ़ाइल आप ख़ुद चैट में लगा दो।',
  pdfExplainPrint:
    'दबाने पर ब्राउज़र का अपना प्रिंट वाला पेज खुलता है। जब लिखे हुए को कॉपी या ढूँढना हो तब ये काम आता है: भेजी जाने वाली PDF पेज की फोटो होती है, इसी वजह से हिंदी के नाम सही छपते हैं।',
  reportsOpenHint:
    'रिपोर्ट खोलकर स्क्रीन पर ही पढ़ लो। PDF, WhatsApp और शीट सब वहीं से मिल जाएँगे।',
  backupLabel: 'बैकअप (§41).',
  backupHint:
    'यही डाउनलोड आपका बैकअप हैं। अपने आप कहीं बाहर बैकअप नहीं होता, क्योंकि उसके लिए जो शेड्यूल वाला काम चाहिए वो मुफ़्त प्लान में नहीं चलता। लेना-बाक़ी, बिल और पेमेंट की रिपोर्ट बीच-बीच में डाउनलोड करके सँभालकर रखो।',
  openPrintView: 'प्रिंट वाला पेज खोलो',
  useTheseDetails: 'यही डिटेल लगाओ',
  documentHeaderHint: 'ये इस रिपोर्ट के ऊपर छपेगा। यहाँ बदलोगे तो सिर्फ़ इसी कागज़ पर लगेगा —',
  editSavedDetailsInSettings: 'सेव की हुई डिटेल सेटिंग में बदलो',
  letterheadNotSetUp:
    'फ़र्म की डिटेल अभी भरी ही नहीं है, इसलिए ऊपर छापने को कुछ है नहीं। नीचे कम से कम फ़र्म का नाम भर दो, या एक बार सेटिंग → अपनी फ़र्म की डिटेल में डाल दो।',
  resetToSavedDetails: 'मेरी सेव की हुई डिटेल वापस लाओ',
  showingFirstRows: 'पहली {shown} लाइनें दिख रही हैं, कुल {all} हैं। PDF और शीट में पूरी लिस्ट है।',

  aiToolLayerNote:
    'टूल वाला हिस्सा बनकर जाँचा जा चुका है — बिलिंग चालू होते ही कोई प्रोवाइडर जोड़ना बस एक अडैप्टर का काम है, पूरा दोबारा नहीं बनाना पड़ेगा।',

  utrNumber: 'UTR नंबर',

  tourGreetingName: 'जी',
  tourSupIntroBody:
    'ये ऐप हाज़िरी की कॉपी और नाप की डायरी की जगह ले लेगा। आपका लगभग सारा काम दो ही स्क्रीन पर हो जाएगा।',
  tourSupAttendanceBody: 'प्रोजेक्ट और तारीख़ चुनो, फिर हर नाम के आगे P, ½, A या L दबा दो।',
  tourSupAttendanceDetail:
    'बिना नेट के भी चलता है। हाज़िरी फ़ोन में सेव हो जाती है और नेटवर्क आते ही अपने आप चली जाती है — कुछ भी नहीं खोता।',
  tourSupMeasureBody:
    'रेट कार्ड के हिसाब से किया हुआ काम लिखो — काम, कहाँ, कितना। लिखते ही ऐप रकम दिखा देता है।',
  tourSupMeasureDetail:
    'अगर मात्रा तय हुए ठेके से ऊपर जा रही हो तो ऐप तुरंत बता देगा कि कितना बचा है। आप भेज दो; मंज़ूरी मालिक देंगे।',
  tourSupHiddenTitle: 'आपको क्या नहीं दिखेगा',
  tourSupHiddenBody:
    'बिल, पेमेंट और मज़दूरी आपके रोल से छुपे हैं। ये जान-बूझकर है, कोई ख़राबी नहीं।',
  tourOwnerIntroBody:
    'आपका पूरा ठेकेदारी का काम एक जगह — प्रोजेक्ट, हुआ काम, बिल, आया पैसा, मज़दूर और मज़दूरी।',
  tourFlowTitle: 'काम से पैसा कैसे बनता है',
  tourFlowBody: 'क्लाइंट → प्रोजेक्ट → रेट कार्ड → नाप → मंज़ूरी → बिल → पैसा।',
  tourFlowDetail:
    'हर कदम अगले में जाता है। जब तक नाप और मंज़ूरी न हो जाए, बिल नहीं बनता, और डैशबोर्ड का हर आंकड़ा इन्हीं रिकॉर्ड से बनता है — हाथ से कभी नहीं भरा जाता।',
  tourProjectsBody:
    'कोई प्रोजेक्ट खोलो तो उसका सब कुछ दिखेगा: ठेके का पैसा, कितने का बिल बना, कितना पैसा आया, और कितना लेना बाक़ी है।',
  tourProjectsDetail:
    '“बाक़ी” तीन अलग-अलग आंकड़ों में दिखता है, क्योंकि इसके तीन मतलब हैं — बिल बन गया पर पैसा नहीं आया, बिल बनाना बाक़ी, और सब मिलाकर कितना लेना है।',
  tourRateCardTitle: 'रेट कार्ड और नाप',
  tourRateCardBody:
    'तय किए हुए काम और रेट एक बार डाल दो। साइट वाले हर महीने उन्हीं के हिसाब से काम लिखते रहेंगे।',
  tourRateCardDetail:
    'ठेके की मात्रा से ऊपर नाप कोई नहीं डाल पाएगा, जब तक साफ़-साफ़ चेंज ऑर्डर न हो।',
  tourBillsTitle: 'बिल और पेमेंट',
  tourBillsBody:
    'मंज़ूर हुई नाप से बिल बनाओ, प्रिंट करो या PDF बना लो, फिर जैसे-जैसे पैसा आए वैसे-वैसे दर्ज करते जाओ।',
  tourBillsDetail:
    'बिल कभी मिटता नहीं। ग़लती हो जाए तो उसे रद्द करके नया बना दो, ताकि पूरा हिसाब बना रहे।',
  tourLabourTitle: 'मज़दूर और मज़दूरी',
  tourLabourBody: 'मज़दूरी हाज़िरी से बनती है — कितने दिन आया, कितने आधे दिन, और उस दिन का रेट।',
  tourLabourDetail:
    'कमाई, दे दिए और देने बाक़ी — तीनों अलग-अलग चलते हैं, इसलिए एडवांस एडवांस ही दिखता है।',
  tourReportsBody: 'हर रिपोर्ट PDF या शीट बनकर डाउनलोड हो जाती है।',
  tourReportsDetail:
    'यही आपका बैकअप भी है। मुफ़्त प्लान में अपने आप कहीं बाहर बैकअप नहीं होता, इसलिए इन्हें बीच-बीच में डाउनलोड करते रहो।',
  tourStart: 'चलो शुरू करें',
  tourProgress: '{total} में से {step} · इसे सेटिंग से दोबारा देख सकते हो',
}

export const TRANSLATIONS: Record<Locale, Strings> = { en, hi }
