import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  Mail,
  Calendar,
  FileSpreadsheet,
  HardDrive,
  Bot,
  Package,
  ShoppingBag,
  Store,
  Pencil,
} from 'lucide-react'
import axios from 'axios'

const api = axios.create({ baseURL: '/api/settings' })

interface Connection {
  id: string
  scope: string
  tokenType: string
  expiryDate: number | null
  updatedAt: string
  isExpired: boolean
}

interface AmazonAccount {
  id: string
  account_name: string
  seller_id: string
  marketplace_id: string
  is_active: boolean
  last_synced_at: string | null
  created_at: string
}

interface ChannelStore {
  id: string
  channel: string
  store_name: string
  shop_domain: string | null
  shop_id: string | null
  is_active: boolean
  auto_fulfill: boolean
  inventory_sync_enabled: boolean
  last_synced_at: string | null
  created_at: string
  gmail_token_id: string | null
}

interface ChannelGmailStatus {
  hasToken: boolean
  tokenInfo: { scope: string; expiryDate: string; updatedAt: string; isExpired: boolean } | null
}

interface GoogleService {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  scopes: string[]
  usedBy: string[]
}

const googleServices: GoogleService[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'メール送信・下書き作成・メール取得',
    icon: <Mail size={20} />,
    scopes: ['gmail.compose', 'gmail.send', 'gmail.readonly'],
    usedBy: ['請求書ツール', '会計書類管理', 'AI秘書'],
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    description: '予定の取得・作成・管理',
    icon: <Calendar size={20} />,
    scopes: ['calendar', 'calendar.events'],
    usedBy: ['AI秘書'],
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    description: 'スプレッドシートの読み書き',
    icon: <FileSpreadsheet size={20} />,
    scopes: ['spreadsheets'],
    usedBy: ['請求書ツール', '会計書類管理'],
  },
  {
    id: 'drive',
    name: 'Google Drive',
    description: 'ファイルの読み取り・管理',
    icon: <HardDrive size={20} />,
    scopes: ['drive.readonly'],
    usedBy: ['会計書類管理'],
  },
]

// envServicesは APIキー設定セクションに統合済み

