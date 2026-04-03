import { useState, useEffect } from 'react';
import { api } from './api';
import type { Customer } from './types';

interface HealthStatus {
  status: string;
  env: { chatwork: boolean; anthropic: boolean };
}

export default function Settings() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', chatwork_room_id: '', contract_type: '', business_description: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [customersRes, healthRes] = await Promise.all([
        api.get('/customers'),
        api.get('/health'),
      ]);
      setCustomers((customersRes as unknown as { data: { data: Customer[] } }).data.data || []);
      setHealth((healthRes as unknown as { data: HealthStatus }).data);
    } catch (err) {
      console.error('設定読み込みエラー:', err);
    }
  };

  const addCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.name) return;
    setSaving(true);
    try {
      await api.post('/customers', newCustomer);
      setNewCustomer({ name: '', chatwork_room_id: '', contract_type: '', business_description: '' });
      setMessage('顧客を追加しました');
      loadData();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage('エラー: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fetchChatwork = async () => {
    setSaving(true);
    try {
      await api.post('/chatwork/fetch', {});
      setMessage('✅ Chatworkメッセージを取得しました');
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage('❌ ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">⚙️ 設定</h1>

      {message && (
        <div className={`rounded-lg p-3 text-sm ${message.startsWith('❌') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* API接続状態 */}
      {health && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">🔌 API接続状態</h2>
          <div className="space-y-2">
            <StatusRow label="Chatwork API" ok={health.env.chatwork} />
            <StatusRow label="Anthropic Claude API" ok={health.env.anthropic} />
            <StatusRow label="バックエンドサーバー" ok={health.status === 'ok'} />
          </div>
          <p className="text-xs text-gray-400 mt-3">
            APIキーは backend/.env で設定してください
          </p>
        </section>
      )}

      {/* Chatwork */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-3">💬 Chatwork</h2>
        <p className="text-sm text-gray-600 mb-3">
          直近48時間のメッセージをすべてのルームから取得してDBにキャッシュします。
        </p>
        <button
          onClick={fetchChatwork}
          disabled={saving}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {saving ? '取得中...' : '🔄 今すぐChatworkを同期'}
        </button>
      </section>

      {/* 顧客管理 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-4">👥 顧客管理</h2>

        {/* 顧客追加フォーム */}
        <form onSubmit={addCustomer} className="mb-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">新しい顧客を追加</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              placeholder="顧客名 *"
              value={newCustomer.name}
              onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })}
              required
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="ChatworkルームID"
              value={newCustomer.chatwork_room_id}
              onChange={e => setNewCustomer({ ...newCustomer, chatwork_room_id: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="契約種別（例：月次コンサル）"
              value={newCustomer.contract_type}
              onChange={e => setNewCustomer({ ...newCustomer, contract_type: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="事業概要"
              value={newCustomer.business_description}
              onChange={e => setNewCustomer({ ...newCustomer, business_description: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            ＋ 顧客を追加
          </button>
        </form>

        {/* 顧客一覧 */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">登録済み顧客 ({customers.length}社)</h3>
          {customers.length === 0 ? (
            <p className="text-sm text-gray-400">顧客がいません</p>
          ) : (
            <div className="space-y-2">
              {customers.map(c => (
                <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">
                      {c.contract_type && <span>{c.contract_type}</span>}
                      {c.chatwork_room_id && <span> • Chatwork: {c.chatwork_room_id}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 使い方ガイド */}
      <section className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h2 className="font-bold text-blue-900 mb-3">📖 使い方</h2>
        <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
          <li>backend/.env に APIキーを設定</li>
          <li>顧客を登録して Chatworkルームid を紐付け</li>
          <li>ダッシュボードで「今日のタスクを生成」をクリック</li>
          <li>Gmailを使う場合はメールページで認証を実施</li>
          <li>議事録をアップロードして自動でアクションアイテムを抽出</li>
        </ol>
      </section>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`text-sm font-medium ${ok ? 'text-green-600' : 'text-red-500'}`}>
        {ok ? '✅ 接続済み' : '❌ 未設定'}
      </span>
    </div>
  );
}
