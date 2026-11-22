import { hasCapability } from '../../shared/permissions.js'

export default function authorizeRoles(...allowedRoles) {
  function authorize(request, response, next) {
    // Authentication establishes the current role; each route then supplies its own
    // allow-list, keeping staff access explicit instead of implied.
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      return response.status(403).json({
        success: false,
        message: 'Access denied',
      })
    }

    return next()
  }

  authorize.allowedRoles = allowedRoles
  return authorize
}

export function authorizeCapability(capability) {
  function authorize(request, response, next) {
    if (!request.user || !hasCapability(request.user.role, capability)) {
      return response.status(403).json({ success: false, message: 'Access denied' })
    }
    return next()
  }
  authorize.capability = capability
  return authorize
}
