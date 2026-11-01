import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { authService } from '../services/authService.js';
import { unlockedStore } from '../services/api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  // Auto-lock inactivity timeout (default 15 minutes)
  const [autoLockMinutes, setAutoLockMins] = useState(() => {
    const val = localStorage.getItem('vc_autolock');
    return val !== null ? Number(val) : 15;
  });

  const setAutoLock = (mins) => {
    localStorage.setItem('vc_autolock', String(mins));
    setAutoLockMins(Number(mins));
  };

  const lockVault = useCallback(() => {
    unlockedStore.clear();
    setVaultLocked(true);
    setUnlockPassword('');
    setUnlockError('');
  }, []);

  const unlockVault = useCallback(() => {
    setVaultLocked(false);
    setUnlockPassword('');
    setUnlockError('');
  }, []);

  useEffect(() => {
    authService
      .me()
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const f = () => {
      setUser(null);
      setVaultLocked(false);
    };
    window.addEventListener('vc:unauth', f);
    return () => window.removeEventListener('vc:unauth', f);
  }, []);

  // Idle Inactivity Timer (Auto-lock)
  useEffect(() => {
    if (!user || autoLockMinutes <= 0 || vaultLocked) return;

    let timer;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        lockVault();
      }, autoLockMinutes * 60 * 1000);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [user, autoLockMinutes, vaultLocked, lockVault]);

  const toast = useCallback((message, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const logout = async () => {
    await authService.logout().catch(() => {});
    unlockedStore.clear();
    setUser(null);
    setVaultLocked(false);
  };

  const handleUnlockSubmit = async (e) => {
    e.preventDefault();
    if (!unlockPassword || !user) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      await authService.login({ username: user.username || user.email, password: unlockPassword });
      unlockVault();
      toast('Vault unlocked');
    } catch (err) {
      setUnlockError(err.message || 'Incorrect password');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <Ctx.Provider
      value={{
        user,
        setUser,
        booting,
        toast,
        logout,
        vaultLocked,
        lockVault,
        unlockVault,
        autoLockMinutes,
        setAutoLock,
      }}
    >
      {children}

      {/* Auto-Lock / Manual Lock Fullscreen Privacy Shield */}
      <AnimatePresence>
        {vaultLocked && user && (
          <motion.div
            className="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ zIndex: 100, backdropFilter: 'blur(24px)', background: 'rgba(9, 7, 14, 0.88)' }}
          >
            <motion.div
              className="modal glass"
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              style={{ maxWidth: '400px', textAlign: 'center' }}
            >
              <div
                style={{
                  fontSize: '2.5rem',
                  marginBottom: '10px',
                  display: 'inline-block',
                }}
              >
                🔒
              </div>
              <h2>Vault Locked</h2>
              <p className="muted small" style={{ marginBottom: '18px' }}>
                Your vault is locked to protect your privacy. Enter your password to resume.
              </p>

              <form onSubmit={handleUnlockSubmit} style={{ display: 'grid', gap: '14px', textAlign: 'left' }}>
                <label className="lbl" style={{ margin: 0 }}>
                  Account Password (@{user.username || user.displayName})
                  <input
                    type="password"
                    autoFocus
                    required
                    placeholder="Enter account password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                  />
                </label>

                {unlockError && <p className="error small" style={{ margin: 0 }}>{unlockError}</p>}

                <div className="row end" style={{ marginTop: '8px' }}>
                  <button type="button" className="btn ghost" onClick={logout}>
                    Sign out
                  </button>
                  <button type="submit" className="btn primary" disabled={unlocking}>
                    {unlocking ? 'Verifying…' : 'Unlock Vault'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={'toast ' + t.type}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
