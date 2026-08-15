import RoleSelector from './RoleSelector.jsx'

function UserForm() {
  return (
    <aside className="panel profile-panel">
      <h2>REGISTER SECURE PROFILE</h2>
      <label>
        Full Name
        <input placeholder="Operator full name" />
      </label>
      <label>
        Username
        <input placeholder="Username" />
      </label>
      <label>
        Phone Number
        <input placeholder="Phone number" />
      </label>
      <p>Role Selection</p>
      <RoleSelector />
      <button className="primary-action" type="button">
        REGISTER OPERATOR
      </button>
    </aside>
  )
}

export default UserForm
