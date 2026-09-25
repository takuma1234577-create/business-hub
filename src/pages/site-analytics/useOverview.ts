import { useEffect, useState } from 'react'
import { saApi, type Device, type Overview, type Preset } from './api'

export function useOverview(preset: Preset, device: Device, path: string | null, enabled = true) {
  const key = `${preset}|${device}|${path ?? ''}`
  const [state, setState] = useState<{ key: string; data: Overview | null; err: string }>({ key: '', data: null, err: '' })

  useEffect(() => {
    if (!enabled) return
    let alive = true
    saApi.get<Overview>('/overview', { params: { preset, device, ...(path ? { path } : {}) } })
      .then((r) => { if (alive) setState({ key, data: r.data, err: '' }) })
      .catch((e) => { if (alive) setState((s) => ({ key, data: s.data, err: e?.response?.data?.error || '取得に失敗しました' })) })
    return () => { alive = false }
  }, [key, preset, device, path, enabled])

  // 条件が変わった直後は前回のデータを薄く表示したまま読み込む
  return { data: state.data, loading: enabled && state.key !== key, err: state.key === key ? state.err : '' }
}

export function formatBucket(t: string, gran: 'hour' | 'day') {
  // t は日本時間の "YYYY-MM-DDTHH:MI"
  const [d, hm] = t.split('T')
  const [y, m, day] = d.split('-')
  if (gran === 'hour') return `${Number(m)}/${Number(day)} ${Number(hm.split(':')[0])}時`
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(Number(y), Number(m) - 1, Number(day))).getUTCDay()]
  return `${Number(m)}/${Number(day)}(${w})`
}
