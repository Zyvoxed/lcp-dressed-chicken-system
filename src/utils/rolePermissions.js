import { hasCapability, normalizeRole } from '../../shared/permissions.js'

export { hasCapability, normalizeRole }

export function isAdmin(role) {
  return normalizeRole(role) === 'admin'
}

export function roleLabel(role) {
  return isAdmin(role) ? 'Admin' : 'Employee'
}

export function hasRouteAccess(route, role) {
  if (route.staffOnly && normalizeRole(role) !== 'employee') return false
  if (route.adminOnly) return isAdmin(role)
  return hasCapability(role, route.capability)
}
