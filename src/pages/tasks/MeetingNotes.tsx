import { useState, useEffect, useRef } from 'react';
import { api } from './api';
import type { MeetingNote, Customer } from './types';
import axios from 'axios';

export default function MeetingNotes() {
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tab, setTab] = useState<'text' | 'file'>('text');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ summary: string; tasks_created: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [textForm, setTextForm] = useState({
    customer_id: '',
    title: '',
    content: '',
    meeting_date: '',
  });

  const [fileForm, setFileForm] = useState({
    customer_id: '',
    title: '',
    meeting_date: '',
    file: null as File | null,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [notesRes, customersRes] = await Promise.all([
        api.get('/meetings'),
        api.get('/customers'),
      ]);
      setNotes((notesRes as unknown as { data: { data: MeetingNote[] } }).data.data || []);
      setCustomers((customersRes as unknown as { data: { data: Customer[] } }).data.data || []);
    } catch (err) {
      console.error('データ取得エラー:', err);
    }
  };

  const submitText = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post('/meetings/import/text', textForm);
      const data = (res as unknown as { data: { data: typeof result } }).data.data;
      setResult(data);
      setTextForm({ customer_id: '', title: '', content: '', meeting_date: '' });
      loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submitFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileForm.file) { setError('ファイルを選択してください'); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', fileForm.file);
      if (fileForm.customer_id) formData.append('customer_id', fileForm.customer_id);
      if (fileForm.title) formData.append('title', fileForm.title);
      if (fileForm.meeting_date) formData.append('meeting_date', fileForm.meeting_date);

      const res = await axios.post('/api/tasks/meetings/import/file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data.data);
      setFileForm({ customer_id: '', title: '', meeting_date: '', file: null });
      if (fileRef.current) fileRef.current.value = '';
      loadData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e.response?.data?.error || e.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">📋 議事録管理</h1>

      {/* インポートフォーム */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
        <h2 className="font-bold text-gray-800 mb-4">議事録をインポート</h2>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('text')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            📝 テキスト入力
          </button>
          <button
            onClick={() => setTab('file')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'file' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            📎 ファイルアップロード
          </button>
        </div>

        {tab === 'text' ? (
          <form onSubmit={submitText} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <select
                value={textForm.customer_id}
                onChange={e => setTextForm({ ...textForm, customer_id: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">顧客を選択（任意）</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                type="text"
                placeholder="タイトル（任意）"
                value={textForm.title}
                onChange={e => setTextForm({ ...textForm, title: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={textForm.meeting_date}
                onChange={e => setTextForm({ ...textForm, meeting_date: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <textarea
              placeholder="議事録のテキストを貼り付けてください..."
              value={textForm.content}
              onChange={e => setTextForm({ ...textForm, content: e.target.value })}
              rows={8}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {loading ? '🤖 AIで分析中...' : '🤖 分析してタスク抽出'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitFile} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <select
                value={fileForm.customer_id}
                onChange={e => setFileForm({ ...fileForm, customer_id: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">顧客を選択（任意）</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                type="text"
                placeholder="タイトル（任意）"
                value={fileForm.title}
                onChange={e => setFileForm({ ...fileForm, title: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={fileForm.meeting_date}
                onChange={e => setFileForm({ ...fileForm, meeting_date: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov"
                onChange={e => setFileForm({ ...fileForm, file: e.target.files?.[0] || null })}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <p className="text-gray-500 text-sm">
                  {fileForm.file ? (
                    <span className="text-blue-600 font-medium">📎 {fileForm.file.name}</span>
                  ) : (
                    <>クリックしてファイルを選択<br /><span className="text-xs text-gray-400">PDF, TXT, 画像（JPG/PNG）, 動画（MP4/MOV）</span></>
                  )}
                </p>
              </label>
            </div>
            <button
              type="submit"
              disabled={loading || !fileForm.file}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {loading ? '🤖 AIで解析中...' : '🤖 アップロードして分析'}
            </button>
          </form>
        )}

        {/* 結果表示 */}
        {result && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="font-medium text-green-800">✅ インポート完了（タスク {result.tasks_created}件を自動登録）</p>
            {result.summary && (
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-line">{result.summary}</p>
            )}
          </div>
        )}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700 text-sm">❌ {error}</p>
          </div>
        )}
      </div>

      {/* 議事録一覧 */}
      <div>
        <h2 className="font-bold text-gray-800 mb-3">議事録一覧 ({notes.length}件)</h2>
        {notes.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-2">📂</p>
            <p>議事録がありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map(note => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteCard({ note }: { note: MeetingNote }) {
  const [expanded, setExpanded] = useState(false);
  let actionItems: Array<{ title: string; priority: string }> = [];
  try {
    actionItems = JSON.parse(note.action_items || '[]');
  } catch { /* ignore */ }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="font-medium text-gray-900">{note.title}</p>
            <div className="flex gap-3 mt-1">
              {note.customer_name && (
                <span className="text-xs text-blue-600">👤 {note.customer_name}</span>
              )}
              {note.meeting_date && (
                <span className="text-xs text-gray-500">📅 {note.meeting_date}</span>
              )}
              {note.file_type && (
                <span className="text-xs text-gray-500">
                  {note.file_type === 'image' ? '🖼️' : note.file_type === 'pdf' ? '📄' : '📎'} {note.file_type}
                </span>
              )}
              {actionItems.length > 0 && (
                <span className="text-xs text-green-600">✅ アクション {actionItems.length}件</span>
              )}
            </div>
          </div>
          <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {note.summary && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">📝 サマリー</p>
              <p className="text-sm text-gray-700 whitespace-pre-line">{note.summary}</p>
            </div>
          )}
          {actionItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">✅ アクションアイテム</p>
              <div className="space-y-1.5">
                {actionItems.map((item, i) => {
                  const emoji = item.priority === 'high' ? '🔴' : item.priority === 'medium' ? '🟡' : '🟢';
                  return (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span>{emoji}</span>
                      <span className="text-gray-700">{item.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
