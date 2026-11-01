import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '../context/AppContext.jsx';
import { api, ago } from '../services/api.js';

import { authService } from '../services/authService.js';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

function UsageStat({ label, value, accent }) {
  return (
    <div className="glass stat" style={{ '--accent': accent || 'var(--gold)' }}>
      <span className="muted" style={{ fontSize: '.78rem' }}>{label}</span>
      <strong style={{ font: '600 1.6rem Fraunces,serif', color: 'var(--accent)' }}>{fmt(value)}</strong>
    </div>
  );
}

export default function Settings() {
  const { user, setUser, logout, lockVault, autoLockMinutes, setAutoLock, toast } = useApp();
  const [usage, setUsage] = useState(null);
  const [err, setErr] = useState(null);

  // Username edit state
  const [usernameInput, setUsernameInput] = useState(user?.username || '');
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameErr, setUsernameErr] = useState('');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState('');

  useEffect(() => {
    if (user?.username) setUsernameInput(user.username);
  }, [user]);

  useEffect(() => {
    api.get('/ai/usage')
      .then(setUsage)
      .catch((e) => setErr(e.message));
  }, []);

  const handleUpdateUsername = async (e) => {
    e.preventDefault();
    setUsernameBusy(true);
    setUsernameErr('');
    try {
      const res = await authService.updateUsername(usernameInput.trim());
      setUser(res.user);
      toast(`Username updated to @${res.user.username}`);
    } catch (x) {
      setUsernameErr(x.message || 'Could not update username');
    } finally {
      setUsernameBusy(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwErr('');
    if (newPassword !== confirmPassword) {
      setPwErr('New passwords do not match');
      return;
    }
    if (newPassword.length < 10) {
      setPwErr('New password must be at least 10 characters long');
      return;
    }
    setPwBusy(true);
    try {
      await authService.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Account password changed successfully!');
    } catch (x) {
      setPwErr(x.message || 'Failed to change password');
    } finally {
      setPwBusy(false);
    }
  };

  const totals = usage?.totals;
  const hasTokenData = totals && Number(totals.total_tokens) > 0;

  return (
    <>
      <header className="page-head"><h1>Settings</h1></header>

      {/* Account Profile & Username */}
      <section className="glass pad stack" style={{ marginBottom: 14 }}>
        <h3>Account & Username</h3>
        <p style={{ margin: 0 }}>
          <strong>{user.displayName}</strong>
          {user.username && <span style={{ color: 'var(--gold)', marginLeft: '8px' }}>@{user.username}</span>}
          {user.email && <span className="muted"> · {user.email}</span>}
        </p>

        <form onSubmit={handleUpdateUsername} style={{ display: 'grid', gap: '10px', maxWidth: '420px', marginTop: '10px' }}>
          <label className="lbl" style={{ margin: 0 }}>
            <b>Unique Username (Used to Sign In):</b>
            <div className="row" style={{ gap: '8px', marginTop: '6px' }}>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="e.g. dragoncode72"
                pattern="[a-zA-Z0-9_]{3,30}"
                title="3 to 30 alphanumeric characters and underscores (no @)"
                required
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn" disabled={usernameBusy || usernameInput === user.username}>
                {usernameBusy ? 'Saving…' : 'Update Username'}
              </button>
            </div>
            <span className="muted small">Letters, numbers, and underscores only. No email addresses.</span>
          </label>
          {usernameErr && <p className="error small" style={{ margin: 0 }}>{usernameErr}</p>}
        </form>

        <div style={{ marginTop: '8px' }}>
          <button className="btn ghost" onClick={logout}>Sign out</button>
        </div>
      </section>

      {/* Change Password */}
      <section className="glass pad stack" style={{ marginBottom: 14 }}>
        <h3>Change Account Password</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Enter your current password and choose a new, secure password (at least 10 characters).
        </p>

        <form onSubmit={handleChangePassword} style={{ display: 'grid', gap: '12px', maxWidth: '420px', marginTop: '8px' }}>
          <label className="lbl" style={{ margin: 0 }}>
            Current Password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
              autoComplete="current-password"
            />
          </label>

          <label className="lbl" style={{ margin: 0 }}>
            New Password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 10 characters (mixed case & numbers)"
              minLength={10}
              required
              autoComplete="new-password"
            />
          </label>

          <label className="lbl" style={{ margin: 0 }}>
            Confirm New Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              minLength={10}
              required
              autoComplete="new-password"
            />
          </label>

          {pwErr && <p className="error small" style={{ margin: 0 }}>{pwErr}</p>}

          <div>
            <button type="submit" className="btn primary" disabled={pwBusy}>
              {pwBusy ? 'Updating Password…' : 'Update Password'}
            </button>
          </div>
        </form>
      </section>

      {/* Security & Vault Protection */}
      <section className="glass pad stack" style={{ marginBottom: 14, borderLeft: '4px solid var(--gold)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3>Vault Security & Inactivity Protection</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Defends your vault against unauthorized physical and remote access.
            </p>
          </div>
          <button className="btn primary" onClick={lockVault} title="Lock Vault immediately (Alt+L)">
            🔒 Lock Vault Now (Alt+L)
          </button>
        </div>

        <div style={{ display: 'grid', gap: '12px', marginTop: '10px' }}>
          <label className="lbl" style={{ margin: 0 }}>
            <b>Inactivity Auto-Lock Timer:</b>
            <select
              value={autoLockMinutes}
              onChange={(e) => {
                setAutoLock(Number(e.target.value));
                toast(`Auto-lock set to ${e.target.value === '0' ? 'Disabled' : `${e.target.value} minutes`}`);
              }}
              style={{ maxWidth: '240px', marginTop: '4px' }}
            >
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes (Recommended)</option>
              <option value={30}>30 minutes</option>
              <option value={0}>Disabled</option>
            </select>
          </label>
          <span className="muted small">
            When enabled, VaultCloset automatically locks your session and secures all protected folders if no mouse or keyboard activity is detected.
          </span>
        </div>

        <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px' }}>
          <b style={{ fontSize: '0.88rem', color: 'var(--gold)' }}>Active Security & Anti-Hacker Protections:</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', marginTop: '8px', fontSize: '0.82rem' }}>
            <span>🛡️ AES-256-GCM Envelope Encryption</span>
            <span>🔥 DoD 5220.22-M 3-Pass Secure Shredding</span>
            <span>🚫 Anti-Brute-Force & Account Lockout Defense</span>
            <span>⏱️ Constant-Time Anti-Timing-Attack Protection</span>
            <span>🛡️ Strict HSTS, COOP & CORS Zero-Leak Headers</span>
            <span>🔒 Strict Account Isolation (No Cross-Viewing)</span>
            <span>🧼 EXIF GPS & Device Fingerprint Stripped</span>
            <span>💣 Decompression Bomb & Pixel Flood Guard</span>
            <span>🛡️ Prototype Pollution & Null-Byte Sanitizer</span>
            <span>⚡ Zero-Cache RAM Shielding (No Disk Traces)</span>
          </div>
        </div>
      </section>

      {/* Viewer */}
      <section className="glass pad stack" style={{ marginBottom: 14 }}>
        <h3>Viewer</h3>
        <p className="muted small">The viewer blocks right-click saving and hides the image when the window loses focus. No website can fully stop screenshots, because the operating system or a camera can still capture the screen.</p>
      </section>

      {/* AI Usage */}
      <section className="glass pad stack">
        <h3>AI Token Usage</h3>
        <p className="muted small">Every image you upload is scanned by an AI model. This section shows how many tokens have been consumed from your API key.</p>

        {err && <p className="error small">{err}</p>}

        {!usage && !err && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="spinner sm" /> <span className="muted">Loading…</span>
          </div>
        )}

        {usage && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>

            {/* Lifetime stats */}
            <div className="stats" style={{ marginBottom: 14 }}>
              <UsageStat label="AI Scans" value={totals.total_calls} />
              <UsageStat label="Input tokens" value={totals.total_input} />
              <UsageStat label="Output tokens" value={totals.total_output} accent="var(--rose)" />
              <UsageStat label="Total tokens" value={totals.total_tokens} accent="var(--ok)" />
            </div>

            {!hasTokenData && (
              <p className="muted small" style={{ marginBottom: 12 }}>
                ℹ️ Token counts will appear here after your next image upload (older scans may not have this data).
              </p>
            )}

            {/* Per-model breakdown */}
            {usage.byModel?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p className="muted small" style={{ marginBottom: 8 }}>By model</p>
                <div style={{ display: 'grid', gap: 8 }}>
                  {usage.byModel.map((m) => (
                    <div key={m.provider} className="glass" style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '.85rem', color: 'var(--gold)' }}>{m.provider}</span>
                      <span className="muted small">{fmt(m.calls)} scans</span>
                      <span className="small">↑ {fmt(m.input_tokens)} <span className="muted">in</span></span>
                      <span className="small">↓ {fmt(m.output_tokens)} <span className="muted">out</span></span>
                      <span className="small" style={{ color: 'var(--ok)' }}>{fmt(m.total_tokens)} <span className="muted">total</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent scans */}
            {usage.recent?.length > 0 && (
              <div>
                <p className="muted small" style={{ marginBottom: 8 }}>Recent scans</p>
                <div style={{ display: 'grid', gap: 6 }}>
                  {usage.recent.map((r, i) => (
                    <div key={i} className="glass" style={{ padding: '8px 14px', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className={'badge ' + (r.verdict === 'approved' ? 'approved' : 'rejected')} style={{ flex: 'none' }}>{r.verdict}</span>
                      <span className="small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 80 }} title={r.filename}>{r.filename || '—'}</span>
                      <span className="muted small" style={{ flex: 'none' }}>{r.category}</span>
                      {r.input_tokens != null
                        ? <span className="muted small" style={{ flex: 'none' }}>{fmt(r.input_tokens + r.output_tokens)} tokens</span>
                        : <span className="muted small" style={{ flex: 'none' }}>no token data</span>}
                      <span className="muted small" style={{ flex: 'none' }}>{ago(r.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {usage.recent?.length === 0 && (
              <p className="muted small">No AI scans yet. Upload some images to get started!</p>
            )}
          </motion.div>
        )}
      </section>
    </>
  );
}
