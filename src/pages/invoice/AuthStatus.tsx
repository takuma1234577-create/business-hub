import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from './api';

export function AuthStatus() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ hasCredentials: boolean; hasToken: boolean } | null>(null);
  const [error, setError] = useState('');

  const checkStatus = async () => {
    try {
      const s = await authApi.status();
      setStatus(s);
    } catch (e: any) {
      setError('サーバーに接続できません');
    }
  };

  useEffect(() => {
    checkStatus();

    // Listen for OAuth completion from settings page popup
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'oauth_complete' && e.data?.service === 'gmail') {
        checkStatus();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleLogin = async () => {
    try {
      const { url } = await authApi.login();
      const popup = window.open(url, '_blank', 'width=600,height=700');
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          checkStatus();
        }
      }, 500);
    } catch (e: any) {
      setError('認証URLの取得に失敗しました');
    }
  };

  if (error) {
    return (
      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1">
        {error}
      </div>
    );
  }

  if (!status) return null;

  if (!status.hasCredentials) {
    return (
      <button
        onClick={() => navigate('/settings')}
        className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 transition"
      >
        API設定が必要です →
      </button>
    );
  }

  if (!status.hasToken) {
    return (
      <button
        onClick={handleLogin}
        className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 transition"
      >
        Google認証
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
      <span className="text-xs text-gray-600">Gmail連携済み</span>
      <button onClick={() => navigate('/settings')} className="text-xs text-gray-400 hover:text-gray-600 underline">API設定</button>
    </div>
  );
}
