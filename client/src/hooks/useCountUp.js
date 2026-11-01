import { useEffect, useState } from 'react';
import { animate } from 'framer-motion';
export default function useCountUp(target, seconds = 1) {
  const [v, setV] = useState(0);
  useEffect(() => { const c = animate(0, target, { duration: seconds, ease: 'easeOut', onUpdate: (x) => setV(Math.round(x)) }); return () => c.stop(); }, [target, seconds]);
  return v;
}
