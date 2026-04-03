import { NavLink } from 'react-router-dom';
import type { Customer } from './types';

interface Props {
  customers: Customer[];
}

const navItems = [
  { to: '/tasks', label: '🏠 ダッシュボード', exact: true },
  { to: '/tasks/list', label: '✅ タスク管理' },
  { to: '/tasks/meetings', label: '📋 議事録' },
  { to: '/tasks/emails', label: '📧 メール' },
  { to: '/tasks/settings', label: '⚙️ 設定' },
];

export default function Sidebar({ customers }: Props) {
  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">🤖 AI Secretary</h1>
        <p className="text-xs text-gray-500 mt-0.5">専用秘書ツール</p>
      </div>

      <nav className="p-2 flex-1 overflow-y-auto scrollbar-hide">
        <div className="space-y-0.5">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        {customers.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase px-3 mb-1">顧客</p>
            <div className="space-y-0.5">
              {customers.map(c => (
                <NavLink
                  key={c.id}
                  to={`/tasks/customers/${c.id}`}
                  className={({ isActive }) =>
                    `block px-3 py-1.5 rounded-lg text-sm transition-colors truncate ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  👤 {c.name}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-gray-200">
        <p className="text-xs text-gray-400 text-center">
          SVPコーポレーション<br />宇良琢真
        </p>
      </div>
    </aside>
  );
}
