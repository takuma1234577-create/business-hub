import { useEffect, useState } from 'react';
import type { AmazonAccount, FeeRule, FeeTier } from './types';
import { amazonApi, feeRuleApi } from './api';

interface Props {
  clientId: string;
  clientName: string;
  onClose: () => void;
}

const MARKETPLACE_OPTIONS = [
  { id: 'A1VC38T7YXB528', label: 'Japan (amazon.co.jp)' },
  { id: 'ATVPDKIKX0DER', label: 'US (amazon.com)' },
];

const emptyTier = (): FeeTier => ({ min: 0, max: null, rate: 0 });

export function AmazonSettings({ clientId, clientName, onClose }: Props) {
  const [accounts, setAccounts] = useState<AmazonAccount[]>([]);
  const [rules, setRules] = useState<FeeRule[]>([]);
  const [error, setError] = useState('');
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);

  // Account form
  const [accForm, setAccForm] = useState({
    accountName: '', sellerId: '', marketplaceId: 'A1VC38T7YXB528',
    refreshToken: '', spApiClientId: '', spApiClientSecret: '',
  });

  // Rule form
  const [ruleForm, setRuleForm] = useState<{
    ruleType: 'sales_performance' | 'adspend_percentage';
    description: string;
    tiers: FeeTier[];
  }>({
    ruleType: 'sales_performance',
    description: '',
    tiers: [emptyTier()],
  });

  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result: any }>>({});

  const load = async () => {
    try {
      const [a, r] = await Promise.all([amazonApi.listAccounts(clientId), feeRuleApi.list(clientId)]);
      setAccounts(a);
      setRules(r);
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, [clientId]);

  const handleTestConnection = async (accountId: string) => {
    setTestResults(prev => ({ ...prev, [accountId]: { loading: true, result: null } }));
    try {
      const result = await amazonApi.testConnection(accountId);
      setTestResults(prev => ({ ...prev, [accountId]: { loading: false, result } }));
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [accountId]: { loading: false, result: { success: false, error: e.message } } }));
    }
  };

  const [editingAccount, setEditingAccount] = useState<AmazonAccount | null>(null);

  const resetAccForm = () => setAccForm({ accountName: '', sellerId: '', marketplaceId: 'A1VC38T7YXB528', refreshToken: '', spApiClientId: '', spApiClientSecret: '' });

  const handleAddAccount = async () => {
    try {
      await amazonApi.addAccount(clientId, accForm);
      setShowAccountForm(false);
      resetAccForm();
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleEditAccount = (a: AmazonAccount) => {
    setEditingAccount(a);
    setAccForm({
      accountName: a.accountName, sellerId: a.sellerId, marketplaceId: a.marketplaceId,
      refreshToken: '', spApiClientId: '', spApiClientSecret: '',
    });
    setShowAccountForm(true);
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) return;
    try {
      const updates: any = { accountName: accForm.accountName, sellerId: accForm.sellerId, marketplaceId: accForm.marketplaceId };
      if (accForm.refreshToken) updates.refreshToken = accForm.refreshToken;
      if (accForm.spApiClientId) updates.spApiClientId = accForm.spApiClientId;
      if (accForm.spApiClientSecret) updates.spApiClientSecret = accForm.spApiClientSecret;
      await amazonApi.updateAccount(editingAccount.id, updates);
      setShowAccountForm(false);
      setEditingAccount(null);
      resetAccForm();
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('このAmazonアカウントを削除しますか？')) return;
    await amazonApi.deleteAccount(id);
    load();
  };

  const handleAddRule = async () => {
    try {
      await feeRuleApi.create(clientId, { ...ruleForm, active: true });
      setShowRuleForm(false);
      setRuleForm({ ruleType: 'sales_performance', description: '', tiers: [emptyTier()] });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleToggleRule = async (rule: FeeRule) => {
    await feeRuleApi.update(rule.id, { active: !rule.active });
    load();
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('この料金ルールを削除しますか？')) return;
    await feeRuleApi.delete(id);
    load();
  };

  const updateTier = (idx: number, field: keyof FeeTier, value: string) => {
    setRuleForm(prev => ({
      ...prev,
      tiers: prev.tiers.map((t, i) => i === idx ? {
        ...t,
        [field]: field === 'max' && value === '' ? null : Number(value),
      } : t),
    }));
  };

  const formatTiers = (tiers: FeeTier[], ruleType: string) => {
    const base = ruleType === 'sales_performance' ? '売上' : '広告費';
    return tiers.map(t => {
      const min = `¥${t.min.toLocaleString()}`;
      const max = t.max !== null ? `¥${t.max.toLocaleString()}` : '上限なし';
      return `${base} ${min}〜${max}: ${t.rate}%`;
    }).join(' / ');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-10 z-50 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl m-4 p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-800">Amazon連携 - {clientName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {error && (
          <div className="p-3 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200">
            {error}<button onClick={() => setError('')} className="ml-3 text-xs underline">閉じる</button>
          </div>
        )}

        {/* ── Amazon Accounts ── */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-700">Amazonアカウント</h3>
            <button onClick={() => { setEditingAccount(null); resetAccForm(); setShowAccountForm(true); }} className="text-sm text-blue-600 hover:underline">+ 追加</button>
          </div>

          {showAccountForm && (
            <div className="border border-gray-200 rounded-lg p-4 mb-3 space-y-3 bg-gray-50">
              <h4 className="text-sm font-medium text-gray-700">{editingAccount ? 'アカウント編集' : '新規アカウント'}</h4>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'accountName', label: 'アカウント名', ph: 'クライアントA 本店' },
                  { key: 'sellerId', label: 'Seller ID', ph: 'A1B2C3D4E5' },
                  { key: 'spApiClientId', label: `SP-API Client ID${editingAccount ? '（空欄=変更なし）' : ''}`, ph: 'amzn1.application-oa2-client.xxx' },
                  { key: 'spApiClientSecret', label: `SP-API Client Secret${editingAccount ? '（空欄=変更なし）' : ''}`, ph: '' },
                  { key: 'refreshToken', label: `Refresh Token${editingAccount ? '（空欄=変更なし）' : ''}`, ph: 'Atzr|xxx' },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label className="block text-xs text-gray-600 mb-1">{label}</label>
                    <input type="text" value={(accForm as any)[key]} onChange={e => setAccForm(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={ph} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">マーケットプレイス</label>
                  <select value={accForm.marketplaceId} onChange={e => setAccForm(p => ({ ...p, marketplaceId: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                    {MARKETPLACE_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={editingAccount ? handleUpdateAccount : handleAddAccount}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm">
                  {editingAccount ? '更新' : '追加'}
                </button>
                <button onClick={() => { setShowAccountForm(false); setEditingAccount(null); resetAccForm(); }}
                  className="text-gray-600 border border-gray-300 px-4 py-1.5 rounded text-sm">キャンセル</button>
              </div>
            </div>
          )}

          {accounts.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center border border-gray-200 rounded-lg">Amazonアカウント未登録</p>
          ) : (
            <div className="space-y-2">
              {accounts.map(a => {
                const test = testResults[a.id];
                return (
                  <div key={a.id} className="border border-gray-200 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{a.accountName}</span>
                        <span className="text-xs text-gray-400 ml-3">Seller: {a.sellerId}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleTestConnection(a.id)}
                          disabled={test?.loading}
                          className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50">
                          {test?.loading ? 'テスト中...' : '接続テスト'}
                        </button>
                        <button onClick={() => handleEditAccount(a)} className="text-xs text-blue-600 hover:underline">編集</button>
                        <button onClick={() => handleDeleteAccount(a.id)} className="text-xs text-red-500 hover:underline">削除</button>
                      </div>
                    </div>
                    {test?.result && (
                      <div className={`mt-2 p-3 rounded text-xs ${test.result.success ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                        {test.result.success ? (
                          <div className="space-y-1">
                            <p className="font-semibold">{test.result.message || '接続成功'}</p>
                            {test.result.salesApiOk && <p>Sales API: OK — 本日の売上: {test.result.todaySales}</p>}
                            {test.result.salesApiOk === false && <p className="text-yellow-700">{test.result.note}</p>}
                            {test.result.marketplaces && (
                              <div>
                                <p>マーケットプレイス:</p>
                                {test.result.marketplaces.map((m: any, i: number) => (
                                  <span key={i} className="inline-block bg-green-100 rounded px-2 py-0.5 mr-1 mt-1">{m.name || m.country} ({m.id})</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="font-semibold">接続失敗</p>
                            {test.result.step === 'token' && (
                              <p>トークン取得: 失敗 — Client ID / Secret / Refresh Token を確認してください</p>
                            )}
                            {test.result.step === 'api' && (
                              <>
                                <p>トークン取得: OK</p>
                                <p>API呼び出し: 失敗 — {test.result.error}</p>
                                {test.result.hint && <p className="text-red-600 mt-1">{test.result.hint}</p>}
                              </>
                            )}
                            {test.result.step === 'unknown' && <p>エラー: {test.result.error}</p>}
                            {!test.result.step && test.result.error && <p>エラー: {test.result.error}</p>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Fee Rules ── */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-700">料金ルール（成果報酬・広告運用費）</h3>
            <button onClick={() => setShowRuleForm(true)} className="text-sm text-blue-600 hover:underline">+ 追加</button>
          </div>

          {showRuleForm && (
            <div className="border border-gray-200 rounded-lg p-4 mb-3 space-y-3 bg-gray-50">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">種別</label>
                  <select value={ruleForm.ruleType} onChange={e => setRuleForm(p => ({ ...p, ruleType: e.target.value as any }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                    <option value="sales_performance">売上成果報酬</option>
                    <option value="adspend_percentage">広告運用費（広告費の%）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">説明</label>
                  <input type="text" value={ruleForm.description}
                    onChange={e => setRuleForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Amazonコンサル成果報酬" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-2">料率テーブル（段階制）</label>
                <div className="space-y-2">
                  {ruleForm.tiers.map((tier, idx) => (
                    <div key={idx} className="flex gap-2 items-center text-sm">
                      <span className="text-xs text-gray-500 w-6">{idx + 1}.</span>
                      <input type="number" value={tier.min} onChange={e => updateTier(idx, 'min', e.target.value)}
                        className="w-28 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="下限(円)" />
                      <span className="text-gray-400">〜</span>
                      <input type="number" value={tier.max ?? ''} onChange={e => updateTier(idx, 'max', e.target.value)}
                        className="w-28 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="上限(空=無制限)" />
                      <span className="text-gray-400">:</span>
                      <input type="number" value={tier.rate} onChange={e => updateTier(idx, 'rate', e.target.value)}
                        step="0.1" className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="%" />
                      <span className="text-gray-500 text-xs">%</span>
                      {ruleForm.tiers.length > 1 && (
                        <button onClick={() => setRuleForm(p => ({ ...p, tiers: p.tiers.filter((_, i) => i !== idx) }))}
                          className="text-red-400 hover:text-red-600">×</button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => setRuleForm(p => ({ ...p, tiers: [...p.tiers, emptyTier()] }))}
                  className="text-xs text-blue-600 hover:underline mt-2">+ 段階を追加</button>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800">
                例: 売上 ¥0〜¥1,000,000 は 5%、¥1,000,000〜上限なし は 10%
                → 売上¥1,500,000 の場合: ¥50,000 + ¥50,000 = ¥100,000
              </div>

              <div className="flex gap-2">
                <button onClick={handleAddRule} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm">追加</button>
                <button onClick={() => setShowRuleForm(false)} className="text-gray-600 border border-gray-300 px-4 py-1.5 rounded text-sm">キャンセル</button>
              </div>
            </div>
          )}

          {rules.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center border border-gray-200 rounded-lg">料金ルール未設定</p>
          ) : (
            <div className="space-y-2">
              {rules.map(r => (
                <div key={r.id} className="border border-gray-200 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.active ? '有効' : '無効'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.ruleType === 'sales_performance' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {r.ruleType === 'sales_performance' ? '売上成果報酬' : '広告運用費'}
                      </span>
                      <span className="font-medium text-sm">{r.description || '（名称なし）'}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleToggleRule(r)} className="text-xs text-blue-600 hover:underline">
                        {r.active ? '無効化' : '有効化'}
                      </button>
                      <button onClick={() => handleDeleteRule(r.id)} className="text-xs text-red-500 hover:underline">削除</button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{formatTiers(r.tiers, r.ruleType)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm hover:bg-gray-300">閉じる</button>
        </div>
      </div>
    </div>
  );
}
