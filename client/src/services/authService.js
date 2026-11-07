import { api } from './api.js';
export const authService = {
  me: () => api.get('/auth/me'),
  login: (b) => api.post('/auth/login', b),
  register: (b) => api.post('/auth/register', b),
  logout: () => api.post('/auth/logout'),
  changePassword: (b) => api.post('/auth/change-password', b),
  updateUsername: (username) => api.post('/auth/username', { username }),
  checkLoginStatus: (id) => api.get(`/auth/login-request/${id}/status`),
  cancelLoginRequest: (id) => api.post(`/auth/login-request/${id}/cancel`),
  getPendingMobileAuth: () => api.get('/auth/mobile-auth/pending'),
  respondMobileAuth: (b) => api.post('/auth/mobile-auth/respond', b),
  getRequestDetails: (id) => api.get(`/auth/mobile-auth/request-details/${id}`),
  directUnlock: (b) => api.post('/auth/mobile-auth/direct-unlock', b),
  toggleMobileAuth: (b) => api.post('/auth/mobile-auth/toggle', b),
};
