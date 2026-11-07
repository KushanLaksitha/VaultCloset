import { useState } from 'react';
import Modal from './Modal.jsx';
import { authService } from '../services/authService.js';
import { unlockedStore } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';

export default function RemoteLockModal({ open, onClose }) {
  const { toast } = useApp();
  const [busyAction, setBusyAction] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [err, setErr] = useState('');

  if (!open) return null;

  const handleAction = async (action) => {
    setBusyAction(action);
    setErr('');
    setSuccessMsg('');
    try {
      await authService.remoteLock(action);

      if (action === 'lock_categories') {
        unlockedStore.clear();
        setSuccessMsg('✅ All protected categories on your laptop have been locked!');
        toast('🔒 Laptop categories locked remotely', 'ok');
      } else if (action === 'lock_vault') {
        unlockedStore.clear();
        setSuccessMsg('🚨 Laptop vault screen has been locked with privacy shield!');
        toast('🚨 Laptop vault locked remotely', 'ok');
      } else if (action === 'logout') {
        setSuccessMsg('⛔ Laptop session was terminated and logged out!');
        toast('⛔ Laptop signed out remotely', 'ok');
      }
    } catch (e) {
      setErr(e.message || 'Failed to dispatch remote security action');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="🛡️ Remote Security Controls">
      <div style={{ display: 'grid', gap: '16px', textAlign: 'left' }}>
        <p className="muted small" style={{ margin: 0, fontSize: '0.86rem' }}>
          Instantly control and lock your active VaultCloset sessions on your laptop or computer right from this phone.
        </p>

        {successMsg && (
          <div
            style={{
              padding: '12px 14px',
              background: 'rgba(74, 222, 128, 0.12)',
              borderRadius: '10px',
              border: '1px solid #4ade80',
              color: '#4ade80',
              fontSize: '0.88rem',
              fontWeight: 500,
            }}
          >
            {successMsg}
          </div>
        )}

        {err && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(248, 113, 113, 0.1)',
              borderRadius: '10px',
              border: '1px solid #f87171',
              color: '#f87171',
              fontSize: '0.85rem',
            }}
          >
            {err}
          </div>
        )}

        {/* Action 1: Lock Categories */}
        <div
          className="glass pad"
          style={{
            padding: '14px',
            borderRadius: '12px',
            border: '1px solid rgba(232, 201, 165, 0.25)',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div className="row between" style={{ alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.96rem', color: 'var(--gold)' }}>
              🔒 Lock All Categories on Laptop
            </span>
            <button
              type="button"
              className="btn primary sm"
              disabled={!!busyAction}
              onClick={() => handleAction('lock_categories')}
              style={{ fontWeight: 600 }}
            >
              {busyAction === 'lock_categories' ? 'Locking…' : 'Lock Folders'}
            </button>
          </div>
          <p className="muted small" style={{ margin: 0, fontSize: '0.78rem' }}>
            Immediately re-locks all protected photo, video, and document categories currently unlocked on your laptop.
          </p>
        </div>

        {/* Action 2: Emergency Screen Lock */}
        <div
          className="glass pad"
          style={{
            padding: '14px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div className="row between" style={{ alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.96rem' }}>
              🚨 Emergency Lock Laptop Screen
            </span>
            <button
              type="button"
              className="btn danger sm"
              disabled={!!busyAction}
              onClick={() => handleAction('lock_vault')}
              style={{ fontWeight: 600 }}
            >
              {busyAction === 'lock_vault' ? 'Locking…' : 'Lock Screen'}
            </button>
          </div>
          <p className="muted small" style={{ margin: 0, fontSize: '0.78rem' }}>
            Instantly covers your laptop screen with the fullscreen privacy shield. Your password is required on the laptop to resume.
          </p>
        </div>

        {/* Action 3: Terminate Laptop Session */}
        <div
          className="glass pad"
          style={{
            padding: '14px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'grid',
            gap: '8px',
          }}
        >
          <div className="row between" style={{ alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.96rem', opacity: 0.9 }}>
              ⛔ Sign Out Laptop Session
            </span>
            <button
              type="button"
              className="btn ghost sm"
              disabled={!!busyAction}
              onClick={() => handleAction('logout')}
              style={{ border: '1px solid rgba(248, 113, 113, 0.4)', color: '#f87171' }}
            >
              {busyAction === 'logout' ? 'Signing out…' : 'Sign Out Laptop'}
            </button>
          </div>
          <p className="muted small" style={{ margin: 0, fontSize: '0.78rem' }}>
            Remotely disconnects and terminates the active session on your computer.
          </p>
        </div>

        <div className="row end" style={{ marginTop: '4px' }}>
          <button type="button" className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
