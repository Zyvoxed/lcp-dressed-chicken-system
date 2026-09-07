import { Router } from 'express'
import { getProducts } from '../controllers/productController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.get('/', authenticate, getProducts)

export default router
