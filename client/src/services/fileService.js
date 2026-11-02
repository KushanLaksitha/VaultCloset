import { api, qs } from './api.js';

export const fileService = {
  list: (filters) => api.get('/files?' + qs(filters)),
  stats: () => api.get('/files/stats'),
  upload: (file, categoryId, signal) => {
    const form = new FormData();
    form.append('files', file);
    form.append('categoryId', categoryId);
    return api.request('/files/upload', { method: 'POST', form, signal });
  },
  downloadToken: (id) => api.post(`/files/${id}/download-token`),
  favorite: (id) => api.post(`/files/${id}/favorite`, {}),
  setCategory: (id, categoryId) => api.patch(`/files/${id}/category`, { categoryId }),
  remove: (id) => api.del(`/files/${id}`),
};