export default function ApiSettings() {
  const navigate = useNavigate()
  const [connections, setConnections] = useState<Connection[]>([])
  const [amazonAccounts, setAmazonAccounts] = useState<AmazonAccount[]>([])
  const [channelStores, setChannelStores] = useState<ChannelStore[]>([])
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [channelForm, setChannelForm] = useState({ channel: 'shopify' as 'shopify' | 'tiktok', store_name: '', shop_domain: '', access_token: '', app_key: '', app_secret: '', shop_id: '', tiktok_access_token: '' })
  const [channelSaving, setChannelSaving] = useState(false)
  const [channelTesting, setChannelTesting] = useState<string | null>(null)
  const [channelGmailStatus, setChannelGmailStatus] = useState<Record<string, ChannelGmailStatus>>({})
  const [channelGmailConnecting, setChannelGmailConnecting] = useState<string | null>(null)
  const [showAmazonForm, setShowAmazonForm] = useState(false)
  const [amazonForm, setAmazonForm] = useState({ account_name: '', seller_id: '', marketplace_id: 'A1VC38T7YXB528', refresh_token: '', client_id: '', client_secret: '' })
  const [amazonSaving, setAmazonSaving] = useState(false)
  const [amazonTesting, setAmazonTesting] = useState<string | null>(null)
  const [amazonEditing, setAmazonEditing] = useState<string | null>(null)
  const [amazonEditForm, setAmazonEditForm] = useState({ account_name: '', seller_id: '', marketplace_id: '', refresh_token: '', client_id: '', client_secret: '', endpoint: '' })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // APIキー管理
  const [apiKeys, setApiKeys] = useState<{ id: string; label: string; placeholder: string; source: string; isSet: boolean; maskedValue: string; updatedAt: string | null }[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyTesting, setKeyTesting] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [connRes, amazonRes, channelRes, keysRes] = await Promise.all([
        api.get('/connections'),
        api.get('/amazon/accounts'),
        api.get('/channels'),
        api.get('/api-keys'),
      ])
      setConnections(connRes.data.connections)
      setAmazonAccounts(amazonRes.data.accounts || [])
      const stores = channelRes.data.stores || []
      setChannelStores(stores)
      setApiKeys(keysRes.data)

      // チャネル別Gmail状態を取得
      const gmailStatuses: Record<string, ChannelGmailStatus> = {}
      for (const store of stores) {
        if (store.gmail_token_id) {
          try {
            const gmRes = await api.get(`/channels/${store.id}/gmail/status`)
            gmailStatuses[store.id] = gmRes.data
          } catch { /* ignore */ }
        }
      }
      setChannelGmailStatus(gmailStatuses)
    } catch {
      setMessage({ type: 'error', text: 'API設定の取得に失敗しました' })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()

    // Listen for OAuth callback messages
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'oauth_complete') {
        fetchData()
        const svc = e.data.service as string
        if (svc?.startsWith('gmail_channel_')) {
          setChannelGmailConnecting(null)
          setMessage({ type: 'success', text: 'Gmail連携が完了しました（メール自動返信用）' })
        } else {
          setMessage({ type: 'success', text: `${svc} の認証が完了しました` })
        }
      }
      if (e.data?.type === 'shopify_connected') {
        fetchData()
        setMessage({ type: 'success', text: `Shopify「${e.data.shop}」を連携しました` })
      }
      if (e.data?.type === 'tiktok_connected') {
        fetchData()
        setMessage({ type: 'success', text: `TikTokショップ「${e.data.shop}」を連携しました` })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [fetchData])

  const handleGoogleLogin = async (serviceId: string) => {
    try {
      const { data } = await api.get(`/google/login?service=${serviceId}`)
      window.open(data.url, '_blank', 'width=600,height=700')
    } catch {
      setMessage({ type: 'error', text: '認証URLの取得に失敗しました' })
    }
  }

  const handleRefresh = async (id: string) => {
    setRefreshing(id)
    try {
      await api.post(`/connections/${id}/refresh`)
      setMessage({ type: 'success', text: `${id} のトークンを更新しました` })
      fetchData()
    } catch (err: any) {
      setMessage({ type: 'error', text: `更新失敗: ${err.response?.data?.error || err.message}` })
    }
    setRefreshing(null)
  }

  const handleShopifyOAuth = async () => {
    const shop = prompt('Shopifyストアのドメインを入力してください\n例: mystore.myshopify.com')
    if (!shop) return
    try {
      const { data } = await api.get(`/shopify/login?shop=${encodeURIComponent(shop)}`)
      window.open(data.url, '_blank', 'width=600,height=700')
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Shopify認証URLの取得に失敗しました' })
    }
  }

  const handleTikTokOAuth = async () => {
    try {
      const { data } = await api.get('/tiktok/login')
      window.open(data.url, '_blank', 'width=600,height=700')
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'TikTok認証URLの取得に失敗しました' })
    }
  }

  const handleChannelSave = async () => {
    if (!channelForm.store_name) {
      setMessage({ type: 'error', text: 'ストア名を入力してください' })
      return
    }
    if (channelForm.channel === 'shopify' && (!channelForm.shop_domain || !channelForm.access_token)) {
      setMessage({ type: 'error', text: 'Shopifyドメインとアクセストークンを入力してください' })
      return
    }
    if (channelForm.channel === 'tiktok' && (!channelForm.app_key || !channelForm.app_secret)) {
      setMessage({ type: 'error', text: 'App KeyとApp Secretを入力してください' })
      return
    }
    setChannelSaving(true)
    try {
      await api.post('/channels', channelForm)
      setMessage({ type: 'success', text: `${channelForm.channel === 'shopify' ? 'Shopify' : 'TikTokショップ'}を連携しました` })
      setShowChannelForm(false)
      setChannelForm({ channel: 'shopify', store_name: '', shop_domain: '', access_token: '', app_key: '', app_secret: '', shop_id: '', tiktok_access_token: '' })
      fetchData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '連携に失敗しました' })
    }
    setChannelSaving(false)
  }

  const handleChannelTest = async (id: string) => {
    setChannelTesting(id)
    try {
      await api.post(`/channels/${id}/test`)
      setMessage({ type: 'success', text: '接続テスト成功' })
      fetchData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'テスト失敗' })
    }
    setChannelTesting(null)
  }

  const handleChannelGmailConnect = async (storeId: string) => {
    setChannelGmailConnecting(storeId)
    try {
      const { data } = await api.get(`/channels/${storeId}/gmail/login`)
      window.open(data.url, '_blank', 'width=600,height=700')
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Gmail認証URLの取得に失敗しました' })
      setChannelGmailConnecting(null)
    }
  }

  const handleChannelGmailDisconnect = async (storeId: string) => {
    if (!confirm('このチャネルのGmail連携を解除しますか？メール自動返信が停止します。')) return
    try {
      await api.delete(`/channels/${storeId}/gmail/disconnect`)
      setChannelGmailStatus(prev => { const next = { ...prev }; delete next[storeId]; return next })
      setMessage({ type: 'success', text: 'Gmail連携を解除しました' })
      fetchData()
    } catch {
      setMessage({ type: 'error', text: 'Gmail連携の解除に失敗しました' })
    }
  }

  const handleChannelDelete = async (id: string) => {
    if (!confirm('このチャネルの接続を解除しますか？')) return
    try {
      await api.delete(`/channels/${id}`)
      setMessage({ type: 'success', text: 'チャネルを削除しました' })
      fetchData()
    } catch {
      setMessage({ type: 'error', text: '削除に失敗しました' })
    }
  }

  const handleAmazonEdit = async (id: string) => {
    try {
      const { data } = await api.get(`/amazon/accounts/${id}`)
      setAmazonEditForm({
        account_name: data.account_name || '',
        seller_id: data.seller_id || '',
        marketplace_id: data.marketplace_id || '',
        refresh_token: data.refresh_token || '',
        client_id: data.client_id || '',
        client_secret: data.client_secret || '',
        endpoint: data.endpoint || '',
      })
      setAmazonEditing(id)
    } catch (err: any) {
      setMessage({ type: 'error', text: 'アカウント情報の取得に失敗しました' })
    }
  }

  const handleAmazonUpdate = async () => {
    if (!amazonEditing) return
    setAmazonSaving(true)
    try {
      await api.put(`/amazon/accounts/${amazonEditing}`, amazonEditForm)
      setMessage({ type: 'success', text: 'Amazonアカウントを更新しました' })
      setAmazonEditing(null)
      fetchData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '更新に失敗しました' })
    }
    setAmazonSaving(false)
  }

  const handleAmazonSave = async () => {
    if (!amazonForm.account_name || !amazonForm.seller_id || !amazonForm.refresh_token || !amazonForm.client_id || !amazonForm.client_secret) {
      setMessage({ type: 'error', text: 'すべての必須項目を入力してください' })
      return
    }
    setAmazonSaving(true)
    try {
      await api.post('/amazon/accounts', amazonForm)
      setMessage({ type: 'success', text: 'Amazon SP-APIアカウントを接続しました' })
      setShowAmazonForm(false)
      setAmazonForm({ account_name: '', seller_id: '', marketplace_id: 'A1VC38T7YXB528', refresh_token: '', client_id: '', client_secret: '' })
      fetchData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '接続に失敗しました' })
    }
    setAmazonSaving(false)
  }

  const handleAmazonTest = async (id: string) => {
    setAmazonTesting(id)
    try {
      const { data } = await api.post(`/amazon/accounts/${id}/test`)
      if (data.success) {
        setMessage({ type: 'success', text: '✓ すべてのAPI権限OK: ' + data.tests.map((t: any) => t.name).join(', ') })
      } else {
        const failed = data.tests.filter((t: any) => !t.ok)
        const failMsg = failed.map((t: any) => `${t.name} (${t.status}): ${t.error}`).join(' / ')
        setMessage({ type: 'error', text: `権限不足: ${failMsg}` })
      }
      fetchData()
    } catch (err: any) {
      const d = err.response?.data
      setMessage({ type: 'error', text: `${d?.error || 'テスト失敗'}${d?.detail ? ' - ' + d.detail : ''}` })
    }
    setAmazonTesting(null)
  }

  const handleAmazonDelete = async (id: string) => {
    if (!confirm('このAmazonアカウントの接続を解除しますか？')) return
    try {
      await api.delete(`/amazon/accounts/${id}`)
      setMessage({ type: 'success', text: 'Amazonアカウントを削除しました' })
      fetchData()
    } catch {
      setMessage({ type: 'error', text: '削除に失敗しました' })
    }
  }

  const handleDisconnect = async (id: string) => {
    if (!confirm(`${id} の接続を解除しますか？`)) return
    try {
      await api.delete(`/connections/${id}`)
      setMessage({ type: 'success', text: `${id} の接続を解除しました` })
      fetchData()
    } catch {
      setMessage({ type: 'error', text: '接続解除に失敗しました' })
    }
  }

  const getConnection = (id: string) => connections.find(c => c.id === id)

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-4">
            <ArrowLeft size={16} />
            ツール一覧
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <Shield size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">API設定</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">全ツール共通のAPI接続を管理</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Message */}
        {message && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'}`}>
            {message.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {message.text}
            <button onClick={() => setMessage(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">閉じる</button>
          </div>
        )}

        {/* Google API Connections */}
        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Google API連携</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">OAuth認証で各Googleサービスと連携します。全ツールで共有されます。</p>

          <div className="space-y-3">
            {googleServices.map(service => {
              const conn = getConnection(service.id)
              const isConnected = !!conn
              const isExpired = conn?.isExpired

              return (
                <div key={service.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                  {/* Icon */}
                  <div className={`p-2.5 rounded-lg ${isConnected && !isExpired ? 'bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400' : isExpired ? 'bg-yellow-50 text-yellow-600 dark:bg-yellow-950/50 dark:text-yellow-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                    {service.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900 dark:text-white">{service.name}</h3>
                      {isConnected && !isExpired && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 size={12} /> 接続済み
                        </span>
                      )}
                      {isExpired && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/50 px-2 py-0.5 rounded-full">
                          <AlertTriangle size={12} /> 期限切れ
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{service.description}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      使用: {service.usedBy.join(', ')}
                      {conn?.updatedAt && <span className="ml-2">· 最終更新: {formatDate(conn.updatedAt)}</span>}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {isConnected && (
                      <>
                        <button
                          onClick={() => handleRefresh(service.id)}
                          disabled={refreshing === service.id}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/50 transition disabled:opacity-50"
                          title="トークン更新"
                        >
                          <RefreshCw size={16} className={refreshing === service.id ? 'animate-spin' : ''} />
                        </button>
                        <button
                          onClick={() => handleDisconnect(service.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/50 transition"
                          title="接続解除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleGoogleLogin(service.id)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition ${
                        isConnected
                          ? 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      <ExternalLink size={14} />
                      {isConnected ? '再認証' : '連携する'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Amazon SP-API */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Amazon SP-API</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">セラーセントラルのAPI認証情報を管理。Amazon自動出荷・請求書ツールで使用。</p>
            </div>
            <button
              onClick={() => setShowAmazonForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF9900] text-white text-sm font-medium hover:bg-[#E88B00] transition"
            >
              <Package size={16} />
              アカウント追加
            </button>
          </div>

          {/* Add form */}
          {showAmazonForm && (
            <div className="mb-4 p-5 rounded-xl border border-[#FF9900]/30 bg-[#FF9900]/5 dark:bg-[#FF9900]/10 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">アカウント名 *</label>
                  <input type="text" value={amazonForm.account_name} onChange={e => setAmazonForm({ ...amazonForm, account_name: e.target.value })} placeholder="メインアカウント" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">セラーID *</label>
                  <input type="text" value={amazonForm.seller_id} onChange={e => setAmazonForm({ ...amazonForm, seller_id: e.target.value })} placeholder="A1B2C3D4E5F6G7" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">LWA Client ID *</label>
                  <input type="text" value={amazonForm.client_id} onChange={e => setAmazonForm({ ...amazonForm, client_id: e.target.value })} placeholder="amzn1.application-oa2-client.xxxxx" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">マーケットプレイスID</label>
                  <input type="text" value={amazonForm.marketplace_id} onChange={e => setAmazonForm({ ...amazonForm, marketplace_id: e.target.value })} placeholder="A1VC38T7YXB528" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">LWA Client Secret *</label>
                <input type="password" value={amazonForm.client_secret} onChange={e => setAmazonForm({ ...amazonForm, client_secret: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">リフレッシュトークン *</label>
                <input type="password" value={amazonForm.refresh_token} onChange={e => setAmazonForm({ ...amazonForm, refresh_token: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleAmazonSave} disabled={amazonSaving} className="px-4 py-2 rounded-lg bg-[#FF9900] text-white text-sm font-medium hover:bg-[#E88B00] transition disabled:opacity-50">
                  {amazonSaving ? '接続確認中...' : '接続する'}
                </button>
                <button onClick={() => setShowAmazonForm(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition">
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* Account list */}
          {/* Edit form */}
          {amazonEditing && (
            <div className="mb-4 p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">アカウント編集</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">アカウント名</label>
                  <input type="text" value={amazonEditForm.account_name} onChange={e => setAmazonEditForm({ ...amazonEditForm, account_name: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">セラーID</label>
                  <input type="text" value={amazonEditForm.seller_id} onChange={e => setAmazonEditForm({ ...amazonEditForm, seller_id: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">LWA Client ID</label>
                  <input type="text" value={amazonEditForm.client_id} onChange={e => setAmazonEditForm({ ...amazonEditForm, client_id: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">マーケットプレイスID</label>
                  <input type="text" value={amazonEditForm.marketplace_id} onChange={e => setAmazonEditForm({ ...amazonEditForm, marketplace_id: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">LWA Client Secret</label>
                <input type="password" value={amazonEditForm.client_secret} onChange={e => setAmazonEditForm({ ...amazonEditForm, client_secret: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">リフレッシュトークン</label>
                <input type="password" value={amazonEditForm.refresh_token} onChange={e => setAmazonEditForm({ ...amazonEditForm, refresh_token: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">エンドポイント</label>
                <input type="text" value={amazonEditForm.endpoint} onChange={e => setAmazonEditForm({ ...amazonEditForm, endpoint: e.target.value })} placeholder="https://sellingpartnerapi-fe.amazon.com" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleAmazonUpdate} disabled={amazonSaving} className="px-4 py-2 rounded-lg bg-[#FF9900] text-white text-sm font-medium hover:bg-[#E88B00] transition disabled:opacity-50">
                  {amazonSaving ? '更新中...' : '更新する'}
                </button>
                <button onClick={() => setAmazonEditing(null)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-950 transition">
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {amazonAccounts.length > 0 ? (
            <div className="space-y-3">
              {amazonAccounts.map(acct => (
                <div key={acct.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                  <div className="p-2.5 rounded-lg bg-[#FF9900]/10 text-[#FF9900]">
                    <Package size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900 dark:text-white">{acct.account_name}</h3>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${acct.is_active ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50' : 'text-slate-500 bg-slate-100'}`}>
                        {acct.is_active ? <><CheckCircle2 size={12} /> 接続中</> : '無効'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      セラーID: {acct.seller_id} · マーケットプレイス: {acct.marketplace_id}
                      {acct.last_synced_at && <span className="ml-2">· 最終確認: {new Date(acct.last_synced_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                    </p>
                  </div>
                  <button onClick={() => handleAmazonEdit(acct.id)} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition" title="編集">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleAmazonTest(acct.id)} disabled={amazonTesting === acct.id} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/50 transition disabled:opacity-50" title="接続テスト">
                    <RefreshCw size={16} className={amazonTesting === acct.id ? 'animate-spin' : ''} />
                  </button>
                  <button onClick={() => handleAmazonDelete(acct.id)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/50 transition" title="削除">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : !showAmazonForm && (
            <div className="p-8 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
              <Package size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Amazon SP-APIアカウントが未連携です</p>
              <button onClick={() => setShowAmazonForm(true)} className="mt-2 text-sm font-medium text-[#FF9900] hover:underline">アカウントを追加する</button>
            </div>
          )}
        </section>

        {/* Shopify / TikTok Shop Channels */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">販売チャネル連携</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Shopify・TikTokショップを接続。Amazon自動出荷で使用。</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleShopifyOAuth}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#96BF48] text-white text-sm font-medium hover:bg-[#7ea33d] transition"
              >
                <ShoppingBag size={16} />
                Shopify連携
              </button>
              <button
                onClick={handleTikTokOAuth}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition"
              >
                <Store size={16} />
                TikTok連携
              </button>
            </div>
          </div>

          {/* Add form */}
          {showChannelForm && (
            <div className="mb-4 p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 space-y-4">
              {/* Platform selector */}
              <div className="flex gap-2">
                <button
                  onClick={() => setChannelForm({ ...channelForm, channel: 'shopify' })}
                  className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition ${channelForm.channel === 'shopify' ? 'border-[#96BF48] bg-[#96BF48]/5 text-[#96BF48]' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}
                >
                  <ShoppingBag size={18} />
                  Shopify
                </button>
                <button
                  onClick={() => setChannelForm({ ...channelForm, channel: 'tiktok' })}
                  className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition ${channelForm.channel === 'tiktok' ? 'border-slate-900 dark:border-white bg-slate-900/5 dark:bg-white/5 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}
                >
                  <Store size={18} />
                  TikTokショップ
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">ストア名 *</label>
                <input type="text" value={channelForm.store_name} onChange={e => setChannelForm({ ...channelForm, store_name: e.target.value })} placeholder="マイストア" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              </div>

              {channelForm.channel === 'shopify' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Shopifyドメイン *</label>
                    <input type="text" value={channelForm.shop_domain} onChange={e => setChannelForm({ ...channelForm, shop_domain: e.target.value })} placeholder="mystore.myshopify.com" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">アクセストークン *</label>
                    <input type="password" value={channelForm.access_token} onChange={e => setChannelForm({ ...channelForm, access_token: e.target.value })} placeholder="shpat_xxxxx" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                    <p className="mt-1 text-xs text-slate-400">Shopify管理画面 → 設定 → アプリと販売チャネル → アプリを開発 で取得</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">App Key *</label>
                      <input type="text" value={channelForm.app_key} onChange={e => setChannelForm({ ...channelForm, app_key: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">App Secret *</label>
                      <input type="password" value={channelForm.app_secret} onChange={e => setChannelForm({ ...channelForm, app_secret: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Shop ID</label>
                      <input type="text" value={channelForm.shop_id} onChange={e => setChannelForm({ ...channelForm, shop_id: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">アクセストークン</label>
                      <input type="password" value={channelForm.tiktok_access_token} onChange={e => setChannelForm({ ...channelForm, tiktok_access_token: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">TikTok Shop Partner Center → アプリ管理 で取得</p>
                </>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={handleChannelSave} disabled={channelSaving} className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition disabled:opacity-50">
                  {channelSaving ? '接続確認中...' : '連携する'}
                </button>
                <button onClick={() => setShowChannelForm(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-950 transition">
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* Channel list */}
          {channelStores.length > 0 ? (
            <div className="space-y-3">
              {channelStores.map(store => (
                <div key={store.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                  <div className={`p-2.5 rounded-lg ${store.channel.toLowerCase() === 'shopify' ? 'bg-[#96BF48]/10 text-[#96BF48]' : 'bg-slate-900/10 dark:bg-white/10 text-slate-900 dark:text-white'}`}>
                    {store.channel.toLowerCase() === 'shopify' ? <ShoppingBag size={20} /> : <Store size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900 dark:text-white">{store.store_name}</h3>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${store.channel.toLowerCase() === 'shopify' ? 'text-[#96BF48] bg-[#96BF48]/10' : 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800'}`}>
                        {store.channel.toLowerCase() === 'shopify' ? 'Shopify' : 'TikTok'}
                      </span>
                      {store.is_active && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 size={12} /> 接続中
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {store.shop_domain || store.shop_id || '-'}
                      {store.last_synced_at && <span className="ml-2">· 最終確認: {new Date(store.last_synced_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                    </p>
                  </div>
                  {/* Gmail連携ボタン */}
                  {channelGmailStatus[store.id]?.hasToken ? (
                    <button onClick={() => handleChannelGmailDisconnect(store.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition" title="Gmail連携済み">
                      <Mail size={14} />
                      <CheckCircle2 size={12} />
                      Gmail
                    </button>
                  ) : (
                    <button onClick={() => handleChannelGmailConnect(store.id)} disabled={channelGmailConnecting === store.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50" title="Gmail連携">
                      <Mail size={14} />
                      {channelGmailConnecting === store.id ? '認証中...' : 'Gmail連携'}
                    </button>
                  )}
                  <button onClick={() => handleChannelTest(store.id)} disabled={channelTesting === store.id} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/50 transition disabled:opacity-50" title="接続テスト">
                    <RefreshCw size={16} className={channelTesting === store.id ? 'animate-spin' : ''} />
                  </button>
                  <button onClick={() => handleChannelDelete(store.id)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/50 transition" title="削除">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : !showChannelForm && (
            <div className="p-8 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
              <ShoppingBag size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">販売チャネルが未連携です</p>
              <button onClick={() => setShowChannelForm(true)} className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">チャネルを追加する</button>
            </div>
          )}
        </section>

        {/* APIキー設定 */}
        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">APIキー設定</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">各サービスのAPIキーを設定・管理します。暗号化して保存されます。</p>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 divide-y divide-slate-100 dark:divide-slate-800">
            {apiKeys.map(key => (
              <div key={key.id} className="px-4 py-3.5">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${key.isSet ? 'bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                    <Bot size={20} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white">{key.label}</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {key.isSet ? (
                        <span>{key.source === 'database' ? `DB保存 ${key.maskedValue}` : key.maskedValue}</span>
                      ) : '未設定'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {key.isSet && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                        <CheckCircle2 size={14} />
                      </span>
                    )}
                    {key.id === 'anthropic' && key.isSet && (
                      <button
                        onClick={async () => {
                          setKeyTesting(key.id)
                          try {
                            const res = await api.post(`/api-keys/${key.id}/test`)
                            setMessage({ type: 'success', text: res.data.message })
                          } catch (err: unknown) {
                            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'テスト失敗'
                            setMessage({ type: 'error', text: msg })
                          } finally { setKeyTesting(null) }
                        }}
                        disabled={keyTesting === key.id}
                        className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-400"
                      >
                        {keyTesting === key.id ? 'テスト中...' : 'テスト'}
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingKey(editingKey === key.id ? null : key.id); setKeyInput('') }}
                      className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {editingKey === key.id ? 'キャンセル' : key.isSet ? '変更' : '設定'}
                    </button>
                    {key.isSet && key.source === 'database' && (
                      <button
                        onClick={async () => {
                          if (!confirm(`${key.label} のキーを削除しますか？`)) return
                          await api.delete(`/api-keys/${key.id}`)
                          fetchData()
                          setMessage({ type: 'success', text: `${key.label} を削除しました` })
                        }}
                        className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded dark:hover:bg-red-950"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 入力フォーム */}
                {editingKey === key.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      value={keyInput}
                      onChange={e => setKeyInput(e.target.value)}
                      placeholder={key.placeholder || 'APIキーを入力...'}
                      className="flex-1 text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                    <button
                      onClick={async () => {
                        if (!keyInput) return
                        setKeySaving(true)
                        try {
                          await api.post(`/api-keys/${key.id}`, { apiKey: keyInput })
                          setEditingKey(null); setKeyInput('')
                          fetchData()
                          setMessage({ type: 'success', text: `${key.label} を保存しました` })
                        } catch (err: unknown) {
                          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '保存失敗'
                          setMessage({ type: 'error', text: msg })
                        } finally { setKeySaving(false) }
                      }}
                      disabled={keySaving || !keyInput}
                      className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50"
                    >
                      {keySaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            APIキーはAES-256-GCMで暗号化してデータベースに保存されます。環境変数に設定済みのキーはそちらが優先されます。
          </p>
        </section>
      </main>
    </div>
  )
}
