import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
export default function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => { if (!open) return; const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div className={'modal glass' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }} onMouseDown={(e) => e.stopPropagation()}>
            <h3>{title}</h3>{children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
