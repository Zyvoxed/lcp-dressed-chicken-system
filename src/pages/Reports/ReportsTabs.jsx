import TabBar from '../Shared/TabBar.jsx'
import { reportTabs } from '../../utils/constants.js'

function ReportsTabs({ activeTab, onSelect }) {
  return <TabBar tabs={reportTabs} active={activeTab} onSelect={onSelect} />
}

export default ReportsTabs
