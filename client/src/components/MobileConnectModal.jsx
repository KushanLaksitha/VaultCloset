import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import Modal from './Modal.jsx';

export default function MobileConnectModal({ open, onClose }) {
  const [qrUrl, setQrUrl] = useState('');
  const [networkInfo, setNetworkInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    fetch('/api/network-info')
      .then((r) => r.json())
      .then(async (data) => {
        setNetworkInfo(data);
        const mobileTargetUrl = data.url || `http://${data.primaryIp}:5173`;
        const qrDataUri = await QRCode.toDataURL(mobileTargetUrl, {
          width: 280,
          margin: 2,
          color: {
            dark: '#14111b',
            light: '#ffffff',
          },
        });
        setQrUrl(qrDataUri);
      })
      .catch((err) => {
        console.error('Failed to get network info for QR code:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  const handleCopy = () => {
    if (!networkInfo?.url) return;
    navigator.clipboard?.writeText(networkInfo.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const mobileUrl = networkInfo?.url || `http://${networkInfo?.primaryIp || '10.216.232.193'}:5173`;

  return (
    <Modal open={open} onClose={onClose} title="📱 Connect Mobile Phone">
      <div style={{ display: 'grid', gap: '16px', textAlign: 'center' }}>
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
          Access your private vault from your mobile phone on the same Wi-Fi network.
        </p>

        {loading ? (
          <div style={{ padding: '40px', display: 'grid', placeItems: 'center' }}>
            <span className="spinner" />
            <span className="muted small" style={{ marginTop: '8px' }}>Generating QR code…</span>
          </div>
        ) : (
          <>
            {/* QR Code Container */}
            <div
              style={{
                display: 'inline-block',
                margin: '0 auto',
                background: '#ffffff',
                padding: '12px',
                borderRadius: '16px',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)',
              }}
            >
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="Mobile Access QR Code"
                  style={{ width: '220px', height: '220px', display: 'block', borderRadius: '8px' }}
                />
              ) : (
                <div style={{ width: '220px', height: '220px', display: 'grid', placeItems: 'center', color: '#333' }}>
                  QR code unavailable
                </div>
              )}
            </div>

            {/* Direct URL Display & Copy */}
            <div
              className="glass pad"
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
              }}
            >
              <div style={{ textAlign: 'left', minWidth: 0, overflow: 'hidden' }}>
                <span className="muted small" style={{ display: 'block', fontSize: '0.74rem' }}>
                  Mobile Network Address:
                </span>
                <code
                  style={{
                    color: 'var(--gold)',
                    fontWeight: 600,
                    fontSize: '0.92rem',
                    wordBreak: 'break-all',
                  }}
                >
                  {mobileUrl}
                </code>
              </div>
              <button
                type="button"
                className="btn primary sm"
                onClick={handleCopy}
                style={{ flexShrink: 0, padding: '7px 12px', fontSize: '0.82rem' }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            {/* Step-by-Step Instructions */}
            <div
              style={{
                textAlign: 'left',
                background: 'rgba(232, 201, 165, 0.08)',
                borderLeft: '3px solid var(--gold)',
                padding: '12px 14px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                display: 'grid',
                gap: '6px',
              }}
            >
              <b style={{ color: 'var(--gold)' }}>How to connect:</b>
              <div>1. Connect your mobile phone to the <strong>same Wi-Fi network</strong> as this PC.</div>
              <div>2. Open your phone's <strong>Camera or QR Code Scanner</strong>.</div>
              <div>3. Point it at the QR code above and tap the link to open VaultCloset!</div>
            </div>
          </>
        )}

        <div className="row end" style={{ marginTop: '4px' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
