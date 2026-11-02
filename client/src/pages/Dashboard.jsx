import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { imageService } from '../services/imageService.js';
import { fmtBytes, ago } from '../services/api.js';
import useCountUp from '../hooks/useCountUp.js';
import { useApp } from '../context/AppContext.jsx';
import SecureImage from '../components/SecureImage.jsx';

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

const ACTION_ICON = {
  image_added: '🖼️',
  manually_approved: '📁',
  image_rejected: '🚫',
  images_deleted: '🗑️',
  images_moved: '📂',
  category_created: '➕',
  category_renamed: '✏️',
  category_deleted: '🗑️',
  file_added: '📄',
};

const ACTION_LABEL = {
  image_added: 'Image added (AI)',
  manually_approved: 'Image saved',
  image_rejected: 'Image rejected',
  images_deleted: 'Images deleted',
  images_moved: 'Images moved',
  category_created: 'Category created',
  category_renamed: 'Category renamed',
  category_deleted: 'Category deleted',
  file_added: 'File saved',
};

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

      <div className="two">
        {/* Recent uploads */}
        {s.recent?.length > 0 && (
          <section className="glass pad">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ margin: 0 }}>Recent uploads</h3>
              <Link to="/gallery" className="muted small" style={{ textDecoration: 'none' }}>View all →</Link>
            </div>
            <div className="strip">
              <AnimatePresence>
                {s.recent.map((img, i) => (
                  <motion.div
                    key={img.id}
                    className="tile glass"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Link to={`/gallery`} style={{ display: 'block', width: '100%', height: '100%' }}>
                      <SecureImage
                        thumbToken={img.thumbToken}
                        alt={img.name || img.original_filename}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '14px' }}
                      />
                    </Link>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Activity feed */}
        {s.activity?.length > 0 && (
          <section className="glass pad">
            <h3 style={{ marginBottom: '14px' }}>Recent activity</h3>
            <div style={{ display: 'grid', gap: '2px' }}>
              {s.activity.map((a, i) => (
                <motion.div
                  key={i}
                  className="act"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', borderBottom: i < s.activity.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
                >
                  <span style={{ fontSize: '1.1rem', marginTop: '1px', flex: 'none' }}>
                    {ACTION_ICON[a.action] || '📋'}
                  </span>
                  <div style={{ display: 'grid', gap: '1px', minWidth: 0 }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                      {ACTION_LABEL[a.action] || a.action}
                    </span>
                    {a.detail && (
                      <span className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.detail}
                      </span>
                    )}
                  </div>
                  <span className="muted small" style={{ flex: 'none', marginLeft: 'auto', paddingLeft: '8px' }}>
                    {ago(a.created_at)}
                  </span>
                </motion.div>
              ))}
            </div>
          </section>
        )}
      </div>

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
