// Design-doc workflow helpers: status display metadata.
import type { DocStatus } from './api'

// Ordered lifecycle + the color used for the status pill. The review UI is
// shown only while a doc is IN_REVIEW (see Editor).
export const DOC_STATUSES: { value: DocStatus; label: string; color: string }[] = [
  { value: 'DRAFT', label: 'Draft', color: '#6b7280' },
  { value: 'IN_REVIEW', label: 'In Review', color: '#2563eb' },
  { value: 'ACCEPTED', label: 'Accepted', color: '#16a34a' },
  { value: 'REJECTED', label: 'Rejected', color: '#dc2626' },
  { value: 'SUPERSEDED', label: 'Superseded', color: '#92754e' },
]

export function statusMeta(s: DocStatus) {
  return DOC_STATUSES.find((x) => x.value === s) ?? DOC_STATUSES[0]
}
