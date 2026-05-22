import { useState, useCallback } from 'react';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/tasks' });
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
export function useApi<T>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    body?: unknown,
    config?: object
  ) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api[method]<{ success: boolean; data: T; error?: string }>(
        url, method === 'get' ? config : body, method === 'get' ? undefined : config
      );
      if (response.data.success) {
        setData(response.data.data);
        return response.data.data;
      } else {
        throw new Error(response.data.error || 'エラーが発生しました');
      }
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      const message = e.response?.data?.error || e.message || 'エラーが発生しました';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, request, setData };
}

export { api };
