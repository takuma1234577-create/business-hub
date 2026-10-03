/** @jsxImportSource @business-hub/i18n */
import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'
import LanguageSwitcher from '../src/i18n/LanguageSwitcher'
import { uiText } from '../src/i18n/dialogs'

function Fixture() {
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
    <button id="toggle" onClick={() => setVisible(!visible)}>表示</button>
    {visible && <span id="conditional">保存</span>}
    <button id="ref-focus" onClick={() => ref.current?.focus()}>Focus</button>
    <button id="dialog" onClick={() => alert(uiText('保存しました'))}>Alert</button>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
