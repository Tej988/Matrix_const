import { describe, it, expect } from 'vitest'
import type { Role } from '@mc/types'
import { can } from '../business/permissions'
import {
  AI_TOOLS,
  READ_TOOLS,
  WRITE_PROPOSAL_TOOLS,
  toolByName,
  canUseTool,
  AI_SAFETY_RULES,
  AI_STATUS,
} from './tools'

/**
 * These tests guard the properties section 52 demands, so that whenever a
 * provider is eventually wired in, the safety model is already proven rather
 * than assumed.
 */

describe('no tool can write', () => {
  it('has only READ and PROPOSE_WRITE kinds', () => {
    for (const tool of AI_TOOLS) {
      expect(['READ', 'PROPOSE_WRITE']).toContain(tool.kind)
    }
  })

  it('names every mutating tool as a proposal', () => {
    // The naming is the contract: a `propose*` tool returns something a human
    // confirms. There is deliberately no tool that commits.
    for (const tool of WRITE_PROPOSAL_TOOLS) {
      expect(tool.name.startsWith('propose')).toBe(true)
    }
  })

  it('exposes no delete or cancel tool at all', () => {
    const forbidden = AI_TOOLS.filter((t) =>
      /delete|remove|cancel|reverse|destroy/i.test(t.name),
    )
    expect(forbidden).toEqual([])
  })
})

describe('authorisation is enforced in code, not by the model', () => {
  const holder = (role: Role) => (permission: Parameters<typeof can>[1]) => can(role, permission)

  it('lets an owner use every tool', () => {
    for (const tool of AI_TOOLS) {
      expect(canUseTool(tool.name, holder('OWNER'))).toBe(true)
    }
  })

  it('denies a supervisor every financial tool', () => {
    const financial = AI_TOOLS.filter((t) => t.permission === 'financials:view')
    expect(financial.length).toBeGreaterThan(0)
    for (const tool of financial) {
      expect(canUseTool(tool.name, holder('SUPERVISOR'))).toBe(false)
    }
  })

  it('lets a supervisor read attendance, which is their job', () => {
    expect(canUseTool('getTodayAttendance', holder('SUPERVISOR'))).toBe(true)
  })

  it('denies a viewer every write proposal', () => {
    for (const tool of WRITE_PROPOSAL_TOOLS) {
      expect(canUseTool(tool.name, holder('VIEWER'))).toBe(false)
    }
  })

  it('rejects an unknown tool name outright', () => {
    expect(canUseTool('dropDatabase', holder('OWNER'))).toBe(false)
    expect(canUseTool('', holder('OWNER'))).toBe(false)
  })
})

describe('registry integrity', () => {
  it('gives every tool a permission, a description and a kind', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.permission).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.kind).toBeTruthy()
    }
  })

  it('has no duplicate tool names', () => {
    const names = AI_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('resolves tools by name', () => {
    expect(toolByName('getProjects')?.kind).toBe('READ')
    expect(toolByName('nope')).toBeUndefined()
  })

  it('scopes project-level tools so a supervisor cannot read another site', () => {
    expect(toolByName('getTodayAttendance')?.projectScoped).toBe(true)
    expect(toolByName('getProjectFinancialSummary')?.projectScoped).toBe(true)
  })

  it('splits cleanly into reads and proposals', () => {
    expect(READ_TOOLS.length + WRITE_PROPOSAL_TOOLS.length).toBe(AI_TOOLS.length)
  })
})

describe('the R-01 ambiguity is handled at the tool boundary', () => {
  it('makes the outstanding tool return all three figures', () => {
    // Otherwise the assistant would quietly pick one meaning of "kitna baaki
    // hai" and sound authoritative about it.
    const tool = toolByName('getClientOutstanding')
    expect(tool?.description).toMatch(/receivable/i)
    expect(tool?.description).toMatch(/unbilled/i)
    expect(tool?.description).toMatch(/contract remaining/i)
  })

  it('instructs the model to disambiguate', () => {
    expect(AI_SAFETY_RULES.some((r) => /ambiguous/i.test(r))).toBe(true)
  })
})

describe('safety rules cover what section 52 forbids', () => {
  it.each([
    [/never estimate|do not guess/i, 'no invented figures'],
    [/cannot write|propose/i, 'no unconfirmed writes'],
    [/arithmetic/i, 'no self-computed money'],
    [/no access/i, 'no cross-project leakage'],
  ])('states %s', (pattern) => {
    expect(AI_SAFETY_RULES.some((r) => pattern.test(r))).toBe(true)
  })
})

describe('status is honest about being unavailable', () => {
  it('reports unavailable with the reason', () => {
    expect(AI_STATUS.available).toBe(false)
    expect(AI_STATUS.reason).toMatch(/Blaze/)
  })
})
