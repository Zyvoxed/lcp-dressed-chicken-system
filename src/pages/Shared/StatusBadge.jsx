import { statusClass } from '../../utils/helpers.js'

function StatusBadge({ value, as: Component = 'span' }) {
  return <Component className={`status ${statusClass(value)}`}>{value}</Component>
}

export default StatusBadge
