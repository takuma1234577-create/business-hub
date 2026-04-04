import { useState } from 'react'
import { Package, Link, Search, ShoppingBag } from 'lucide-react'
import ToolLayout from '../components/ToolLayout'
import OrderList from './amazon/OrderList'
import SkuMappings from './amazon/SkuMappings'
import InventoryCheck from './amazon/InventoryCheck'
import ChannelProducts from './amazon/ChannelProducts'

type Tab = 'orders' | 'channel-products' | 'sku-mappings' | 'inventory'

const TABS: { key: Tab; label: string; icon: typeof Package }[] = [
  { key: 'orders', label: '注文管理', icon: Package },
  { key: 'channel-products', label: 'チャネル商品', icon: ShoppingBag },
  { key: 'sku-mappings', label: 'SKUマッピング', icon: Link },
  { key: 'inventory', label: '在庫確認', icon: Search },
]

export default function AmazonAutoShip() {
  const [activeTab, setActiveTab] = useState<Tab>('orders')

  return (
    <ToolLayout title="Amazon自動出荷">
      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-700">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === key
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'orders' && <OrderList />}
      {activeTab === 'channel-products' && <ChannelProducts />}
      {activeTab === 'sku-mappings' && <SkuMappings />}
      {activeTab === 'inventory' && <InventoryCheck />}
    </ToolLayout>
  )
}
