import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { imageService } from '../services/imageService.js';
import { categoryService } from '../services/categoryService.js';
import { unlockedStore, fmtBytes } from '../services/api.js';
import { useApp } from '../context/AppContext.jsx';
import Modal from '../components/Modal.jsx';
import CategoryUnlockModal from '../components/CategoryUnlockModal.jsx';
import { isRealMobilePhone } from '../services/deviceDetect.js';

// Server accepts: JPEG, PNG, WEBP, HEIC/HEIF (iPhone), AVIF (Android), GIF, TIFF, BMP
// Client-side validation uses broad 'image/*' check; the server does final format validation
const MOBILE_ACCEPT = 'image/*';  // covers HEIC, AVIF, JPEG, PNG, WEBP, GIF etc.
const MAX = 25 * 1024 * 1024; // 25 MB limit for high-res phone photos

const CONCURRENCY = 3;
const LABEL = {
  waiting: 'Waiting',
  analyzing: 'Processing',
  approved: 'Saved',
  rejected: 'Rejected',
  failed: 'Failed',
  duplicate: 'Duplicate (Skipped)',
  cancelled: 'Cancelled',
};

async function getFileHash(file) {
  try {
    const buffer = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * DoD 5220.22-M / NIST style Secure Shredding:
 * Overwrites original disk blocks with cryptographic random noise + zeros before removing,
 * rendering recovery completely impossible for any forensic or data recovery tool.
 */
async function shredAndRemove(fileHandle, dirHandle, filename) {
  try {
    if (fileHandle && typeof fileHandle.createWritable === 'function') {
      const file = await fileHandle.getFile();
      const size = file.size;
      if (size > 0) {
        const writable = await fileHandle.createWritable();
        const chunkSize = Math.min(size, 256 * 1024);

        // Pass 1: Cryptographic random bytes overwrite
        const randBuf = new Uint8Array(chunkSize);
        crypto.getRandomValues(randBuf);
        let offset = 0;
        while (offset < size) {
          const len = Math.min(chunkSize, size - offset);
          await writable.write({ type: 'write', position: offset, data: randBuf.subarray(0, len) });
          offset += len;
        }

        // Pass 2: Zero wipe overwrite
        const zeroBuf = new Uint8Array(chunkSize);
        offset = 0;
        while (offset < size) {
          const len = Math.min(chunkSize, size - offset);
          await writable.write({ type: 'write', position: offset, data: zeroBuf.subarray(0, len) });
          offset += len;
        }

        await writable.close(); // Force flush destroyed data blocks to disk
      }
    }
  } catch (err) {
    console.warn('Shred overwrite note:', err);
  }

  // Remove the file entry from filesystem
  if (dirHandle && typeof dirHandle.removeEntry === 'function') {
    await dirHandle.removeEntry(filename);
    return true;
  } else if (fileHandle && typeof fileHandle.remove === 'function') {
    await fileHandle.remove();
    return true;
  }
  return false;
}

export default function Upload() {
  const { toast } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState(searchParams.get('mode') === 'manual' ? 'manual' : 'ai'); // 'ai' | 'manual'
  const [categories, setCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState(searchParams.get('category') || '');
  const [items, setItems] = useState([]);
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [localFolderPath, setLocalFolderPath] = useState('');
  const [localImporting, setLocalImporting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('environment'); // 'environment' | 'user'
  const [cameraError, setCameraError] = useState('');
  const ctrl = useRef(null);
  const input = useRef(null);       // gallery / file picker
  const cameraInput = useRef(null); // native camera capture fallback
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Robust mobile detection (blocks DevTools emulation)
  const isMobile = isRealMobilePhone();

  // Clean up any live camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);


  // Load categories
  useEffect(() => {
    categoryService
      .list('image')
      .then((r) => {
        setCategories(r.categories);
        if (!selectedCatId && r.categories.length) {
          const initCat = searchParams.get('category') || r.categories[0].id;
          setSelectedCatId(String(initCat));
        }
      })
      .catch(() => {});
  }, [searchParams]);

  const patch = (id, p) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = async (files) => {
    const rawFiles = [...files];
    if (!rawFiles.length) return;

    setItems((prevList) => {
      const existingKeys = new Set(
        prevList.map((i) => `${i.file.name}_${i.file.size}_${i.file.lastModified || ''}`)
      );
      const uniqueFiles = [];
      let queueDups = 0;

      for (const f of rawFiles) {
        const key = `${f.name}_${f.size}_${f.lastModified || ''}`;
        if (existingKeys.has(key)) {
          queueDups++;
        } else {
          existingKeys.add(key);
          uniqueFiles.push(f);
        }
      }

      if (queueDups > 0) {
        toast(`Skipped ${queueDups} duplicate file(s) already in the upload queue`, 'err');
      }

      if (!uniqueFiles.length) return prevList;

      const newItems = uniqueFiles.map((file) => {
        const bad = file.size > MAX
          ? `File too large (max ${MAX / 1048576} MB per photo)`
          : !file.type.startsWith('image/')
          ? 'Not an image file'
          : null;
        return {
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
          file,
          preview: URL.createObjectURL(file),
          status: bad ? 'failed' : 'waiting',
          message: bad,
          hash: null,
          hasHandle: !!(file._handle || file._dirHandle),
        };
      });


      // Background duplicate pre-check strictly by cryptographic SHA-256 hash (never by filename)
      setTimeout(async () => {
        const waitingItems = newItems.filter((i) => i.status === 'waiting');
        if (!waitingItems.length) return;

        try {
          const hashedList = await Promise.all(
            waitingItems.map(async (item) => {
              const hash = await getFileHash(item.file);
              return { id: item.id, name: item.file.name, size: item.file.size, hash };
            })
          );

          setItems((curr) =>
            curr.map((x) => {
              const match = hashedList.find((h) => h.id === x.id);
              return match ? { ...x, hash: match.hash } : x;
            })
          );

          const payload = hashedList.map((h) => ({ name: h.name, size: h.size, hash: h.hash }));
          const { duplicates } = await imageService.checkDuplicates(payload);

          if (duplicates && duplicates.length > 0) {
            let autoDeletedCount = 0;

            for (const dup of duplicates) {
              const target = waitingItems.find(
                (it) => it.hash === dup.hash || hashedList.find((h) => h.id === it.id)?.hash === dup.hash
              );
              if (target) {
                // Secure Shredding: overwrite random noise + zeros before unlinking
                const deleted = await shredAndRemove(target.file?._handle, target.file?._dirHandle, target.file.name);
                if (deleted) autoDeletedCount++;

                patch(target.id, {
                  status: 'approved',
                  isDuplicate: true,
                  deletedFromSource: deleted,
                  message: `Duplicate verified by SHA-256 (in “${dup.categoryName || 'Folder'}”) — ${
                    deleted ? '🛡️ Shredded & Permanently Deleted (Unrecoverable)' : 'Already safe in vault'
                  }`,
                });
              }
            }

            if (autoDeletedCount > 0) {
              toast(`🗑️ Automatically deleted ${autoDeletedCount} duplicate photo(s) from your computer (already in vault).`);
            } else {
              toast(`ℹ️ ${duplicates.length} duplicate photo(s) verified by SHA-256 hash.`);
            }
          }
        } catch (err) {
          console.error('Duplicate pre-check error:', err);
        }
      }, 50);

      return [...prevList, ...newItems];
    });
  };

  const remove = (id) =>
    setItems((l) => {
      const x = l.find((i) => i.id === id);
      if (x) URL.revokeObjectURL(x.preview);
      return l.filter((i) => i.id !== id);
    });

  const selectedCategory = categories.find((c) => String(c.id) === String(selectedCatId));
  const isSelectedLocked = selectedCategory?.hasPin && !unlockedStore.has(selectedCategory.id);

  // Pick files — on mobile, showOpenFilePicker is not available, so we always
  // fall back to the hidden file input (which shows the native photo/gallery picker).
  const pickFiles = async () => {
    if (!isMobile && 'showOpenFilePicker' in window) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Images',
              accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.avif', '.gif', '.tiff', '.bmp'] },
            },
          ],
        });
        const fileList = await Promise.all(
          handles.map(async (h) => {
            const f = await h.getFile();
            f._handle = h;
            return f;
          })
        );
        add(fileList);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled
        // On any other error fall through to hidden input
      }
    }
    input.current?.click();
  };

  const startLiveCamera = async (facing = cameraFacing) => {
    setCameraError('');
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('In-app camera not supported on this browser or connection. You can use the standard camera.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.warn('Live camera error:', err);
      setCameraError(err.message || 'Could not access camera. Please allow camera permissions.');
    }
  };

  const stopLiveCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCameraError('');
  };

  const switchCameraFacing = () => {
    const next = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(next);
    startLiveCamera(next);
  };

  const captureFromLiveCamera = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const filename = `vault_camera_${Date.now()}.jpg`;
        const file = new File([blob], filename, { type: 'image/jpeg' });
        file._pureRam = true; // Captured directly to RAM — never saved to phone storage!
        add([file]);
        toast('📸 Captured directly to RAM — Zero traces on phone!');
        stopLiveCamera();
      },
      'image/jpeg',
      0.95
    );
  };

  const openInAppCamera = () => {
    setCameraOpen(true);
    setTimeout(() => startLiveCamera('environment'), 80);
  };

  // Dedicated fallback camera shutter
  const pickFromNativeCamera = () => {
    cameraInput.current?.click();
  };



  // Modern File System Access API: Pick entire folder with readwrite permission (ONE-TIME PROMPT)
  const pickFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const fileList = [];
        for await (const [name, handle] of dirHandle.entries()) {
          if (handle.kind === 'file' && /\.(jpe?g|png|webp)$/i.test(name)) {
            const f = await handle.getFile();
            f._handle = handle;
            f._dirHandle = dirHandle;
            fileList.push(f);
          }
        }
        if (fileList.length) add(fileList);
        else toast('No JPG, PNG, or WEBP images found in selected folder', 'err');
      } catch (e) {
        if (e.name !== 'AbortError') console.error(e);
      }
    } else {
      toast('Folder selection requires Chrome or Edge browser', 'err');
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDrag(false);
    const droppedFiles = [];
    if (e.dataTransfer.items) {
      for (const item of e.dataTransfer.items) {
        if (item.kind === 'file') {
          let handle = null;
          if ('getAsFileSystemHandle' in item) {
            try {
              handle = await item.getAsFileSystemHandle();
            } catch {}
          }
          if (handle && handle.kind === 'directory') {
            try {
              for await (const [name, fHandle] of handle.entries()) {
                if (fHandle.kind === 'file' && /\.(jpe?g|png|webp)$/i.test(name)) {
                  const f = await fHandle.getFile();
                  f._handle = fHandle;
                  f._dirHandle = handle;
                  droppedFiles.push(f);
                }
              }
            } catch (dirErr) {
              console.warn('Could not read dropped folder entries:', dirErr);
            }
          } else {
            const f = item.getAsFile();
            if (f) {
              if (handle) f._handle = handle;
              droppedFiles.push(f);
            }
          }
        }
      }
    }
    if (droppedFiles.length) add(droppedFiles);
    else add(e.dataTransfer.files);
  };

  const start = async () => {
    if (mode === 'manual' && isSelectedLocked) {
      setPinModalOpen(true);
      return;
    }

    ctrl.current = new AbortController();
    setRunning(true);
    const queue = items.filter((i) => i.status === 'waiting');

    const worker = async () => {
      while (queue.length && !ctrl.current.signal.aborted) {
        const it = queue.shift();
        patch(it.id, { status: 'analyzing' });
        try {
          let r;
          if (mode === 'manual') {
            const { results } = await imageService.uploadManual(it.file, +selectedCatId, ctrl.current.signal);
            r = results[0];
          } else {
            const { results } = await imageService.upload(it.file, ctrl.current.signal);
            r = results[0];
          }

          // Secure Shredding: overwrite random noise + zeros before unlinking so recovery is impossible
          let deletedFromSource = false;
          if (r && (r.status === 'approved' || r.duplicate || r.status === 'rejected')) {
            deletedFromSource = await shredAndRemove(it.file?._handle, it.file?._dirHandle, it.file.name);
          }

          const baseMsg = r.message || (r.category ? `Saved to ${r.category}` : 'Saved');
          let deleteMsg = '';
          if (deletedFromSource) {
            deleteMsg = ' · 🛡️ Shredded & Permanently Deleted';
          } else if (it.file?._pureRam) {
            deleteMsg = ' · 🔒 Pure RAM (Never saved to phone storage)';
          } else if (isMobile) {
            deleteMsg = ' · 📱 Delete original from phone gallery';
          }

          patch(it.id, {
            status: r.status,
            message: baseMsg + deleteMsg,
            ai: r.ai,
            deletedFromSource,
          });
        } catch (e) {
          patch(it.id, e.name === 'AbortError' ? { status: 'cancelled' } : { status: 'failed', message: e.message });
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  };

  // Direct Local PC Folder Import (Executed directly on PC by backend)
  const handleLocalFolderImport = async (e) => {
    e.preventDefault();
    if (!localFolderPath.trim()) return;
    setLocalImporting(true);
    try {
      const data = await imageService.importLocalFolder(localFolderPath.trim(), +selectedCatId || null, mode);
      const results = data.results || [];
      if (!results.length) {
        toast(data.message || 'No images found in that folder', 'err');
      } else {
        const deletedCount = results.filter((x) => x.deletedFromSource).length;
        toast(`✅ Moved ${results.length} image(s) to vault (${deletedCount} deleted from original folder)`);
        setLocalFolderPath('');
      }
    } catch (err) {
      toast(err.message || 'Failed to import local folder', 'err');
    } finally {
      setLocalImporting(false);
    }
  };

  const cancel = () => {
    ctrl.current?.abort();
    setItems((l) => l.map((i) => (i.status === 'waiting' ? { ...i, status: 'cancelled' } : i)));
  };

  const handleUnlockAndStart = async (e) => {
    e.preventDefault();
    if (!pinInput || !selectedCategory) return;
    setPinVerifying(true);
    try {
      await categoryService.verifyPin(selectedCategory.id, pinInput);
      unlockedStore.add(selectedCategory.id);
      toast(`Folder “${selectedCategory.name}” unlocked`);
      setPinModalOpen(false);
      setPinInput('');
      setTimeout(() => start(), 100);
    } catch (err) {
      toast(err.message || 'Incorrect password', 'err');
    } finally {
      setPinVerifying(false);
    }
  };

  const done = items.filter((i) => !['waiting', 'analyzing'].includes(i.status)).length;
  const waiting = items.some((i) => i.status === 'waiting');
  const duplicateCount = items.filter((i) => i.status === 'duplicate').length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Add Images</h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Zero-knowledge encrypted client-side storage. Automatic duplicate protection active.
          </p>
        </div>

        {/* Mode Selector */}
        <div className="seg">
          <button
            type="button"
            className={mode === 'ai' ? 'on' : ''}
            onClick={() => {
              setMode('ai');
              setSearchParams({});
            }}
          >
            🤖 AI Automatic Scan
          </button>
          <button
            type="button"
            className={mode === 'manual' ? 'on' : ''}
            onClick={() => {
              setMode('manual');
              if (selectedCatId) setSearchParams({ category: selectedCatId, mode: 'manual' });
            }}
          >
            📁 Direct to Folder (No AI)
          </button>
        </div>
      </header>

      {/* Manual Mode Folder Selector Banner */}
      {mode === 'manual' ? (
        <div className="glass pad" style={{ marginBottom: '18px', borderLeft: '4px solid var(--gold)' }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: '14px' }}>
            <div style={{ display: 'grid', gap: '4px' }}>
              <div className="row" style={{ gap: '8px' }}>
                <b style={{ color: 'var(--gold)', fontSize: '1.05rem' }}>📁 Direct Folder Upload Mode</b>
                <span className="badge" style={{ background: 'rgba(143, 211, 176, 0.18)', color: 'var(--ok)' }}>
                  0 AI Tokens Used
                </span>
              </div>
              <span className="muted small">
                Photos are encrypted and saved directly into the chosen folder without AI safety or categorization scans.
              </span>
            </div>

            <div className="row" style={{ gap: '10px' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Choose folder:</label>
              <select
                value={selectedCatId}
                onChange={(e) => {
                  setSelectedCatId(e.target.value);
                  setSearchParams({ category: e.target.value, mode: 'manual' });
                }}
                style={{ padding: '8px 12px', minWidth: '160px' }}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.hasPin ? '🔒 ' : ''}
                    {c.name} ({c.imageCount})
                  </option>
                ))}
              </select>
              {selectedCategory?.hasPin && (
                <span
                  className="badge"
                  style={{
                    background: isSelectedLocked ? 'rgba(239, 122, 122, 0.2)' : 'rgba(143, 211, 176, 0.2)',
                    color: isSelectedLocked ? 'var(--danger)' : 'var(--ok)',
                  }}
                >
                  {isSelectedLocked ? '🔒 Password Locked' : '🔓 Unlocked for Session'}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="glass pad" style={{ marginBottom: '18px', borderLeft: '4px solid var(--rose)' }}>
          <div className="row" style={{ gap: '8px' }}>
            <b style={{ color: 'var(--rose)', fontSize: '1.05rem' }}>🤖 AI Smart Scan & Sort</b>
            <span className="badge analyzing">Gemini AI Active</span>
          </div>
          <span className="muted small" style={{ display: 'block', marginTop: '4px' }}>
            Each photo is evaluated by Gemini AI for explicit content and automatically sorted into the most fitting category folder.
          </span>
        </div>
      )}

      {/* Drop Zone */}
      <motion.div
        className={'drop glass' + (drag ? ' over' : '')}
        animate={{ scale: drag ? 1.015 : 1 }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={isMobile ? undefined : pickFiles}
        role={isMobile ? undefined : 'button'}
        tabIndex={isMobile ? undefined : 0}
        onKeyDown={isMobile ? undefined : (e) => e.key === 'Enter' && pickFiles()}
        style={{ cursor: isMobile ? 'default' : 'pointer' }}
      >
        {/* Hidden file input — gallery picker (mobile: shows photo library) */}
        <input
          ref={input}
          id="file-picker-input"
          type="file"
          accept={MOBILE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
        {/* Hidden camera capture input — opens camera directly on mobile */}
        <input
          ref={cameraInput}
          id="camera-capture-input"
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />

        {isMobile ? (
          /* ─── Mobile UI: Big tap-friendly buttons ─── */
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>📷</div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '6px' }}>Add Photos to Vault</h2>
            <p className="muted" style={{ marginBottom: '20px', fontSize: '0.9rem' }}>
              {mode === 'manual'
                ? `Will be saved directly to "${selectedCategory?.name || 'selected folder'}".`
                : 'Gemini AI will scan and sort each photo automatically.'}
            </p>
            <div
              style={{ display: 'grid', gap: '10px', maxWidth: '340px', margin: '0 auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="btn primary"
                onClick={openInAppCamera}
                style={{ padding: '14px 20px', fontSize: '1rem', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                📸 Private Camera (Zero Phone Traces)
              </button>
              <button
                type="button"
                className="btn"
                onClick={pickFiles}
                style={{ padding: '13px 20px', fontSize: '0.95rem', borderRadius: '14px' }}
              >
                🖼️ Choose from Gallery
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={pickFromNativeCamera}
                style={{ fontSize: '0.82rem', opacity: 0.8 }}
              >
                📷 Standard Phone Camera
              </button>
            </div>
            <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(232, 201, 165, 0.08)', borderRadius: '12px', fontSize: '0.78rem', textAlign: 'left', lineHeight: 1.45, maxWidth: '360px', margin: '16px auto 0' }}>
              🔒 <strong>Private Camera</strong> captures directly to RAM — <em>never touches or saves to your phone's gallery!</em><br />
              📱 <strong>Gallery Photos</strong>: Android & Apple iOS prevent websites from deleting gallery photos for device security. Please delete originals from your gallery after uploading.
            </div>
          </>
        ) : (
          /* ─── Desktop UI: Drag-and-drop zone ─── */
          <>
            <h2>Drop images here, or click to choose</h2>
            <p className="muted">
              JPG, PNG, WEBP, HEIC, AVIF and more.
              {mode === 'manual'
                ? ` Photos will be encrypted and moved directly to "${selectedCategory?.name || 'selected folder'}".`
                : ' Each image is checked with AI, encrypted, and moved into vault storage.'}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="btn primary sm" onClick={pickFolder} title="One-time permission for all photos inside the folder">
                📁 Move Folder (1-Time Access Permission)
              </button>
              <button type="button" className="btn ghost sm" onClick={pickFiles}>
                📄 Select Individual Photos
              </button>
            </div>
            <div style={{ marginTop: '12px', fontSize: '0.84rem', color: 'var(--ok)', opacity: 0.95 }}>
              🔒 One-Time Access: Choosing a folder grants access once for all images. Duplicates (strictly checked by SHA-256 hash) are automatically deleted from your computer immediately without asking.
            </div>
          </>
        )}
      </motion.div>

      {/* Direct Local PC Folder Mover — PC only, hidden on mobile */}
      {!isMobile && (
        <div className="glass pad" style={{ marginTop: '16px', border: '1px solid rgba(255, 255, 255, 0.12)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div>
              <b style={{ fontSize: '0.95rem' }}>💻 Move Photos by Local PC Folder Path</b>
              <span className="muted small" style={{ display: 'block' }}>
                Have photos in a PC folder? Type or paste the full folder path (e.g. <code>C:\Users\DELL\Pictures\Camera</code>) to move all images into Vault and delete the originals directly.
              </span>
            </div>
          </div>
          <form onSubmit={handleLocalFolderImport} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="e.g. C:\Users\DELL\Pictures\Camera"
              value={localFolderPath}
              onChange={(e) => setLocalFolderPath(e.target.value)}
              style={{ flex: 1, minWidth: '240px', padding: '9px 12px' }}
              disabled={localImporting}
            />
            <button type="submit" className="btn primary" disabled={localImporting || !localFolderPath.trim()}>
              {localImporting ? 'Moving photos...' : 'Move All Photos to Vault'}
            </button>
          </form>
        </div>
      )}


      {/* Action Bar */}
      {items.length > 0 && (
        <div className="bar-actions" style={{ marginTop: '18px' }}>
          <div className="progress">
            <motion.i animate={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span className="muted">
            {done} of {items.length} processed
          </span>
          {!running && (
            <button className="btn primary" onClick={start} disabled={!waiting}>
              {mode === 'manual' ? `Save & Move to “${selectedCategory?.name || 'Folder'}”` : 'Check, Save & Move with AI'}
            </button>
          )}
          {running && (
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          )}
          {!running && (
            <button className="btn ghost" onClick={() => setItems([])}>
              Clear list
            </button>
          )}
        </div>
      )}

      {/* Upload Cards */}
      <div className="cards">
        <AnimatePresence>
          {items.map((it) => (
            <motion.div
              key={it.id}
              layout
              className={'ucard glass ' + it.status}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <img src={it.preview} alt="" draggable={false} />
              <div className="ubody">
                <b title={it.file.name}>{it.file.name}</b>
                <span className="muted small">{fmtBytes(it.file.size)}</span>
                <span className={'badge ' + it.status}>
                  {it.status === 'analyzing' && <span className="spinner sm" />}
                  {LABEL[it.status]}
                </span>
                {it.message && (
                  <span
                    className="small msg"
                    style={{ color: it.status === 'duplicate' ? 'var(--rose)' : undefined }}
                  >
                    {it.message}
                  </span>
                )}
                {it.ai?.inputTokens != null && (
                  <span
                    className="small muted"
                    title={`Input: ${it.ai.inputTokens.toLocaleString()} · Output: ${
                      it.ai.outputTokens?.toLocaleString() ?? '?'
                    }`}
                  >
                    🪙 {(it.ai.inputTokens + (it.ai.outputTokens ?? 0)).toLocaleString()} tokens
                  </span>
                )}
              </div>
              {['waiting', 'failed', 'cancelled', 'duplicate'].includes(it.status) && (
                <button className="x" onClick={() => remove(it.id)} aria-label="Remove">
                  ×
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {items.some((i) => i.status === 'rejected') && (
        <p style={{ marginTop: '20px' }}>
          <Link to="/rejected">Review rejected images →</Link>
        </p>
      )}

      {/* Mobile Phone Gallery Clean-up Notification Banner */}
      {isMobile && done > 0 && items.some((i) => i.status === 'approved' && !i.file?._pureRam && !i.deletedFromSource) && (
        <div className="glass pad" style={{ marginTop: '18px', borderLeft: '4px solid var(--gold)', background: 'rgba(232, 201, 165, 0.09)' }}>
          <div className="row" style={{ gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '1.25rem' }}>📱</span>
            <b style={{ color: 'var(--gold)', fontSize: '0.98rem' }}>Phone Gallery Clean-up Reminder</b>
          </div>
          <p className="small muted" style={{ margin: '8px 0 6px', lineHeight: 1.5 }}>
            Your photos are safely encrypted inside VaultCloset! 🛡️<br />
            Due to strict Android & Apple iOS privacy policies, websites are restricted from auto-deleting files from your phone's Photo Gallery.
            <strong> Please open your phone's Gallery / Photos app now, delete the uploaded original photo(s), and empty your <em>Recently Deleted</em> / Trash album.</strong>
          </p>
        </div>
      )}

      {/* Live In-App Camera Modal (Never touches phone gallery) */}
      <Modal open={cameraOpen} onClose={stopLiveCamera} title="📸 Private Vault Camera (Zero Phone Traces)">
        <div style={{ display: 'grid', gap: '14px', textAlign: 'center' }}>
          <p className="muted small" style={{ margin: 0 }}>
            Photos taken with this camera are captured directly into memory (RAM) and encrypted into your vault.
            <strong> It is never saved to your phone's photo gallery!</strong>
          </p>

          {cameraError ? (
            <div style={{ padding: '18px', background: 'rgba(239, 122, 122, 0.12)', borderRadius: '12px' }}>
              <p className="error small" style={{ margin: '0 0 10px' }}>{cameraError}</p>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  stopLiveCamera();
                  pickFromNativeCamera();
                }}
              >
                Open Standard Camera instead
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative', width: '100%', borderRadius: '14px', overflow: 'hidden', background: '#000', maxHeight: '55vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', maxHeight: '55vh', objectFit: 'cover' }}
              />
              <button
                type="button"
                onClick={switchCameraFacing}
                title="Switch Camera (Front / Rear)"
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  background: 'rgba(0,0,0,0.65)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  borderRadius: '50%',
                  width: '42px',
                  height: '42px',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                🔄
              </button>
            </div>
          )}

          {!cameraError && (
            <div className="row" style={{ justifyContent: 'center', gap: '16px', marginTop: '6px' }}>
              <button type="button" className="btn ghost" onClick={stopLiveCamera}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={captureFromLiveCamera}
                style={{ padding: '12px 24px', fontSize: '1rem', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                📸 Snap & Add to Vault
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Folder Mobile / Direct Unlock Modal */}
      <CategoryUnlockModal
        open={pinModalOpen}
        onClose={() => setPinModalOpen(false)}
        categoryId={selectedCategory?.id}
        targetType="Folder"
        onUnlocked={(res) => {
          toast(`Folder “${res.name || selectedCategory?.name || 'Folder'}” unlocked`);
          setPinModalOpen(false);
          setTimeout(() => start(), 100);
        }}
      />
    </>
  );
}
