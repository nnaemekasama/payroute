import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const client = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error?.message
      || error.response?.data?.message
      || error.message
      || 'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);

export function createPayment(data, idempotencyKey) {
  return client.post('/payments', data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function getPayment(id) {
  return client.get(`/payments/${id}`);
}

export function getPayments(params = {}) {
  return client.get('/payments', { params });
}

export function getAccounts() {
  return client.get('/accounts');
}

export default client;
