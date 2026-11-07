import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode';
import { authService } from '../services/authService.js';
import { useApp } from '../context/AppContext.jsx';
import MobileConnectModal from '../components/MobileConnectModal.jsx';

export default function Auth({ mode }) {
  const reg = mode === 'register';
  const { setUser } = useApp();
  const [f, setF] = useState({ displayName: '', username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobileModal, setMobileModal] = useState(false);

  // Mobile Auth Waiting Gate State
  const [pendingAuth, setPendingAuth] = useState(null);
  const [countdown, setCountdown] = useState(180);
  const [pollStatus, setPollStatus] = useState('pending'); // 'pending' | 'approved' | 'rejected' | 'expired'
  const [qrCodeData, setQrCodeData] = useState('');
  const [mobileUrl, setMobileUrl] = useState('');
  const pollTimerRef = useRef(null);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Handle Login / Registration submission
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const isMobileClient = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
      const res = await (reg ? authService.register(f) : authService.login({ ...f, isMobile: isMobileClient }));

      if (res.requireMobileAuth) {
        // Laptop login paused: user must approve on mobile
        setPendingAuth(res);
        setCountdown(res.expiresIn || 180);
        setPollStatus('pending');
      } else if (res.user) {
        setUser(res.user);
      }
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  // Generate QR Code & Mobile URL when pendingAuth activates
  useEffect(() => {
    if (!pendingAuth) {
      setQrCodeData('');
      setMobileUrl('');
      return;
    }

    fetch('/api/network-info')
      .then((r) => r.json())
      .then(async (net) => {
        const base = net.url || `http://${net.primaryIp || 'localhost'}:5173`;
        const unlockUrl = `${base}/unlock-request?id=${pendingAuth.loginRequestId}`;
        setMobileUrl(unlockUrl);
        const qr = await QRCode.toDataURL(unlockUrl, {
          width: 200,
          margin: 1,
          color: { dark: '#14111b', light: '#ffffff' },
        });
        setQrCodeData(qr);
      })
      .catch((err) => {
        console.error('Failed to generate unlock QR code:', err);
      });
  }, [pendingAuth]);

  // Polling & Countdown Timer for Pending Mobile Approval
  useEffect(() => {
    if (!pendingAuth || pollStatus !== 'pending') return;

    // 1-second countdown interval
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          setPollStatus('expired');
          setErr('Login request expired. Please sign in again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // 2-second polling interval
    const poll = async () => {
      try {
        const res = await authService.checkLoginStatus(pendingAuth.loginRequestId);
        if (res.status === 'approved') {
          setPollStatus('approved');
          clearInterval(pollTimerRef.current);
          clearInterval(countdownInterval);
          setTimeout(() => {
            if (res.user) setUser(res.user);
          }, 1000);
        } else if (res.status === 'rejected') {
          setPollStatus('rejected');
          setErr('Login request was rejected on your mobile phone.');
          clearInterval(pollTimerRef.current);
          clearInterval(countdownInterval);
        } else if (res.status === 'expired') {
          setPollStatus('expired');
          setErr('Login request expired. Please try again.');
          clearInterval(pollTimerRef.current);
          clearInterval(countdownInterval);
        }
      } catch {
        // Continue polling despite occasional network hiccup
      }
    };

    pollTimerRef.current = setInterval(poll, 2000);

    return () => {
      clearInterval(countdownInterval);
      clearInterval(pollTimerRef.current);
    };
  }, [pendingAuth, pollStatus, setUser]);

  const cancelPendingAuth = async () => {
    if (pendingAuth?.loginRequestId) {
      await authService.cancelLoginRequest(pendingAuth.loginRequestId).catch(() => {});
    }
    setPendingAuth(null);
    setPollStatus('pending');
    setErr('');
  };

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="auth">
      {/* Top Mobile Connect Header Bar */}
      <header className="auth-header glass">
        <div className="brand" style={{ padding: 0 }}>
          <span className="logo" style={{ width: 34, height: 34, fontSize: '1.05rem', borderRadius: 10 }}>
            V
          </span>
          <b>VaultCloset</b>
        </div>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setMobileModal(true)}
          title="Scan QR to connect mobile phone"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          📱 Mobile Connect
        </button>
      </header>

      <div className="auth-container">
        {/* Mobile Connect Quick Access Bar */}
        {!pendingAuth && (
          <div
            className="glass mobile-connect-bar"
            onClick={() => setMobileModal(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setMobileModal(true);
            }}
            title="Connect your mobile phone to VaultCloset"
          >
            <div className="mobile-connect-bar-info">
              <span className="mobile-connect-bar-icon">📱</span>
              <div className="mobile-connect-bar-text">
                <b>Connect Mobile Phone</b>
                <span>Scan QR to access vault on your phone</span>
              </div>
            </div>
            <button
              type="button"
              className="btn ghost sm"
              onClick={(e) => {
                e.stopPropagation();
                setMobileModal(true);
              }}
            >
              QR Code
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {pendingAuth ? (
            /* ========================================================== */
            /* 📱 PENDING MOBILE APPROVAL GATE VIEW                      */
            /* ========================================================== */
            <motion.div
              key="mobile-gate"
              className="glass auth-card"
              style={{ textAlign: 'center', maxWidth: '440px' }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
            >
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: '8px' }}>
                <span className="logo big" style={{ fontSize: '1.8rem', width: 56, height: 56 }}>
                  📱
                </span>
                {pollStatus === 'pending' && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: 'var(--gold)',
                      border: '2px solid #000',
                      animation: 'pulse 1.5s infinite',
                    }}
                  />
                )}
              </div>

              <h2 style={{ margin: '0 0 6px', fontSize: '1.45rem' }}>Mobile Unlock Required</h2>
              <p className="muted small" style={{ margin: '0 0 16px' }}>
                Sign-in for <b>@{pendingAuth.username}</b> is paused until you approve it from your mobile device.
              </p>

              {/* Status Banner */}
              {pollStatus === 'pending' && (
                <div
                  style={{
                    background: 'rgba(232, 201, 165, 0.08)',
                    border: '1px solid var(--gold)',
                    borderRadius: '14px',
                    padding: '16px',
                    marginBottom: '16px',
                  }}
                >
                  <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.74rem' }}>
                    Security Match Code
                  </span>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '2.4rem',
                      letterSpacing: '0.18em',
                      color: 'var(--gold)',
                      fontWeight: 700,
                      margin: '6px 0',
                    }}
                  >
                    {pendingAuth.securityCode}
                  </div>
                  <div className="row" style={{ justifyContent: 'center', alignItems: 'center', gap: '8px', fontSize: '0.84rem' }}>
                    <span className="spinner sm" />
                    <span>Waiting for mobile approval…</span>
                    <strong style={{ color: 'var(--gold)' }}>{formatCountdown(countdown)}</strong>
                  </div>
                </div>
              )}

              {pollStatus === 'approved' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{
                    padding: '20px',
                    background: 'rgba(74, 222, 128, 0.1)',
                    border: '1px solid #4ade80',
                    borderRadius: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>✅</div>
                  <h3 style={{ color: '#4ade80', margin: 0 }}>Approved from Mobile!</h3>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>Unlocking your private vault…</p>
                </motion.div>
              )}

              {pollStatus === 'rejected' && (
                <div
                  style={{
                    padding: '16px',
                    background: 'rgba(248, 113, 113, 0.1)',
                    border: '1px solid #f87171',
                    borderRadius: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ fontSize: '2rem' }}>⛔</div>
                  <h4 style={{ color: '#f87171', margin: '4px 0' }}>Sign-in Rejected</h4>
                  <p className="muted small" style={{ margin: 0 }}>The login request was denied on your mobile device.</p>
                </div>
              )}

              {pollStatus === 'expired' && (
                <div
                  style={{
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ fontSize: '2rem' }}>⏱️</div>
                  <h4 style={{ margin: '4px 0' }}>Request Expired</h4>
                  <p className="muted small" style={{ margin: 0 }}>The 3-minute authorization window timed out.</p>
                </div>
              )}

              {/* QR Code Quick Scan for Mobile */}
              {pollStatus === 'pending' && qrCodeData && (
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    padding: '14px',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    marginBottom: '16px',
                  }}
                >
                  <p className="muted small" style={{ margin: '0 0 10px', fontSize: '0.8rem' }}>
                    📱 Don't have VaultCloset open on your phone yet?
                    <br />
                    Scan this QR code with your phone's camera:
                  </p>
                  <div
                    style={{
                      display: 'inline-block',
                      background: '#fff',
                      padding: '8px',
                      borderRadius: '10px',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                    }}
                  >
                    <img
                      src={qrCodeData}
                      alt="Scan to authorize on mobile"
                      style={{ width: '150px', height: '150px', display: 'block', borderRadius: '4px' }}
                    />
                  </div>
                </div>
              )}

              {err && pollStatus !== 'pending' && <p className="error small">{err}</p>}

              <div className="row" style={{ justifyContent: 'center', marginTop: '10px' }}>
                <button type="button" className="btn ghost" onClick={cancelPendingAuth}>
                  {pollStatus === 'pending' ? 'Cancel Request' : 'Back to Login'}
                </button>
              </div>
            </motion.div>
          ) : (
            /* ========================================================== */
            /* STANDARD LOGIN / REGISTER FORM                             */
            /* ========================================================== */
            <motion.form
              key="auth-form"
              className="glass auth-card"
              onSubmit={submit}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <span className="logo big">V</span>
              <h1>{reg ? 'Create your private vault' : 'Welcome back'}</h1>
              <p className="muted">
                {reg
                  ? 'Your images are encrypted before they are saved on this machine.'
                  : 'Sign in to open your collection.'}
              </p>
              {reg && (
                <label className="lbl">
                  Display name
                  <input
                    value={f.displayName}
                    onChange={set('displayName')}
                    placeholder="e.g. Dragon"
                    required
                    autoComplete="name"
                  />
                </label>
              )}
              <label className="lbl">
                Username
                <input
                  type="text"
                  value={f.username}
                  onChange={set('username')}
                  placeholder={reg ? 'e.g. dragoncode72' : 'Enter your username'}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  autoComplete="username"
                />
                {reg && (
                  <span className="muted small">Unique username (3–30 characters, letters, numbers & underscores)</span>
                )}
              </label>
              <label className="lbl">
                Password
                <input
                  type="password"
                  value={f.password}
                  onChange={set('password')}
                  required
                  minLength={reg ? 10 : 1}
                  autoComplete={reg ? 'new-password' : 'current-password'}
                />
                {reg && <span className="muted small">At least 10 characters (uppercase, numbers/symbols)</span>}
              </label>
              {err && (
                <p className="error" role="alert">
                  {err}
                </p>
              )}
              <button className="btn primary" disabled={busy}>
                {busy ? 'Please wait…' : reg ? 'Create account' : 'Sign in'}
              </button>
              <p className="muted small">
                {reg ? 'Already registered?' : 'New here?'}{' '}
                <Link to={reg ? '/login' : '/register'}>{reg ? 'Sign in' : 'Create an account'}</Link>
              </p>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      <MobileConnectModal open={mobileModal} onClose={() => setMobileModal(false)} />
    </div>
  );
}
