import { useEffect, useState } from 'react'
import { saApi, type Device, type Preset, type Signups } from './api'

export function useSignups(preset: Preset, device: Device, path: string | null, includeAds = false, enabled = true) {
  const key = `${preset}|${device}|${path ?? ''}|${includeAds ? 1 : 0}`
  const [state, setState] = useState<{ key: string; data: Signups | null; err: string }>({ key: '', data: null, err: '' })

  useEffect(() => {
    if (!enabled) return
    let alive = true
    saApi.get<Signups>('/signups', { params: { preset, device, ...(path ? { path } : {}), ...(includeAds ? { ads: '1' } : {}) } })
      .then((r) => { if (alive) setState({ key, data: r.data, err: '' }) })
      .catch((e) => { if (alive) setState((s) => ({ key, data: s.data, err: e?.response?.data?.error || '取得に失敗しました' })) })
    return () => { alive = false }
  }, [key, preset, device, path, includeAds, enabled])

  return { data: state.data, loading: enabled && state.key !== key, err: state.key === key ? state.err : '' }
}

/** 設置場所のコード（テーマの data-fpl-place / utm_content）を日本語に */
export function placeLabel(place: string | null | undefined, kind: 'line' | 'myfitpeak' = 'line') {
  if (!place || place === '(不明)') return kind === 'line' ? '設置場所の記録なし' : 'リンク文言の記録なし'
  if (kind === 'myfitpeak') return place.length > 40 ? place.slice(0, 40) + '…' : place
  if (/^[0-9]{12,}$/.test(place)) return `Meta広告（広告ID ${place.slice(-6)}）`
  const map: Record<string, string> = {
    kt_article_end: '記事の読了直後カード',
    top_bottom: 'トップページ下部のカード',
    tools_bottom: 'ツール・固定ページ下部のカード',
    navi_bottom: '筋トレ最安ナビ下部のカード',
    site_bottom: 'ページ下部のカード',
  }
  if (map[place]) return map[place]
  const m = place.match(/^sticky_(.+)$/)
  if (m) {
    const t: Record<string, string> = { article: '記事', blog: '記事一覧', page: '固定ページ', index: 'トップ', collection: 'コレクション' }
    return `スマホ追従バー（${t[m[1]] || m[1]}）`
  }
  return place
}
