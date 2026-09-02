import type { Permission } from '../business/permissions'

/**
 * The AI tool registry. Sections 30–32, 52.
 *
 * BUILT BUT NOT WIRED. There is no provider behind this, because every option
 * needs the Blaze plan (ADR-002) and a browser-shipped API key would be
 * readable by anyone (section 47). The registry exists now so that the day a
 * provider is chosen, the assistant is a thin adapter over code that already
 * works and is already tested - not a rewrite.
 *
 * Three properties this design guarantees, all of which section 52 demands:
 *
 *   1. The model never sees the database. It calls named tools with typed
 *      arguments; the tools call the same repositories the UI calls.
 *   2. The model never computes money. Every figure comes from the
 *      deterministic business layer, so the assistant is arithmetically
 *      incapable of disagreeing with the screen (section 51).
 *   3. The model never writes. Write-intent tools return a PROPOSAL that a
 *      human confirms in the UI, and the app performs the write (section 32).
 */

export type ToolKind = 'READ' | 'PROPOSE_WRITE'

export interface ToolDefinition {
  name: string
  kind: ToolKind
  description: string
  /** Caller must hold this, checked before the tool runs - never by the model. */
  permission: Permission
  /** Whether results must be filtered to the user's assigned projects. */
  projectScoped: boolean
  parameters: Record<string, { type: 'string' | 'number' | 'boolean'; required: boolean; description: string }>
}

const p = (
  type: 'string' | 'number' | 'boolean',
  required: boolean,
  description: string,
) => ({ type, required, description })

export const AI_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'getProjects',
    kind: 'READ',
    description: 'List projects with their status and contract value.',
    permission: 'project:read',
    projectScoped: true,
    parameters: {},
  },
  {
    name: 'getProjectFinancialSummary',
    kind: 'READ',
    description:
      'Contract, billed, received, receivable, unbilled balance, contract remaining, labour earned/paid/payable, expenses and cash position for one project.',
    permission: 'financials:view',
    projectScoped: true,
    parameters: { projectId: p('string', true, 'Project identifier') },
  },
  {
    name: 'getClientOutstanding',
    kind: 'READ',
    description:
      'What a client owes. Returns all three figures separately - receivable, unbilled balance and contract remaining - because "outstanding" is ambiguous (R-01) and the assistant must not silently pick one.',
    permission: 'financials:view',
    projectScoped: false,
    parameters: { clientId: p('string', true, 'Client identifier') },
  },
  {
    name: 'getTodayAttendance',
    kind: 'READ',
    description: 'Who is present, absent, half day or on leave today on a project.',
    permission: 'attendance:read',
    projectScoped: true,
    parameters: { projectId: p('string', true, 'Project identifier') },
  },
  {
    name: 'getLabourPayable',
    kind: 'READ',
    description: 'Earned, paid and payable per labourer on a project.',
    permission: 'financials:view',
    projectScoped: true,
    parameters: { projectId: p('string', true, 'Project identifier') },
  },
  {
    name: 'getLabourPaymentHistory',
    kind: 'READ',
    description: 'Every recorded payment to one labourer.',
    permission: 'labourPayment:read',
    projectScoped: false,
    parameters: { labourId: p('string', true, 'Labourer identifier') },
  },
  {
    name: 'getMonthlyMeasurements',
    kind: 'READ',
    description: 'Approved measurements for a project and month, with amounts.',
    permission: 'measurement:read',
    projectScoped: true,
    parameters: {
      projectId: p('string', true, 'Project identifier'),
      period: p('string', true, 'Month as YYYY-MM'),
    },
  },
  {
    name: 'getBills',
    kind: 'READ',
    description: 'Bills for a project with status and amount received.',
    permission: 'bill:read',
    projectScoped: true,
    parameters: { projectId: p('string', true, 'Project identifier') },
  },
  {
    name: 'getProjectExpenses',
    kind: 'READ',
    description: 'Expenses for a project, optionally by category.',
    permission: 'expense:read',
    projectScoped: true,
    parameters: {
      projectId: p('string', true, 'Project identifier'),
      category: p('string', false, 'Expense category filter'),
    },
  },

  /*
   * Write-intent tools. These do NOT write. Each returns a proposal object
   * that the UI renders with Confirm and Cancel buttons, and only the
   * confirmation handler performs the actual transaction. Section 32 makes
   * this mandatory, and it is why the kind is PROPOSE_WRITE rather than WRITE.
   */
  {
    name: 'proposeLabourPayment',
    kind: 'PROPOSE_WRITE',
    description:
      'Prepare a labour payment for human confirmation. Does not record anything. Returns the amount, the labourer and what remains payable so the person confirming sees the consequence.',
    permission: 'labourPayment:write',
    projectScoped: true,
    parameters: {
      labourId: p('string', true, 'Labourer identifier'),
      projectId: p('string', true, 'Project identifier'),
      amountRupees: p('number', true, 'Amount in rupees'),
    },
  },
  {
    name: 'proposeExpense',
    kind: 'PROPOSE_WRITE',
    description: 'Prepare an expense entry for human confirmation. Does not record anything.',
    permission: 'expense:write',
    projectScoped: true,
    parameters: {
      projectId: p('string', true, 'Project identifier'),
      amountRupees: p('number', true, 'Amount in rupees'),
      category: p('string', true, 'Expense category'),
      description: p('string', true, 'What the expense was for'),
    },
  },
] as const

export type ToolName = (typeof AI_TOOLS)[number]['name']

export function toolByName(name: string): ToolDefinition | undefined {
  return AI_TOOLS.find((t) => t.name === name)
}

export const READ_TOOLS = AI_TOOLS.filter((t) => t.kind === 'READ')
export const WRITE_PROPOSAL_TOOLS = AI_TOOLS.filter((t) => t.kind === 'PROPOSE_WRITE')

/**
 * Authorisation happens HERE, in application code, before a tool runs - never
 * by asking the model to respect a role. A model can be talked out of a rule;
 * a permission check cannot.
 */
export function canUseTool(
  toolName: string,
  holds: (permission: Permission) => boolean,
): boolean {
  const tool = toolByName(toolName)
  if (!tool) return false
  return holds(tool.permission)
}

/**
 * The system prompt's non-negotiable clauses. Section 52.
 *
 * These are guidance for the model; they are NOT the enforcement mechanism.
 * Enforcement is `canUseTool`, Firestore Rules, and the fact that no write
 * tool exists. If the prompt and the code ever disagree, the code wins.
 */
export const AI_SAFETY_RULES = [
  'Answer only from tool results. Never estimate, infer or recall a financial figure.',
  'If a tool returns no data, say the information is not available. Do not guess.',
  'Never perform arithmetic on money yourself. Report the figures the tools return.',
  'You cannot write to the database. For any change, call a propose* tool and let the person confirm.',
  '"Outstanding" is ambiguous. State which of receivable, unbilled balance or contract remaining you mean.',
  'Never reveal data about a project the user has no access to, even if asked directly.',
  'Reply in the language the question was asked in - Hindi, English or a mix.',
] as const

export const AI_STATUS = {
  available: false,
  reason:
    'Requires the Blaze plan. Firebase AI Logic and Cloud Functions are both unavailable on Spark, and a browser-shipped provider key would be readable by anyone (ADR-002, spec section 47).',
} as const
