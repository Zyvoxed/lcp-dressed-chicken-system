import { BriefcaseBusiness, ShieldCheck } from 'lucide-react'

function RoleSelector({ value, onChange, lockAdmin = false }) {
  return (
    <div className="role-cards">
      <button className={value === 'Staff' ? 'selected staff' : 'staff'} type="button" disabled={lockAdmin} title={lockAdmin ? 'You cannot demote your own Admin account' : ''} aria-pressed={value === 'Staff'} onClick={() => onChange('Staff')}><BriefcaseBusiness size={17} /><strong>Staff (Employee)</strong><span>sales POS &amp; products</span></button>
      <button className={value === 'Admin' ? 'selected admin' : 'admin'} type="button" aria-pressed={value === 'Admin'} onClick={() => onChange('Admin')}><ShieldCheck size={17} /><strong>Admin (Owner)</strong><span>full ledger controls</span></button>
    </div>
  )
}

export default RoleSelector
