import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import axios from 'axios'
import type { LineAccount } from './types'
import { getChannelId, setChannelId, subscribeChannelId } from './lineAccount'

const api = axios.create({ baseURL: '/api/line-crm', headers: { 'Content-Type': 'application/json' } })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export function useLineAccounts() {
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [loading, setLoading] = useState(true)
  const selectedChannelId = useSyncExternalStore(subscribeChannelId, getChannelId)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<LineAccount[]>('/accounts')
      setAccounts(res.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return {
    accounts,
    loading,
    selectedChannelId,
    selectChannel: setChannelId,
    reload,
  }
}
