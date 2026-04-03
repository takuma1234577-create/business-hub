import { useState, useEffect } from 'react';
import { api } from './api';
import type { DailyReport, ExtractedTask, Task } from './types';
import TaskCard from './TaskCard';

export default function Dashboard() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ pending: 0, in_progress: 0, done: 0 });

  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      const res = await api.get<Task[]>('/tasks');
      const tasks = (res.data as unknown as { data: Task[] }).data || [];
      setTodayTasks(tasks.filter((t: Task) => t.status !== 'done'));

      const pending = tasks.filter((t: Task) => t.status === 'pending').length;
      const in_progress = tasks.filter((t: Task) => t.status === 'in_progress').length;
      const done = tasks.filter((t: Task) => t.status === 'done').length;
      setStats({ pending, in_progress, done });
    } catch (err) {
      console.error('タスク取得エラー:', err);
    }
  };

  const generateDaily = async (force = false) => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api.post<DailyReport>('/tasks/generate-daily', { force });
      const data = (res as unknown as { data: { data: DailyReport } }).data.data;
      setReport(data);
      await loadTasks();
    } catch (err) {
      const e = err as Error;
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const priorityOrder = { high: 0, medium: 1, low: 2 };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📋 今日のタスク</h1>
          <p className="text-gray-500 text-sm mt-1">{today}</p>
        </div>
        <button
          onClick={() => generateDaily(true)}
          disabled={generating}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {generating ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              生成中...
            </>
          ) : (
            <>🤖 今日のタスクを生成</>
          )}
        </button>
      </div>

      {/* 統計 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="未着手" value={stats.pending} color="text-gray-600" bg="bg-gray-50" />
        <StatCard label="対応中" value={stats.in_progress} color="text-blue-600" bg="bg-blue-50" />
        <StatCard label="今日完了" value={stats.done} color="text-green-600" bg="bg-green-50" />
      </div>

      {/* エラー */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-700 text-sm">❌ {error}</p>
        </div>
      )}

      {/* AIレポート */}
      {report && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🤖</span>
            <h2 className="font-bold text-blue-900">AIサマリー</h2>
            {report.cached && (
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">キャッシュ</span>
            )}
            {report.chatwork_rooms !== undefined && (
              <span className="text-xs text-blue-600">
                Chatwork {report.chatwork_rooms}ルーム分析済み
              </span>
            )}
          </div>
          <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-line">{report.summary}</p>

          {report.tasks.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">AI提案タスク ({report.tasks.length}件)</p>
              <div className="space-y-2">
                {[...report.tasks]
                  .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
                  .map((task, i) => (
                    <AiTaskItem key={i} task={task} />
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* タスク一覧 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">アクティブタスク ({todayTasks.length}件)</h2>
          <button
            onClick={loadTasks}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            🔄 更新
          </button>
        </div>
        {todayTasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-2">✨</p>
            <p>タスクがありません。上の「今日のタスクを生成」ボタンで自動生成できます。</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayTasks.map(task => (
              <TaskCard key={task.id} task={task} onUpdate={loadTasks} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4 text-center`}>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-sm text-gray-600 mt-1">{label}</p>
    </div>
  );
}

function AiTaskItem({ task }: { task: ExtractedTask }) {
  const emoji = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
  return (
    <div className="bg-white rounded-lg p-3 border border-blue-100">
      <div className="flex items-start gap-2">
        <span>{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-gray-900">
            {task.title}
            {task.customer_name && (
              <span className="ml-2 text-xs text-blue-600">（{task.customer_name}）</span>
            )}
          </p>
          {task.description && (
            <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
          )}
        </div>
        {task.due_hint && (
          <span className="text-xs text-orange-500 flex-shrink-0">{task.due_hint}</span>
        )}
      </div>
    </div>
  );
}
