import { useEffect, useState } from 'react';
import type { SenderSettings } from './types';
import { settingsApi } from './api';

const defaultSettings: SenderSettings = {
  senderName: '', senderCompany: '', senderPostalCode: '', senderAddress: '',
  senderPhone: '', senderEmail: '',
  bankName: '', bankBranch: '', bankAccount: '', bankAccountName: '', bankSwift: '', currency: 'JPY',
};

export function SettingsManager() {
  const [form, setForm] = useState<SenderSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    settingsApi.get().then(data => {
      setForm(data);
      setLoading(false);
    }).catch(e => {
      setMessage({ type: 'error', text: '設定の読み込みに失敗しました: ' + e.message });
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    try {
      const updated = await settingsApi.update(form);
      setForm(updated);
      setMessage({ type: 'success', text: '設定を保存しました' });
    } catch (e: any) {
      setMessage({ type: 'error', text: '保存に失敗しました: ' + e.message });
    }
  };

  const set = (key: keyof SenderSettings, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  if (loading) return <p className="text-center text-gray-500 py-12 text-sm">読み込み中...</p>;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-4 text-xs underline">閉じる</button>
        </div>
      )}

      {/* Sender Info */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">差出人情報（請求書に表示）</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">氏名 *</label>
            <input type="text" value={form.senderName} onChange={e => set('senderName', e.target.value)}
              placeholder="山田 太郎"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">会社名 / 屋号</label>
            <input type="text" value={form.senderCompany} onChange={e => set('senderCompany', e.target.value)}
              placeholder="Amazonコンサルティング"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">郵便番号</label>
            <input type="text" value={form.senderPostalCode} onChange={e => set('senderPostalCode', e.target.value)}
              placeholder="123-4567"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">住所</label>
            <input type="text" value={form.senderAddress} onChange={e => set('senderAddress', e.target.value)}
              placeholder="東京都渋谷区..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">電話番号</label>
            <input type="text" value={form.senderPhone} onChange={e => set('senderPhone', e.target.value)}
              placeholder="090-1234-5678"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">メールアドレス</label>
            <input type="text" value={form.senderEmail} onChange={e => set('senderEmail', e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      {/* Bank Info */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">振込先情報</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">通貨</label>
            <input type="text" value={form.currency} onChange={e => set('currency', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">口座名義</label>
            <input type="text" value={form.bankAccountName} onChange={e => set('bankAccountName', e.target.value)}
              placeholder="ヤマダ タロウ"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">銀行名</label>
            <input type="text" value={form.bankName} onChange={e => set('bankName', e.target.value)}
              placeholder="楽天銀行（0036）"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">支店名</label>
            <input type="text" value={form.bankBranch} onChange={e => set('bankBranch', e.target.value)}
              placeholder="アリア支店（225）"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">口座番号</label>
            <input type="text" value={form.bankAccount} onChange={e => set('bankAccount', e.target.value)}
              placeholder="1234567"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">SWIFTコード（海外送金用）</label>
            <input type="text" value={form.bankSwift} onChange={e => set('bankSwift', e.target.value)}
              placeholder="RAKTJPJT"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      <button onClick={handleSave}
        className="bg-blue-600 text-white px-8 py-3 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
        設定を保存
      </button>
    </div>
  );
}
