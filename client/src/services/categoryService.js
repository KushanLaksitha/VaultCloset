import { api } from './api.js';

export const categoryService = {
  list: (type) => api.get('/categories' + (type ? `?type=${type}` : '')),
  create: (name, type = 'image') => api.post('/categories', { name, type }),
  rename: (id, name) => api.patch(`/categories/${id}`, { name }),
  remove: (id, passwords = {}) => api.request(`/categories/${id}`, { method: 'DELETE', body: passwords }),
  setPin: (id, pin, currentPin) => api.post(`/categories/${id}/pin`, { pin, currentPin }),
  removePin: (id, pin) => api.request(`/categories/${id}/pin`, { method: 'DELETE', body: { pin } }),
  verifyPin: (id, pin) => api.post(`/categories/${id}/pin/verify`, { pin }),
  requestMobileUnlock: (id) => api.post(`/categories/${id}/mobile-unlock-request`),
  checkMobileUnlockStatus: (id) => api.get(`/categories/unlock-request/${id}/status`),
  cancelMobileUnlock: (id) => api.post(`/categories/unlock-request/${id}/cancel`),
  getPendingCategoryMobileAuth: () => api.get('/categories/mobile-auth/pending'),
  respondCategoryMobileAuth: (b) => api.post('/categories/mobile-auth/respond', b),
  getCategoryRequestDetails: (id) => api.get(`/categories/unlock-request-details/${id}`),
  directCategoryUnlock: (b) => api.post('/categories/mobile-auth/direct-unlock', b),
};
