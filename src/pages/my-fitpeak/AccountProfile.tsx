import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Lock, Eye, X } from 'lucide-react'
import { apiFetch } from './lib/api'
import { fitpeakSupabase } from './lib/supabase'

/**
 * My FITPEAK アカウントのプロフィール（2026-10-17）
 *  公開してよい項目 … 表示名・都道府県・市区町村・通っているジム・年代・性別（合トレナビなどで他の会員に見える）
 *    → サーバー /api/my-fitpeak/account/public（ジムは収録データと照合）
 *  非公開項目 … 本名・カナ・メール・郵便番号・住所・電話（本人と運営だけ）
 *    → サーバーを通さず、本人のログインで DB 関数 mf_account_get / mf_private_save / mf_private_delete を直接呼ぶ
 */

const PREFS = '北海道,青森県,岩手県,宮城県,秋田県,山形県,福島県,茨城県,栃木県,群馬県,埼玉県,千葉県,東京都,神奈川県,新潟県,富山県,石川県,福井県,山梨県,長野県,岐阜県,静岡県,愛知県,三重県,滋賀県,京都府,大阪府,兵庫県,奈良県,和歌山県,鳥取県,島根県,岡山県,広島県,山口県,徳島県,香川県,愛媛県,高知県,福岡県,佐賀県,長崎県,熊本県,大分県,宮崎県,鹿児島県,沖縄県'.split(',')
const AGES: Record<string, string> = { '18-24': '18〜24歳', '25-34': '25〜34歳', '35-44': '35〜44歳', '45+': '45歳以上', none: '回答しない' }
const GENDERS: Record<string, string> = { male: '男性', female: '女性', none: '回答しない' }

type Gym = { kind: 'review' | 'store' | 'other'; key?: string; name: string; status?: string; pref?: string; city?: string }
type Pub = { display_name: string; pref: string; city: string; age_band: string; gender: string; gyms: Gym[] }
type Priv = { last_name: string; first_name: string; last_name_kana: string; first_name_kana: string; email: string
  zip: string; province: string; city: string; address1: string; address2: string; phone: string }

const EMPTY_PUB: Pub = { display_name: '', pref: '', city: '', age_band: '', gender: '', gyms: [] }
const EMPTY_PRIV: Priv = { last_name: '', first_name: '', last_name_kana: '', first_name_kana: '', email: '', zip: '', province: '', city: '', address1: '', address2: '', phone: '' }

const input = 'w-full rounded-[12px] border border-[#d2d2d7] bg-white px-3 py-2.5 text-[16px] text-[#111] outline-none focus:border-[#111]'

