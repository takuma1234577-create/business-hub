import { useState, useEffect } from 'react';
import { api } from './api';
import type { GmailMessage } from './types';

const importanceConfig = {
  high: { label: '🔴 高', bg: 'bg-red-50', border: 'border-red-200' },
  medium: { label: '🟡 中', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  low: { label: '🟢 低', bg: 'bg-green-50', border: 'border-green-200' },
};

export default function Emails() {
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [authStatus, setAuthStatus] = useState<{ authenticated: boolean } | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  useEffect(() => {
    checkAuth();
    loadEmails();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await api.get('/emails/auth/status');
      const data = (res as unknown as { data: { data: { authenticated: boolean } } }).data.data;
      setAuthStatus(data);
    } catch {
      setAuthStatus({ authenticated: false });
    }
  };

  const loadEmails = async () => {
    try {
      const res = await api.get('/emails');
      setEmails((res as unknown as { data: { data: GmailMessage[] } }).data.data || []);
    } catch (err) {
      console.error('メール取得エラー:', err);
    }
  };

  const getAuthUrl = async () => {
    try {
      const res = await api.get('/emails/auth');
      const data = (res as unknown as { data: { data: { auth_url: string } } }).data.data;
      setAuthUrl(data.auth_url);
      window.open(data.auth_url, '_blank');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const fetchEmails = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/emails/fetch', {});
      const data = (res as unknown as { data: { data: { fetched: number; analyzed: number; emails: GmailMessage[] } } }).data.data;
      setEmails(data.emails || []);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string; auth_url?: string } }; message?: string };
      if (e.response?.data?.auth_url) {
        setAuthUrl(e.response.data.auth_url);
        setAuthStatus({ authenticated: false });
      }
      setError(e.response?.data?.error || e.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const filtered = emails.filter(e =>
    filter === 'all' || e.importance === filter
  );

  const highCount = emails.filter(e => e.importance === 'high').length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📧 メール管理</h1>
          {highCount > 0 && (
            <p className="text-red-600 text-sm mt-1">🔴 重要メールが {highCount} 件あります</p>
          )}
        </div>
        <button
          onClick={fetchEmails}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {loading ? '取得中...' : '🔄 メールを取得・分析'}
        </button>
      </div>

      {/* Gmail未認証 */}
      {authStatus && !authStatus.authenticated && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-6">
          <h3 className="font-bold text-yellow-800 mb-2">⚠️ Gmail認証が必要です</h3>
          <p className="text-sm text-yellow-700 mb-3">
            メールを取得するには、Googleアカウントとの連携が必要です。
          </p>
          <button
            onClick={getAuthUrl}
            className="bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-yellow-700 transition-colors"
          >
            🔑 Googleで認証する
          </button>
          {authUrl && (
            <p className="text-xs text-yellow-600 mt-2">
              認証後、ページを再読み込みしてください
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-700 text-sm">❌ {error}</p>
        </div>
      )}

      {/* フィルター */}
      <div className="flex gap-2 mb-4">
        {[
          { value: 'all', label: `すべて (${emails.length})` },
          { value: 'high', label: `🔴 高 (${emails.filter(e => e.importance === 'high').length})` },
          { value: 'medium', label: `🟡 中 (${emails.filter(e => e.importance === 'medium').length})` },
          { value: 'low', label: `🟢 低 (${emails.filter(e => e.importance === 'low').length})` },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value as typeof filter)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* メール一覧 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📭</p>
          <p>メールがありません。「メールを取得・分析」ボタンで取得してください。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(email => (
            <EmailCard key={email.id} email={email} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmailCard({ email }: { email: GmailMessage }) {
  const [expanded, setExpanded] = useState(false);
  const importance = email.importance as 'high' | 'medium' | 'low' | undefined;
  const config = importance ? importanceConfig[importance] : importanceConfig.medium;

  return (
    <div className={`border rounded-xl p-4 ${config.bg} ${config.border}`}>
      <div
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {importance && (
                <span className="text-xs font-medium">{config.label}</span>
              )}
              {email.category && (
                <span className="text-xs bg-white px-2 py-0.5 rounded-full text-gray-600 border">
                  {email.category}
                </span>
              )}
            </div>
            <p className="font-medium text-sm text-gray-900 truncate">
              {email.subject || '（件名なし）'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {email.from_name || email.from_address}
              {email.received_at && ` • ${new Date(email.received_at).toLocaleDateString('ja-JP')}`}
            </p>
          </div>
          <span className="text-gray-400 text-sm flex-shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/50 space-y-2">
          {email.summary && (
            <div>
              <p className="text-xs font-semibold text-gray-500">📝 要約</p>
              <p className="text-sm text-gray-700 mt-0.5">{email.summary}</p>
            </div>
          )}
          {email.recommended_action && (
            <div>
              <p className="text-xs font-semibold text-gray-500">💡 推奨アクション</p>
              <p className="text-sm text-gray-700 mt-0.5">{email.recommended_action}</p>
            </div>
          )}
          {email.body_snippet && (
            <div>
              <p className="text-xs font-semibold text-gray-500">本文プレビュー</p>
              <p className="text-xs text-gray-600 mt-0.5 line-clamp-3">{email.body_snippet}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
