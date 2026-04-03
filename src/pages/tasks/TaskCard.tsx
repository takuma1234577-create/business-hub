import type { Task } from './types';
import { api } from './api';

interface Props {
  task: Task;
  onUpdate: () => void;
}

const priorityConfig = {
  high: { label: '🔴 高', bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
  medium: { label: '🟡 中', bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700' },
  low: { label: '🟢 低', bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700' },
};

const statusConfig = {
  pending: { label: '未着手', color: 'text-gray-500' },
  in_progress: { label: '対応中', color: 'text-blue-600' },
  done: { label: '完了', color: 'text-green-600' },
};

const sourceLabel: Record<string, string> = {
  chatwork: '💬 Chatwork',
  gmail: '📧 Gmail',
  meeting: '📋 議事録',
  ai: '🤖 AI生成',
  manual: '✍️ 手動',
  pending: '📌 持ち越し',
};

export default function TaskCard({ task, onUpdate }: Props) {
  const config = priorityConfig[task.priority] || priorityConfig.medium;
  const status = statusConfig[task.status] || statusConfig.pending;

  const updateStatus = async (newStatus: string) => {
    try {
      await api.patch(`/tasks/${task.id}/status`, { status: newStatus });
      onUpdate();
    } catch (err) {
      console.error('ステータス更新エラー:', err);
    }
  };

  const deleteTask = async () => {
    if (!confirm(`「${task.title}」を削除しますか？`)) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      onUpdate();
    } catch (err) {
      console.error('削除エラー:', err);
    }
  };

  return (
    <div className={`border rounded-lg p-4 ${config.bg} ${config.border} ${task.status === 'done' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
              {config.label}
            </span>
            {task.customer_name && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                👤 {task.customer_name}
              </span>
            )}
            <span className="text-xs text-gray-500">
              {sourceLabel[task.source] || task.source}
            </span>
            {task.due_date && (
              <span className="text-xs text-orange-600">
                📅 {task.due_date}
              </span>
            )}
          </div>
          <h3 className={`font-semibold text-gray-900 ${task.status === 'done' ? 'line-through' : ''}`}>
            {task.title}
          </h3>
          {task.description && (
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">{task.description}</p>
          )}
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          {task.status === 'pending' && (
            <button
              onClick={() => updateStatus('in_progress')}
              className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600 transition-colors"
            >
              対応中
            </button>
          )}
          {task.status === 'in_progress' && (
            <button
              onClick={() => updateStatus('done')}
              className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 transition-colors"
            >
              完了
            </button>
          )}
          {task.status === 'done' && (
            <button
              onClick={() => updateStatus('pending')}
              className="text-xs bg-gray-400 text-white px-2 py-1 rounded hover:bg-gray-500 transition-colors"
            >
              戻す
            </button>
          )}
          <button
            onClick={deleteTask}
            className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200 transition-colors"
          >
            削除
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className={`text-xs font-medium ${status.color}`}>● {status.label}</span>
        <span className="text-xs text-gray-400">
          {new Date(task.created_at).toLocaleDateString('ja-JP')}
        </span>
      </div>
    </div>
  );
}
