import { useState, useEffect } from 'react';
import { api } from './api';
import type { Task, Customer } from './types';
import TaskCard from './TaskCard';

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'done'>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    customer_id: '',
    priority: 'medium',
    due_date: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [tasksRes, customersRes] = await Promise.all([
        api.get('/tasks'),
        api.get('/customers'),
      ]);
      setTasks((tasksRes as unknown as { data: { data: Task[] } }).data.data || []);
      setCustomers((customersRes as unknown as { data: { data: Customer[] } }).data.data || []);
    } catch (err) {
      console.error('データ取得エラー:', err);
    }
  };

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/tasks', {
        ...form,
        customer_id: form.customer_id ? parseInt(form.customer_id) : undefined,
        source: 'manual',
      });
      setForm({ title: '', description: '', customer_id: '', priority: 'medium', due_date: '' });
      setShowForm(false);
      loadData();
    } catch (err) {
      console.error('タスク作成エラー:', err);
    }
  };

  const filtered = tasks.filter(t => filter === 'all' || t.status === filter);
  const highCount = tasks.filter(t => t.priority === 'high' && t.status !== 'done').length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">✅ タスク管理</h1>
          {highCount > 0 && (
            <p className="text-red-600 text-sm mt-1">🔴 高優先度タスクが {highCount} 件あります</p>
          )}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          ＋ タスクを追加
        </button>
      </div>

      {/* タスク追加フォーム */}
      {showForm && (
        <form onSubmit={createTask} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <h2 className="font-bold text-gray-800 mb-4">新しいタスク</h2>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="タイトル *"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="詳細説明（任意）"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="grid grid-cols-3 gap-3">
              <select
                value={form.customer_id}
                onChange={e => setForm({ ...form, customer_id: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">顧客（任意）</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="high">🔴 高優先</option>
                <option value="medium">🟡 中優先</option>
                <option value="low">🟢 低優先</option>
              </select>
              <input
                type="date"
                value={form.due_date}
                onChange={e => setForm({ ...form, due_date: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                追加
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </form>
      )}

      {/* フィルター */}
      <div className="flex gap-2 mb-4">
        {[
          { value: 'all', label: `すべて (${tasks.length})` },
          { value: 'pending', label: `未着手 (${tasks.filter(t => t.status === 'pending').length})` },
          { value: 'in_progress', label: `対応中 (${tasks.filter(t => t.status === 'in_progress').length})` },
          { value: 'done', label: `完了 (${tasks.filter(t => t.status === 'done').length})` },
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

      {/* タスクリスト */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📭</p>
          <p>タスクがありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(task => (
            <TaskCard key={task.id} task={task} onUpdate={loadData} />
          ))}
        </div>
      )}
    </div>
  );
}
