export function sessionMatchesUser(payload, user) {
  if (!payload || !user || !user.is_active || user.role !== payload.role) return false
  return Number(user.auth_version || 0) === Number(payload.auth_version ?? 0)
}
