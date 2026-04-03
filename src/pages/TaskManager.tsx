import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from './tasks/api';
import type { Customer } from './tasks/types';
import Sidebar from './tasks/Sidebar';
import Dashboard from './tasks/Dashboard';
import Tasks from './tasks/Tasks';
import MeetingNotes from './tasks/MeetingNotes';
import Emails from './tasks/Emails';
import Settings from './tasks/Settings';
import CustomerDetail from './tasks/CustomerDetail';

export default function TaskManager() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      const res = await api.get('/customers');
      const data = (res as unknown as { data: { data: Customer[] } }).data.data;
      setCustomers(data || []);
    } catch (err) {
      console.error('顧客取得エラー:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* ヘッダー */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex-shrink-0">
        <div className="px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            AI秘書 / タスク管理
          </h1>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar customers={customers} />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="list" element={<Tasks />} />
            <Route path="meetings" element={<MeetingNotes />} />
            <Route path="emails" element={<Emails />} />
            <Route path="settings" element={<Settings />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
