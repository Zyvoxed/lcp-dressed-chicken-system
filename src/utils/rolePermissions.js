export function isAdmin(role) {
  return role === 'admin'
}

export function roleLabel(role) {
  return isAdmin(role) ? 'Admin' : 'Employee'
}

export function hasRouteAccess(route, role) {
  return route.roles.includes(role)
}
