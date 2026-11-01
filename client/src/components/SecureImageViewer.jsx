import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { imageService } from '../services/imageService.js';
import { fmtBytes } from '../services/api.js';

// Full-screen protected viewer with interactive multi-level Zoom, Pan, and Gesture support.
export default function SecureImageViewer({ image, categories, onClose, onPrev, onNext, onFavorite, onCategory }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  const [hidden, setHidden] = useState(false);

  // Zoom and Pan states
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const imgContainerRef = useRef(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const touchDistRef = useRef(null);

  // Reset zoom & pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
  }, [image.id]);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setErr('');
    imageService.viewUrl(image.id).then((r) => live && setUrl(r.url)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [image.id]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(5, +(z + 0.5).toFixed(1)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => {
      const next = Math.max(1, +(z - 0.5).toFixed(1));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Keyboard navigation & zoom shortcuts
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && zoom === 1) onPrev?.();
      if (e.key === 'ArrowRight' && zoom === 1) onNext?.();
      if (e.key === '+' || e.key === '=') { e.preventDefault(); handleZoomIn(); }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); handleZoomOut(); }
      if (e.key === '0') { e.preventDefault(); handleResetZoom(); }
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c'].includes(e.key.toLowerCase())) e.preventDefault();
    };

    const vis = () => setHidden(document.hidden);
    const blur = () => setHidden(true);
    const focus = () => setHidden(false);

    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);

    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }, [onClose, onPrev, onNext, zoom, handleZoomIn, handleZoomOut, handleResetZoom]);

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.3 : -0.3;
    setZoom((prev) => {
      const next = Math.max(1, Math.min(5, +(prev + delta).toFixed(2)));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Double-click toggle (1x <-> 2.5x)
  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (zoom > 1) {
      handleResetZoom();
    } else {
      setZoom(2.5);
    }
  };

  // Mouse drag pan
  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = (e) => {
    if (!isDragging || zoom <= 1) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch pinch-to-zoom & pan
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchDistRef.current = dist;
    } else if (e.touches.length === 1 && zoom > 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panStartRef.current = { ...pan };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchDistRef.current) {
      e.preventDefault();
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = newDist / touchDistRef.current;
      touchDistRef.current = newDist;
      setZoom((z) => Math.max(1, Math.min(5, +(z * ratio).toFixed(2))));
    } else if (e.touches.length === 1 && isDragging && zoom > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - dragStartRef.current.x;
      const dy = e.touches[0].clientY - dragStartRef.current.y;
      setPan({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy,
      });
    }
  };

  const handleTouchEnd = () => {
    touchDistRef.current = null;
    setIsDragging(false);
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  };

  return (
    <motion.div
      className="viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="viewer-stage"
        onClick={() => { if (zoom === 1) onClose(); }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        <AnimatePresence mode="wait">
          {url && !hidden && (
            <div
              key={image.id}
              ref={imgContainerRef}
              className="viewer-img"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={handleDoubleClick}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.16s ease-out',
                cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
                userSelect: 'none',
                touchAction: zoom > 1 ? 'none' : 'auto',
              }}
            >
              <img
                src={url}
                alt={image.name}
                draggable={false}
                onError={() => setErr('This image link expired. Close and reopen the image.')}
                style={{ pointerEvents: 'none' }}
              />
            </div>
          )}
        </AnimatePresence>

        {/* Floating Zoom Control Bar */}
        {url && !hidden && (
          <div
            className="glass"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: '22px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '30px',
              background: 'rgba(16, 12, 23, 0.88)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              backdropFilter: 'blur(16px)',
              zIndex: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
            }}
          >
            <button
              type="button"
              className="btn ghost sm"
              onClick={handleZoomOut}
              disabled={zoom <= 1}
              title="Zoom out (-)"
              style={{ minWidth: '32px', padding: '4px 8px', fontSize: '1.2rem', lineHeight: 1 }}
            >
              −
            </button>

            <button
              type="button"
              className="btn ghost sm"
              onClick={handleResetZoom}
              title="Reset Zoom (0)"
              style={{
                padding: '4px 8px',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: zoom > 1 ? 'var(--gold)' : 'var(--text)',
                fontFamily: 'monospace',
                minWidth: '54px',
                textAlign: 'center',
              }}
            >
              {Math.round(zoom * 100)}%
            </button>

            <button
              type="button"
              className="btn ghost sm"
              onClick={handleZoomIn}
              disabled={zoom >= 5}
              title="Zoom in (+)"
              style={{ minWidth: '32px', padding: '4px 8px', fontSize: '1.2rem', lineHeight: 1 }}
            >
              +
            </button>

            {zoom > 1 && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={handleResetZoom}
                title="Fit to Screen"
                style={{ padding: '4px 8px', fontSize: '0.78rem', opacity: 0.8 }}
              >
                Fit
              </button>
            )}
          </div>
        )}

        {!url && !err && <span className="spinner" />}
        {hidden && <p className="muted">Hidden while this window is not in focus.</p>}
        {err && <p className="error">{err}</p>}
      </div>

      <aside className="viewer-side glass">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <h3 title={image.name}>{image.name}</h3>
        <p className="muted">{image.width}×{image.height} · {fmtBytes(image.size)}</p>

        {/* Zoom details in side panel */}
        <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="small muted">🔍 Zoom Level</span>
            <span className="small" style={{ color: 'var(--gold)', fontWeight: 600, fontFamily: 'monospace' }}>
              {Math.round(zoom * 100)}%
            </span>
          </div>
          <div className="row" style={{ marginTop: '8px', gap: '6px' }}>
            <button type="button" className="btn sm ghost grow" onClick={handleZoomOut} disabled={zoom <= 1} title="Zoom out">
              −
            </button>
            <button type="button" className="btn sm ghost grow" onClick={handleResetZoom} title="Reset to Fit">
              Fit (1x)
            </button>
            <button type="button" className="btn sm ghost grow" onClick={handleZoomIn} disabled={zoom >= 5} title="Zoom in">
              +
            </button>
          </div>
          <span className="muted small" style={{ display: 'block', marginTop: '6px', fontSize: '0.74rem' }}>
            Mouse wheel, double-click, or pinch on phone to zoom. Drag to pan.
          </span>
        </div>

        <label className="lbl">
          Category
          <select value={image.categoryId} onChange={(e) => onCategory(image, +e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <p className="muted small">
          {image.catSource === 'manual'
            ? 'Category set by you'
            : `AI suggested ${image.aiCategory || 'a category'}${image.confidence ? ` (${Math.round(image.confidence * 100)}%)` : ''}`}
        </p>
        <p className="muted small">
          {image.approval === 'manual' ? 'Approved manually' : 'Approved by AI check'}
        </p>

        <button className="btn" onClick={() => onFavorite(image)}>
          {image.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        </button>

        <div className="row" style={{ marginTop: 'auto' }}>
          <button className="btn ghost" onClick={onPrev} disabled={!onPrev}>Previous</button>
          <button className="btn ghost" onClick={onNext} disabled={!onNext}>Next</button>
        </div>
      </aside>
    </motion.div>
  );
}

