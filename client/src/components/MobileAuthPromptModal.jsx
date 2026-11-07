import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { authService } from '../services/authService.js';
import { useApp } from '../context/AppContext.jsx';

export default function MobileAuthPromptModal() {
  const { user, toast } = useApp();
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dismissedId, setDismissedId] = useState(null);
  const isPollingRef = useRef(false);

  useEffect(() => {
    if (!user) {
      setPending(null);
      return;
    }

    const checkPending = async () => {
      if (isPollingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      isPollingRef.current = true;
      try {
        const res = await authService.getPendingMobileAuth();
        if (res.pendingRequest && res.pendingRequest.id !== dismissedId) {
          setPending(res.pendingRequest);
        } else if (!res.pendingRequest) {
          setPending(null);
        }
      } catch {
        // Silently ignore network hiccup during polling
      } finally {
        isPollingRef.current = false;
      }
    };

    checkPending();
    const timer = setInterval(checkPending, 3500);
    return () => clearInterval(timer);
  }, [user, dismissedId]);

  const handleRespond = async (approve) => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await authService.respondMobileAuth({ requestId: pending.id, approve });
      setDismissedId(pending.id);
      setPending(null);
      if (approve) {
        toast('✅ Laptop session approved & unlocked!', 'ok');
      } else {
        toast('⛔ Laptop login request was denied', 'err');
      }
    } catch (e) {
      toast(e.message || 'Action failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  if (!pending) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          zIndex: 120,
          backdropFilter: 'blur(16px)',
          background: 'rgba(7, 5, 12, 0.85)',
          display: 'grid',
          placeItems: 'center',
          padding: '16px',
        }}
      >
        <motion.div
          className="modal glass"
          initial={{ scale: 0.94, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.94, y: 20 }}
          style={{
            maxWidth: '420px',
            width: '100%',
            textAlign: 'center',
            border: '2px solid var(--gold)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>💻</div>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.4rem' }}>Laptop Login Request</h2>
          <p className="muted small" style={{ margin: '0 0 16px' }}>
            A laptop is attempting to sign into your VaultCloset account. Please verify and approve.
          </p>

          {/* Security Match Code */}
          <div
            style={{
              background: 'rgba(232, 201, 165, 0.1)',
              border: '1px solid var(--gold)',
              borderRadius: '12px',
              padding: '12px',
              marginBottom: '14px',
            }}
          >
            <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.72rem' }}>
              Security Match Code
            </span>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '2rem',
                letterSpacing: '0.18em',
                color: 'var(--gold)',
                fontWeight: 700,
                margin: '4px 0',
              }}
            >
              {pending.security_code}
            </div>
            <span className="muted small" style={{ fontSize: '0.76rem' }}>
              Confirm this matches the digits on your laptop screen.
            </span>
          </div>

          {/* Device details */}
          <div
            className="glass pad"
            style={{
              textAlign: 'left',
              padding: '10px 14px',
              borderRadius: '10px',
              fontSize: '0.84rem',
              marginBottom: '16px',
              background: 'rgba(255, 255, 255, 0.03)',
            }}
          >
            <div><b>Device:</b> {pending.device_info || 'Laptop Browser'}</div>
            {pending.ip_address && <div><b>IP:</b> {pending.ip_address}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => handleRespond(false)}
              disabled={busy}
              style={{ border: '1px solid rgba(248, 113, 113, 0.4)', color: '#f87171' }}
            >
              {busy ? '…' : '❌ Deny'}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => handleRespond(true)}
              disabled={busy}
              style={{ fontWeight: 600 }}
            >
              {busy ? 'Verifying…' : '✅ Unlock Laptop'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
