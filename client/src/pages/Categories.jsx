import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { categoryService } from '../services/categoryService.js';
import { unlockedStore } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';
import Modal from '../components/Modal.jsx';

export default function Categories() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [delForm, setDelForm] = useState({ userPassword: '', categoryPassword: '' });
  const [delSubmitting, setDelSubmitting] = useState(false);
  const [pinModal, setPinModal] = useState(null); // { id, name, mode: 'set'|'change'|'remove' }
  const [pinForm, setPinForm] = useState({ currentPin: '', pin: '', confirmPin: '' });
  const [submitting, setSubmitting] = useState(false);

  // Category Unlock & View Modal
  const [unlockModal, setUnlockModal] = useState(null); // { id, name }
  const [unlockPin, setUnlockPin] = useState('');
  const [unlockSubmitting, setUnlockSubmitting] = useState(false);

  const load = () => categoryService.list().then((r) => setList(r.categories)).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const run = (fn, ok) => async () => {
    try {
      await fn();
      if (ok) toast(ok);
      await load();
    } catch (e) {
      toast(e.message, 'err');
      throw e;
    }
  };

  const openPinModal = (cat, mode) => {
    setPinModal({ id: cat.id, name: cat.name, mode });
    setPinForm({ currentPin: '', pin: '', confirmPin: '' });
  };

  // Open category photos (asks for password if locked)
  const handleOpenCategory = (cat) => {
    if (cat.hasPin && !unlockedStore.has(cat.id)) {
      setUnlockModal(cat);
      setUnlockPin('');
    } else {
      navigate(`/gallery?category=${cat.id}`);
    }
  };

  const handleUnlockSubmit = async (e) => {
    e.preventDefault();
    if (!unlockModal) return;
    setUnlockSubmitting(true);
    try {
      await categoryService.verifyPin(unlockModal.id, unlockPin);
      unlockedStore.add(unlockModal.id);
      toast(`Folder “${unlockModal.name}” unlocked`);
      const catId = unlockModal.id;
      setUnlockModal(null);
      navigate(`/gallery?category=${catId}`);
    } catch (err) {
      toast(err.message || 'Incorrect password', 'err');
    } finally {
      setUnlockSubmitting(false);
    }
  };

  // Category Deletion with Dual Passwords (User Account Password + Category Password)
  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (!del) return;
    setDelSubmitting(true);
    try {
      await categoryService.remove(del.id, {
        userPassword: delForm.userPassword,
        categoryPassword: delForm.categoryPassword,
      });
      toast(`Category “${del.name}” deleted`);
      setDel(null);
      setDelForm({ userPassword: '', categoryPassword: '' });
      await load();
    } catch (err) {
      toast(err.message || 'Failed to delete category', 'err');
    } finally {
      setDelSubmitting(false);
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    if (!pinModal) return;
    setSubmitting(true);
    try {
      if (pinModal.mode === 'set' || pinModal.mode === 'change') {
        if (!pinForm.pin || pinForm.pin.length < 4) {
          toast('Password must be at least 4 characters', 'err');
          setSubmitting(false);
          return;
        }
        if (pinForm.pin !== pinForm.confirmPin) {
          toast('Passwords do not match', 'err');
          setSubmitting(false);
          return;
        }
        await categoryService.setPin(pinModal.id, pinForm.pin, pinModal.mode === 'change' ? pinForm.currentPin : undefined);
        toast(`Password ${pinModal.mode === 'set' ? 'set' : 'updated'} for “${pinModal.name}”`);
      } else if (pinModal.mode === 'remove') {
        if (!pinForm.currentPin) {
          toast('Please enter the current password', 'err');
          setSubmitting(false);
          return;
        }
        await categoryService.removePin(pinModal.id, pinForm.currentPin);
        toast(`Password removed from “${pinModal.name}”`);
      }
      setPinModal(null);
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Categories & Folders</h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Organize images into folders. You can set a password for each folder to keep its photos private and unlock them securely.
          </p>
        </div>
      </header>

      <form className="row glass pad" onSubmit={(e) => { e.preventDefault(); run(() => categoryService.create(name), 'Category created')().then(() => setName('')); }}>
        <input placeholder="New category, e.g. Travel, Work, Private" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        <button className="btn primary">Create category</button>
      </form>

      <div className="list">
        <AnimatePresence>
          {list.map((c) => (
            <motion.div key={c.id} layout className="glass pad crow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }}>
              {edit?.id === c.id ? (
                <form className="row grow" onSubmit={(e) => { e.preventDefault(); run(() => categoryService.rename(c.id, edit.name), 'Renamed')().then(() => setEdit(null)); }}>
                  <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} />
                  <button className="btn primary">Save</button>
                  <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div className="grow" style={{ display: 'grid', gap: '4px' }}>
                    <div className="row" style={{ gap: '8px' }}>
                      <b style={{ fontSize: '1.05rem' }}>{c.name}</b>
                      {c.hasPin ? (

                        <span className="badge" style={{ background: 'rgba(232, 201, 165, 0.18)', color: 'var(--gold)' }}>
                          🔒 Password Protected {unlockedStore.has(c.id) ? '(Unlocked)' : '(Locked)'}
                        </span>
                      ) : (
                        <span className="badge" style={{ opacity: 0.6 }}>
                          🔓 Open
                        </span>
                      )}
                    </div>
                    <div className="muted small">{c.imageCount} image{c.imageCount === 1 ? '' : 's'}</div>
                  </div>

                  <div className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                    {/* Open & View Photos Button */}
                    <button
                      type="button"
                      className="btn primary"
                      style={{ padding: '6px 14px', fontSize: '0.88rem' }}
                      onClick={() => handleOpenCategory(c)}
                      title="Enter password (if protected) and view photos in this folder"
                    >
                      {c.hasPin && !unlockedStore.has(c.id) ? '🔒 Unlock & View' : '👁️ View Photos'}
                    </button>

                    <Link
                      to={`/upload?category=${c.id}&mode=manual`}
                      className="btn ghost"
                      title="Add photos directly to this folder without AI"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      📁 Add photos
                    </Link>

                    {c.hasPin ? (
                      <>
                        <button className="btn ghost" onClick={() => openPinModal(c, 'change')}>
                          🔑 Change Password
                        </button>
                        <button className="btn ghost danger" onClick={() => openPinModal(c, 'remove')}>
                          Remove Password
                        </button>
                      </>
                    ) : (
                      <button className="btn ghost" onClick={() => openPinModal(c, 'set')}>
                        🔒 Set Password
                      </button>
                    )}

                    <button className="btn ghost" onClick={() => setEdit({ id: c.id, name: c.name })}>Rename</button>
                    <button
                      className="btn ghost danger"
                      onClick={() => {
                        setDel(c);
                        setDelForm({ userPassword: '', categoryPassword: '' });
                      }}
                    >
                      Delete
                    </button>
                  </div>

                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Delete Category Modal - Requires Both Passwords */}
      <Modal open={!!del} onClose={() => setDel(null)} title={`Delete “${del?.name}”?`}>
        <form onSubmit={handleDeleteSubmit} style={{ display: 'grid', gap: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            Deleting this category will move its {del?.imageCount} image{del?.imageCount === 1 ? '' : 's'} to another folder automatically.
            Requires your <strong>Account Password</strong>{del?.hasPin ? <span> and the <strong>Category Password</strong></span> : ''}.
          </p>

          <label className="lbl" style={{ margin: 0 }}>
            Your User Account Password
            <input
              type="password"
              required
              autoFocus
              placeholder="Enter your account password"
              value={delForm.userPassword}
              onChange={(e) => setDelForm({ ...delForm, userPassword: e.target.value })}
            />
          </label>

          {del?.hasPin && (
            <label className="lbl" style={{ margin: 0 }}>
              Category Password (Folder PIN)
              <input
                type="password"
                required
                placeholder="Enter this folder's password"
                value={delForm.categoryPassword}
                onChange={(e) => setDelForm({ ...delForm, categoryPassword: e.target.value })}
              />
            </label>
          )}

          <div className="row end" style={{ marginTop: '8px' }}>
            <button type="button" className="btn ghost" onClick={() => setDel(null)} disabled={delSubmitting}>
              Keep category
            </button>
            <button type="submit" className="btn danger" disabled={delSubmitting}>
              {delSubmitting ? 'Verifying & Deleting…' : 'Verify Passwords & Delete'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Category Password Unlock Modal (To view/open photos) */}
      <Modal open={!!unlockModal} onClose={() => setUnlockModal(null)} title={`Unlock “${unlockModal?.name}”`}>
        <form onSubmit={handleUnlockSubmit} style={{ display: 'grid', gap: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            This folder is password protected. Enter the folder password to unlock and view its photos.
          </p>
          <label className="lbl" style={{ margin: 0 }}>
            Folder Password
            <input
              type="password"
              autoFocus
              required
              placeholder="Enter folder password"
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value)}
            />
          </label>
          <div className="row end">
            <button type="button" className="btn ghost" onClick={() => setUnlockModal(null)} disabled={unlockSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={unlockSubmitting || !unlockPin}>
              {unlockSubmitting ? 'Unlocking…' : 'Unlock & View Photos'}
            </button>
          </div>
        </form>
      </Modal>

      {/* PIN / Password Setting Modal */}
      <Modal
        open={!!pinModal}
        onClose={() => setPinModal(null)}
        title={
          pinModal?.mode === 'set'
            ? `Set Password for “${pinModal?.name}”`
            : pinModal?.mode === 'change'
            ? `Change Password for “${pinModal?.name}”`
            : `Remove Password from “${pinModal?.name}”`
        }
      >
        <form onSubmit={handlePinSubmit} style={{ display: 'grid', gap: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            {pinModal?.mode === 'remove'
              ? 'Enter the current password to unlock this folder and remove password protection.'
              : 'Setting a password keeps its photos private. Anyone opening this folder must enter the password to view its photos.'}
          </p>

          {pinModal?.mode !== 'set' && (
            <label className="lbl" style={{ margin: 0 }}>
              Current Password
              <input
                type="password"
                required
                autoFocus
                placeholder="Enter current password"
                value={pinForm.currentPin}
                onChange={(e) => setPinForm({ ...pinForm, currentPin: e.target.value })}
              />
            </label>
          )}

          {pinModal?.mode !== 'remove' && (
            <>
              <label className="lbl" style={{ margin: 0 }}>
                {pinModal?.mode === 'change' ? 'New Password' : 'Folder Password / PIN'}
                <input
                  type="password"
                  required
                  autoFocus={pinModal?.mode === 'set'}
                  minLength={4}
                  maxLength={32}
                  placeholder="At least 4 characters"
                  value={pinForm.pin}
                  onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value })}
                />
              </label>
              <label className="lbl" style={{ margin: 0 }}>
                Confirm Password
                <input
                  type="password"
                  required
                  minLength={4}
                  maxLength={32}
                  placeholder="Re-enter password"
                  value={pinForm.confirmPin}
                  onChange={(e) => setPinForm({ ...pinForm, confirmPin: e.target.value })}
                />
              </label>
            </>
          )}

          <div className="row end" style={{ marginTop: '8px' }}>
            <button type="button" className="btn ghost" onClick={() => setPinModal(null)} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={pinModal?.mode === 'remove' ? 'btn danger' : 'btn primary'}
              disabled={submitting}
            >
              {submitting
                ? 'Saving…'
                : pinModal?.mode === 'set'
                ? 'Save Password'
                : pinModal?.mode === 'change'
                ? 'Update Password'
                : 'Remove Password'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
