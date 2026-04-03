import { useState, useEffect } from 'react';
import { pdf } from '@react-pdf/renderer';
import type { InvoiceData, InvoiceItem, Client, EmailTemplate, InvoiceItemType, SenderSettings, CalculatedFees, FeeTier } from './types';
import { clientApi, templateApi, gmailApi, settingsApi, amazonApi, feeRuleApi } from './api';
import { InvoicePDF, ensureFontsLoaded } from './InvoicePDF';

const ITEM_TYPE_LABELS: Record<InvoiceItemType, string> = {
  fixed: '固定',
  performance: '成果報酬',
  adspend: '広告費%',
};

const defaultSender: SenderSettings = {
  senderName: '', senderCompany: '', senderPostalCode: '', senderAddress: '',
  senderPhone: '', senderEmail: '',
  bankName: '', bankBranch: '', bankAccount: '', bankAccountName: '', bankSwift: '', currency: 'JPY',
};

const today = () => {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
};
const addDays = (date: string, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

const calcTieredFee = (amount: number, tiers: FeeTier[]): number => {
  let fee = 0;
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  for (const tier of sorted) {
    const min = tier.min || 0;
    const max = tier.max ?? Infinity;
    if (amount <= min) continue;
    const taxable = Math.min(amount, max) - min;
    fee += Math.round(taxable * (tier.rate / 100));
  }
  return fee;
};

const calcUnitPrice = (item: InvoiceItem): number => {
  if (item.itemType === 'fixed') return item.unitPrice;
  const base = item.baseAmount ?? 0;
  if (item.useTiered && item.tiers && item.tiers.length > 0) {
    return calcTieredFee(base, item.tiers);
  }
  return Math.round((base * (item.rate ?? 0)) / 100);
};

const buildItemsText = (items: InvoiceItem[]): string => {
  return items.map(item => {
    const price = calcUnitPrice(item);
    const amount = item.itemType === 'fixed' ? price * item.quantity : price;
    return `・${item.description}：¥${amount.toLocaleString()}`;
  }).join('\n');
};

const applyTemplateVars = (
  text: string,
  inv: InvoiceData,
  subtotal: number,
  total: number,
): string => {
  const fmt = (d: string) => {
    const date = new Date(d);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };
  return text
    .replace(/\{会社名\}/g, inv.client.companyName || '{会社名}')
    .replace(/\{担当者名\}/g, inv.client.contactName || '{担当者名}')
    .replace(/\{請求項目\}/g, buildItemsText(inv.items))
    .replace(/\{品目\}/g, inv.items.map(i => i.description).filter(Boolean).join('、'))
    .replace(/\{合計金額\}/g, `¥${total.toLocaleString()}`)
    .replace(/\{小計\}/g, `¥${subtotal.toLocaleString()}`)
    .replace(/\{請求書番号\}/g, inv.invoiceNumber || '{請求書番号}')
    .replace(/\{請求日\}/g, inv.issueDate ? fmt(inv.issueDate) : '{請求日}')
    .replace(/\{支払期限\}/g, inv.dueDate ? fmt(inv.dueDate) : '{支払期限}')
    .replace(/\{差出人名\}/g, inv.sender.senderName || '{差出人名}')
    .replace(/\{会社名_差出人\}/g, inv.sender.senderCompany || '{会社名_差出人}');
};

export function InvoiceForm() {
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [calcMonth, setCalcMonth] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [calcResult, setCalcResult] = useState<CalculatedFees | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  const [invoice, setInvoice] = useState<InvoiceData>({
    invoiceNumber: '',
    issueDate: today(),
    dueDate: addDays(today(), 10),
    client: { id: '', companyName: '', contactName: '', email: '', postalCode: '', address: '' },
    sender: defaultSender,
    items: [newItem()],
    notes: '※振込手数料はご負担ください。',
  });

  useEffect(() => {
    Promise.all([clientApi.list(), templateApi.list(), settingsApi.get()]).then(
      ([c, t, settings]) => {
        setClients(c);
        setTemplates(t);
        setInvoice(prev => ({ ...prev, sender: settings }));
        if (t.length > 0) {
          setSelectedTemplateId(t[0].id);
          setEmailSubject(t[0].subject);
          setEmailBody(t[0].body);
        }
      }
    ).catch(err => {
      setMessage({ type: 'error', text: 'データの読み込みに失敗しました: ' + err.message });
    });
  }, []);

  const refreshEmail = (inv: InvoiceData, tmplId?: string) => {
    const tmpl = templates.find(t => t.id === (tmplId ?? selectedTemplateId));
    if (!tmpl) return;
    const st = inv.items.reduce((sum, item) => {
      const price = calcUnitPrice(item);
      return sum + (item.itemType === 'fixed' ? price * item.quantity : price);
    }, 0);
    setEmailSubject(applyTemplateVars(tmpl.subject, inv, st, st));
    setEmailBody(applyTemplateVars(tmpl.body, inv, st, st));
  };

  const handleClientSelect = (id: string) => {
    setSelectedClientId(id);
    const client = clients.find(c => c.id === id);
    if (client) {
      const items = client.defaultItems && client.defaultItems.length > 0
        ? client.defaultItems.map((item, i) => ({ ...item, id: `default_${Date.now()}_${i}` }))
        : [newItem()];
      const updated = { ...invoice, client, items };
      setInvoice(updated);
      refreshEmail(updated);
    }
  };

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplateId(id);
    refreshEmail(invoice, id);
  };

  const handleFetchAndCalc = async () => {
    if (!selectedClientId) {
      setMessage({ type: 'error', text: 'クライアントを選択してください' });
      return;
    }
    setCalcLoading(true);
    try {
      // Fetch sales for all accounts
      const accounts = await amazonApi.listAccounts(selectedClientId);
      for (const acc of accounts) {
        await amazonApi.fetchSales(acc.id, calcMonth);
      }
      // Calculate fees
      const result = await feeRuleApi.calculate(selectedClientId, calcMonth);
      setCalcResult(result);
    } catch (e: any) {
      setMessage({ type: 'error', text: '売上取得エラー: ' + e.message });
    } finally {
      setCalcLoading(false);
    }
  };

  const applyCalcToInvoice = () => {
    if (!calcResult) return;
    const newItems: InvoiceItem[] = calcResult.feeItems.map((fi, i) => ({
      id: `calc_${Date.now()}_${i}`,
      description: fi.description,
      unitPrice: 0,
      quantity: 1,
      itemType: fi.ruleType === 'sales_performance' ? 'performance' as InvoiceItemType : 'adspend' as InvoiceItemType,
      baseAmount: fi.baseAmount,
      rate: fi.fee > 0 && fi.baseAmount > 0 ? Math.round((fi.fee / fi.baseAmount) * 10000) / 100 : 0,
    }));
    setInvoice(prev => ({ ...prev, items: [...prev.items.filter(i => !i.id.startsWith('calc_')), ...newItems] }));
    setMessage({ type: 'success', text: `${newItems.length}件の自動計算項目を追加しました` });
  };

  const updateItem = (id: string, field: keyof InvoiceItem, value: string | number) => {
    setInvoice(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === 'itemType' && value !== 'fixed') {
          updated.quantity = 1;
        }
        return updated;
      }),
    }));
  };

  const addItem = () => {
    setInvoice(prev => ({ ...prev, items: [...prev.items, newItem()] }));
  };

  const removeItem = (id: string) => {
    setInvoice(prev => ({ ...prev, items: prev.items.filter(item => item.id !== id) }));
  };

  const subtotal = invoice.items.reduce((sum, item) => {
    const price = calcUnitPrice(item);
    return sum + (item.itemType === 'fixed' ? price * item.quantity : price);
  }, 0);
  const total = subtotal;

  const generatePDF = async (): Promise<{ base64: string; filename: string }> => {
    await ensureFontsLoaded();
    const blob = await pdf(<InvoicePDF invoice={invoice} subtotal={subtotal} total={total} />).toBlob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        const d = new Date(invoice.issueDate);
        const filename = `請求書_${invoice.client.companyName}_${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月.pdf`;
        resolve({ base64, filename });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleDownloadPDF = async () => {
    setLoading(true);
    try {
      await ensureFontsLoaded();
      const blob = await pdf(<InvoicePDF invoice={invoice} subtotal={subtotal} total={total} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date(invoice.issueDate);
      a.href = url;
      a.download = `請求書_${invoice.client.companyName}_${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMessage({ type: 'error', text: 'PDF生成エラー: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!invoice.client.email) {
      setMessage({ type: 'error', text: 'メールアドレスを入力してください' });
      return;
    }
    setLoading(true);
    try {
      const { base64, filename } = await generatePDF();
      await gmailApi.createDraft({
        to: invoice.client.email,
        subject: emailSubject,
        body: emailBody,
        pdfBase64: base64,
        pdfFilename: filename,
        invoiceNumber: invoice.invoiceNumber,
      });
      setMessage({ type: 'success', text: 'Gmailに下書きを作成しました' });
    } catch (e: any) {
      setMessage({ type: 'error', text: '下書き作成エラー: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!invoice.client.email) {
      setMessage({ type: 'error', text: 'メールアドレスを入力してください' });
      return;
    }
    if (!window.confirm(`${invoice.client.email} に送信してよろしいですか？`)) return;
    setLoading(true);
    try {
      const { base64, filename } = await generatePDF();
      await gmailApi.send({
        to: invoice.client.email,
        subject: emailSubject,
        body: emailBody,
        pdfBase64: base64,
        pdfFilename: filename,
        invoiceNumber: invoice.invoiceNumber,
      });
      setMessage({ type: 'success', text: 'メールを送信しました' });
    } catch (e: any) {
      setMessage({ type: 'error', text: '送信エラー: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-4 text-xs underline">閉じる</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Client Selection */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">請求先情報</h2>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">クライアントを選択</label>
              <select
                value={selectedClientId}
                onChange={e => handleClientSelect(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- 新規入力 --</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.companyName}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">会社名 *</label>
                <input
                  type="text"
                  value={invoice.client.companyName}
                  onChange={e => setInvoice(prev => ({ ...prev, client: { ...prev.client, companyName: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="株式会社〇〇"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">担当者名</label>
                <input
                  type="text"
                  value={invoice.client.contactName}
                  onChange={e => setInvoice(prev => ({ ...prev, client: { ...prev.client, contactName: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="山田 太郎"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">メールアドレス *</label>
                <input
                  type="email"
                  value={invoice.client.email}
                  onChange={e => setInvoice(prev => ({ ...prev, client: { ...prev.client, email: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="example@company.co.jp"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">郵便番号</label>
                <input
                  type="text"
                  value={invoice.client.postalCode}
                  onChange={e => setInvoice(prev => ({ ...prev, client: { ...prev.client, postalCode: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="123-4567"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600 mb-1">住所</label>
                <input
                  type="text"
                  value={invoice.client.address}
                  onChange={e => setInvoice(prev => ({ ...prev, client: { ...prev.client, address: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="東京都渋谷区..."
                />
              </div>
            </div>
          </div>

          {/* Auto Calc from Amazon */}
          {selectedClientId && (
            <div className="bg-orange-50 rounded-xl shadow-sm border border-orange-200 p-6">
              <h2 className="text-lg font-semibold text-orange-800 mb-4">Amazon売上自動計算</h2>
              <div className="flex gap-3 items-end mb-4">
                <div>
                  <label className="block text-sm text-orange-700 mb-1">対象月</label>
                  <input type="month" value={calcMonth} onChange={e => setCalcMonth(e.target.value)}
                    className="border border-orange-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={handleFetchAndCalc} disabled={calcLoading}
                  className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-orange-700 transition disabled:opacity-50">
                  {calcLoading ? '取得中...' : '売上データ取得 & 計算'}
                </button>
              </div>
              {calcResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-white rounded-lg p-3 border border-orange-200">
                      <span className="text-xs text-gray-500">合計売上</span>
                      <p className="text-lg font-bold text-gray-800">¥{calcResult.totalSales.toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-orange-200">
                      <span className="text-xs text-gray-500">合計広告費</span>
                      <p className="text-lg font-bold text-gray-800">¥{calcResult.totalAdSpend.toLocaleString()}</p>
                    </div>
                  </div>
                  {calcResult.feeItems.length > 0 && (
                    <div className="bg-white rounded-lg p-3 border border-orange-200">
                      <p className="text-xs text-gray-500 mb-2">計算結果</p>
                      {calcResult.feeItems.map((fi, i) => (
                        <div key={i} className="flex justify-between text-sm py-1">
                          <span>{fi.description}</span>
                          <span className="font-medium">¥{fi.fee.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={applyCalcToInvoice}
                    className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-orange-700 w-full">
                    請求項目に反映する
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Invoice Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">請求情報</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">請求日</label>
                <input
                  type="date"
                  value={invoice.issueDate}
                  onChange={e => setInvoice(prev => ({ ...prev, issueDate: e.target.value, dueDate: addDays(e.target.value, 10) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">支払い期限</label>
                <input
                  type="date"
                  value={invoice.dueDate}
                  onChange={e => setInvoice(prev => ({ ...prev, dueDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">請求項目</h2>
            <div className="space-y-4">
              {invoice.items.map(item => {
                const computed = calcUnitPrice(item);
                const isVariable = item.itemType !== 'fixed';
                return (
                  <div key={item.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50 space-y-2">
                    {/* Row 1: type + description + remove */}
                    <div className="flex gap-2 items-center">
                      <select
                        value={item.itemType}
                        onChange={e => updateItem(item.id, 'itemType', e.target.value as InvoiceItemType)}
                        className="border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {(Object.keys(ITEM_TYPE_LABELS) as InvoiceItemType[]).map(t => (
                          <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={item.description}
                        onChange={e => updateItem(item.id, 'description', e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        placeholder={
                          item.itemType === 'performance' ? 'Amazonコンサル成果報酬' :
                          item.itemType === 'adspend' ? 'Amazon広告運用費' :
                          'コンサルティング費用'
                        }
                      />
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-red-400 hover:text-red-600 text-lg leading-none px-1"
                        disabled={invoice.items.length <= 1}
                      >
                        ×
                      </button>
                    </div>

                    {/* Row 2: inputs */}
                    {isVariable ? (
                      <div className="space-y-2">
                        {/* Base amount */}
                        <div className="flex gap-2 items-center text-sm">
                          <div className="flex-1">
                            <label className="block text-xs text-gray-500 mb-1">
                              {item.itemType === 'performance' ? '先月売上（円）' : '先月広告費（円）'}
                            </label>
                            <input
                              type="number"
                              value={item.baseAmount ?? 0}
                              onChange={e => updateItem(item.id, 'baseAmount', Number(e.target.value))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              placeholder="0"
                            />
                          </div>
                          {!item.useTiered && (
                            <>
                              <div className="text-gray-400 mt-4">×</div>
                              <div className="w-28">
                                <label className="block text-xs text-gray-500 mb-1">料率（%）</label>
                                <input
                                  type="number"
                                  value={item.rate ?? 0}
                                  onChange={e => updateItem(item.id, 'rate', Number(e.target.value))}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                  step="0.1"
                                  placeholder="0"
                                />
                              </div>
                            </>
                          )}
                          <div className="text-gray-400 mt-4">=</div>
                          <div className="w-36">
                            <label className="block text-xs text-gray-500 mb-1">請求額（円）</label>
                            <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-medium text-blue-700">
                              ¥{computed.toLocaleString()}
                            </div>
                          </div>
                        </div>

                        {/* Tiered toggle */}
                        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!item.useTiered}
                            onChange={e => {
                              const useTiered = e.target.checked;
                              setInvoice(prev => ({
                                ...prev,
                                items: prev.items.map(it => {
                                  if (it.id !== item.id) return it;
                                  return {
                                    ...it,
                                    useTiered,
                                    tiers: useTiered && (!it.tiers || it.tiers.length === 0)
                                      ? [{ min: 0, max: null, rate: 0 }]
                                      : it.tiers,
                                  };
                                }),
                              }));
                            }}
                            className="rounded border-gray-300"
                          />
                          段階制料率を使用（売上〇万円超の分に〇%）
                        </label>

                        {/* Tiered rate editor */}
                        {item.useTiered && (
                          <div className="bg-white border border-blue-200 rounded-lg p-3 space-y-2">
                            <p className="text-xs text-blue-700 font-medium">段階制料率の設定</p>
                            {(item.tiers ?? []).map((tier, ti) => (
                              <div key={ti} className="flex gap-2 items-center text-xs">
                                <span className="text-gray-500 whitespace-nowrap">売上</span>
                                <input
                                  type="number"
                                  value={tier.min}
                                  onChange={e => {
                                    const newTiers = [...(item.tiers ?? [])];
                                    newTiers[ti] = { ...newTiers[ti], min: Number(e.target.value) };
                                    setInvoice(prev => ({
                                      ...prev,
                                      items: prev.items.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it),
                                    }));
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
                                    setInvoice(prev => ({
                                      ...prev,
                                      items: prev.items.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it),
                                    }));
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
                                    setInvoice(prev => ({
                                      ...prev,
                                      items: prev.items.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it),
                                    }));
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
                                      setInvoice(prev => ({
                                        ...prev,
                                        items: prev.items.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it),
                                      }));
                                    }}
                                    className="text-red-400 hover:text-red-600 text-sm leading-none"
                                  >×</button>
                                )}
                              </div>
                            ))}
                            <button
                              onClick={() => {
                                const tiers = item.tiers ?? [];
                                const lastMax = tiers.length > 0 ? (tiers[tiers.length - 1].max ?? 0) : 0;
                                const newTiers = [...tiers, { min: lastMax, max: null, rate: 0 }];
                                setInvoice(prev => ({
                                  ...prev,
                                  items: prev.items.map(it => it.id === item.id ? { ...it, tiers: newTiers } : it),
                                }));
                              }}
                              className="text-xs text-blue-600 hover:text-blue-800"
                            >
                              + 段階を追加
                            </button>
                            {/* Tier breakdown preview */}
                            {(item.baseAmount ?? 0) > 0 && (item.tiers ?? []).length > 0 && (
                              <div className="border-t border-blue-100 pt-2 mt-1 text-xs text-gray-600 space-y-1">
                                <p className="font-medium text-blue-700">内訳プレビュー</p>
                                {[...(item.tiers ?? [])].sort((a, b) => a.min - b.min).map((tier, i) => {
                                  const base = item.baseAmount ?? 0;
                                  const min = tier.min || 0;
                                  const max = tier.max ?? Infinity;
                                  if (base <= min) return null;
                                  const taxable = Math.min(base, max) - min;
                                  const tierFee = Math.round(taxable * (tier.rate / 100));
                                  return (
                                    <div key={i} className="flex justify-between">
                                      <span>
                                        ¥{min.toLocaleString()}〜{max === Infinity ? '上限なし' : `¥${max.toLocaleString()}`}：
                                        ¥{taxable.toLocaleString()} × {tier.rate}%
                                      </span>
                                      <span className="font-medium">¥{tierFee.toLocaleString()}</span>
                                    </div>
                                  );
                                })}
                                <div className="flex justify-between font-bold text-blue-700 border-t border-blue-100 pt-1">
                                  <span>合計</span>
                                  <span>¥{computed.toLocaleString()}</span>
                                </div>
                              </div>
                            )}
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
                            onChange={e => updateItem(item.id, 'unitPrice', Number(e.target.value))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-xs text-gray-500 mb-1">数量</label>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                            min={1}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        </div>
                        <div className="w-36">
                          <label className="block text-xs text-gray-500 mb-1">小計（円）</label>
                          <div className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm font-medium text-gray-700">
                            ¥{(item.unitPrice * item.quantity).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={addItem}
              className="mt-4 text-sm text-blue-600 hover:text-blue-800 border border-blue-300 rounded-lg px-4 py-2 hover:bg-blue-50 transition"
            >
              + 行を追加
            </button>

            <div className="mt-6 border-t border-gray-200 pt-4 space-y-2">
              <div className="flex justify-end gap-8 text-sm">
                <span className="text-gray-600">小計 (SUB-TOTAL)</span>
                <span className="font-medium w-32 text-right">¥{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-end gap-8 text-base font-bold">
                <span className="text-gray-800">合計 (TOTAL)</span>
                <span className="text-blue-600 w-32 text-right">¥{total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">備考</h2>
            <textarea
              value={invoice.notes}
              onChange={e => setInvoice(prev => ({ ...prev, notes: e.target.value }))}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-2">差出人情報・振込先は「設定」タブで変更できます</p>
          </div>

          {/* Email Compose */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">メール作成</h2>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">テンプレート選択</label>
              <select
                value={selectedTemplateId}
                onChange={e => handleTemplateSelect(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">件名</label>
              <input
                type="text"
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">本文</label>
              <textarea
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                rows={8}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3 sticky top-4">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">アクション</h2>
            <button
              onClick={handleDownloadPDF}
              disabled={loading}
              className="w-full bg-gray-800 text-white py-3 rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
            >
              PDFをダウンロード
            </button>
            <button
              onClick={handleCreateDraft}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              Gmailに下書き作成
            </button>
            <button
              onClick={handleSend}
              disabled={loading}
              className="w-full bg-green-600 text-white py-3 rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50"
            >
              メールを送信する
            </button>
            {loading && (
              <div className="text-center text-sm text-gray-500">処理中...</div>
            )}
          </div>

          {/* Summary */}
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <h3 className="text-sm font-semibold text-blue-800 mb-3">請求書サマリー</h3>
            <dl className="space-y-1 text-xs text-blue-700">
              <div className="flex justify-between">
                <dt>請求先</dt>
                <dd>{invoice.client.companyName || '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>請求日</dt>
                <dd>{invoice.issueDate}</dd>
              </div>
              <div className="flex justify-between">
                <dt>支払期限</dt>
                <dd>{invoice.dueDate}</dd>
              </div>
              <div className="flex justify-between font-bold text-blue-900 border-t border-blue-200 pt-2 mt-2">
                <dt>合計金額</dt>
                <dd>¥{total.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
