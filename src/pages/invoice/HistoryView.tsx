import { useEffect, useState } from 'react';
import type { HistoryItem } from './types';
import { historyApi } from './api';

export function HistoryView() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setHistory(await historyApi.list());
    } catch (e: any) {
      setError('履歴の取得に失敗しました: ' + e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('この履歴を削除しますか？')) return;
    try {
      await historyApi.delete(id);
      load();
    } catch (e: any) {
      setError('削除に失敗しました: ' + e.message);
    }
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('ja-JP');
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200">
          {error}
          <button onClick={() => setError('')} className="ml-4 text-xs underline">閉じる</button>
        </div>
      )}
      <h2 className="text-xl font-semibold text-gray-800">送信履歴</h2>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {history.length === 0 ? (
          <p className="text-center text-gray-500 py-12 text-sm">送信履歴がありません</p>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['種別', '送信先', '件名', '日時', '操作'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-gray-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...history].reverse().map(h => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${h.type === 'sent' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {h.type === 'sent' ? '送信済み' : '下書き'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{h.to}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{h.subject}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(h.sentAt || h.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(h.id)} className="text-xs text-red-500 hover:underline">削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
