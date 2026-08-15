import jwt from 'jsonwebtoken'

export default function authenticate(request, response, next) {
  const authorization = request.get('Authorization')

  if (!authorization?.startsWith('Bearer ')) {
    return response.status(401).json({
      success: false,
      message: 'Authentication required',
    })
  }

  const token = authorization.slice(7).trim()

  if (!token) {
    return response.status(401).json({
      success: false,
      message: 'Authentication required',
    })
  }

  try {
    request.user = jwt.verify(token, process.env.JWT_SECRET)
    return next()
  } catch {
    return response.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    })
  }
}
