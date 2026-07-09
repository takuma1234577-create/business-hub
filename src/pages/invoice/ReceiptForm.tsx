import { useState, useEffect } from 'react';
import { pdf } from '@react-pdf/renderer';
import type { ReceiptData, Client, SenderSettings } from './types';
import { clientApi, settingsApi, gmailApi, receiptApi } from './api';
import { ReceiptPDF } from './ReceiptPDF';

const defaultSender: SenderSettings = {
  senderName: '', senderCompany: '', senderPostalCode: '', senderAddress: '',
  senderPhone: '', senderEmail: '',
  bankName: '', bankBranch: '', bankAccount: '', bankAccountName: '', bankSwift: '', currency: 'JPY',
};

const emptyClient: Client = {
  id: '', companyName: '', contactName: '', email: '', postalCode: '', address: '',
};

const today = () => {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
};

const defaultReceiptNumber = () => {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const ymd = `${jst.getFullYear()}${String(jst.getMonth() + 1).padStart(2, '0')}${String(jst.getDate()).padStart(2, '0')}`;
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `R-${ymd}-${rand}`;
};

const PAYMENT_METHODS = ['銀行振込', '現金', 'クレジットカード', '口座振替', 'その他'];

const fmtDate = (d: string) => {
  const date = new Date(d);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

export function ReceiptForm() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  const [receipt, setReceipt] = useState<ReceiptData>({
    receiptNumber: defaultReceiptNumber(),
    issueDate: today(),
    client: emptyClient,
    sender: defaultSender,
    amount: 0,
    taxRate: 10,
    subject: '',
    paymentMethod: '銀行振込',
    notes: '',
  });

  useEffect(() => {
    Promise.all([clientApi.list(), settingsApi.get()])
      .then(([c, settings]) => {
        setClients(c);
        setReceipt(prev => ({ ...prev, sender: settings }));
      })
      .catch(err => {
        setMessage({ type: 'error', text: 'データの読み込みに失敗しました: ' + err.message });
      });
  }, []);

  const buildEmail = (r: ReceiptData) => {
    const subject = `【領収書】${r.sender.senderCompany || r.sender.senderName || ''}`;
    const body = [
      `${r.client.companyName || ''}${r.client.contactName ? `\n${r.client.contactName} 様` : ' 御中'}`,
      '',
      'いつもお世話になっております。',
      `${r.sender.senderName || ''}です。`,
      '',
      'お支払いいただいた件につきまして、領収書を添付いたします。',
      'ご査収のほどよろしくお願いいたします。',
      '',
      `金額：¥${r.amount.toLocaleString()}`,
      `但し：${r.subject || ''} として`,
      '',
      `${r.sender.senderName || ''}`,
    ].join('\n');
    setEmailSubject(subject);
    setEmailBody(body);
  };

  const handleClientSelect = (id: string) => {
    setSelectedClientId(id);
    const client = clients.find(c => c.id === id) || emptyClient;
    const updated = { ...receipt, client };
    setReceipt(updated);
    buildEmail(updated);
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadName(file.name);
    setParsing(true);
    setMessage(null);
    try {
      const parsed = await receiptApi.parse(file);
      // AIが読み取った請求先の会社名で既存クライアントを照合（メール等を補完）
      const matched = clients.find(
        c => c.companyName && parsed.companyName &&
          c.companyName.replace(/\s/g, '') === parsed.companyName.replace(/\s/g, '')
      );
      const client: Client = matched
        ? { ...matched, contactName: parsed.contactName || matched.contactName }
        : { ...emptyClient, companyName: parsed.companyName, contactName: parsed.contactName };
      setSelectedClientId(matched?.id || '');

      const next: ReceiptData = {
        ...receipt,
        client,
        amount: parsed.amount || receipt.amount,
        taxRate: parsed.taxRate,
        subject: parsed.subject || receipt.subject,
      };
      setReceipt(next);
      buildEmail(next);
      setMessage({ type: 'success', text: `解析完了：${parsed.companyName || '宛名'} / ¥${(parsed.amount || 0).toLocaleString()}${matched ? '（既存クライアントと照合）' : ''}。内容を確認してください。` });
    } catch (e: any) {
      setMessage({ type: 'error', text: '解析エラー: ' + (e.response?.data?.error || e.message) });
    } finally {
      setParsing(false);
    }
  };

  const update = <K extends keyof ReceiptData>(key: K, value: ReceiptData[K]) => {
    setReceipt(prev => {
      const next = { ...prev, [key]: value };
      buildEmail(next);
      return next;
    });
  };

  const updateClientField = (key: keyof Client, value: string) => {
    setReceipt(prev => {
      const next = { ...prev, client: { ...prev.client, [key]: value } };
      buildEmail(next);
      return next;
    });
  };

  const pdfFilename = () => {
    const d = new Date(receipt.issueDate);
    const name = receipt.client.companyName || '領収書';
    return `領収書_${name}_${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月.pdf`;
  };

  // 発行者情報が空ならPDF生成直前に取得し直す（発行者欄の空欄を防ぐ）
  const ensureReceipt = async (): Promise<ReceiptData> => {
    if (receipt.sender.senderName || receipt.sender.senderCompany) return receipt;
    try {
      const settings = await settingsApi.get();
      const next = { ...receipt, sender: settings };
      setReceipt(next);
      return next;
    } catch {
      return receipt;
    }
  };

  const generatePDF = async (r: ReceiptData): Promise<{ base64: string; filename: string }> => {
    const blob = await pdf(<ReceiptPDF receipt={r} />).toBlob();
    const filename = pdfFilename();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({ base64, filename });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const validate = (): boolean => {
    if (!receipt.client.companyName) {
      setMessage({ type: 'error', text: '宛名（会社名）を入力してください' });
      return false;
    }
    if (!receipt.amount || receipt.amount <= 0) {
      setMessage({ type: 'error', text: '金額を入力してください' });
      return false;
    }
    return true;
  };

  const handleDownloadPDF = async () => {
    if (!validate()) return;
    setLoading(true);
    setMessage(null);
    try {
      const r = await ensureReceipt();
      const blob = await pdf(<ReceiptPDF receipt={r} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfFilename();
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMessage({ type: 'error', text: 'PDF生成エラー: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!validate()) return;
    if (!receipt.client.email) {
      setMessage({ type: 'error', text: '宛先メールアドレスがありません（クライアント設定またはメールを確認）' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const r = await ensureReceipt();
      const { base64, filename } = await generatePDF(r);
      await gmailApi.createDraft({
        to: receipt.client.email,
        subject: emailSubject,
        body: emailBody,
        pdfBase64: base64,
        pdfFilename: filename,
        invoiceNumber: receipt.receiptNumber,
      });
      setMessage({ type: 'success', text: 'Gmailに下書きを作成しました' });
    } catch (e: any) {
      setMessage({ type: 'error', text: '下書き作成エラー: ' + (e.response?.data?.error || e.message) });
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!validate()) return;
    if (!receipt.client.email) {
      setMessage({ type: 'error', text: '宛先メールアドレスがありません' });
      return;
    }
    if (!window.confirm(`${receipt.client.email} 宛に領収書を送信します。よろしいですか？`)) return;
    setLoading(true);
    setMessage(null);
    try {
      const r = await ensureReceipt();
      const { base64, filename } = await generatePDF(r);
      await gmailApi.send({
        to: receipt.client.email,
        subject: emailSubject,
        body: emailBody,
        pdfBase64: base64,
        pdfFilename: filename,
        invoiceNumber: receipt.receiptNumber,
      });
      setMessage({ type: 'success', text: 'メールを送信しました' });
    } catch (e: any) {
      setMessage({ type: 'error', text: '送信エラー: ' + (e.response?.data?.error || e.message) });
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <div>
      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: form */}
        <div className="lg:col-span-2 space-y-6">
          {/* 請求書アップロード → AI解析 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-1">請求書から自動作成（AI）</h2>
            <p className="text-xs text-gray-500 mb-4">請求書のPDFまたは画像をアップロードすると、AIが宛名・金額・但し書きを読み取って下のフォームに反映します。</p>
            <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg px-4 py-8 cursor-pointer transition ${parsing ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={parsing}
                onChange={e => { handleUpload(e.target.files?.[0]); e.target.value = ''; }}
              />
              {parsing ? (
                <span className="text-sm text-blue-600">AIが解析中...（数十秒かかる場合があります）</span>
              ) : (
                <>
                  <span className="text-sm font-medium text-gray-700">クリックして請求書を選択</span>
                  <span className="text-xs text-gray-400 mt-1">PDF / JPG / PNG（最大20MB）</span>
                  {uploadName && <span className="text-xs text-gray-500 mt-2">前回: {uploadName}</span>}
                </>
              )}
            </label>
          </div>

          {/* 宛名 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">宛名</h2>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">クライアントから選択</label>
              <select value={selectedClientId} onChange={e => handleClientSelect(e.target.value)} className={inputCls}>
                <option value="">-- 手動入力 --</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.companyName}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">会社名 / 宛名</label>
                <input type="text" value={receipt.client.companyName} onChange={e => updateClientField('companyName', e.target.value)} className={inputCls} placeholder="株式会社〇〇" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">担当者名（任意）</label>
                <input type="text" value={receipt.client.contactName} onChange={e => updateClientField('contactName', e.target.value)} className={inputCls} placeholder="山田 太郎" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">メールアドレス（送信時に使用）</label>
                <input type="email" value={receipt.client.email} onChange={e => updateClientField('email', e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          {/* 領収内容 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">領収内容</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">領収番号</label>
                <input type="text" value={receipt.receiptNumber} onChange={e => update('receiptNumber', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">発行日</label>
                <input type="date" value={receipt.issueDate} onChange={e => update('issueDate', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">金額（円）</label>
                <input type="number" min={0} value={receipt.amount} onChange={e => update('amount', Number(e.target.value))} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">但し書き</label>
                <input type="text" value={receipt.subject} onChange={e => update('subject', e.target.value)} className={inputCls} placeholder="コンサルティング費用" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">お支払方法</label>
                <select value={receipt.paymentMethod} onChange={e => update('paymentMethod', e.target.value)} className={inputCls}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs text-gray-500 mb-1">備考</label>
              <textarea value={receipt.notes} onChange={e => update('notes', e.target.value)} rows={2} className={inputCls} />
            </div>
            <p className="text-xs text-gray-400 mt-3">発行者情報は「設定」タブで変更できます</p>
          </div>

          {/* メール作成 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">メール作成</h2>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">件名</label>
              <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">本文</label>
              <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={8} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
          </div>
        </div>

        {/* Right: actions + summary */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3 sticky top-4">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">アクション</h2>
            <button onClick={handleDownloadPDF} disabled={loading} className="w-full bg-gray-800 text-white py-3 rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
              PDFをダウンロード
            </button>
            <button onClick={handleCreateDraft} disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50">
              Gmailに下書き作成
            </button>
            <button onClick={handleSend} disabled={loading} className="w-full bg-green-600 text-white py-3 rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50">
              メールを送信する
            </button>
            {loading && <div className="text-center text-sm text-gray-500">処理中...</div>}
          </div>

          {/* サマリー */}
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <h3 className="text-sm font-semibold text-blue-800 mb-3">領収書サマリー</h3>
            <dl className="space-y-1 text-xs text-blue-700">
              <div className="flex justify-between"><dt>宛名</dt><dd>{receipt.client.companyName || '-'}</dd></div>
              <div className="flex justify-between"><dt>発行日</dt><dd>{fmtDate(receipt.issueDate)}</dd></div>
              <div className="flex justify-between"><dt>金額</dt><dd className="font-bold">¥{receipt.amount.toLocaleString()}</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
