import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
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

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      setUser((await (reg ? authService.register(f) : authService.login(f))).user);
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
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

        <motion.form
          className="glass auth-card"
          onSubmit={submit}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
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
      </div>

      <MobileConnectModal open={mobileModal} onClose={() => setMobileModal(false)} />
    </div>
  );
}
