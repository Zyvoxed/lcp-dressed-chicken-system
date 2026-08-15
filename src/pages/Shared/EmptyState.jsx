import { Inbox } from 'lucide-react'

function EmptyState({ children }) {
  return (
    <div className="empty-basket">
      <Inbox size={24} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export default EmptyState
