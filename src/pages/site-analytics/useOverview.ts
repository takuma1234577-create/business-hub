import { useEffect, useState } from 'react'
import { saApi, type Device, type Overview, type Preset } from './api'
import { getLang, t } from './i18n'

export function useOverview(preset: Preset, device: Device, path: string | null, enabled = true) {
  const key = `${preset}|${device}|${path ?? ''}`
  const [state, setState] = useState<{ key: string; data: Overview | null; err: string }>({ key: '', data: null, err: '' })

  useEffect(() => {
    if (!enabled) return
    let alive = true
    saApi.get<Overview>('/overview', { params: { preset, device, ...(path ? { path } : {}) } })
      .then((r) => { if (alive) setState({ key, data: r.data, err: '' }) })
      .catch((e) => { if (alive) setState((s) => ({ key, data: s.data, err: e?.response?.data?.error || t('取得に失敗しました') })) })
    return () => { alive = false }
  }, [key, preset, device, path, enabled])

  // 条件が変わった直後は前回のデータを薄く表示したまま読み込む
  return { data: state.data, loading: enabled && state.key !== key, err: state.key === key ? state.err : '' }
}

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土']
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatBucket(bucket: string, gran: 'hour' | 'day') {
  // bucket は日本時間の "YYYY-MM-DDTHH:MI"
  const en = getLang() === 'en'
  const [d, hm] = bucket.split('T')
  const [y, m, day] = d.split('-')
  if (gran === 'hour') {
    const h = Number(hm.split(':')[0])
    return en ? `${Number(m)}/${Number(day)} ${h}:00` : `${Number(m)}/${Number(day)} ${h}時`
  }
  const dow = new Date(Date.UTC(Number(y), Number(m) - 1, Number(day))).getUTCDay()
  return en
    ? `${Number(m)}/${Number(day)} (${DOW_EN[dow]})`
    : `${Number(m)}/${Number(day)}(${DOW_JA[dow]})`
}
