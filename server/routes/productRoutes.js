import { Router } from 'express'
import { createProduct, getProducts, updateProduct } from '../controllers/productController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.get('/', authenticate, getProducts)
router.post('/', authenticate, createProduct)
router.patch('/:id', authenticate, updateProduct)

export default router
