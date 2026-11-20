import { Router } from 'express'
import { getCurrentUser, login, logout, resendLoginMfa, verifyLoginMfa } from '../controllers/authController.js'
import { verifyEmail } from '../controllers/emailVerificationController.js'
import { requestPasswordReset, resetPassword } from '../controllers/passwordResetController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.post('/login', login)
router.post('/login/verify', verifyLoginMfa)
router.post('/login/resend', resendLoginMfa)
router.post('/logout', authenticate, logout)
router.post('/verify-email', verifyEmail)
router.post('/forgot-password', requestPasswordReset)
router.post('/reset-password', resetPassword)
router.get('/me', authenticate, getCurrentUser)

export default router
