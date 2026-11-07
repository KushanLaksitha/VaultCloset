import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { fileService } from '../services/fileService.js';
import { categoryService } from '../services/categoryService.js';
import { unlockedStore, fmtBytes, ago } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';
import Modal from '../components/Modal.jsx';
import CategoryUnlockModal from '../components/CategoryUnlockModal.jsx';

const VIDEO_ACCEPT = 'video/*,.mp4,.webm,.mov,.mkv,.avi,.3gp,.m4v';
const DOC_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z';

function getFileIcon(filename, type) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (type === 'video' || ['mp4', 'webm', 'mov', 'mkv', 'avi', '3gp', 'm4v'].includes(ext)) {
    return '🎬';
  }
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
  if (['txt', 'md', 'json'].includes(ext)) return '📝';
  return '📄';
}

export default function Files() {
  const { toast } = useApp();
  const [searchParams] = useSearchParams();

  // Categories separated by target type
  const [videoCategories, setVideoCategories] = useState([]);
  const [docCategories, setDocCategories] = useState([]);

  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [f, setF] = useState({
    q: '',
    category: searchParams.get('category') || '',
    type: searchParams.get('type') || '', // '' | 'video' | 'document'
    favorite: false,
    sort: 'newest',
  });

  // Upload drawer state
  const [uploadOpen, setUploadOpen] = useState(searchParams.get('upload') === '1');
  const [uploadType, setUploadType] = useState(searchParams.get('type') === 'document' ? 'document' : 'video'); // 'video' | 'document'
  const [selectedCatId, setSelectedCatId] = useState(searchParams.get('category') || '');
  const [queue, setQueue] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef(null);

  // Stealth PIN unlock modal
  const [pinModal, setPinModal] = useState(null); // { catId, catName, masked }
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);

  // Video viewer modal
  const [playingVideo, setPlayingVideo] = useState(null); // { id, name, url }

  // Delete modal
  const [delTarget, setDelTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Sync with unlockedStore
  const [, setUnlockedVer] = useState(0);
  useEffect(() => {
    const onUnlockedChange = () => setUnlockedVer((v) => v + 1);
    window.addEventListener('vc:unlocked-change', onUnlockedChange);
    return () => window.removeEventListener('vc:unlocked-change', onUnlockedChange);
  }, []);

  // Memoized all file categories
  const allFileCategories = useMemo(
    () => [...videoCategories, ...docCategories],
    [videoCategories, docCategories]
  );
  const categoriesRef = useRef(allFileCategories);
  categoriesRef.current = allFileCategories;

  // Load video and document categories once on mount
  const loadCategories = useCallback(() => {
    Promise.all([categoryService.list('video'), categoryService.list('document')])
      .then(([vRes, dRes]) => {
        const vCats = vRes.categories || [];
        const dCats = dRes.categories || [];
        setVideoCategories(vCats);
        setDocCategories(dCats);

        setSelectedCatId((curr) => {
          if (curr) return curr;
          const list = uploadType === 'video' ? vCats : dCats;
          return list[0] ? String(list[0].id) : '';
        });
      })
      .catch(() => {});
  }, [uploadType]);

  useEffect(() => {
    loadCategories();
  }, []); // Only once on mount!

  // When uploadType toggles, set selectedCatId to first category of that type
  const handleUploadTypeChange = (nextType) => {
    setUploadType(nextType);
    const list = nextType === 'video' ? videoCategories : docCategories;
    if (list.length) setSelectedCatId(String(list[0].id));
  };

  // Load files - strictly depends on filter `f`
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fileService.list(f);
      setFiles(res.files || []);
      setTotal(res.total || 0);
    } catch (err) {
      if (err.code === 'LOCKED_CATEGORY' && f.category) {
        const cat = categoriesRef.current.find((c) => String(c.id) === String(f.category));
        setPinModal({ catId: f.category, catName: cat?.name || 'Folder', masked: !!cat?.masked });
      } else {
        toast(err.message || 'Failed to load files', 'err');
      }
    } finally {
      setLoading(false);
    }
  }, [f, toast]);

  useEffect(() => {
    const timer = setTimeout(loadFiles, 150);
    return () => clearTimeout(timer);
  }, [loadFiles]);

  // Handle category filter change with PIN check
  const handleCategoryFilterChange = (catIdStr) => {
    if (!catIdStr) {
      setF((prev) => ({ ...prev, category: '' }));
      return;
    }
    const cat = allFileCategories.find((c) => String(c.id) === String(catIdStr));
    if ((cat?.masked || cat?.hasPin) && !unlockedStore.has(cat.id)) {
      setPinModal({ catId: cat.id, catName: cat.name, masked: !!cat.masked });
      return;
    }
    setF((prev) => ({ ...prev, category: catIdStr }));
  };

  // Handle PIN unlock
  const handlePinUnlock = async (e) => {
    e.preventDefault();
    if (!pinModal || !pinInput) return;
    setPinVerifying(true);
    try {
      const res = await categoryService.verifyPin(pinModal.catId, pinInput);
      unlockedStore.add(pinModal.catId, res.name || null, res.imageCount ?? null);
      const label = res.name || pinModal.catName || 'Folder';
      toast(`“${label}” unlocked`);
      const targetCatId = String(pinModal.catId);
      setPinModal(null);
      setPinInput('');
      setF((prev) => ({ ...prev, category: targetCatId }));
      loadCategories();
    } catch (err) {
      toast(err.message || 'Incorrect password', 'err');
    } finally {
      setPinVerifying(false);
    }
  };

  // Upload queue handlers
  const addFilesToQueue = (fileList) => {
    const newItems = Array.from(fileList).map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      name: file.name,
      size: file.size,
      status: 'ready',
      message: '',
    }));
    setQueue((prev) => [...prev, ...newItems]);
  };

  const removeQueueItem = (id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  // Perform upload
  const handleStartUpload = async () => {
    if (!selectedCatId) {
      toast('Please choose a destination folder', 'err');
      return;
    }

    const selectedCat = allFileCategories.find((c) => String(c.id) === String(selectedCatId));
    if ((selectedCat?.masked || selectedCat?.hasPin) && !unlockedStore.has(selectedCat.id)) {
      setPinModal({ catId: selectedCat.id, catName: selectedCat.name, masked: !!selectedCat.masked });
      return;
    }

    const pending = queue.filter((i) => i.status === 'ready');
    if (!pending.length) {
      toast('Please select files to upload', 'err');
      return;
    }

    setUploading(true);

    for (const item of pending) {
      setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'uploading' } : x)));
      try {
        const res = await fileService.upload(item.file, selectedCatId);
        const result = res.results?.[0];
        if (result?.status === 'duplicate') {
          setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'duplicate', message: result.message } : x)));
        } else if (result?.status === 'saved') {
          setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'saved', message: 'Saved to vault' } : x)));
        } else {
          setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'failed', message: result?.message || 'Failed' } : x)));
        }
      } catch (err) {
        setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'failed', message: err.message } : x)));
      }
    }

    setUploading(false);
    toast('Upload process completed');
    loadFiles();
  };

  // Play video in modal
  const handlePlayVideo = (file) => {
    const streamUrl = `/api/files/stream/${file.viewToken}`;
    setPlayingVideo({
      id: file.id,
      name: file.name,
      url: streamUrl,
    });
  };

  // Toggle favorite
  const handleToggleFavorite = async (file) => {
    try {
      const res = await fileService.favorite(file.id);
      setFiles((list) => list.map((item) => (item.id === file.id ? { ...item, isFavorite: res.isFavorite } : item)));
    } catch (err) {
      toast(err.message || 'Could not update favorite', 'err');
    }
  };

  // Delete file
  const handleDeleteConfirm = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await fileService.remove(delTarget.id);
      toast(`“${delTarget.name}” deleted & shredded`);
      setDelTarget(null);
      loadFiles();
    } catch (err) {
      toast(err.message || 'Delete failed', 'err');
    } finally {
      setDeleting(false);
    }
  };

  const uploadCategoriesList = uploadType === 'video' ? videoCategories : docCategories;
  const selectedCategoryObj = uploadCategoriesList.find((c) => String(c.id) === String(selectedCatId));
  const isSelectedCatLocked = (selectedCategoryObj?.masked || selectedCategoryObj?.hasPin) && !unlockedStore.has(selectedCategoryObj.id);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            Files Vault <span className="muted small">{total} files</span>
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Separate folders for videos and documents. Zero AI scans. Encrypted with AES-256.
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setUploadOpen(!uploadOpen)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {uploadOpen ? '✕ Close Upload' : '+ Upload Videos / Docs'}
        </button>
      </header>

      {/* Upload Section / Drawer */}
      <AnimatePresence>
        {uploadOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: '22px' }}
          >
            <div className="glass pad" style={{ borderLeft: uploadType === 'video' ? '4px solid var(--rose)' : '4px solid #6bbde3' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <b style={{ fontSize: '1.05rem', color: uploadType === 'video' ? 'var(--rose)' : '#6bbde3' }}>
                    📁 Direct File Upload (No AI Scan)
                  </b>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    {uploadType === 'video'
                      ? 'Videos are saved directly into your selected Video Folder.'
                      : 'Documents are saved directly into your selected Document Folder.'}
                  </p>
                </div>

                {/* Upload Destination Type Selector: Video vs Document */}
                <div className="row" style={{ gap: '12px', flexWrap: 'wrap' }}>
                  <div className="seg">
                    <button
                      type="button"
                      className={uploadType === 'video' ? 'on' : ''}
                      onClick={() => handleUploadTypeChange('video')}
                    >
                      🎬 Video Folder
                    </button>
                    <button
                      type="button"
                      className={uploadType === 'document' ? 'on' : ''}
                      onClick={() => handleUploadTypeChange('document')}
                    >
                      📄 Document Folder
                    </button>
                  </div>

                  {/* Category Dropdown (Filtered strictly by uploadType!) */}
                  <div className="row" style={{ gap: '6px' }}>
                    <select
                      value={selectedCatId}
                      onChange={(e) => setSelectedCatId(e.target.value)}
                      style={{ padding: '8px 12px', minWidth: '180px' }}
                    >
                      {uploadCategoriesList.map((c) => {
                        const rev = unlockedStore.getName(c.id);
                        const label = c.masked && !rev ? '🔒 Hidden' : (c.hasPin ? '🔒 ' : '') + (rev?.name || c.name);
                        return (
                          <option key={c.id} value={c.id}>
                            {label}
                          </option>
                        );
                      })}
                    </select>

                    {selectedCategoryObj?.hasPin && (
                      <span
                        className="badge"
                        style={{
                          background: isSelectedCatLocked ? 'rgba(239, 122, 122, 0.2)' : 'rgba(143, 211, 176, 0.2)',
                          color: isSelectedCatLocked ? 'var(--danger)' : 'var(--ok)',
                        }}
                      >
                        {isSelectedCatLocked ? '🔒 Locked' : '🔓 Unlocked'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Drag and Drop Box */}
              <div
                className={'drop glass' + (drag ? ' over' : '')}
                style={{ padding: '34px 16px', margin: '14px 0' }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  if (e.dataTransfer.files?.length) {
                    addFilesToQueue(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={uploadType === 'video' ? VIDEO_ACCEPT : DOC_ACCEPT}
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      addFilesToQueue(e.target.files);
                      e.target.value = '';
                    }
                  }}
                />
                <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>
                  {uploadType === 'video' ? '🎬' : '📄'}
                </div>
                <h3 style={{ margin: '0 0 6px' }}>
                  Click to select {uploadType === 'video' ? 'videos' : 'documents'} or drag &amp; drop
                </h3>
                <p className="muted small" style={{ margin: 0 }}>
                  {uploadType === 'video'
                    ? 'MP4, WEBM, MOV, MKV, AVI, 3GP (up to 500 MB)'
                    : 'PDF, DOCX, XLSX, PPTX, TXT, CSV, ZIP, RAR, 7Z (up to 500 MB)'}
                </p>
              </div>

              {/* Queue List */}
              {queue.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span className="small muted">
                      {queue.length} file{queue.length === 1 ? '' : 's'} queued
                    </span>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setQueue([])}
                      disabled={uploading}
                    >
                      Clear queue
                    </button>
                  </div>

                  <div style={{ display: 'grid', gap: '8px', maxHeight: '240px', overflowY: 'auto', marginBottom: '14px' }}>
                    {queue.map((item) => (
                      <div
                        key={item.id}
                        className="glass"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 12px',
                          borderRadius: '10px',
                        }}
                      >
                        <span style={{ fontSize: '1.4rem' }}>{getFileIcon(item.name, uploadType)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </div>
                          <div className="muted small">
                            {fmtBytes(item.size)} {item.message && `· ${item.message}`}
                          </div>
                        </div>

                        <div>
                          {item.status === 'ready' && <span className="badge">Ready</span>}
                          {item.status === 'uploading' && <span className="badge analyzing">Encrypting…</span>}
                          {item.status === 'saved' && <span className="badge approved">Saved</span>}
                          {item.status === 'duplicate' && <span className="badge duplicate">Duplicate</span>}
                          {item.status === 'failed' && <span className="badge failed">Failed</span>}
                        </div>

                        {!uploading && (
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => removeQueueItem(item.id)}
                            style={{ padding: '2px 8px', color: 'var(--muted)' }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="row end">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={uploading || !queue.some((i) => i.status === 'ready')}
                      onClick={handleStartUpload}
                    >
                      {uploading ? 'Encrypting & Uploading…' : 'Save & Encrypt into Vault'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Toolbar */}
      <div className="filters glass pad">
        <input
          placeholder="Search by file name…"
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
        />

        {/* Type Segments: All | Videos | Documents */}
        <div className="seg">
          <button
            type="button"
            className={f.type === '' ? 'on' : ''}
            onClick={() => setF({ ...f, type: '', category: '' })}
          >
            All Files
          </button>
          <button
            type="button"
            className={f.type === 'video' ? 'on' : ''}
            onClick={() => setF({ ...f, type: 'video', category: '' })}
          >
            🎬 Videos
          </button>
          <button
            type="button"
            className={f.type === 'document' ? 'on' : ''}
            onClick={() => setF({ ...f, type: 'document', category: '' })}
          >
            📄 Documents
          </button>
        </div>

        {/* Category Filter — strictly separated by type! */}
        <select value={f.category} onChange={(e) => handleCategoryFilterChange(e.target.value)}>
          <option value="">All folders</option>

          {/* If video filter active: show only video categories */}
          {f.type === 'video' && (
            videoCategories.map((c) => {
              const revName = unlockedStore.getName(c.id);
              const displayLabel = c.masked && !revName
                ? '🔒 Hidden'
                : (c.hasPin ? (unlockedStore.has(c.id) ? '🔓 ' : '🔒 ') : '') + (revName?.name || c.name);
              return (
                <option key={c.id} value={c.id}>
                  {displayLabel}
                </option>
              );
            })
          )}

          {/* If document filter active: show only document categories */}
          {f.type === 'document' && (
            docCategories.map((c) => {
              const revName = unlockedStore.getName(c.id);
              const displayLabel = c.masked && !revName
                ? '🔒 Hidden'
                : (c.hasPin ? (unlockedStore.has(c.id) ? '🔓 ' : '🔒 ') : '') + (revName?.name || c.name);
              return (
                <option key={c.id} value={c.id}>
                  {displayLabel}
                </option>
              );
            })
          )}

          {/* If all files: show video folders and document folders grouped cleanly */}
          {f.type === '' && (
            <>
              {videoCategories.length > 0 && (
                <optgroup label="🎬 Video Folders">
                  {videoCategories.map((c) => {
                    const revName = unlockedStore.getName(c.id);
                    const displayLabel = c.masked && !revName
                      ? '🔒 Hidden'
                      : (c.hasPin ? (unlockedStore.has(c.id) ? '🔓 ' : '🔒 ') : '') + (revName?.name || c.name);
                    return (
                      <option key={c.id} value={c.id}>
                        {displayLabel}
                      </option>
                    );
                  })}
                </optgroup>
              )}

              {docCategories.length > 0 && (
                <optgroup label="📄 Document Folders">
                  {docCategories.map((c) => {
                    const revName = unlockedStore.getName(c.id);
                    const displayLabel = c.masked && !revName
                      ? '🔒 Hidden'
                      : (c.hasPin ? (unlockedStore.has(c.id) ? '🔓 ' : '🔒 ') : '') + (revName?.name || c.name);
                    return (
                      <option key={c.id} value={c.id}>
                        {displayLabel}
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </>
          )}
        </select>

        {/* Sort */}
        <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>

        {/* Favorites */}
        <button
          type="button"
          className={'btn ' + (f.favorite ? 'primary' : 'ghost')}
          onClick={() => setF({ ...f, favorite: !f.favorite })}
        >
          Favorites
        </button>
      </div>

      {/* Files Display */}
      {loading && files.length === 0 ? (
        <div className="center pad">
          <span className="spinner" />
          <p className="muted small">Loading vault files…</p>
        </div>
      ) : files.length === 0 ? (
        <div className="empty glass pad">
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>
            {f.type === 'video' ? '🎬' : f.type === 'document' ? '📄' : '📂'}
          </div>
          <h3>No {f.type === 'video' ? 'videos' : f.type === 'document' ? 'documents' : 'files'} found</h3>
          <p className="muted small" style={{ maxWidth: '400px', margin: '0 auto 16px' }}>
            {f.q || f.category || f.favorite
              ? 'No files match your current filter settings.'
              : 'This section is currently empty. Upload files safely into your dedicated folders without AI scans.'}
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => setUploadOpen(true)}
          >
            + Upload Files Now
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
            gap: '14px',
            opacity: loading ? 0.7 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          <AnimatePresence>
            {files.map((file) => {
              const icon = getFileIcon(file.name, file.fileType);
              const isVideo = file.fileType === 'video';

              return (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass pad"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative',
                    gap: '12px',
                  }}
                >
                  {/* Top Bar with Icon, Name, Category */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '12px',
                        background: isVideo ? 'rgba(217, 138, 155, 0.16)' : 'rgba(107, 189, 227, 0.16)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '1.6rem',
                        flex: 'none',
                      }}
                    >
                      {icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b
                        style={{
                          fontSize: '0.94rem',
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginBottom: '3px',
                        }}
                        title={file.name}
                      >
                        {file.name}
                      </b>
                      <div className="row" style={{ gap: '6px' }}>
                        <span className="badge" style={{ fontSize: '0.7rem' }}>
                          📁 {file.categoryName || 'Folder'}
                        </span>
                        <span className="muted small">{fmtBytes(file.size)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={'fav' + (file.isFavorite ? ' on' : '')}
                      onClick={() => handleToggleFavorite(file)}
                      style={{ position: 'static', width: '30px', height: '30px', opacity: 1 }}
                      title="Toggle Favorite"
                    >
                      {file.isFavorite ? '❤️' : '🤍'}
                    </button>
                  </div>

                  {/* Date and Action Buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="muted small">{ago(file.createdAt)}</span>

                    <div className="row" style={{ gap: '6px' }}>
                      {isVideo && (
                        <button
                          type="button"
                          className="btn primary sm"
                          onClick={() => handlePlayVideo(file)}
                          style={{ padding: '5px 10px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          ▶ Watch
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn ghost danger sm"
                        onClick={() => setDelTarget(file)}
                        style={{ padding: '5px 8px', fontSize: '0.82rem' }}
                        title="Delete permanently"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Video Streaming Modal */}
      <Modal
        open={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        title={playingVideo ? `🎬 ${playingVideo.name}` : ''}
        wide
      >
        {playingVideo && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <div
              style={{
                background: '#000',
                borderRadius: '12px',
                overflow: 'hidden',
                aspectRatio: '16/9',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <video
                src={playingVideo.url}
                controls
                controlsList="nodownload"
                onContextMenu={(e) => e.preventDefault()}
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', maxHeight: '65vh', objectFit: 'contain' }}
              />
            </div>
            <div className="row" style={{ justifyContent: 'center', alignItems: 'center' }}>
              <span className="muted small">🔒 Streamed directly from zero-knowledge encrypted vault (Download disabled for privacy)</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Stealth / Mobile Unlock Modal for Category PIN */}
      <CategoryUnlockModal
        open={!!pinModal}
        onClose={() => setPinModal(null)}
        categoryId={pinModal?.catId}
        targetType={f.type === 'video' ? 'Video Folder' : 'Document Folder'}
        onUnlocked={(res) => {
          const label = res.name || pinModal?.catName || 'Folder';
          toast(`“${label}” unlocked`);
          const targetCatId = String(res.categoryId || pinModal?.catId);
          setPinModal(null);
          setF((prev) => ({ ...prev, category: targetCatId }));
          loadCategories();
        }}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        title={`Delete “${delTarget?.name}”?`}
      >
        <div style={{ display: 'grid', gap: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            This file will be shredded using DoD 5220.22-M multi-pass cryptographic overwrite and permanently deleted from the vault.
            This action cannot be undone.
          </p>
          <div className="row end">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setDelTarget(null)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? 'Shredding & Deleting…' : 'Shred & Permanently Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
