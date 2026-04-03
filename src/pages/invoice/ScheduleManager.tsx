import { useEffect, useState } from 'react';
import type { Schedule, Client, EmailTemplate, InvoiceItem, InvoiceItemType, ScheduleFeeRule, FeeTier } from './types';
import { scheduleApi, clientApi, templateApi } from './api';

const ITEM_TYPE_LABELS: Record<InvoiceItemType, string> = { fixed: '固定', performance: '成果報酬', adspend: '広告費%' };

const newItem = (): InvoiceItem => ({
  id: Date.now().toString(), description: '', unitPrice: 0, quantity: 1, itemType: 'fixed', baseAmount: 0, rate: 0,
});

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const emptyTier = (): FeeTier => ({ min: 0, max: null, rate: 0 });
  const emptyFeeRule = (): ScheduleFeeRule => ({ ruleType: 'sales_performance', description: '', tiers: [emptyTier()] });

  const [form, setForm] = useState({
    clientId: '', dayOfMonth: 1, templateId: '', description: '',
    fixedItems: [newItem()] as InvoiceItem[],
    notes: '※振込手数料はご負担ください。',
    autoFetchAmazon: false,
    sendMode: 'draft' as 'draft' | 'send',
    feeRulesConfig: [] as ScheduleFeeRule[],
  });

  const load = async () => {
    try {
      const [s, c, t] = await Promise.all([scheduleApi.list(), clientApi.list(), templateApi.list()]);
      setSchedules(s);
      setClients(c);
      setTemplates(t);
      if (c.length > 0) setForm(p => ({ ...p, clientId: p.clientId || c[0].id }));
      if (t.length > 0) setForm(p => ({ ...p, templateId: p.templateId || t[0].id }));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    try {
      await scheduleApi.create({ ...form, active: true });
      setShowForm(false);
      setForm(p => ({ ...p, description: '', fixedItems: [newItem()], notes: '※振込手数料はご負担ください。', autoFetchAmazon: false, sendMode: 'draft', feeRulesConfig: [] }));
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleToggle = async (s: Schedule) => {
    await scheduleApi.update(s.id, { active: !s.active });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    await scheduleApi.delete(id);
    load();
  };

  const getName = (id: string, list: { id: string }[], key: string) =>
    (list.find(x => x.id === id) as any)?.[key] || '-';

  const updateFormItem = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    setForm(prev => ({
      ...prev,
      fixedItems: prev.fixedItems.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        if (field === 'itemType' && value !== 'fixed') updated.quantity = 1;
        return updated;
      }),
    }));
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200">
          {error}<button onClick={() => setError('')} className="ml-4 text-xs underline">閉じる</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-800">自動送信スケジュール</h2>
        <button onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition">+ 追加</button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
        毎月指定日にVercel Cronが実行され、Amazonデータ取得→料金計算→PDF生成→メール送信/下書き作成を自動で行います。
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          <h3 className="font-semibold text-gray-800">新規スケジュール</h3>

          {/* Basic settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">クライアント</label>
              <select value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">毎月何日に送信</label>
              <input type="number" min={1} max={28} value={form.dayOfMonth}
                onChange={e => setForm(p => ({ ...p, dayOfMonth: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">メールテンプレート</label>
              <select value={form.templateId} onChange={e => setForm(p => ({ ...p, templateId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">説明</label>
              <input type="text" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="月末請求書" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Send mode + Amazon */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">送信モード</label>
              <select value={form.sendMode} onChange={e => setForm(p => ({ ...p, sendMode: e.target.value as any }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="draft">下書き作成（Gmailで確認後に送信）</option>
                <option value="send">自動送信（即送信）</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.autoFetchAmazon}
                  onChange={e => setForm(p => ({ ...p, autoFetchAmazon: e.target.checked }))}
                  className="rounded border-gray-300" />
                <span>Amazon売上・広告費を自動取得して成果報酬を計算</span>
              </label>
            </div>
          </div>

          {form.autoFetchAmazon && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
              <p className="text-xs text-orange-800">
                送信日に前月の売上・広告費をSP-APIから取得し、以下の料金ルールで自動計算して請求項目に追加します。
                Amazonアカウントは「クライアント管理」→「Amazon連携」で登録してください。
              </p>

              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-orange-800">料金ルール</label>
                <button onClick={() => setForm(p => ({ ...p, feeRulesConfig: [...p.feeRulesConfig, emptyFeeRule()] }))}
                  className="text-xs text-orange-700 hover:underline">+ ルール追加</button>
              </div>

              {form.feeRulesConfig.length === 0 && (
                <p className="text-xs text-orange-600 text-center py-2">料金ルールが未設定です。「+ ルール追加」で追加してください。</p>
              )}

              {form.feeRulesConfig.map((rule, ri) => (
                <div key={ri} className="bg-white border border-orange-200 rounded-lg p-3 space-y-2">
                  <div className="flex gap-2 items-center">
                    <select value={rule.ruleType}
                      onChange={e => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.map((r, i) => i === ri ? { ...r, ruleType: e.target.value as any } : r) }))}
                      className="border border-gray-300 rounded px-2 py-1 text-xs">
                      <option value="sales_performance">売上成果報酬</option>
                      <option value="adspend_percentage">広告運用費（広告費の%）</option>
                    </select>
                    <input type="text" value={rule.description} placeholder="ルール名（例: Amazonコンサル成果報酬）"
                      onChange={e => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.map((r, i) => i === ri ? { ...r, description: e.target.value } : r) }))}
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs" />
                    <button onClick={() => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.filter((_, i) => i !== ri) }))}
                      className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">料率テーブル（段階制）</p>
                    {rule.tiers.map((tier, ti) => (
                      <div key={ti} className="flex gap-1 items-center text-xs">
                        <input type="number" value={tier.min} placeholder="下限"
                          onChange={e => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.map((r, i) => i === ri ? { ...r, tiers: r.tiers.map((t, j) => j === ti ? { ...t, min: Number(e.target.value) } : t) } : r) }))}
                          className="w-24 border border-gray-300 rounded px-1.5 py-1 text-xs" />
                        <span className="text-gray-400">〜</span>
                        <input type="number" value={tier.max ?? ''} placeholder="上限(空=無制限)"
                          onChange={e => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.map((r, i) => i === ri ? { ...r, tiers: r.tiers.map((t, j) => j === ti ? { ...t, max: e.target.value === '' ? null : Number(e.target.value) } : t) } : r) }))}
                          className="w-24 border border-gray-300 rounded px-1.5 py-1 text-xs" />
                        <span className="text-gray-400">:</span>
                        <input type="number" value={tier.rate} step="0.1" placeholder="%"
                          onChange={e => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.map((r, i) => i === ri ? { ...r, tiers: r.tiers.map((t, j) => j === ti ? { ...t, rate: Number(e.target.value) } : t) } : r) }))}
                          className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs" />
                        <span className="text-gray-500">%</span>
                        {rule.tiers.length > 1 && (
                          <button onClick={() => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.map((r, i) => i === ri ? { ...r, tiers: r.tiers.filter((_, j) => j !== ti) } : r) }))}
                            className="text-red-400 hover:text-red-600">×</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setForm(p => ({ ...p, feeRulesConfig: p.feeRulesConfig.map((r, i) => i === ri ? { ...r, tiers: [...r.tiers, emptyTier()] } : r) }))}
                      className="text-xs text-orange-600 hover:underline">+ 段階追加</button>
                  </div>
                </div>
              ))}

              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800">
                例: 売上 ¥0〜¥1,000,000: 5%、¥1,000,000〜上限なし: 10% → 売上¥1,500,000 の場合: ¥50,000 + ¥50,000 = ¥100,000
              </div>
            </div>
          )}

          {/* Fixed items */}
          <div>
            <label className="block text-sm text-gray-600 mb-2">固定請求項目（毎月同じ項目）</label>
            <div className="space-y-2">
              {form.fixedItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select value={item.itemType}
                    onChange={e => updateFormItem(idx, 'itemType', e.target.value as InvoiceItemType)}
                    className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white w-20">
                    {(Object.keys(ITEM_TYPE_LABELS) as InvoiceItemType[]).map(t => (
                      <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <input type="text" value={item.description} placeholder="品目名"
                    onChange={e => updateFormItem(idx, 'description', e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm" />
                  {item.itemType === 'fixed' ? (
                    <>
                      <input type="number" value={item.unitPrice} placeholder="単価"
                        onChange={e => updateFormItem(idx, 'unitPrice', Number(e.target.value))}
                        className="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm" />
                      <input type="number" value={item.quantity} min={1}
                        onChange={e => updateFormItem(idx, 'quantity', Number(e.target.value))}
                        className="w-16 border border-gray-300 rounded px-2 py-1.5 text-sm" />
                    </>
                  ) : (
                    <>
                      <input type="number" value={item.baseAmount ?? 0} placeholder="基準額"
                        onChange={e => updateFormItem(idx, 'baseAmount', Number(e.target.value))}
                        className="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm" />
                      <input type="number" value={item.rate ?? 0} step="0.1" placeholder="%"
                        onChange={e => updateFormItem(idx, 'rate', Number(e.target.value))}
                        className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm" />
                      <span className="text-xs text-gray-500">%</span>
                    </>
                  )}
                  {form.fixedItems.length > 1 && (
                    <button onClick={() => setForm(p => ({ ...p, fixedItems: p.fixedItems.filter((_, i) => i !== idx) }))}
                      className="text-red-400 hover:text-red-600 text-lg">×</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => setForm(p => ({ ...p, fixedItems: [...p.fixedItems, newItem()] }))}
              className="text-xs text-blue-600 hover:underline mt-2">+ 項目を追加</button>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">備考</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="flex gap-3">
            <button onClick={handleSubmit} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-blue-700">追加</button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 border border-gray-300 px-6 py-2 rounded-lg text-sm">キャンセル</button>
          </div>
        </div>
      )}

      {/* Schedule list */}
      <div className="space-y-3">
        {schedules.length === 0 ? (
          <p className="text-center text-gray-500 py-12 text-sm bg-white rounded-xl border border-gray-200">スケジュールがありません</p>
        ) : (
          schedules.map(s => (
            <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${s.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.active ? '有効' : '無効'}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full ${s.sendMode === 'send' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {s.sendMode === 'send' ? '自動送信' : '下書き'}
                  </span>
                  {s.autoFetchAmazon && (
                    <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700">Amazon自動計算</span>
                  )}
                  <h3 className="font-medium text-gray-800">{getName(s.clientId, clients, 'companyName')}</h3>
                  <span className="text-sm text-gray-500">毎月{s.dayOfMonth}日</span>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleToggle(s)} className="text-xs text-blue-600 hover:underline">
                    {s.active ? '無効化' : '有効化'}
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="text-xs text-red-500 hover:underline">削除</button>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500 space-y-1">
                <p>テンプレート: {getName(s.templateId, templates, 'name')} {s.description && `/ ${s.description}`}</p>
                {s.fixedItems && s.fixedItems.length > 0 && (
                  <p>固定項目: {s.fixedItems.filter(i => i.description).map(i => i.description).join('、') || 'なし'}</p>
                )}
                {s.feeRulesConfig && s.feeRulesConfig.length > 0 && (
                  <p>料金ルール: {s.feeRulesConfig.map(r => {
                    const type = r.ruleType === 'sales_performance' ? '売上' : '広告費';
                    const rates = r.tiers.map(t => `${t.rate}%`).join('/');
                    return `${r.description || type}(${rates})`;
                  }).join('、')}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
