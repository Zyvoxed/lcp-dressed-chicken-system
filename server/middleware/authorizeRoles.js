export default function authorizeRoles(...allowedRoles) {
  function authorize(request, response, next) {
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
