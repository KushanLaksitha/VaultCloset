import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { categoryService } from '../services/categoryService.js';
import { unlockedStore } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';
import Modal from '../components/Modal.jsx';
import CategoryUnlockModal from '../components/CategoryUnlockModal.jsx';

export default function Categories() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('image'); // 'image' | 'video' | 'document'
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [delForm, setDelForm] = useState({ userPassword: '', categoryPassword: '' });
  const [delSubmitting, setDelSubmitting] = useState(false);
  const [pinModal, setPinModal] = useState(null); // { id, name, mode: 'set'|'change'|'remove' }
  const [pinForm, setPinForm] = useState({ currentPin: '', pin: '', confirmPin: '' });
  const [submitting, setSubmitting] = useState(false);

  // Category Unlock Modal (stealth: generic, no name shown until unlocked)
  const [unlockModal, setUnlockModal] = useState(null); // { id, masked: bool, targetType: string }
  const [unlockPin, setUnlockPin] = useState('');
  const [unlockSubmitting, setUnlockSubmitting] = useState(false);

  // Track revealed names/counts for masked categories within this session
  const [revealed, setRevealed] = useState(() => unlockedStore.getNames());

  // Sync revealed state when unlocked store changes (e.g. vault lock clears all)
  useEffect(() => {
    const onChanged = () => setRevealed(unlockedStore.getNames());
    window.addEventListener('vc:unlocked-change', onChanged);
    return () => window.removeEventListener('vc:unlocked-change', onChanged);
  }, []);

  const load = useCallback(() => {
    categoryService
      .list(activeTab)
      .then((r) => setList(r.categories || []))
      .catch((e) => toast(e.message, 'err'));
  }, [activeTab, toast]);

  useEffect(() => {
    load();
  }, [load]);

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

  // Get effective display name for a category card (uses revealed map for masked ones)
  const getDisplayName = (c) => {
    if (!c.masked) return c.name;
    const rev = revealed[c.id];
    return rev ? rev.name : null;
  };

  const getItemCount = (c) => {
    if (!c.masked) return c.imageCount;
    const rev = revealed[c.id];
    return rev != null ? rev.imageCount : null;
  };

  const isUnlocked = (c) => (c.masked ? unlockedStore.has(c.id) : true);

  const openPinModal = (cat, mode) => {
    setPinModal({ id: cat.id, name: getDisplayName(cat), mode });
    setPinForm({ currentPin: '', pin: '', confirmPin: '' });
  };

  // Open category contents (asks for password if locked/masked)
  const handleOpenCategory = (c) => {
    if ((c.masked || c.hasPin) && !unlockedStore.has(c.id)) {
      setUnlockModal({ id: c.id, masked: !!c.masked, targetType: c.targetType || activeTab });
      setUnlockPin('');
    } else {
      if (c.targetType === 'image' || activeTab === 'image') {
        navigate(`/gallery?category=${c.id}`);
      } else {
        navigate(`/files?category=${c.id}&type=${c.targetType || activeTab}`);
      }
    }
  };

  const handleUnlockSubmit = async (e) => {
    e.preventDefault();
    if (!unlockModal) return;
    setUnlockSubmitting(true);
    try {
      const res = await categoryService.verifyPin(unlockModal.id, unlockPin);
      // Store revealed name from server response
      unlockedStore.add(unlockModal.id, res.name || null, res.imageCount ?? null);
      setRevealed(unlockedStore.getNames());
      const revealedName = res.name || 'Folder';
      toast(`Folder "${revealedName}" unlocked`);
      const catId = unlockModal.id;
      const tType = unlockModal.targetType;
      setUnlockModal(null);
      setUnlockPin('');
      if (tType === 'image') {
        navigate(`/gallery?category=${catId}`);
      } else {
        navigate(`/files?category=${catId}&type=${tType}`);
      }
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
      const label = getDisplayName(del) || 'Hidden Category';
      toast(`Category "${label}" deleted`);
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
        toast(`Password ${pinModal.mode === 'set' ? 'set' : 'updated'}`);
      } else if (pinModal.mode === 'remove') {
        if (!pinForm.currentPin) {
          toast('Please enter the current password', 'err');
          setSubmitting(false);
          return;
        }
        await categoryService.removePin(pinModal.id, pinForm.currentPin);
        toast('Password removed');
      }
      setPinModal(null);
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const getItemUnit = () => (activeTab === 'image' ? 'photo' : activeTab === 'video' ? 'video' : 'document');

  const getPlaceholder = () => {
    if (activeTab === 'image') return 'New photo category, e.g. Travel, Work, Private';
    if (activeTab === 'video') return 'New video category, e.g. Movies, Clips, Personal';
    return 'New document category, e.g. Contracts, IDs, Finances';
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Categories &amp; Folders</h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Organize photos, videos, and documents into separate protected folders.
          </p>
        </div>
      </header>

      {/* Type Tabs: Photo | Video | Document */}
      <div className="seg" style={{ marginBottom: '18px', width: 'fit-content' }}>
        <button
          type="button"
          className={activeTab === 'image' ? 'on' : ''}
          onClick={() => setActiveTab('image')}
        >
          🖼️ Photo Categories
        </button>
        <button
          type="button"
          className={activeTab === 'video' ? 'on' : ''}
          onClick={() => setActiveTab('video')}
        >
          🎬 Video Categories
        </button>
        <button
          type="button"
          className={activeTab === 'document' ? 'on' : ''}
          onClick={() => setActiveTab('document')}
        >
          📄 Document Categories
        </button>
      </div>

      <form
        className="row glass pad"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => categoryService.create(name, activeTab), 'Category created')().then(() => setName(''));
        }}
      >
        <input
          placeholder={getPlaceholder()}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
        />
        <button className="btn primary">
          + Create {activeTab === 'image' ? 'Photo' : activeTab === 'video' ? 'Video' : 'Document'} category
        </button>
      </form>

      <div className="list">
        <AnimatePresence>
          {list.map((c) => {
            const displayName = getDisplayName(c);
            const count = getItemCount(c);
            const unlocked = isUnlocked(c);
            const isMaskedLocked = c.masked && !unlocked;
            const unit = getItemUnit();

            return (
              <motion.div
                key={c.id}
                layout
                className="glass pad crow"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -30 }}
              >
                {!isMaskedLocked && edit?.id === c.id ? (
                  <form
                    className="row grow"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => categoryService.rename(c.id, edit.name), 'Renamed')().then(() => setEdit(null));
                    }}
                  >
                    <input
                      autoFocus
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      maxLength={60}
                    />
                    <button className="btn primary">Save</button>
                    <button type="button" className="btn ghost" onClick={() => setEdit(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="grow" style={{ display: 'grid', gap: '4px' }}>
                      <div className="row" style={{ gap: '8px' }}>
                        {isMaskedLocked ? (
                          <b style={{ fontSize: '1.05rem', opacity: 0.55, fontStyle: 'italic' }}>
                            🔒 Hidden Category
                          </b>
                        ) : (
                          <b style={{ fontSize: '1.05rem' }}>{displayName}</b>
                        )}
                        {c.hasPin ? (
                          <span
                            className="badge"
                            style={{ background: 'rgba(232, 201, 165, 0.18)', color: 'var(--gold)' }}
                          >
                            🔒 Password Protected {unlocked ? '(Unlocked)' : '(Locked)'}
                          </span>
                        ) : (
                          <span className="badge" style={{ opacity: 0.6 }}>
                            🔓 Open
                          </span>
                        )}
                      </div>
                      <div className="muted small">
                        {isMaskedLocked
                          ? '— unlock to reveal details'
                          : `${count} ${unit}${count === 1 ? '' : 's'}`}
                      </div>
                    </div>

                    <div className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                      {/* Open & View Items Button */}
                      <button
                        type="button"
                        className="btn primary"
                        style={{ padding: '6px 14px', fontSize: '0.88rem' }}
                        onClick={() => handleOpenCategory(c)}
                        title={
                          isMaskedLocked
                            ? 'Enter password to reveal and view this folder'
                            : 'Enter password (if protected) and view contents in this folder'
                        }
                      >
                        {isMaskedLocked
                          ? '🔓 Reveal & View'
                          : c.hasPin && !unlocked
                            ? '🔒 Unlock & View'
                            : '👁️ View Contents'}
                      </button>

                      {!isMaskedLocked && (
                        activeTab === 'image' ? (
                          <Link
                            to={`/upload?category=${c.id}&mode=manual`}
                            className="btn ghost"
                            title="Add photos directly to this folder without AI"
                            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            📁 Add photos
                          </Link>
                        ) : (
                          <Link
                            to={`/files?category=${c.id}&type=${activeTab}`}
                            className="btn ghost"
                            title="Add files directly to this folder without AI"
                            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            📁 Add files
                          </Link>
                        )
                      )}

                      {/* PIN management — only show when category name is known (revealed) */}
                      {!isMaskedLocked && (
                        c.hasPin ? (
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
                        )
                      )}

                      {!isMaskedLocked && (
                        <button className="btn ghost" onClick={() => setEdit({ id: c.id, name: displayName })}>
                          Rename
                        </button>
                      )}

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
            );
          })}
        </AnimatePresence>
      </div>

      {/* Delete Category Modal - Requires Both Passwords */}
      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title={del && getDisplayName(del) ? `Delete "${getDisplayName(del)}"?` : 'Delete hidden category?'}
      >
        <form onSubmit={handleDeleteSubmit} style={{ display: 'grid', gap: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            {del && getDisplayName(del) ? (
              <>
                Deleting this category will move its {getItemCount(del)} item
                {getItemCount(del) === 1 ? '' : 's'} to another folder automatically.
              </>
            ) : (
              <>Deleting this hidden category will move its items to another folder automatically.</>
            )}{' '}
            Requires your <strong>Account Password</strong>
            {del?.hasPin ? (
              <span>
                {' '}
                and the <strong>Category Password</strong>
              </span>
            ) : (
              ''
            )}
            .
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

      {/* Stealth / Mobile Unlock Modal */}
      <CategoryUnlockModal
        open={!!unlockModal}
        onClose={() => setUnlockModal(null)}
        categoryId={unlockModal?.id}
        targetType={unlockModal?.targetType}
        onUnlocked={(res) => {
          setRevealed(unlockedStore.getNames());
          toast(`Folder "${res.name || 'Folder'}" unlocked`);
          const catId = unlockModal.id;
          const tType = unlockModal.targetType;
          setUnlockModal(null);
          if (tType === 'image') {
            navigate(`/gallery?category=${catId}`);
          } else {
            navigate(`/files?category=${catId}&type=${tType}`);
          }
        }}
      />

      {/* PIN / Password Setting Modal */}
      <Modal
        open={!!pinModal}
        onClose={() => setPinModal(null)}
        title={
          pinModal?.mode === 'set'
            ? `Set Password for "${pinModal?.name}"`
            : pinModal?.mode === 'change'
              ? `Change Password for "${pinModal?.name}"`
              : `Remove Password from "${pinModal?.name}"`
        }
      >
        <form onSubmit={handlePinSubmit} style={{ display: 'grid', gap: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            {pinModal?.mode === 'remove'
              ? 'Enter the current password to unlock this folder and remove password protection.'
              : 'Setting a password keeps its contents private. Anyone opening this folder must enter the password to view its contents.'}
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
