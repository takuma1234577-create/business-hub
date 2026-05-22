import axios from 'axios'

export function createApi(baseURL: string) {
  const instance = axios.create({ baseURL })
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })
  return instance
}
