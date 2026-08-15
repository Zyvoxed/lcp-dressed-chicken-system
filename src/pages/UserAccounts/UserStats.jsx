import StatCard from '../Shared/StatCard.jsx'

function UserStats() {
  return (
    <div className="stats-grid compact full-span">
      <StatCard label="Total Registered" value="3" />
      <StatCard label="Administrators" value="1" />
      <StatCard label="Dressed Chicken Staff" value="2" />
    </div>
  )
}

export default UserStats
