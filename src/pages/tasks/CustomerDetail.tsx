import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from './api';
import type { Customer, Task, MeetingNote } from './types';
import TaskCard from './TaskCard';

interface CustomerDetailData extends Customer {
  tasks: Task[];
  meetings: MeetingNote[];
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetailData | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    business_description: '',
    contract_type: '',
    chatwork_room_id: '',
    notes: '',
  });

  useEffect(() => {
    if (id) loadCustomer();
  }, [id]);

  const loadCustomer = async () => {
    try {
      const res = await api.get(`/customers/${id}`);
      const data = (res as unknown as { data: { data: CustomerDetailData } }).data.data;
      setCustomer(data);
      setForm({
        business_description: data.business_description || '',
        contract_type: data.contract_type || '',
        chatwork_room_id: data.chatwork_room_id || '',
        notes: data.notes || '',
      });
    } catch (err) {
      console.error('顧客詳細取得エラー:', err);
    }
  };

  const saveCustomer = async () => {
    try {
      await api.put(`/customers/${id}`, form);
      setEditing(false);
      loadCustomer();
    } catch (err) {
      console.error('保存エラー:', err);
    }
  };

  if (!customer) return <div className="p-6 text-gray-500">読み込み中...</div>;

  const activeTasks = customer.tasks.filter(t => t.status !== 'done');
  const doneTasks = customer.tasks.filter(t => t.status === 'done');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">👤 {customer.name}</h1>
        <button
          onClick={() => setEditing(!editing)}
          className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
        >
          {editing ? 'キャンセル' : '✏️ 編集'}
        </button>
      </div>

      {/* 顧客情報 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Chatworkルームid</label>
              <input
                type="text"
                value={form.chatwork_room_id}
                onChange={e => setForm({ ...form, chatwork_room_id: e.target.value })}
                placeholder="例: 123456789"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">契約種別</label>
              <input
                type="text"
                value={form.contract_type}
                onChange={e => setForm({ ...form, contract_type: e.target.value })}
                placeholder="例: Amazonコンサル月次"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">事業概要</label>
              <textarea
                value={form.business_description}
                onChange={e => setForm({ ...form, business_description: e.target.value })}
                rows={3}
                placeholder="どんな事業をしているか、Amazon販売の状況など"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">メモ</label>
              <textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <button
              onClick={saveCustomer}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              保存
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="Chatworkルームid" value={customer.chatwork_room_id} />
            <InfoRow label="契約種別" value={customer.contract_type} />
            <div className="col-span-2">
              <InfoRow label="事業概要" value={customer.business_description} multiline />
            </div>
            <div className="col-span-2">
              <InfoRow label="メモ" value={customer.notes} multiline />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* タスク */}
        <div>
          <h2 className="font-bold text-gray-800 mb-3">
            ✅ タスク ({activeTasks.length}件アクティブ / {doneTasks.length}件完了)
          </h2>
          <div className="space-y-3">
            {activeTasks.length === 0 ? (
              <p className="text-gray-400 text-sm py-4 text-center">アクティブなタスクなし</p>
            ) : (
              activeTasks.map(task => (
                <TaskCard key={task.id} task={task} onUpdate={loadCustomer} />
              ))
            )}
          </div>
        </div>

        {/* 議事録 */}
        <div>
          <h2 className="font-bold text-gray-800 mb-3">📋 議事録 ({customer.meetings.length}件)</h2>
          {customer.meetings.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">議事録なし</p>
          ) : (
            <div className="space-y-3">
              {customer.meetings.map(note => (
                <div key={note.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="font-medium text-sm text-gray-900">{note.title}</p>
                  {note.meeting_date && (
                    <p className="text-xs text-gray-500 mt-1">{note.meeting_date}</p>
                  )}
                  {note.summary && (
                    <p className="text-xs text-gray-600 mt-2 line-clamp-3">{note.summary}</p>
                  )}
                  {note.action_items && (() => {
                    try {
                      const items = JSON.parse(note.action_items || '[]');
                      return items.length > 0 ? (
                        <p className="text-xs text-blue-600 mt-1">アクション {items.length}件</p>
                      ) : null;
                    } catch { return null; }
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-sm text-gray-900 mt-0.5 ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {value || <span className="text-gray-400">未設定</span>}
      </p>
    </div>
  );
}
