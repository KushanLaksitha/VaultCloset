import { api } from './api.js';
export const authService = {
  me: () => api.get('/auth/me'),
  login: (b) => api.post('/auth/login', b),
  register: (b) => api.post('/auth/register', b),
  logout: () => api.post('/auth/logout'),
  changePassword: (b) => api.post('/auth/change-password', b),
  updateUsername: (username) => api.post('/auth/username', { username }),
};
