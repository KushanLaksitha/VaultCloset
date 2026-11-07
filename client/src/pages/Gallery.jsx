import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { imageService } from '../services/imageService.js';
import { categoryService } from '../services/categoryService.js';
import { unlockedStore } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';
import SecureImage from '../components/SecureImage.jsx';
import SecureImageViewer from '../components/SecureImageViewer.jsx';
import Modal from '../components/Modal.jsx';
import CategoryUnlockModal from '../components/CategoryUnlockModal.jsx';

const EMPTY = { q: '', category: '', favorite: false, approval: '', catSource: '', aiClass: '', from: '', to: '', sort: 'newest' };

export default function Gallery() {
  const { user, toast } = useApp();
  const [cats, setCats] = useState([]);
  const [f, setF] = useState(EMPTY);
  const [more, setMore] = useState(false);
  const [view, setView] = useState('grid'); // grid | compact | large
  const [data, setData] = useState({ images: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(new Set());
  const [open, setOpen] = useState(-1);
  const [moveOpen, setMoveOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [target, setTarget] = useState('');

  // Password Unlock Modal State
  const [lockModal, setLockModal] = useState(null); // { catId, catName }
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [, setUnlockedVer] = useState(0);

  // Sync with unlockedStore events
  useEffect(() => {
    const onUnlockedChange = () => setUnlockedVer((v) => v + 1);
    window.addEventListener('vc:unlocked-change', onUnlockedChange);
    return () => window.removeEventListener('vc:unlocked-change', onUnlockedChange);
  }, []);

  const load = useCallback(async (p, replace) => {
    setLoading(true);
    try {
      const r = await imageService.list({ ...f, page: p });
      setData((d) => ({ images: replace ? r.images : [...d.images, ...r.images], total: r.total }));
      setPage(p);
    } catch (e) {
      if (e.code === 'LOCKED_CATEGORY' && f.category) {
        const cat = cats.find((c) => String(c.id) === String(f.category));
        setLockModal({ catId: f.category, catName: cat?.name || 'Folder' });
      } else {
        toast(e.message, 'err');
      }
    } finally {
      setLoading(false);
    }
  }, [f, cats, toast]);

  useEffect(() => {
    categoryService.list('image').then((r) => setCats(r.categories)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(1, true), 250);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = (id) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const ids = [...sel];
  const act = async (fn, msg) => {
    try {
      await fn();
      toast(msg);
      setSel(new Set());
      setMoveOpen(false);
      setDelOpen(false);
      load(1, true);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const patchImg = (id, p) =>
    setData((d) => ({ ...d, images: d.images.map((i) => (i.id === id ? { ...i, ...p } : i)) }));

  const selecting = sel.size > 0;
  const cur = data.images[open];

  // Category filter selection handler with PIN check
  const handleCategoryChange = (catIdStr) => {
    if (!catIdStr) {
      setF({ ...f, category: '' });
      return;
    }
    const cat = cats.find((c) => String(c.id) === String(catIdStr));
    // Masked (stealth) or PIN-protected categories that aren't unlocked yet
    if ((cat?.masked || cat?.hasPin) && !unlockedStore.has(cat.id)) {
      // For masked categories the name must not be revealed here — show generic modal
      setLockModal({ catId: cat.id, catName: null, masked: !!cat.masked });
      return;
    }
    setF({ ...f, category: catIdStr });
  };

  const handleUnlockSubmit = async (e) => {
    e.preventDefault();
    if (!lockModal || !pinInput) return;
    setPinVerifying(true);
    try {
      await categoryService.verifyPin(lockModal.catId, pinInput);
      unlockedStore.add(lockModal.catId);
      toast(`“${lockModal.catName}” unlocked`);
      const targetCatId = String(lockModal.catId);
      setLockModal(null);
      setPinInput('');
      setF((prev) => ({ ...prev, category: targetCatId }));
    } catch (err) {
      toast(err.message || 'Incorrect password', 'err');
    } finally {
      setPinVerifying(false);
    }
  };

  const activeCategory = cats.find((c) => String(c.id) === String(f.category));
  const isActiveCatUnlocked = activeCategory?.hasPin && unlockedStore.has(activeCategory.id);

  const lockActiveCategory = () => {
    if (!activeCategory) return;
    unlockedStore.remove(activeCategory.id);
    toast(`“${activeCategory.name}” locked`);
    setF({ ...f, category: '' });
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            Gallery <span className="muted small">{data.total} images</span>
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Zero-knowledge encrypted client-side storage.
          </p>
        </div>
        <div className="seg">
          {['grid', 'compact', 'large'].map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'grid' ? 'Grid' : v === 'compact' ? 'Compact' : 'Large'}
            </button>
          ))}
        </div>
      </header>

      <div className="filters glass pad">
        <input
          placeholder="Search by file name"
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
        />

        <div className="row" style={{ gap: '6px' }}>
          <select value={f.category} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">All folders</option>
            {cats.map((c) => {
              const revName = unlockedStore.getName(c.id);
              const displayLabel = c.masked && !revName ? '🔒 Hidden' : ((c.hasPin ? (unlockedStore.has(c.id) ? '🔓 ' : '🔒 ') : '') + (revName || c.name));
              return <option key={c.id} value={c.id}>{displayLabel}</option>;
            })}
          </select>

          {isActiveCatUnlocked && (
            <button
              type="button"
              className="btn ghost"
              onClick={lockActiveCategory}
              title="Lock this folder again"
              style={{ fontSize: '0.82rem', padding: '6px 10px', color: 'var(--rose)' }}
            >
              🔒 Lock Folder
            </button>
          )}
        </div>

        <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
        </select>
        <button
          className={'btn ' + (f.favorite ? 'primary' : 'ghost')}
          onClick={() => setF({ ...f, favorite: !f.favorite })}
        >
          Favorites
        </button>
        <button className="btn ghost" onClick={() => setMore(!more)}>
          {more ? 'Fewer filters' : 'More filters'}
        </button>

        {more && (
          <>
            <select value={f.approval} onChange={(e) => setF({ ...f, approval: e.target.value })}>
              <option value="">Any approval</option>
              <option value="ai">AI-approved</option>
              <option value="manual">Manually approved</option>
            </select>
            <select value={f.catSource} onChange={(e) => setF({ ...f, catSource: e.target.value })}>
              <option value="">Any categorization</option>
              <option value="ai">AI-categorized</option>
              <option value="manual">Manually categorized</option>
            </select>
            <select value={f.aiClass} onChange={(e) => setF({ ...f, aiClass: e.target.value })}>
              <option value="">Any AI class</option>
              {cats
                .filter((c) => c.isDefault)
                .map((c) => (
                  <option key={c.id}>{c.name}</option>
                ))}
            </select>
            <input
              type="date"
              value={f.from}
              onChange={(e) => setF({ ...f, from: e.target.value })}
              aria-label="From date"
            />
            <input
              type="date"
              value={f.to}
              onChange={(e) => setF({ ...f, to: e.target.value })}
              aria-label="To date"
            />
            <button className="btn ghost" onClick={() => setF(EMPTY)}>
              Reset
            </button>
          </>
        )}
      </div>

      {!loading && data.images.length === 0 && (
        <p className="empty muted">
          No images match. Try clearing filters or add some images with the button above.
        </p>
      )}

      <div className={'gallery ' + view}>
        {data.images.map((im, idx) => (
          <motion.figure
            key={im.id}
            className={'gcard' + (sel.has(im.id) ? ' picked' : '')}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.985 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div
              onClick={() => (selecting ? toggle(im.id) : setOpen(idx))}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && (selecting ? toggle(im.id) : setOpen(idx))}
            >
              <SecureImage token={im.thumbToken} alt={im.name} />
            </div>
            <input
              type="checkbox"
              className="chk"
              checked={sel.has(im.id)}
              onChange={() => toggle(im.id)}
              aria-label={`Select ${im.name}`}
            />
            <button
              className={'fav' + (im.isFavorite ? ' on' : '')}
              onClick={async () => {
                const r = await imageService.favorite(im.id);
                patchImg(im.id, { isFavorite: r.isFavorite });
              }}
              aria-label="Toggle favorite"
            >
              {im.isFavorite ? '♥' : '♡'}
            </button>
            <figcaption>
              <span className="badge">{im.categoryName}</span>
            </figcaption>
          </motion.figure>
        ))}
      </div>

      {data.images.length < data.total && (
        <div className="center">
          <button className="btn" disabled={loading} onClick={() => load(page + 1, false)}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      <AnimatePresence>
        {selecting && (
          <motion.div
            className="bulk glass"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
          >
            <b>{sel.size} selected</b>
            <button
              className="btn primary"
              onClick={() => {
                setTarget(cats[0]?.id);
                setMoveOpen(true);
              }}
            >
              Move to folder
            </button>
            <button
              className="btn"
              onClick={() => act(() => imageService.bulkFavorite(ids, true), 'Added to favorites')}
            >
              Favorite
            </button>
            <button
              className="btn"
              onClick={() => act(() => imageService.bulkFavorite(ids, false), 'Removed from favorites')}
            >
              Unfavorite
            </button>
            <button className="btn" onClick={() => setOpen(data.images.findIndex((i) => i.id === ids[0]))}>
              Details
            </button>
            <button className="btn danger" onClick={() => setDelOpen(true)}>
              Delete
            </button>
            <button className="btn ghost" onClick={() => setSel(new Set(data.images.map((i) => i.id)))}>
              Select all shown
            </button>
            <button className="btn ghost" onClick={() => setSel(new Set())}>
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={`Move ${sel.size} images`}>
        <label className="lbl">
          Folder
          <select value={target} onChange={(e) => setTarget(+e.target.value)}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.hasPin ? '🔒 ' : ''}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row end">
          <button className="btn ghost" onClick={() => setMoveOpen(false)}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => act(() => imageService.bulkMove(ids, +target), 'Images moved')}
          >
            Move images
          </button>
        </div>
      </Modal>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title={`Delete ${sel.size} images?`}>
        <p className="muted">The encrypted files are permanently removed from your storage. This can’t be undone.</p>
        <div className="row end">
          <button className="btn ghost" onClick={() => setDelOpen(false)}>
            Keep images
          </button>
          <button className="btn danger" onClick={() => act(() => imageService.bulkDelete(ids), 'Images deleted')}>
            Delete images
          </button>
        </div>
      </Modal>

      {/* Password / Mobile Unlock Modal for Protected Folders */}
      <CategoryUnlockModal
        open={!!lockModal}
        onClose={() => setLockModal(null)}
        categoryId={lockModal?.catId}
        targetType="Photo Category"
        onUnlocked={(res) => {
          toast(`“${res.name || 'Folder'}” unlocked`);
          const targetCatId = String(res.categoryId || lockModal?.catId);
          setLockModal(null);
          setF((prev) => ({ ...prev, category: targetCatId }));
        }}
      />

      <AnimatePresence>
        {cur && (
          <SecureImageViewer
            image={cur}
            categories={cats}
            onClose={() => setOpen(-1)}
            onPrev={open > 0 ? () => setOpen(open - 1) : null}
            onNext={open < data.images.length - 1 ? () => setOpen(open + 1) : null}
            onFavorite={async (im) => {
              const r = await imageService.favorite(im.id);
              patchImg(im.id, { isFavorite: r.isFavorite });
            }}
            onCategory={async (im, cid) => {
              try {
                await imageService.setCategory(im.id, cid);
                patchImg(im.id, {
                  categoryId: cid,
                  categoryName: cats.find((c) => c.id === cid)?.name,
                  catSource: 'manual',
                });
                toast('Category updated');
              } catch (e) {
                toast(e.message, 'err');
              }
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
