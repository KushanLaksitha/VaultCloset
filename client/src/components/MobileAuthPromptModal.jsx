import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { authService } from '../services/authService.js';
import { categoryService } from '../services/categoryService.js';
import { useApp } from '../context/AppContext.jsx';

// Determine if the current client is a mobile device (phone or tablet)
export const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.innerWidth < 768 ||
    ('ontouchstart' in window && window.innerWidth < 1024)
  );
};

export default function MobileAuthPromptModal() {
  const { user, toast } = useApp();
  const [activeRequest, setActiveRequest] = useState(null); // { kind: 'login'|'category', data: {...} }
  const [matchCode, setMatchCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissedId, setDismissedId] = useState(null);
  const isPollingRef = useRef(false);

  useEffect(() => {
    // CRITICAL: Only mobile phones act as the authorizer!
    // Laptops and desktops must NEVER run this polling or show this modal on themselves.
    if (!user || !isMobileDevice()) {
      setActiveRequest(null);
      return;
    }

    const checkPending = async () => {
      if (isPollingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      isPollingRef.current = true;
      try {
        // 1. Check for pending laptop login requests
        const authRes = await authService.getPendingMobileAuth().catch(() => ({}));
        if (authRes.pendingRequest && authRes.pendingRequest.id !== dismissedId) {
          setActiveRequest({ kind: 'login', data: authRes.pendingRequest });
          return;
        }

        // 2. Check for pending laptop category unlock requests
        const catRes = await categoryService.getPendingCategoryMobileAuth().catch(() => ({}));
        if (catRes.pendingCategoryRequest && catRes.pendingCategoryRequest.id !== dismissedId) {
          setActiveRequest({ kind: 'category', data: catRes.pendingCategoryRequest });
          return;
        }

        // Neither pending
        if (!authRes.pendingRequest && !catRes.pendingCategoryRequest) {
          setActiveRequest(null);
          setMatchCode('');
          setPassword('');
          setConfirmPassword('');
          setErr('');
        }
      } catch {
        // Silently ignore network hiccup during polling
      } finally {
        isPollingRef.current = false;
      }
    };

    checkPending();
    const timer = setInterval(checkPending, 3000);
    return () => clearInterval(timer);
  }, [user, dismissedId]);

  const handleApprove = async (e) => {
    if (e) e.preventDefault();
    if (!activeRequest || busy) return;

    setErr('');
    const cleanCode = matchCode.replace(/\s+/g, '').trim();
    if (!cleanCode || cleanCode.length < 6) {
      setErr('Please enter the 6-digit match code from your laptop screen');
      return;
    }
    if (!password) {
      setErr('Please enter your account or folder password');
      return;
    }
    if (!confirmPassword) {
      setErr('Please re-enter your password (confirm password)');
      return;
    }
    if (password !== confirmPassword) {
      setErr('Passwords do not match. Please re-type both accurately.');
      return;
    }

    setBusy(true);
    try {
      if (activeRequest.kind === 'login') {
        await authService.respondMobileAuth({
          requestId: activeRequest.data.id,
          approve: true,
          matchCode: cleanCode,
          password,
          confirmPassword,
        });
        toast('✅ Laptop session approved & unlocked!', 'ok');
      } else {
        await categoryService.respondCategoryMobileAuth({
          requestId: activeRequest.data.id,
          approve: true,
          matchCode: cleanCode,
          password,
          confirmPassword,
        });
        toast('✅ Folder approved & unlocked on laptop!', 'ok');
      }

      setDismissedId(activeRequest.data.id);
      setActiveRequest(null);
      setMatchCode('');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setErr(error.message || 'Verification failed. Please check the code and password.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeny = async () => {
    if (!activeRequest || busy) return;
    setBusy(true);
    try {
      if (activeRequest.kind === 'login') {
        await authService.respondMobileAuth({ requestId: activeRequest.data.id, approve: false });
        toast('⛔ Laptop login request was denied', 'err');
      } else {
        await categoryService.respondCategoryMobileAuth({ requestId: activeRequest.data.id, approve: false });
        toast('⛔ Folder unlock request was denied', 'err');
      }

      setDismissedId(activeRequest.data.id);
      setActiveRequest(null);
      setMatchCode('');
      setPassword('');
      setConfirmPassword('');
      setErr('');
    } catch (error) {
      toast(error.message || 'Action failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  // Only render on mobile devices when there is an active pending authorization request
  if (!user || !isMobileDevice() || !activeRequest) return null;

  const isLogin = activeRequest.kind === 'login';
  const reqData = activeRequest.data;
  const mismatch = password && confirmPassword && password !== confirmPassword;

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
          background: 'rgba(7, 5, 12, 0.88)',
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
            maxWidth: '430px',
            width: '100%',
            textAlign: 'center',
            border: '2px solid var(--gold)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
            maxHeight: '92vh',
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: '2.4rem', marginBottom: '4px' }}>
            {isLogin ? '💻' : '📁'}
          </div>
          <h2 style={{ margin: '0 0 4px', fontSize: '1.35rem' }}>
            {isLogin ? 'Authorize Laptop Login' : 'Unlock Protected Folder'}
          </h2>
          <p className="muted small" style={{ margin: '0 0 12px' }}>
            {isLogin
              ? 'A laptop is requesting sign-in access. Look at your laptop monitor, enter the 6-digit match code, and type your password twice.'
              : `A laptop is requesting to unlock a protected ${reqData.targetType || 'folder'}. Enter the 6-digit code shown on the laptop and verify with password.`}
          </p>

          {/* Device details */}
          <div
            className="glass pad"
            style={{
              textAlign: 'left',
              padding: '8px 12px',
              borderRadius: '10px',
              fontSize: '0.82rem',
              marginBottom: '12px',
              background: 'rgba(255, 255, 255, 0.03)',
            }}
          >
            <div><b>Device:</b> {reqData.deviceInfo || reqData.device_info || 'Laptop Browser'}</div>
            {(reqData.ipAddress || reqData.ip_address) && (
              <div><b>IP:</b> {reqData.ipAddress || reqData.ip_address}</div>
            )}
            {!isLogin && reqData.targetType && (
              <div><b>Target:</b> {reqData.targetType.toUpperCase()} Folder</div>
            )}
          </div>

          {/* Verification Form */}
          <form onSubmit={handleApprove} style={{ display: 'grid', gap: '10px', textAlign: 'left' }}>
            <label className="lbl" style={{ margin: 0 }}>
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
                1. Enter Security Match Code (From Laptop Screen)
              </span>
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. 748 192"
                value={matchCode}
                onChange={(e) => {
                  setMatchCode(e.target.value);
                  setErr('');
                }}
                maxLength={8}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '1.3rem',
                  letterSpacing: '0.14em',
                  textAlign: 'center',
                  fontWeight: 700,
                  color: 'var(--gold)',
                  background: 'rgba(232, 201, 165, 0.08)',
                  borderColor: 'var(--gold)',
                }}
                autoComplete="off"
              />
              <span className="muted small" style={{ fontSize: '0.74rem', marginTop: '2px' }}>
                Look at the 6 digits displayed on your laptop screen.
              </span>
            </label>

            <label className="lbl" style={{ margin: 0 }}>
              <span>2. Enter Password</span>
              <input
                type="password"
                required
                placeholder="Type password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErr('');
                }}
                autoComplete="current-password"
              />
            </label>

            <label className="lbl" style={{ margin: 0 }}>
              <span>3. Re-enter Password (Confirm Again)</span>
              <input
                type="password"
                required
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setErr('');
                }}
                autoComplete="current-password"
                style={{
                  borderColor: mismatch ? '#f87171' : undefined,
                }}
              />
              {mismatch && (
                <span className="error small" style={{ fontSize: '0.76rem', marginTop: '2px' }}>
                  ⚠️ Passwords must match
                </span>
              )}
            </label>

            {err && <p className="error small" style={{ margin: '2px 0 0' }}>{err}</p>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={handleDeny}
                disabled={busy}
                style={{ border: '1px solid rgba(248, 113, 113, 0.4)', color: '#f87171' }}
              >
                {busy ? '…' : '❌ Deny Access'}
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={busy || mismatch || !matchCode || !password || !confirmPassword}
                style={{ fontWeight: 600 }}
              >
                {busy ? 'Verifying…' : isLogin ? '🔒 Verify & Unlock' : '🔓 Unlock Folder'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
