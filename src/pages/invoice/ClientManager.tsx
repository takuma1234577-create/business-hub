import { useEffect, useState } from 'react';
import type { Client, InvoiceItem, InvoiceItemType } from './types';
import { clientApi } from './api';
import { AmazonSettings } from './AmazonSettings';

const ITEM_TYPE_LABELS: Record<InvoiceItemType, string> = {
  fixed: '固定',
  performance: '成果報酬',
  adspend: '広告費%',
};

const newItem = (): InvoiceItem => ({
  id: Date.now().toString(),
  description: '',
  unitPrice: 0,
  quantity: 1,
  itemType: 'fixed',
  baseAmount: 0,
  rate: 0,
});

const emptyClient = (): Omit<Client, 'id'> => ({
  companyName: '',
  contactName: '',
  email: '',
  postalCode: '',
  address: '',
  defaultItems: [],
});

export function ClientManager() {
  const [clients, setClients] = useState<Client[]>([]);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyClient());
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [amazonClient, setAmazonClient] = useState<Client | null>(null);
  const [defaultItemsClient, setDefaultItemsClient] = useState<Client | null>(null);
  const [defaultItems, setDefaultItems] = useState<InvoiceItem[]>([]);
  const [savingItems, setSavingItems] = useState(false);

  const load = async () => {
    try {
      setClients(await clientApi.list());
    } catch (e: any) {
      setError('クライアント一覧の取得に失敗しました: ' + e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    try {
      if (editing) {
        await clientApi.update(editing.id, form);
      } else {
        await clientApi.create(form);
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyClient());
      load();
    } catch (e: any) {
      setError('保存に失敗しました: ' + e.message);
    }
  };

  const handleEdit = (c: Client) => {
    setEditing(c);
    setForm({ companyName: c.companyName, contactName: c.contactName, email: c.email, postalCode: c.postalCode, address: c.address });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    try {
      await clientApi.delete(id);
      load();
    } catch (e: any) {
      setError('削除に失敗しました: ' + e.message);
    }
  };

  const openDefaultItems = (c: Client) => {
    setDefaultItemsClient(c);
    setDefaultItems(c.defaultItems && c.defaultItems.length > 0
      ? c.defaultItems.map((item, i) => ({ ...item, id: `di_${Date.now()}_${i}` }))
      : [newItem()]);
  };

  const saveDefaultItems = async () => {
    if (!defaultItemsClient) return;
    setSavingItems(true);
    try {
      await clientApi.update(defaultItemsClient.id, { defaultItems });
      await load();
      setDefaultItemsClient(null);
    } catch (e: any) {
      setError('デフォルト項目の保存に失敗しました: ' + e.message);
    } finally {
      setSavingItems(false);
    }
  };

  const updateDefaultItem = (id: string, field: keyof InvoiceItem, value: string | number) => {
    setDefaultItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === 'itemType' && value !== 'fixed') {
        updated.quantity = 1;
      }
      return updated;
    }));
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
        <h2 className="text-xl font-semibold text-gray-800">クライアント管理</h2>
        <button
          onClick={() => { setShowForm(true); setEditing(null); setForm(emptyClient()); }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition"
        >
          + 新規追加
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">{editing ? '編集' : '新規クライアント'}</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'companyName', label: '会社名', placeholder: '株式会社〇〇' },
              { key: 'contactName', label: '担当者名', placeholder: '山田 太郎' },
              { key: 'email', label: 'メールアドレス', placeholder: 'example@co.jp' },
              { key: 'postalCode', label: '郵便番号', placeholder: '123-4567' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-sm text-gray-600 mb-1">{label}</label>
                <input
                  type="text"
                  value={(form as any)[key]}
                  onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">住所</label>
              <input
                type="text"
                value={form.address}
                onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {clients.length === 0 ? (
          <p className="text-center text-gray-500 py-12 text-sm">クライアントが登録されていません</p>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['会社名', '担当者', 'メール', 'デフォルト項目', '操作'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-gray-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clients.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{c.companyName}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.contactName}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {c.defaultItems && c.defaultItems.length > 0 ? (
                      <span className="text-green-600 text-xs">{c.defaultItems.length}件設定済</span>
                    ) : (
                      <span className="text-gray-400 text-xs">未設定</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openDefaultItems(c)} className="text-xs text-purple-600 hover:underline">請求項目</button>
                      <button onClick={() => setAmazonClient(c)} className="text-xs text-orange-600 hover:underline">Amazon連携</button>
                      <button onClick={() => handleEdit(c)} className="text-xs text-blue-600 hover:underline">編集</button>
                      <button onClick={() => handleDelete(c.id)} className="text-xs text-red-500 hover:underline">削除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Default Items Modal */}
      {defaultItemsClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                デフォルト請求項目 - {defaultItemsClient.companyName}
              </h3>
              <button onClick={() => setDefaultItemsClient(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              請求書作成時にこのクライアントを選択すると、以下の項目が自動入力されます。
              成果報酬・広告費%の場合、売上額は請求書作成時に入力してください。
            </p>

            <div className="space-y-3">
              {defaultItems.map(item => {
                const isVariable = item.itemType !== 'fixed';
                return (
                  <div key={item.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex gap-2 items-center">
                      <select
                        value={item.itemType}
                        onChange={e => updateDefaultItem(item.id, 'itemType', e.target.value as InvoiceItemType)}
                        className="border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                      >
                        {(Object.keys(ITEM_TYPE_LABELS) as InvoiceItemType[]).map(t => (
                          <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={item.description}
                        onChange={e => updateDefaultItem(item.id, 'description', e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                        placeholder={
                          item.itemType === 'performance' ? 'Amazonコンサル成果報酬' :
                          item.itemType === 'adspend' ? 'Amazon広告運用費' :
                          '月額コンサルティング費用'
                        }
                      />
                      <button
                        onClick={() => setDefaultItems(prev => prev.filter(i => i.id !== item.id))}
                        className="text-red-400 hover:text-red-600 text-lg leading-none px-1"
                        disabled={defaultItems.length <= 1}
                      >
                        &times;
                      </button>
                    </div>

                    {isVariable ? (
                      <div className="space-y-2">
                        <div className="flex gap-2 items-center text-sm">
                          {!item.useTiered && (
                            <div className="w-28">
                              <label className="block text-xs text-gray-500 mb-1">料率（%）</label>
                              <input
                                type="number"
                                value={item.rate ?? 0}
                                onChange={e => updateDefaultItem(item.id, 'rate', Number(e.target.value))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                                step="0.1"
                                placeholder="0"
                              />
                            </div>
                          )}
                          <div className="text-xs text-gray-400 mt-4">
                            {item.itemType === 'performance' ? '※売上額は請求書作成時に入力' : '※広告費は請求書作成時に入力'}
                          </div>
                        </div>

                        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!item.useTiered}
                            onChange={e => {
                              const useTiered = e.target.checked;
                              setDefaultItems(prev => prev.map(it => {
                                if (it.id !== item.id) return it;
                                return {
                                  ...it,
                                  useTiered,
                                  tiers: useTiered && (!it.tiers || it.tiers.length === 0)
                                    ? [{ min: 0, max: null, rate: 0 }]
                                    : it.tiers,
                                };
                              }));
                            }}
                            className="rounded border-gray-300"
                          />
                          段階制料率を使用
                        </label>

                        {item.useTiered && (
                          <div className="bg-white border border-purple-200 rounded-lg p-3 space-y-2">
                            <p className="text-xs text-purple-700 font-medium">段階制料率の設定</p>
                            {(item.tiers ?? []).map((tier, ti) => (
                              <div key={ti} className="flex gap-2 items-center text-xs">
                                <span className="text-gray-500 whitespace-nowrap">売上</span>
                                <input
                                  type="number"
                                  value={tier.min}
                                  onChange={e => {
                                    const newTiers = [...(item.tiers ?? [])];
                                    newTiers[ti] = { ...newTiers[ti], min: Number(e.target.value) };
                                    setDefaultItems(prev => prev.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it));
                                  }}
                                  className="w-24 border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                                  placeholder="0"
                                />
                                <span className="text-gray-500">〜</span>
                                <input
                                  type="number"
                                  value={tier.max ?? ''}
                                  onChange={e => {
                                    const newTiers = [...(item.tiers ?? [])];
                                    const val = e.target.value === '' ? null : Number(e.target.value);
                                    newTiers[ti] = { ...newTiers[ti], max: val };
                                    setDefaultItems(prev => prev.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it));
                                  }}
                                  className="w-24 border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                                  placeholder="上限なし"
                                />
                                <span className="text-gray-500">円 →</span>
                                <input
                                  type="number"
                                  value={tier.rate}
                                  onChange={e => {
                                    const newTiers = [...(item.tiers ?? [])];
                                    newTiers[ti] = { ...newTiers[ti], rate: Number(e.target.value) };
                                    setDefaultItems(prev => prev.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it));
                                  }}
                                  className="w-20 border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                                  step="0.1"
                                  placeholder="0"
                                />
                                <span className="text-gray-500">%</span>
                                {(item.tiers ?? []).length > 1 && (
                                  <button
                                    onClick={() => {
                                      const newTiers = (item.tiers ?? []).filter((_, i) => i !== ti);
                                      setDefaultItems(prev => prev.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it));
                                    }}
                                    className="text-red-400 hover:text-red-600 text-sm leading-none"
                                  >&times;</button>
                                )}
                              </div>
                            ))}
                            <button
                              onClick={() => {
                                const tiers = item.tiers ?? [];
                                const lastMax = tiers.length > 0 ? (tiers[tiers.length - 1].max ?? 0) : 0;
                                const newTiers = [...tiers, { min: lastMax, max: null, rate: 0 }];
                                setDefaultItems(prev => prev.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it));
                              }}
                              className="text-xs text-purple-600 hover:text-purple-800"
                            >
                              + 段階を追加
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">単価（円）</label>
                          <input
                            type="number"
                            value={item.unitPrice}
                            onChange={e => updateDefaultItem(item.id, 'unitPrice', Number(e.target.value))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-xs text-gray-500 mb-1">数量</label>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={e => updateDefaultItem(item.id, 'quantity', Number(e.target.value))}
                            min={1}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setDefaultItems(prev => [...prev, newItem()])}
              className="mt-3 text-sm text-purple-600 hover:text-purple-800 border border-purple-300 rounded-lg px-4 py-2 hover:bg-purple-50 transition"
            >
              + 項目を追加
            </button>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={saveDefaultItems}
                disabled={savingItems}
                className="bg-purple-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-purple-700 transition disabled:opacity-50"
              >
                {savingItems ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => setDefaultItemsClient(null)}
                className="text-gray-600 border border-gray-300 px-6 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {amazonClient && (
        <AmazonSettings
          clientId={amazonClient.id}
          clientName={amazonClient.companyName}
          onClose={() => setAmazonClient(null)}
        />
      )}
    </div>
  );
}
