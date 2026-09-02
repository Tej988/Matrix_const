/**
 * Icon set.
 *
 * Hand-drawn line icons rather than emoji. Emoji render differently on every
 * platform, look generic, and carry no relationship to a construction
 * business - these are drawn for the domain: a trowel for site work, a
 * measuring tape for the rate card, a hard hat for labour.
 *
 * 24x24, 1.5 stroke, currentColor, no dependency.
 */

interface IconProps {
  className?: string
  title?: string
}

function Svg({ className = 'size-5', title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

/** Dashboard - a simple bar chart, the overview. */
export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
)

/** Attendance - a register page with ticks. */
export const IconAttendance = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M8 2v4M16 2v4M3 10h18" />
    <path d="M7.5 14.5l1.5 1.5 3-3" />
    <path d="M14.5 17h3" />
  </Svg>
)

/** Projects - a building under construction. */
export const IconProject = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <path d="M5 21V8l7-5 7 5v13" />
    <path d="M9 21v-5h6v5" />
    <path d="M9 11h1.5M13.5 11H15" />
  </Svg>
)

/** Labour - a hard hat. */
export const IconLabour = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 17h19" />
    <path d="M4 17a8 8 0 0 1 16 0" />
    <path d="M10 9.3V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4.8" />
    <path d="M3 20.5h18" />
  </Svg>
)

/** Wages - banknotes. */
export const IconWages = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M5.5 9.5h.01M18.5 14.5h.01" />
  </Svg>
)

/** Bills - a document with lines and a rupee. */
export const IconBill = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3h10l4 4v14H5z" />
    <path d="M15 3v4h4" />
    <path d="M9 12h5M9 15h5M9 18h3" />
  </Svg>
)

/** Reports - a chart on a page. */
export const IconReport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3h14v18H5z" />
    <path d="M9 16v-3M12 16v-6M15 16v-4" />
  </Svg>
)

/** Clients - a handshake, simplified. */
export const IconClient = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 12.5 6 10.5a2 2 0 0 1 0-2.8l2.4-2.4a2 2 0 0 1 1.4-.6H14" />
    <path d="m16 11.5 2 2a2 2 0 0 1 0 2.8l-2.4 2.4a2 2 0 0 1-1.4.6H10" />
    <path d="m10 12 2 2 2-2-2-2z" />
  </Svg>
)

/** Users - two people. */
export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16.5 5.5a3.2 3.2 0 0 1 0 6" />
    <path d="M18 14.5a6 6 0 0 1 3 5.5" />
  </Svg>
)

/** Settings - a sliders panel. Cleaner than a cog at small sizes. */
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="8" cy="18" r="2" />
  </Svg>
)

/** Rate card - a measuring tape. */
export const IconRateCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="7" width="19" height="10" rx="2" />
    <path d="M6 7v3M9.5 7v4M13 7v3M16.5 7v4M20 7v3" />
  </Svg>
)

/** Measurements - a trowel. */
export const IconMeasurement = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 3.5 20 9l-2.2 2.2-5.5-5.5z" />
    <path d="m12.3 5.7-7.6 7.6a2 2 0 0 0-.5 2l1 3.6 3.6 1a2 2 0 0 0 2-.5l7.6-7.6" />
  </Svg>
)

/** Money received. */
export const IconReceived = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4 19h16" />
  </Svg>
)

/** Money out. */
export const IconPaid = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 19h16" />
  </Svg>
)

/** Needs attention. */
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 2 20h20z" />
    <path d="M12 9v5M12 17h.01" />
  </Svg>
)

/** Offline / no signal. */
export const IconOffline = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 2l20 20" />
    <path d="M5 12.5a10 10 0 0 1 3.5-2.3" />
    <path d="M15.5 10.2a10 10 0 0 1 3.5 2.3" />
    <path d="M8.5 16a5 5 0 0 1 7 0" />
    <path d="M12 20h.01" />
  </Svg>
)

export type Icon = (props: IconProps) => React.ReactElement
