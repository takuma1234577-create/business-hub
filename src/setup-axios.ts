import axios from 'axios'

// 全axios.create()インスタンスに認証トークンを自動付与
// main.tsxで最初にimportされるため、他モジュールのaxios.create()より先に実行される
const origCreate = axios.create.bind(axios)
axios.create = function (config?: Parameters<typeof origCreate>[0]) {
  const instance = origCreate(config)
  instance.interceptors.request.use((reqConfig) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      reqConfig.headers.Authorization = `Bearer ${token}`
    }
    return reqConfig
  })
  return instance
} as typeof axios.create
