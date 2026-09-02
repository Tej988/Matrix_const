import { BoqSection } from '../boq/BoqSection'
import { MeasurementsSection } from '../measurements/MeasurementsSection'
import { BillsSection } from '../bills/BillsSection'
import { FinanceSection } from '../payments/FinanceSection'
import { useProjectTab } from './ProjectDetailPage'

/**
 * The routed wrappers for the sections that used to be stacked on one page.
 *
 * Each is a route element and nothing more: the section components are
 * unchanged, and moving them behind tabs was a layout decision, not a reason
 * to rewrite five working screens. Keeping the wrappers this thin also means
 * the routing table in App.tsx reads as a list of tabs.
 */

export function ProjectBillsTab() {
  const { project } = useProjectTab()
  return <BillsSection project={project} />
}

export function ProjectMoneyTab() {
  const { project } = useProjectTab()
  return <FinanceSection project={project} />
}

export function ProjectRateCardTab() {
  const { project } = useProjectTab()
  // Passed through as-is: undefined when the job has no agreed total, which is
  // what tells the rate card there is nothing to reconcile against (R-01).
  return <BoqSection projectId={project.id} contractValuePaise={project.contractValuePaise} />
}

export function ProjectMeasurementsTab() {
  const { project } = useProjectTab()
  return <MeasurementsSection projectId={project.id} />
}
