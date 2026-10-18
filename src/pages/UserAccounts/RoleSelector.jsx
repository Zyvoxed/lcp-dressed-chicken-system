import { BriefcaseBusiness, ShieldCheck } from 'lucide-react'

function RoleSelector({ value, onChange, lockAdmin = false, disabled = false }) {
  return (
    <div className="role-cards" role="group" aria-label="Account role">
      <button className={value === 'Staff' ? 'selected staff' : 'staff'} type="button" disabled={disabled || lockAdmin} title={lockAdmin ? 'You cannot change your own Admin account to Staff' : ''} aria-pressed={value === 'Staff'} onClick={() => onChange('Staff')}><BriefcaseBusiness size={17} aria-hidden="true" /><strong>Staff</strong><span>Sales, stock, and customer credits</span></button>
      <button className={value === 'Admin' ? 'selected admin' : 'admin'} type="button" disabled={disabled} aria-pressed={value === 'Admin'} onClick={() => onChange('Admin')}><ShieldCheck size={17} aria-hidden="true" /><strong>Admin (Owner)</strong><span>Access to all system pages</span></button>
    </div>
  )
}

export default RoleSelector
