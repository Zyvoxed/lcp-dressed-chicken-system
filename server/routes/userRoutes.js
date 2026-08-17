import { Router } from 'express'
import { createUser, getUserById, getUsers, resetUserPassword, updateUser, updateUserStatus } from '../controllers/userController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()
router.use(authenticate, authorizeRoles('Admin'))
router.get('/', getUsers)
router.get('/:id', getUserById)
router.post('/', createUser)
router.put('/:id', updateUser)
router.patch('/:id/status', updateUserStatus)
router.patch('/:id/password', resetUserPassword)
export default router
