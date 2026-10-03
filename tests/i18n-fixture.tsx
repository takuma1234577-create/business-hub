/** @jsxImportSource @business-hub/i18n */
import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'
import LanguageSwitcher from '../src/i18n/LanguageSwitcher'
import { uiText } from '../src/i18n/dialogs'
import { getLocale, useLanguage } from '../src/i18n/store'

function Fixture() {
  useLanguage()
  const [value, setValue] = useState('draft')
  const [visible, setVisible] = useState(true)
  const ref = useRef<HTMLInputElement>(null)
  return <>
    <LanguageSwitcher />
    <h1>業務ツール</h1>
    <input id="controlled" ref={ref} value={value} onChange={e => setValue(e.target.value)} placeholder="検索..." />
    <input id="uncontrolled" defaultValue="original" />
    <textarea id="textarea" placeholder="検索..." defaultValue="保存" />
    <select id="implicit-option"><option>保存</option><option>削除</option></select>
    <select id="explicit-option"><option value="save">保存</option><option value="delete">削除</option></select>
    <div translate="no"><span id="original">保存</span></div>
    <div id="mixed-count">{12}件</div>
    <div id="parameter-name">{uiText('保存 の接続を解除しますか？')}</div>
    <div id="escaped-template">{uiText('出品を作成しました: CAM / $123（写真は別途必要です）')}</div>
    <div id="template-token">{'{会社名}'}</div>
    <div id="locale-date">{new Date('2026-10-03T12:00:00Z').toLocaleDateString(getLocale(), { month: 'long', day: 'numeric', timeZone: 'UTC' })}</div>
    <div contentEditable suppressContentEditableWarning id="editable">保存</div>
    <button id="toggle" onClick={() => setVisible(!visible)}>表示</button>
    {visible && <span id="conditional">保存</span>}
    <button id="ref-focus" onClick={() => ref.current?.focus()}>Focus</button>
    <button id="dialog" onClick={() => alert(uiText('保存しました'))}>Alert</button>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
