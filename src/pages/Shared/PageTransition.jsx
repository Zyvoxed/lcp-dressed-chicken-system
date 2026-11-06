import { motion, useReducedMotion } from 'framer-motion'

function PageTransition({ children }) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className="page-transition"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

export default PageTransition
