export const accounts = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'employee', password: 'employee123', role: 'employee' },
]

export function isAdmin(role) {
  return role === 'admin'
}

export function roleLabel(role) {
  return isAdmin(role) ? 'Admin' : 'Employee'
}

export function hasRouteAccess(route, role) {
  return route.roles.includes(role)
}

export function validateCredentials(username, password) {
  return accounts.find(
    (account) => account.username === username.trim() && account.password === password,
  )
}
