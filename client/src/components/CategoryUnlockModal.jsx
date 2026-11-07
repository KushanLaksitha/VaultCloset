import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import Modal from './Modal.jsx';
import { categoryService } from '../services/categoryService.js';
import { unlockedStore } from '../services/api.js';
import { isMobileDevice } from './MobileAuthPromptModal.jsx';

export default function CategoryUnlockModal({ open, onClose, categoryId, targetType = 'Folder', onUnlocked }) {
  const isMobile = isMobileDevice();

  const [loading, setLoading] = useState(false);
  const [reqData, setReqData] = useState(null);
  const [countdown, setCountdown] = useState(180);
  const [pollStatus, setPollStatus] = useState('pending'); // 'pending' | 'approved' | 'rejected' | 'expired'
  const [qrCodeData, setQrCodeData] = useState('');
  const [err, setErr] = useState('');

  // Fallback direct password input state (on mobile devices, this is the default)
  const [showDirectPin, setShowDirectPin] = useState(false);
  const [directPin, setDirectPin] = useState('');
  const [directBusy, setDirectBusy] = useState(false);
  const [directErr, setDirectErr] = useState('');

  const pollTimerRef = useRef(null);

  // Initialize or reset when modal opens / closes
  useEffect(() => {
    if (!open || !categoryId) {
      setReqData(null);
      setPollStatus('pending');
      setQrCodeData('');
      setErr('');
      setShowDirectPin(false);
      setDirectPin('');
      setDirectErr('');
      setLoading(false);
      return;
    }

    // If the user is browsing directly on their mobile phone, unlock with direct password
    if (isMobile) {
      setShowDirectPin(true);
      setLoading(false);
      setErr('');
      setDirectPin('');
      setDirectErr('');
      return;
    }

    // Desktop/Laptop: Request Mobile Unlock Gate Token
    setLoading(true);
    setShowDirectPin(false);
    setErr('');

    categoryService
      .requestMobileUnlock(categoryId)
      .then(async (res) => {
        if (res.alreadyUnlocked) {
          unlockedStore.add(res.categoryId, res.name, res.imageCount);
          onUnlocked?.(res);
          onClose();
          return;
        }

        setReqData(res);
        setCountdown(res.expiresIn || 180);
        setPollStatus('pending');

        // Fetch network info to build mobile QR code
        try {
          const net = await fetch('/api/network-info').then((r) => r.json());
          const base = net.url || `http://${net.primaryIp || 'localhost'}:5173`;
          const url = `${base}/unlock-category?id=${res.requestId}`;
          const qr = await QRCode.toDataURL(url, {
            width: 190,
            margin: 1,
            color: { dark: '#14111b', light: '#ffffff' },
          });
          setQrCodeData(qr);
        } catch (e) {
          console.error('Failed to generate category QR:', e);
        }
      })
      .catch((e) => {
        console.warn('Mobile unlock request failed, falling back to direct PIN:', e.message);
        setErr('');
        setShowDirectPin(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, categoryId, isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling & countdown for mobile authorization
  useEffect(() => {
    if (!open || !reqData || pollStatus !== 'pending') return;

    // Countdown ticker
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setPollStatus('expired');
          setErr('Unlock request timed out. Please try again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Status poll: poll every 1.5 seconds for instant unlock response
    const poll = async () => {
      try {
        const res = await categoryService.checkMobileUnlockStatus(reqData.requestId);
        if (res.status === 'approved') {
          setPollStatus('approved');
          clearInterval(pollTimerRef.current);
          clearInterval(timer);

          unlockedStore.add(res.categoryId, res.name, res.imageCount);
          setTimeout(() => {
            onUnlocked?.(res);
            onClose();
          }, 800);
        } else if (res.status === 'rejected') {
          setPollStatus('rejected');
          setErr('Folder unlock was denied on mobile device.');
          clearInterval(pollTimerRef.current);
          clearInterval(timer);
        } else if (res.status === 'expired') {
          setPollStatus('expired');
          setErr('Folder unlock request expired.');
          clearInterval(pollTimerRef.current);
          clearInterval(timer);
        }
      } catch {
        // Silently continue polling on network hiccup
      }
    };

    pollTimerRef.current = setInterval(poll, 1500);

    return () => {
      clearInterval(timer);
      clearInterval(pollTimerRef.current);
    };
  }, [open, reqData, pollStatus, onUnlocked, onClose]);

  const handleCancel = async () => {
    if (reqData?.requestId) {
      await categoryService.cancelMobileUnlock(reqData.requestId).catch(() => {});
    }
    onClose();
  };

  const handleDirectPinSubmit = async (e) => {
    e.preventDefault();
    if (!directPin || directBusy) return;
    setDirectBusy(true);
    setDirectErr('');
    try {
      const res = await categoryService.verifyPin(categoryId, directPin);
      unlockedStore.add(categoryId, res.name || null, res.imageCount ?? null);
      onUnlocked?.(res);
      onClose();
    } catch (e) {
      setDirectErr(e.message || 'Incorrect password');
    } finally {
      setDirectBusy(false);
    }
  };

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <Modal open={open} onClose={handleCancel} title={`🔒 Unlock Protected ${targetType || 'Folder'}`}>
      <div style={{ textAlign: 'center', display: 'grid', gap: '14px' }}>
        {/* Loading spinner during initial token request */}
        {loading && (
          <div style={{ padding: '30px 0' }}>
            <span className="spinner" />
            <p className="muted small" style={{ marginTop: '10px' }}>Connecting to mobile authorization gate…</p>
          </div>
        )}

        {/* Error state (expired or denied) */}
        {!loading && err && pollStatus !== 'pending' && (
          <div style={{ padding: '12px', background: 'rgba(248, 113, 113, 0.1)', borderRadius: '10px', border: '1px solid #f87171' }}>
            <p className="error small" style={{ margin: 0 }}>{err}</p>
            <div className="row" style={{ justifyContent: 'center', gap: '8px', marginTop: '10px' }}>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setErr('');
                  setPollStatus('pending');
                  setReqData(null);
                  setQrCodeData('');
                  setLoading(true);
                  categoryService
                    .requestMobileUnlock(categoryId)
                    .then(async (res) => {
                      if (res.alreadyUnlocked) {
                        unlockedStore.add(res.categoryId, res.name, res.imageCount);
                        onUnlocked?.(res);
                        onClose();
                        return;
                      }
                      setReqData(res);
                      setCountdown(res.expiresIn || 180);
                      setPollStatus('pending');
                      try {
                        const net = await fetch('/api/network-info').then((r) => r.json());
                        const base = net.url || `http://${net.primaryIp || 'localhost'}:5173`;
                        const url = `${base}/unlock-category?id=${res.requestId}`;
                        const qr = await QRCode.toDataURL(url, { width: 190, margin: 1, color: { dark: '#14111b', light: '#ffffff' } });
                        setQrCodeData(qr);
                      } catch {}
                    })
                    .catch(() => setShowDirectPin(true))
                    .finally(() => setLoading(false));
                }}
              >
                🔄 Try Again
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => { setErr(''); setShowDirectPin(true); }}
              >
                ⌨️ Use Password Instead
              </button>
            </div>
          </div>
        )}

        {/* Approved Success State */}
        {!loading && pollStatus === 'approved' && (
          <div style={{ padding: '24px 16px', background: 'rgba(74, 222, 128, 0.12)', borderRadius: '14px', border: '1px solid #4ade80' }}>
            <div style={{ fontSize: '2.8rem' }}>✅</div>
            <h3 style={{ color: '#4ade80', margin: '6px 0 2px' }}>Folder Unlocked from Mobile!</h3>
            <p className="muted small" style={{ margin: 0 }}>Revealing contents…</p>
          </div>
        )}

        {/* Mobile Gate UI: Security Match Code + QR + Countdown */}
        {!loading && !showDirectPin && reqData && pollStatus === 'pending' && (
          <>
            <p className="muted small" style={{ margin: 0, fontSize: '0.86rem' }}>
              To open this protected folder on your laptop, look at the code below and enter it on your mobile phone.
            </p>

            {/* Security Match Code Display */}
            <div
              style={{
                background: 'rgba(232, 201, 165, 0.08)',
                border: '1.5px solid var(--gold)',
                borderRadius: '14px',
                padding: '14px 12px',
              }}
            >
              <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.72rem' }}>
                Security Match Code
              </span>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '2.4rem',
                  letterSpacing: '0.18em',
                  color: 'var(--gold)',
                  fontWeight: 700,
                  margin: '4px 0',
                }}
              >
                {reqData.securityCode}
              </div>
              <div className="row" style={{ justifyContent: 'center', alignItems: 'center', gap: '8px', fontSize: '0.84rem' }}>
                <span className="spinner sm" />
                <span>Waiting for mobile authorization…</span>
                <strong style={{ color: 'var(--gold)' }}>{formatCountdown(countdown)}</strong>
              </div>
            </div>

            {/* QR Code for phone camera scanning */}
            {qrCodeData && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                }}
              >
                <span className="muted small" style={{ display: 'block', marginBottom: '8px', fontSize: '0.78rem' }}>
                  📱 Don't have VaultCloset open on your phone? Scan to unlock:
                </span>
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
                    alt="Scan with phone camera to unlock"
                    style={{ width: '150px', height: '150px', display: 'block', borderRadius: '4px' }}
                  />
                </div>
              </div>
            )}

            {/* Alternative Direct PIN Toggle */}
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setShowDirectPin(true)}
              style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '2px' }}
            >
              ⌨️ Or unlock with password directly on this device
            </button>
          </>
        )}

        {/* Direct Password Input Mode */}
        {!loading && showDirectPin && (
          <form onSubmit={handleDirectPinSubmit} style={{ display: 'grid', gap: '12px', textAlign: 'left' }}>
            <p className="muted small" style={{ margin: 0 }}>
              Enter the folder password to unlock directly on this device:
            </p>
            <label className="lbl" style={{ margin: 0 }}>
              Folder Password / PIN
              <input
                type="password"
                required
                autoFocus
                placeholder="Enter folder password"
                value={directPin}
                onChange={(e) => setDirectPin(e.target.value)}
              />
            </label>
            {directErr && <p className="error small" style={{ margin: 0 }}>{directErr}</p>}
            <div className="row end" style={{ gap: '8px', marginTop: '6px' }}>
              {!isMobile && reqData && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setShowDirectPin(false)}
                >
                  📱 Back to Mobile Gate
                </button>
              )}
              <button
                type="submit"
                className="btn primary sm"
                disabled={directBusy || !directPin}
              >
                {directBusy ? 'Verifying…' : 'Unlock Folder'}
              </button>
            </div>
          </form>
        )}

        <div className="row end" style={{ marginTop: '6px' }}>
          <button type="button" className="btn ghost" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
