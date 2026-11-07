// One small wrapper around fetch. Cookies (httpOnly session) are sent automatically.
const UNLOCKED_KEY = 'vc_unlocked_cats';
const UNLOCKED_NAMES_KEY = 'vc_unlocked_names';

// Stores unlocked category IDs (array of numbers) and their revealed names (object: id -> { name, imageCount })
export const unlockedStore = {
  get: () => {
    try {
      const saved = sessionStorage.getItem(UNLOCKED_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  },
  getNames: () => {
    try {
      const saved = sessionStorage.getItem(UNLOCKED_NAMES_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  },
  getName: (id) => {
    const names = unlockedStore.getNames();
    return names[+id] || null;
  },
  add: (id, name = null, imageCount = null) => {
    const list = [...new Set([...unlockedStore.get(), +id])];
    sessionStorage.setItem(UNLOCKED_KEY, JSON.stringify(list));
    if (name !== null) {
      const names = unlockedStore.getNames();
      names[+id] = { name, imageCount };
      sessionStorage.setItem(UNLOCKED_NAMES_KEY, JSON.stringify(names));
    }
    window.dispatchEvent(new Event('vc:unlocked-change'));
  },
  remove: (id) => {
    const list = unlockedStore.get().filter((x) => x !== +id);
    sessionStorage.setItem(UNLOCKED_KEY, JSON.stringify(list));
    const names = unlockedStore.getNames();
    delete names[+id];
    sessionStorage.setItem(UNLOCKED_NAMES_KEY, JSON.stringify(names));
    window.dispatchEvent(new Event('vc:unlocked-change'));
  },
  has: (id) => unlockedStore.get().includes(+id),
  clear: () => {
    sessionStorage.removeItem(UNLOCKED_KEY);
    sessionStorage.removeItem(UNLOCKED_NAMES_KEY);
    window.dispatchEvent(new Event('vc:unlocked-change'));
  },
};

async function request(path, { method = 'GET', body, form, signal } = {}) {
  let res;
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const unlocked = unlockedStore.get();
  if (unlocked.length) headers['x-unlocked-categories'] = unlocked.join(',');

  try {
    res = await fetch('/api' + path, {
      method,
      signal,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: form || (body ? JSON.stringify(body) : undefined),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Can’t reach the server. Check your connection and try again.');
  }

  let data = {};
  let rawText = '';
  try {
    rawText = await res.text();
    data = JSON.parse(rawText);
  } catch {
    if (rawText) data = { error: rawText };
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('vc:unauth'));
    }
    const err = new Error(data.error || res.statusText || 'Something went wrong');
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v && p.set(k, v === true ? '1' : v));
  return p.toString();
};

export const api = {
  request,
  get: (p, o) => request(p, o),
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  uploadOne: (file, signal) => {
    const form = new FormData();
    form.append('files', file);
    return request('/images/upload', { method: 'POST', form, signal });
  },
  uploadManual: (file, categoryId, signal) => {
    const form = new FormData();
    form.append('files', file);
    form.append('categoryId', categoryId);
    return request('/images/upload-manual', { method: 'POST', form, signal });
  },
};

export const fmtBytes = (n) => {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 3);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
};

export const ago = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(d).toLocaleDateString();
};
