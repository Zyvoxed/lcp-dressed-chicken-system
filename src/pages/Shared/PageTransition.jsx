import { motion } from 'framer-motion'

function PageTransition({ children }) {
  return (
    <motion.div
      className="page-transition"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

export default PageTransition
