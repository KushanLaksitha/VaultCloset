import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { imageService } from '../services/imageService.js';
import { categoryService } from '../services/categoryService.js';
import { useApp } from '../context/AppContext.jsx';
import SecureImage from '../components/SecureImage.jsx';
import Modal from '../components/Modal.jsx';
import { ago, fmtBytes } from '../services/api.js';

export default function Rejected() {
  const { toast } = useApp();
  const [list, setList] = useState(null); const [cats, setCats] = useState([]);
  const [shown, setShown] = useState({}); const [review, setReview] = useState(null);
  const [approve, setApprove] = useState(null); const [cat, setCat] = useState(''); const [sure, setSure] = useState(false);
  const [url, setUrl] = useState(null);
  const load = () => imageService.rejected().then((r) => setList(r.rejected)).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); categoryService.list().then((r) => setCats(r.categories)); }, []); // eslint-disable-line
  const ai = (r) => (typeof r.ai === 'string' ? JSON.parse(r.ai) : r.ai) || {};

  const openReview = async (r) => { setReview(r); setUrl(null); try { setUrl((await imageService.rejectedUrl(r.id)).url); } catch (e) { toast(e.message, 'err'); } };
  const discard = async (r) => { try { await imageService.discard(r.id); toast('Deleted'); setReview(null); load(); } catch (e) { toast(e.message, 'err'); } };
  const doApprove = async () => { try { await imageService.approve(approve.id, +cat || undefined); toast('Approved and encrypted into your collection'); setApprove(null); setSure(false); load(); } catch (e) { toast(e.message, 'err'); } };

  if (!list) return <div className="boot"><span className="spinner" /></div>;
  return (
    <>
      <header className="page-head"><h1>Rejected images</h1></header>
      <p className="muted">These were flagged by the AI check. They are kept encrypted and temporarily, then deleted automatically. They never enter your collection unless you approve them.</p>
      {list.length === 0 && <p className="empty muted">Nothing rejected right now.</p>}
      <div className="cards">
        <AnimatePresence>
          {list.map((r) => (
            <motion.div key={r.id} layout className="glass rcard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.92 }}>
              <div className="rthumb"><SecureImage token={r.thumbToken} alt="" blur={!shown[r.id]} />
                <button className="btn ghost reveal" onClick={() => setShown({ ...shown, [r.id]: !shown[r.id] })}>{shown[r.id] ? 'Hide' : 'Show'}</button></div>
              <b title={r.name}>{r.name}</b>
              <span className="small">{r.reason || 'Flagged as explicit'}</span>
              <span className="muted small">AI suggested: {ai(r).category || '—'} · {fmtBytes(r.size)} · deletes {ago(r.expiresAt).includes('ago') ? 'soon' : new Date(r.expiresAt).toLocaleString()}</span>
              <div className="row"><button className="btn" onClick={() => openReview(r)}>Review</button>
                <button className="btn ghost" onClick={() => { setApprove(r); setCat(''); setSure(false); }}>Approve manually</button>
                <button className="btn ghost danger" onClick={() => discard(r)}>Delete</button></div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Modal open={!!review} onClose={() => setReview(null)} title="Review rejected image" wide>
        {review && <>
          <div className="review-img" onContextMenu={(e) => e.preventDefault()}>{url ? <img src={url} alt="" draggable={false} /> : <span className="spinner" />}</div>
          <p><b>Reason:</b> {review.reason || 'Flagged as explicit'}</p>
          <p className="muted small">AI result: category {ai(review).category || '—'}, confidence {Math.round((ai(review).confidence || 0) * 100)}%{ai(review).labels?.length ? `, labels: ${ai(review).labels.join(', ')}` : ''}</p>
          <div className="row end"><button className="btn ghost danger" onClick={() => discard(review)}>Delete</button>
            <button className="btn" onClick={() => { setApprove(review); setReview(null); setCat(''); setSure(false); }}>Approve manually</button></div>
        </>}
      </Modal>
      <Modal open={!!approve} onClose={() => setApprove(null)} title="Approve this image?">
        <p className="muted">Only approve if the AI got it wrong. The image will be encrypted and added to your collection.</p>
        <label className="lbl">Category<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Other</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I’ve reviewed this image and want to keep it</label>
        <div className="row end"><button className="btn ghost" onClick={() => setApprove(null)}>Cancel</button><button className="btn primary" disabled={!sure} onClick={doApprove}>Approve and save</button></div>
      </Modal>
    </>
  );
}
