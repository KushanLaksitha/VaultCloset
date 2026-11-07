/**
 * Strict physical mobile device detection.
 * Designed to prevent bypass via browser inspection, DevTools device emulation,
 * or resized desktop browser windows.
 */
export const isRealMobilePhone = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';

  // 1. Strict Desktop Signature Check
  // Even in Chrome/Edge/Firefox DevTools "Responsive / Mobile" mode, desktop signatures persist:
  const hasDesktopSignature =
    /(Windows NT|Win32|Win64|Macintosh|MacIntel|X11|Ubuntu|Fedora|CrOS)/i.test(ua) ||
    /(Win32|Win64|MacIntel|Linux x86_64)/i.test(platform);

  // If user-agent or platform contains desktop indicators without being an actual iPhone/Android:
  if (hasDesktopSignature && !/(iPhone|iPod|iPad|Android)/i.test(ua)) {
    return false;
  }

  // Windows NT with touch (like touchscreen laptops) is still a laptop/PC!
  if (/Windows NT/i.test(ua)) {
    return false;
  }

  // 2. Client Hints API check (modern Chrome, Edge, Samsung Internet)
  // DevTools responsive mode generally retains userAgentData.platform = "Windows" or "macOS"
  if (navigator.userAgentData) {
    if (navigator.userAgentData.mobile === false) return false;
    if (['Windows', 'macOS', 'Linux'].includes(navigator.userAgentData.platform)) return false;
  }

  // 3. User-Agent Mobile Check
  const hasMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isIPad = /iPad/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (!hasMobileUA && !isIPad) {
    return false;
  }

  // 4. Hardware Pointer & Touch Capabilities
  // Real mobile phones have coarse touch pointer and no hardware mouse cursor
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const isCoarsePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : true;

  return hasTouch && isCoarsePointer;
};
