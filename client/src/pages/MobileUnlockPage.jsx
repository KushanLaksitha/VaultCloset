import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { authService } from '../services/authService.js';
import { useApp } from '../context/AppContext.jsx';

export default function MobileUnlockPage() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('id');
  const navigate = useNavigate();
  const { user, setUser, toast } = useApp();

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusResult, setStatusResult] = useState(''); // 'approved' | 'rejected' | ''

  useEffect(() => {
    if (!requestId) {
      setErr('No request ID provided. Please scan the QR code displayed on your laptop.');
      setLoading(false);
      return;
    }

    authService
      .getRequestDetails(requestId)
      .then((data) => {
        setDetails(data);
        if (data.status === 'approved') setStatusResult('approved');
        else if (data.status === 'rejected') setStatusResult('rejected');
        else if (data.status === 'expired') setErr('This login request has already expired.');
      })
      .catch((x) => {
        setErr(x.message || 'Login request not found or expired.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [requestId]);

  const handleApprove = async () => {
    if (!requestId) return;
    setBusy(true);
    setErr('');
    try {
      if (user) {
        // Authenticated approval
        await authService.respondMobileAuth({ requestId, approve: true });
        setStatusResult('approved');
        toast?.('Laptop session approved!');
      } else {
        // Direct unlock with password
        if (!password) {
          setErr('Please enter your account password to authorize.');
          setBusy(false);
          return;
        }
        const res = await authService.directUnlock({ requestId, password, approve: true });
        if (res.user) setUser(res.user);
        setStatusResult('approved');
        toast?.('Laptop session unlocked!');
      }
    } catch (x) {
      setErr(x.message || 'Failed to approve request');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!requestId) return;
    setBusy(true);
    setErr('');
    try {
      if (user) {
        await authService.respondMobileAuth({ requestId, approve: false });
      } else {
        await authService.directUnlock({ requestId, password: password || 'dummy', approve: false }).catch(() => {
          // Even if password check fails on deny, we still want to inform user
        });
      }
      setStatusResult('rejected');
    } catch (x) {
      setErr(x.message || 'Failed to reject request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <header className="auth-header glass" style={{ width: '100%', maxWidth: '440px', marginBottom: '16px', borderRadius: '16px' }}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="logo" style={{ width: 34, height: 34, fontSize: '1.05rem', borderRadius: 10 }}>V</span>
          <b>VaultCloset</b>
        </div>
        <span className="muted small">Mobile Gate</span>
      </header>

      <motion.div
        className="glass auth-card"
        style={{ maxWidth: '440px', width: '100%', padding: '24px 20px', textAlign: 'center' }}
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="logo big" style={{ fontSize: '1.8rem', width: 56, height: 56, margin: '0 auto 12px' }}>
          📱
        </span>

        <h2>Laptop Unlock Request</h2>

        {loading && (
          <div style={{ padding: '30px 0' }}>
            <span className="spinner" />
            <p className="muted small" style={{ marginTop: '10px' }}>Loading request details…</p>
          </div>
        )}

        {!loading && err && !statusResult && (
          <div style={{ margin: '16px 0' }}>
            <p className="error" style={{ padding: '12px', borderRadius: '10px' }}>{err}</p>
            <button type="button" className="btn ghost sm" onClick={() => navigate('/login')} style={{ marginTop: '10px' }}>
              Return to Login
            </button>
          </div>
        )}

        {!loading && statusResult === 'approved' && (
          <div style={{ margin: '18px 0', display: 'grid', gap: '12px' }}>
            <div style={{ fontSize: '3rem' }}>✅</div>
            <h3 style={{ color: 'var(--green, #4ade80)', margin: 0 }}>Laptop Session Approved!</h3>
            <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
              Your laptop has been unlocked and authenticated. You may now return to your computer.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate('/')}
              style={{ marginTop: '10px' }}
            >
              Open Vault on Mobile
            </button>
          </div>
        )}

        {!loading && statusResult === 'rejected' && (
          <div style={{ margin: '18px 0', display: 'grid', gap: '12px' }}>
            <div style={{ fontSize: '3rem' }}>⛔</div>
            <h3 style={{ color: 'var(--red, #f87171)', margin: 0 }}>Login Request Denied</h3>
            <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
              The laptop sign-in attempt has been rejected and blocked.
            </p>
            <button
              type="button"
              className="btn ghost"
              onClick={() => navigate('/')}
              style={{ marginTop: '10px' }}
            >
              Return Home
            </button>
          </div>
        )}

        {!loading && details && !statusResult && !err && (
          <div style={{ display: 'grid', gap: '16px', marginTop: '12px', textAlign: 'left' }}>
            <p className="muted" style={{ margin: 0, fontSize: '0.86rem', textAlign: 'center' }}>
              A laptop device is requesting access to account <b>@{details.username}</b>.
            </p>

            {/* Match Code Box */}
            <div
              style={{
                background: 'rgba(232, 201, 165, 0.08)',
                border: '1px solid var(--gold)',
                borderRadius: '12px',
                padding: '14px',
                textAlign: 'center',
              }}
            >
              <span className="muted small" style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Security Match Code
              </span>
              <strong
                style={{
                  fontFamily: 'monospace',
                  fontSize: '2rem',
                  letterSpacing: '0.18em',
                  color: 'var(--gold)',
                  display: 'block',
                  margin: '6px 0 2px',
                }}
              >
                {details.securityCode}
              </strong>
              <span className="muted small" style={{ fontSize: '0.78rem' }}>
                Ensure this code matches the digits shown on your laptop screen.
              </span>
            </div>

            {/* Device Info */}
            <div className="glass pad" style={{ padding: '10px 14px', borderRadius: '10px', fontSize: '0.84rem' }}>
              <div><b>Device:</b> {details.deviceInfo || 'Laptop Browser'}</div>
              {details.ipAddress && <div><b>IP:</b> {details.ipAddress}</div>}
            </div>

            {!user && (
              <label className="lbl" style={{ margin: 0 }}>
                Account Password (@{details.username})
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password to authorize"
                  required
                  autoComplete="current-password"
                />
              </label>
            )}

            {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={handleReject}
                disabled={busy}
                style={{ border: '1px solid rgba(248, 113, 113, 0.4)', color: '#f87171' }}
              >
                {busy ? '…' : '❌ Deny'}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleApprove}
                disabled={busy}
              >
                {busy ? 'Verifying…' : '✅ Approve Laptop'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
