import { useState } from 'react';
// Renders an image from a short-lived token URL. Saving/dragging/right-click are discouraged (not impossible — see README).
export default function SecureImage({ token, alt = '', blur = false }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={'simg' + (loaded ? ' loaded' : '')}>
      <img src={`/api/media/${token}`} alt={alt} loading="lazy" draggable={false}
        onContextMenu={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()} onLoad={() => setLoaded(true)}
        style={blur ? { filter: 'blur(22px) saturate(.6)' } : undefined} />
    </div>
  );
}