function Field({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm text-[#444]">{label}</span>
      {children}
      {note && <span className="mt-1 block text-xs text-[#808080]">{note}</span>}
    </label>
  )
}

function Seg({ options, value, onChange }: { options: Record<string, string>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(options).map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rounded-full border px-3.5 py-2 text-sm ${value === k ? 'border-[#111] bg-[#111] text-white' : 'border-[#d2d2d7] bg-white text-[#222]'}`}>{l}</button>
      ))}
    </div>
  )
}

function GymPicker({ pref, value, onChange }: { pref: string; value: Gym[]; onChange: (v: Gym[]) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Gym[]>([])
  const [other, setOther] = useState('')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!q.trim()) { setHits([]); return }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/my-fitpeak/account/gyms?q=${encodeURIComponent(q.trim())}&pref=${encodeURIComponent(pref)}`)
        const j = await r.json()
        setHits(r.ok ? j.gyms || [] : [])
      } catch { setHits([]) }
    }, 300)
  }, [q, pref])
  const add = (g: Gym) => {
    if (value.length >= 5 || value.some((x) => (x.key && x.key === g.key) || (x.kind === 'other' && x.name === g.name))) return
    onChange([...value, g]); setQ(''); setHits([])
  }
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((g, i) => (
            <li key={i} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#111] bg-white px-3 py-1.5 text-sm text-[#111]">
              <span className="truncate">{g.name}{g.kind === 'other' && g.status !== 'ok' ? '（確認待ち）' : ''}</span>
              <button type="button" aria-label="外す" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} className={input} placeholder={pref ? `${pref}のジム名で検索（例：エニタイム 渋谷）` : 'ジム名で検索'} />
      {hits.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-[12px] border border-[#e6e6e6] bg-white">
          {hits.map((g) => (
            <li key={g.key}>
              <button type="button" onClick={() => add(g)} className="block w-full px-3 py-2.5 text-left text-sm hover:bg-[#f5f5f7]">
                <span className="block text-[#111]">{g.name}</span>
                <span className="block text-xs text-[#808080]">{g.pref}{g.city}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input value={other} maxLength={60} onChange={(e) => setOther(e.target.value)} className={input} placeholder="見つからないときは「その他」：ジム名を入力" />
        <button type="button" disabled={!other.trim()} onClick={() => { add({ kind: 'other', name: other.trim(), status: 'pending' }); setOther('') }}
          className="shrink-0 rounded-[12px] border border-[#111] px-4 text-sm font-bold text-[#111] disabled:opacity-40">追加</button>
      </div>
      <p className="text-xs text-[#808080]">最大5件。「その他」のジムは運営が確認してから、ほかの会員に表示されます。</p>
    </div>
  )
}

export default function AccountProfile() {
  const [pub, setPub] = useState<Pub>(EMPTY_PUB)
  const [priv, setPriv] = useState<Priv>(EMPTY_PRIV)
  const [hasPriv, setHasPriv] = useState(false)
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const [params] = useSearchParams()
  const nav = useNavigate()
  const next = params.get('next')

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await fitpeakSupabase.rpc('mf_account_get')
        if (error) throw error
        if (data?.public) setPub({ ...EMPTY_PUB, ...data.public })
        if (data?.private) {
          const p = data.private
          setPriv({ ...EMPTY_PRIV, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])) } as Priv)
          setHasPriv(true); setAgree(true)
        }
      } catch { setErr('プロフィールを読み込めませんでした。時間をおいてもう一度お試しください') }
      setLoading(false)
    })()
  }, [])

  const save = async () => {
    setErr(''); setDone(''); setBusy(true)
    try {
      const r = await apiFetch('/api/my-fitpeak/account/public', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pub),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || '保存に失敗しました')
      const { error } = await fitpeakSupabase.rpc('mf_private_save', { p: priv, p_agree: agree })
      if (error) throw new Error(error.message)
      setHasPriv(true)
      if (next && next.startsWith('/my-fitpeak/')) { nav(next); return }
      setDone('保存しました')
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const removePrivate = async () => {
    if (!window.confirm('お名前・メールアドレス・住所・電話番号を削除しますか？（合トレナビなど、登録が必要な機能は使えなくなります）')) return
    const { error } = await fitpeakSupabase.rpc('mf_private_delete')
    if (error) { setErr(error.message); return }
    setPriv(EMPTY_PRIV); setHasPriv(false); setAgree(false); setDone('非公開の情報を削除しました')
  }

  if (loading) return <div className="py-10 text-center text-sm text-[#808080]">読み込み中…</div>
  const set = (k: keyof Priv) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setPriv({ ...priv, [k]: e.target.value })

  return (
    <section id="profile" className="rounded-[20px] bg-white border border-[#e6e6e6] p-5 sm:p-6 space-y-6">
      <div>
        <h2 className="text-base font-bold text-[#111]">プロフィール</h2>
        <p className="mt-1 text-xs leading-relaxed text-[#6b6b6b]">合トレナビなどの機能で使います。項目ごとに、ほかの会員に見えるかどうかを表示しています。</p>
      </div>

      <div className="space-y-4">
        <p className="flex items-center gap-1.5 text-sm font-bold text-[#111]"><Eye size={15} />ほかの会員に見える項目</p>
        <Field label="表示名（ニックネーム・20文字まで）"><input value={pub.display_name} maxLength={20} onChange={(e) => setPub({ ...pub, display_name: e.target.value })} className={input} placeholder="例：ベンチ100目標" /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="都道府県">
            <select value={pub.pref} onChange={(e) => setPub({ ...pub, pref: e.target.value })} className={input}>
              <option value="">選んでください</option>{PREFS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="市区町村" note="公開されるのは市区町村までです"><input value={pub.city} maxLength={30} onChange={(e) => setPub({ ...pub, city: e.target.value })} className={input} placeholder="例：渋谷区" /></Field>
        </div>
        <div><p className="mb-1.5 text-sm text-[#444]">年代</p><Seg options={AGES} value={pub.age_band} onChange={(v) => setPub({ ...pub, age_band: v })} /></div>
        <div><p className="mb-1.5 text-sm text-[#444]">性別（合トレの「同性のみ」の判定に使います）</p><Seg options={GENDERS} value={pub.gender} onChange={(v) => setPub({ ...pub, gender: v })} /></div>
        <div><p className="mb-1.5 text-sm text-[#444]">通っているジム（ジムナビ収録のジムから選択・複数可）</p><GymPicker pref={pub.pref} value={pub.gyms} onChange={(g) => setPub({ ...pub, gyms: g })} /></div>
      </div>

      <div className="space-y-4 border-t border-[#efefef] pt-5">
        <p className="flex items-center gap-1.5 text-sm font-bold text-[#111]"><Lock size={15} />ほかの会員には見えない項目（本人と運営だけ）</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="姓"><input value={priv.last_name} maxLength={30} onChange={set('last_name')} className={input} autoComplete="family-name" /></Field>
          <Field label="名"><input value={priv.first_name} maxLength={30} onChange={set('first_name')} className={input} autoComplete="given-name" /></Field>
          <Field label="セイ（カタカナ）"><input value={priv.last_name_kana} maxLength={30} onChange={set('last_name_kana')} className={input} /></Field>
          <Field label="メイ（カタカナ）"><input value={priv.first_name_kana} maxLength={30} onChange={set('first_name_kana')} className={input} /></Field>
        </div>
        <Field label="メールアドレス" note="LINEでログインした方も、連絡のとれるメールアドレスを入力してください"><input type="email" value={priv.email} onChange={set('email')} className={input} autoComplete="email" /></Field>
        <p className="text-sm text-[#444]">住所（任意・商品のお届け先として使います）</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="郵便番号"><input value={priv.zip} inputMode="numeric" maxLength={8} onChange={set('zip')} className={input} autoComplete="postal-code" placeholder="例：150-0002" /></Field>
          <Field label="都道府県">
            <select value={priv.province} onChange={set('province')} className={input} autoComplete="address-level1">
              <option value="">選んでください</option>{PREFS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="市区町村"><input value={priv.city} maxLength={60} onChange={set('city')} className={input} autoComplete="address-level2" /></Field>
          <Field label="町名・番地"><input value={priv.address1} maxLength={100} onChange={set('address1')} className={input} autoComplete="address-line1" /></Field>
          <Field label="建物名・部屋番号（任意）"><input value={priv.address2} maxLength={100} onChange={set('address2')} className={input} autoComplete="address-line2" /></Field>
          <Field label="電話番号（任意）"><input type="tel" value={priv.phone} maxLength={20} onChange={set('phone')} className={input} autoComplete="tel" /></Field>
        </div>
      </div>

      <div className="rounded-[14px] bg-[#f5f5f7] p-4 text-xs leading-relaxed text-[#444]">
        <p className="mb-1 font-bold text-[#111]">お預かりする情報の使い道と公開範囲</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>お名前・メールアドレス・住所・電話番号は、本人確認、トラブル時の安全対応、運営からのご連絡、商品のお届け先の入力に使います。ほかの会員には表示せず、合トレの相手にも伝わりません。</li>
          <li>表示名・都道府県・市区町村・通っているジム・年代・性別は、合トレナビなどでほかの会員に表示されます（番地などの住所は表示しません）。</li>
          <li>非公開の情報はこの画面からいつでも削除できます。退会するとすべて削除されます。</li>
        </ul>
        <a href="https://fitpeak.co/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline">プライバシーポリシー</a>
      </div>
      <label className="flex items-start gap-2 text-sm text-[#222]">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 accent-[#111]" />
        上の使い道と公開範囲に同意します
      </label>

      {err && <p className="text-sm text-[#c00]">{err}</p>}
      {done && <p className="text-sm text-[#047d3b]">{done}</p>}
      <button type="button" onClick={save} disabled={busy || !agree}
        className="w-full rounded-full bg-[#111] py-3.5 text-sm font-bold text-white disabled:opacity-40">{busy ? '保存中…' : '保存する'}</button>
      {hasPriv && (
        <button type="button" onClick={removePrivate} className="block text-xs text-[#808080] underline">お名前・メール・住所・電話番号を削除する</button>
      )}
    </section>
  )
}
