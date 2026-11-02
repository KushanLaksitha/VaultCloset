import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { imageService } from '../services/imageService.js';
import { fmtBytes } from '../services/api.js';
import useCountUp from '../hooks/useCountUp.js';
import { useApp } from '../context/AppContext.jsx';

function Stat({ label, value, text, icon, to }) {
  const n = useCountUp(value || 0);
  const inner = (
    <div className="glass stat" style={{ position: 'relative', overflow: 'hidden' }}>
      {icon && <span style={{ position: 'absolute', top: 14, right: 16, fontSize: '1.5rem', opacity: 0.18 }}>{icon}</span>}
      <span className="muted">{label}</span>
      <strong>{text ? text : n.toLocaleString()}</strong>
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}


export default function Dashboard() {
  const { user, toast } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => { imageService.stats().then(setS).catch((e) => toast(e.message, 'err')); }, [toast]);
  if (!s) return <div className="boot"><span className="spinner" /></div>;

  const quickActions = [
    { to: '/upload', icon: '📸', label: 'Add Images', sub: 'AI scan or manual', color: 'var(--gold)' },
    { to: '/upload?mode=manual', icon: '📁', label: 'Direct to Folder', sub: 'No AI, choose folder', color: 'var(--ok)' },
    { to: '/gallery', icon: '🖼️', label: 'Browse Gallery', sub: `${s.total} images`, color: 'var(--rose)' },
    { to: '/categories', icon: '🔒', label: 'Manage Folders', sub: `${s.categories} categories`, color: '#a98bd6' },
    { to: '/files', icon: '🎬', label: 'Files Vault', sub: 'Videos & documents', color: '#6bbde3' },
    { to: '/rejected', icon: '🚫', label: 'Review Rejected', sub: `${s.rejected} pending`, color: 'var(--danger)' },
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Hello, {user.displayName} 👋</h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>Your encrypted vault is secure.</p>
        </div>
        <Link className="btn primary" to="/upload">+ Add images</Link>
      </header>

      {/* Stats row */}
      <div className="stats" style={{ marginBottom: '24px' }}>
        <Stat label="Images" value={s.total} icon="🖼️" to="/gallery" />
        <Stat label="Favorites" value={s.favorites} icon="❤️" to="/gallery?favorite=1" />
        <Stat label="Categories" value={s.categories} icon="📂" to="/categories" />
        <Stat label="Storage used" value={1} text={fmtBytes(s.storageBytes)} icon="💾" />
        {s.rejected > 0 && <Stat label="Rejected" value={s.rejected} icon="🚫" to="/rejected" />}
      </div>

      {/* Quick Actions */}
      <section style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '14px', color: 'var(--muted)', fontSize: '0.82rem', fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
          Quick Actions
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
          {quickActions.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              style={{ textDecoration: 'none' }}
            >
              <motion.div
                className="glass pad"
                whileHover={{ y: -3, scale: 1.02 }}
                transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                style={{ display: 'grid', gap: '6px', cursor: 'pointer', padding: '14px 16px' }}
              >
                <span style={{ fontSize: '1.6rem' }}>{a.icon}</span>
                <b style={{ fontSize: '0.92rem', color: a.color }}>{a.label}</b>
                <span className="muted small">{a.sub}</span>
              </motion.div>
            </Link>
          ))}
        </div>
      </section>



      {/* Vault tip */}
      <div className="glass pad" style={{ display: 'flex', gap: '14px', alignItems: 'center', background: 'rgba(232,201,165,0.05)', borderColor: 'rgba(232,201,165,0.15)', marginTop: '8px' }}>
        <span style={{ fontSize: '1.5rem', flex: 'none' }}>🔐</span>
        <div>
          <b style={{ color: 'var(--gold)', fontSize: '0.9rem' }}>Zero-knowledge encryption</b>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            All files are AES-256-GCM encrypted before storage. Your master key never leaves this device. Even server administrators cannot access your data.
          </p>
        </div>
      </div>
    </>
  );
}
