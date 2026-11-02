import { api } from './api.js';

export const categoryService = {
  list: (type) => api.get('/categories' + (type ? `?type=${type}` : '')),
  create: (name, type = 'image') => api.post('/categories', { name, type }),
  rename: (id, name) => api.patch(`/categories/${id}`, { name }),
  remove: (id, passwords = {}) => api.request(`/categories/${id}`, { method: 'DELETE', body: passwords }),
  setPin: (id, pin, currentPin) => api.post(`/categories/${id}/pin`, { pin, currentPin }),
  removePin: (id, pin) => api.request(`/categories/${id}/pin`, { method: 'DELETE', body: { pin } }),
  verifyPin: (id, pin) => api.post(`/categories/${id}/pin/verify`, { pin }),
};
