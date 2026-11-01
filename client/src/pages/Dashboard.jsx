import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { imageService } from '../services/imageService.js';
import { fmtBytes } from '../services/api.js';
import useCountUp from '../hooks/useCountUp.js';
import { useApp } from '../context/AppContext.jsx';

function Stat({ label, value, text }) {
  const n = useCountUp(value || 0);
  return <div className="glass stat"><span className="muted">{label}</span><strong>{text ? text : n.toLocaleString()}</strong></div>;
}

export default function Dashboard() {
  const { user, toast } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => { imageService.stats().then(setS).catch((e) => toast(e.message, 'err')); }, [toast]);
  if (!s) return <div className="boot"><span className="spinner" /></div>;
  const max = Math.max(1, ...s.byCategory.map((c) => c.count));
  return (
    <>
      <header className="page-head"><h1>Hello, {user.displayName}</h1><Link className="btn primary" to="/upload">Add images</Link></header>
      <div className="stats">
        <Stat label="Images" value={s.total} /><Stat label="Categories" value={s.categories} />
        <Stat label="Favorites" value={s.favorites} /><Stat label="Rejected (temporary)" value={s.rejected} />
        <Stat label="Storage used" value={1} text={fmtBytes(s.storageBytes)} />
      </div>
      <div>
        <section className="glass pad">
          <h3>By category</h3>
          {s.byCategory.map((c) => (
            <div key={c.name} className="bar-row">
              <span>{c.name}</span>
              <div className="bar">
                <motion.i initial={{ width: 0 }} animate={{ width: `${(c.count / max) * 100}%` }} transition={{ duration: 0.8 }} />
              </div>
              <b>{c.count}</b>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
