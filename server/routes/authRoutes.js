import { Router } from 'express'
import { getCurrentUser, login } from '../controllers/authController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.post('/login', login)
router.get('/me', authenticate, getCurrentUser)

export default router
