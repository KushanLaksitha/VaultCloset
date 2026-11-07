import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { categoryService } from '../services/categoryService.js';
import { useApp } from '../context/AppContext.jsx';

export default function MobileCategoryUnlockPage() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('id');
  const navigate = useNavigate();
  const { toast } = useApp();

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [matchCode, setMatchCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusResult, setStatusResult] = useState(''); // 'approved' | 'rejected' | ''

  useEffect(() => {
    if (!requestId) {
      setErr('No request ID provided. Please scan the QR code displayed on your laptop.');
      setLoading(false);
      return;
    }

    categoryService
      .getCategoryRequestDetails(requestId)
      .then((data) => {
        setDetails(data);
        if (data.status === 'approved') setStatusResult('approved');
        else if (data.status === 'rejected') setStatusResult('rejected');
        else if (data.status === 'expired') setErr('This folder unlock request has already expired.');
      })
      .catch((x) => {
        setErr(x.message || 'Unlock request not found or expired.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [requestId]);

  const handleApprove = async (e) => {
    if (e) e.preventDefault();
    if (!requestId || busy) return;
    setErr('');

    const cleanCode = matchCode.replace(/\s+/g, '').trim();
    if (!cleanCode || cleanCode.length < 6) {
      setErr('Please enter the 6-digit match code from your laptop screen');
      return;
    }
    if (!password) {
      setErr('Please enter password');
      return;
    }
    if (!confirmPassword) {
      setErr('Please re-enter password to confirm');
      return;
    }
    if (password !== confirmPassword) {
      setErr('Passwords do not match. Please re-type both accurately.');
      return;
    }

    setBusy(true);
    try {
      await categoryService.directCategoryUnlock({
        requestId,
        matchCode: cleanCode,
        password,
        confirmPassword,
        approve: true,
      });
      setStatusResult('approved');
      toast?.('Folder unlocked on laptop!');
    } catch (x) {
      setErr(x.message || 'Incorrect match code or password. Folder authorization rejected.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!requestId || busy) return;
    setBusy(true);
    setErr('');
    try {
      await categoryService.directCategoryUnlock({
        requestId,
        matchCode: '000000',
        password: 'dummy',
        confirmPassword: 'dummy',
        approve: false,
      }).catch(() => {});
      setStatusResult('rejected');
    } catch (x) {
      setErr(x.message || 'Failed to reject request');
    } finally {
      setBusy(false);
    }
  };

  const mismatch = password && confirmPassword && password !== confirmPassword;

  return (
    <div className="auth" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <header className="auth-header glass" style={{ width: '100%', maxWidth: '440px', marginBottom: '16px', borderRadius: '16px' }}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="logo" style={{ width: 34, height: 34, fontSize: '1.05rem', borderRadius: 10 }}>V</span>
          <b>VaultCloset</b>
        </div>
        <span className="muted small">Folder Gate</span>
      </header>

      <motion.div
        className="glass auth-card"
        style={{ maxWidth: '440px', width: '100%', padding: '24px 20px', textAlign: 'center' }}
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="logo big" style={{ fontSize: '1.8rem', width: 56, height: 56, margin: '0 auto 12px' }}>
          📁
        </span>

        <h2>Folder Unlock Request</h2>

        {loading && (
          <div style={{ padding: '30px 0' }}>
            <span className="spinner" />
            <p className="muted small" style={{ marginTop: '10px' }}>Loading request details…</p>
          </div>
        )}

        {!loading && err && !statusResult && (
          <div style={{ margin: '16px 0' }}>
            <p className="error" style={{ padding: '12px', borderRadius: '10px' }}>{err}</p>
            <button type="button" className="btn ghost sm" onClick={() => navigate('/')} style={{ marginTop: '10px' }}>
              Return Home
            </button>
          </div>
        )}

        {!loading && statusResult === 'approved' && (
          <div style={{ margin: '18px 0', display: 'grid', gap: '12px' }}>
            <div style={{ fontSize: '3rem' }}>✅</div>
            <h3 style={{ color: 'var(--green, #4ade80)', margin: 0 }}>Folder Unlocked!</h3>
            <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
              The protected folder has been unlocked on your laptop. You may now return to your computer.
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
            <h3 style={{ color: 'var(--red, #f87171)', margin: 0 }}>Unlock Denied</h3>
            <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
              The folder unlock request was denied.
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
          <form onSubmit={handleApprove} style={{ display: 'grid', gap: '14px', marginTop: '12px', textAlign: 'left' }}>
            <p className="muted" style={{ margin: 0, fontSize: '0.86rem', textAlign: 'center' }}>
              A laptop is requesting to unlock a protected <b>{details.targetType?.toUpperCase() || 'Folder'}</b> for user <b>@{details.username}</b>.
            </p>

            {/* Device Info */}
            <div className="glass pad" style={{ padding: '8px 12px', borderRadius: '10px', fontSize: '0.82rem' }}>
              <div><b>Device:</b> {details.deviceInfo || 'Laptop Browser'}</div>
              {details.ipAddress && <div><b>IP:</b> {details.ipAddress}</div>}
            </div>

            {/* Match Code Input */}
            <label className="lbl" style={{ margin: 0 }}>
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
                1. Enter Security Match Code (From Laptop Screen)
              </span>
              <input
                type="text"
                value={matchCode}
                onChange={(e) => {
                  setMatchCode(e.target.value);
                  setErr('');
                }}
                placeholder="e.g. 748 192"
                required
                autoFocus
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

            {/* Double Password Fields */}
            <label className="lbl" style={{ margin: 0 }}>
              <span>2. Enter Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErr('');
                }}
                placeholder="Type password"
                required
                autoComplete="current-password"
              />
            </label>

            <label className="lbl" style={{ margin: 0 }}>
              <span>3. Re-enter Password (Confirm Again)</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setErr('');
                }}
                placeholder="Confirm password"
                required
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
                type="submit"
                className="btn primary"
                disabled={busy || mismatch || !matchCode || !password || !confirmPassword}
                style={{ fontWeight: 600 }}
              >
                {busy ? 'Verifying…' : '🔓 Unlock Folder'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}

