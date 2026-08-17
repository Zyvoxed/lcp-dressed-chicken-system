import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import PageHeader from './PageHeader.jsx'

function Modal({ title, children, onClose }) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <motion.section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <PageHeader title={title}>
          <button className="close-button" type="button" onClick={onClose} aria-label="Close modal">
            <X size={18} aria-hidden="true" />
          </button>
        </PageHeader>
        {children}
      </motion.section>
    </motion.div>
  )
}

export default Modal
