import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '../context/AppContext.jsx';
import MobileConnectModal from './MobileConnectModal.jsx';

const nav = [
  ['/', 'Dashboard'],
  ['/gallery', 'Gallery'],
  ['/upload', 'Add images'],
  ['/files', 'Files'],
  ['/categories', 'Categories'],
  ['/rejected', 'Rejected'],
  ['/settings', 'Settings'],
];

export default function Layout() {
  const { user, logout, lockVault } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [mobileModal, setMobileModal] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    const handleKey = (e) => {
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        lockVault();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lockVault]);

  return (
    <div className="app">
      {/* Mobile Top Navigation Header */}
      <header className="mobile-header glass">
        <div className="brand" style={{ padding: 0 }}>
          <span className="logo" style={{ width: 34, height: 34, fontSize: '1.05rem', borderRadius: 10 }}>V</span>
          <b>VaultCloset</b>
        </div>
        <div className="mobile-actions">
          <button
            type="button"
            className="btn ghost sm mobile-qr-btn"
            onClick={() => setMobileModal(true)}
            title="Scan QR to connect mobile"
          >
            📱 QR
          </button>
          <button
            type="button"
            className="burger btn ghost"
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
          >
            ☰ Menu
          </button>
        </div>
      </header>

      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <motion.aside
        className={'side glass' + (drawer ? ' open' : '')}
        animate={{ width: collapsed ? 84 : 248 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      >
        <div className="brand">
          <span className="logo">V</span>
          <AnimatePresence>
            {!collapsed && (
              <motion.b initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                VaultCloset
              </motion.b>
            )}
          </AnimatePresence>
          {drawer && (
            <button
              type="button"
              className="btn ghost sm drawer-close-btn"
              onClick={() => setDrawer(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          )}
        </div>
        <nav>
          {nav.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setDrawer(false)}
              className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}
              title={label}
            >
              <span className="dot" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {!collapsed && (
            <p className="muted small" style={{ margin: 0, paddingLeft: 4 }}>
              {user?.displayName}
            </p>
          )}
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDrawer(false);
              setMobileModal(true);
            }}
            title="Connect Mobile Phone via QR"
          >
            {collapsed ? '📱' : '📱 Mobile Connect'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={lockVault}
            title="Lock Vault immediately (Alt+L)"
          >
            {collapsed ? '🔒' : '🔒 Lock Vault'}
          </button>
          <button type="button" className="btn ghost" onClick={logout}>
            {collapsed ? 'Out' : 'Sign out'}
          </button>
          <button
            type="button"
            className="btn ghost collapse"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '»' : '« Collapse'}
          </button>
        </div>
      </motion.aside>

      <AnimatePresence mode="wait">
        <motion.main
          key={loc.pathname}
          className="main"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <MobileConnectModal open={mobileModal} onClose={() => setMobileModal(false)} />
    </div>
  );
}
