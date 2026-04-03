import { useEffect, useState } from 'react';
import type { EmailTemplate } from './types';
import { templateApi } from './api';

const emptyTemplate = (): Omit<EmailTemplate, 'id'> => ({
  name: '',
  subject: '',
  body: '',
});

export function TemplateManager() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [form, setForm] = useState(emptyTemplate());
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setTemplates(await templateApi.list());
    } catch (e: any) {
      setError('テンプレート一覧の取得に失敗しました: ' + e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    try {
      if (editing) {
        await templateApi.update(editing.id, form);
      } else {
        await templateApi.create(form);
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyTemplate());
      load();
    } catch (e: any) {
      setError('保存に失敗しました: ' + e.message);
    }
  };

  const handleEdit = (t: EmailTemplate) => {
    setEditing(t);
    setForm({ name: t.name, subject: t.subject, body: t.body });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    try {
      await templateApi.delete(id);
      load();
    } catch (e: any) {
      setError('削除に失敗しました: ' + e.message);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200">
          {error}
          <button onClick={() => setError('')} className="ml-4 text-xs underline">閉じる</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-800">メールテンプレート</h2>
        <button
          onClick={() => { setShowForm(true); setEditing(null); setForm(emptyTemplate()); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition"
        >
          + 新規追加
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">使用可能な変数（件名・本文で使えます）</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-blue-700">
          <span><code className="bg-blue-100 px-1 rounded">{"{会社名}"}</code> 請求先の会社名</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{担当者名}"}</code> 請求先の担当者</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{請求項目}"}</code> 項目と金額の一覧</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{品目}"}</code> 品目名のみ（カンマ区切り）</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{合計金額}"}</code> 合計金額</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{小計}"}</code> 小計</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{請求書番号}"}</code> 請求書番号</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{請求日}"}</code> 請求日</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{支払期限}"}</code> 支払期限</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{差出人名}"}</code> あなたの名前</span>
          <span><code className="bg-blue-100 px-1 rounded">{"{会社名_差出人}"}</code> あなたの会社名</span>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">{editing ? 'テンプレート編集' : '新規テンプレート'}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">テンプレート名</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">件名</label>
              <input type="text" value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">本文（{"{会社名}"}は自動置換されます）</label>
              <textarea value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} rows={8}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleSubmit} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-blue-700 transition">
              {editing ? '更新' : '追加'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null); }} className="text-gray-600 border border-gray-300 px-6 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {templates.length === 0 ? (
          <p className="text-center text-gray-500 py-12 text-sm bg-white rounded-xl border border-gray-200">テンプレートがありません</p>
        ) : (
          templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-medium text-gray-800">{t.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">件名: {t.subject}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(t)} className="text-xs text-blue-600 hover:underline">編集</button>
                  <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:underline">削除</button>
                </div>
              </div>
              <pre className="text-xs text-gray-500 bg-gray-50 rounded p-3 whitespace-pre-wrap">{t.body}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
