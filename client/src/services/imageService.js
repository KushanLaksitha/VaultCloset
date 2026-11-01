import { api, qs } from './api.js';

export const imageService = {
  list: (filters) => api.get('/images?' + qs(filters)),
  stats: () => api.get('/images/stats'),
  viewUrl: (id) => api.post(`/images/${id}/view-token`),
  setCategory: (id, categoryId) => api.patch(`/images/${id}/category`, { categoryId }),
  favorite: (id) => api.post(`/images/${id}/favorite`, {}),
  remove: (id) => api.del(`/images/${id}`),
  bulkMove: (ids, categoryId) => api.post('/images/bulk-category', { ids, categoryId }),
  bulkFavorite: (ids, value) => api.post('/images/bulk-favorite', { ids, value }),
  bulkDelete: (ids) => api.post('/images/bulk-delete', { ids }),
  upload: api.uploadOne,
  uploadManual: api.uploadManual,
  importLocalFolder: (folderPath, categoryId, mode) => api.post('/images/import-local-folder', { folderPath, categoryId, mode }),
  checkDuplicates: (items) => api.post('/images/check-duplicates', { items }),
  rejected: () => api.get('/rejected'),
  rejectedUrl: (id) => api.post(`/rejected/${id}/view-token`),
  approve: (id, categoryId) => api.post(`/rejected/${id}/approve`, { categoryId }),
  discard: (id) => api.del(`/rejected/${id}`),
};
