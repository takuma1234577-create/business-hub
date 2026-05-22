import { useState } from 'react'
import { Calendar } from 'lucide-react'

// 日本の個人事業主は1月〜12月、法人は任意（ここでは1月〜12月をデフォルト）
const FISCAL_START_MONTH = 1 // 1月始まり

interface FiscalYear {
  label: string
  startDate: string
  endDate: string
}

function generateFiscalYears(): FiscalYear[] {
  const currentYear = new Date().getFullYear()
  const years: FiscalYear[] = []
  for (let y = currentYear; y >= currentYear - 5; y--) {
    if (FISCAL_START_MONTH === 1) {
      years.push({
        label: `${y}年度`,
        startDate: `${y}-01-01`,
        endDate: `${y}-12-31`,
      })
    } else {
      // 4月始まりの場合: 2025年度 = 2025-04-01 ~ 2026-03-31
      years.push({
        label: `${y}年度`,
        startDate: `${y}-${String(FISCAL_START_MONTH).padStart(2, '0')}-01`,
        endDate: `${y + 1}-${String(FISCAL_START_MONTH - 1).padStart(2, '0')}-${FISCAL_START_MONTH === 4 ? '31' : '28'}`,
      })
    }
  }
  return years
}

const MONTHS = [
  { label: '1月', month: 1 }, { label: '2月', month: 2 }, { label: '3月', month: 3 },
  { label: '4月', month: 4 }, { label: '5月', month: 5 }, { label: '6月', month: 6 },
  { label: '7月', month: 7 }, { label: '8月', month: 8 }, { label: '9月', month: 9 },
  { label: '10月', month: 10 }, { label: '11月', month: 11 }, { label: '12月', month: 12 },
]

const PRESETS = [
  { label: '上半期 (1〜6月)', fromMonth: 1, toMonth: 6 },
  { label: '下半期 (7〜12月)', fromMonth: 7, toMonth: 12 },
  { label: 'Q1 (1〜3月)', fromMonth: 1, toMonth: 3 },
  { label: 'Q2 (4〜6月)', fromMonth: 4, toMonth: 6 },
  { label: 'Q3 (7〜9月)', fromMonth: 7, toMonth: 9 },
  { label: 'Q4 (10〜12月)', fromMonth: 10, toMonth: 12 },
]

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// BS用: 決算年度 + 基準月を選択 -> asOfDate
interface BSPickerProps {
  onSelect: (asOfDate: string) => void
  loading?: boolean
}

export function BSFiscalPicker({ onSelect, loading }: BSPickerProps) {
  const fiscalYears = generateFiscalYears()
  const [selectedYear, setSelectedYear] = useState<FiscalYear | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)

  const handleYearSelect = (fy: FiscalYear) => {
    setSelectedYear(fy)
    setSelectedMonth(null)
  }

  const handleMonthSelect = (month: number) => {
    if (!selectedYear) return
    setSelectedMonth(month)
    const year = parseInt(selectedYear.startDate.substring(0, 4))
    const day = lastDayOfMonth(year, month)
    const asOfDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onSelect(asOfDate)
  }

  const handleFullYear = () => {
    if (!selectedYear) return
    setSelectedMonth(12)
    onSelect(selectedYear.endDate)
  }

  return (
    <div className="space-y-4">
      {/* 決算年度 */}
      <div>
        <label className="text-xs font-medium text-gray-500 mb-2 block">決算年度</label>
        <div className="flex flex-wrap gap-2">
          {fiscalYears.map(fy => (
            <button
              key={fy.label}
              onClick={() => handleYearSelect(fy)}
              className={`px-4 py-2 text-sm rounded-lg border transition ${
                selectedYear?.label === fy.label
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300 hover:bg-violet-50'
              }`}
            >
              {fy.label}
            </button>
          ))}
        </div>
      </div>

      {/* 基準月 */}
      {selectedYear && (
        <div>
          <label className="text-xs font-medium text-gray-500 mb-2 block">
            基準日 <span className="text-gray-400">({selectedYear.label})</span>
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={handleFullYear}
              className={`px-4 py-2 text-sm rounded-lg border transition ${
                selectedMonth === 12 && !MONTHS.find(m => m.month === 12 && selectedMonth === 12)
                  ? 'bg-violet-600 text-white border-violet-600' : ''
              } bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100`}
            >
              <Calendar size={14} className="inline mr-1" />
              年度末 ({selectedYear.endDate})
            </button>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {MONTHS.map(m => (
              <button
                key={m.month}
                onClick={() => handleMonthSelect(m.month)}
                disabled={loading}
                className={`px-3 py-2 text-sm rounded-lg border transition ${
                  selectedMonth === m.month
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300'
                } disabled:opacity-50`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// PL用: 決算年度 + 期間を選択 -> dateFrom, dateTo
interface PLPickerProps {
  onSelect: (dateFrom: string, dateTo: string) => void
  loading?: boolean
}

export function PLFiscalPicker({ onSelect, loading }: PLPickerProps) {
  const fiscalYears = generateFiscalYears()
  const [selectedYear, setSelectedYear] = useState<FiscalYear | null>(null)

  const handleYearSelect = (fy: FiscalYear) => {
    setSelectedYear(fy)
    // 年度全体を自動選択
    onSelect(fy.startDate, fy.endDate)
  }

  const handlePreset = (preset: typeof PRESETS[0]) => {
    if (!selectedYear) return
    const year = parseInt(selectedYear.startDate.substring(0, 4))
    const fromDate = `${year}-${String(preset.fromMonth).padStart(2, '0')}-01`
    const toDay = lastDayOfMonth(year, preset.toMonth)
    const toDate = `${year}-${String(preset.toMonth).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`
    onSelect(fromDate, toDate)
  }

  const handleMonthRange = (fromMonth: number, toMonth: number) => {
    if (!selectedYear) return
    const year = parseInt(selectedYear.startDate.substring(0, 4))
    const fromDate = `${year}-${String(fromMonth).padStart(2, '0')}-01`
    const toDay = lastDayOfMonth(year, toMonth)
    const toDate = `${year}-${String(toMonth).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`
    onSelect(fromDate, toDate)
  }

  const [fromMonth, setFromMonth] = useState<number | null>(null)
  const [toMonth, setToMonth] = useState<number | null>(null)

  const handleMonthClick = (month: number) => {
    if (fromMonth === null || (fromMonth !== null && toMonth !== null)) {
      // 新しい選択開始
      setFromMonth(month)
      setToMonth(null)
    } else {
      // 終了月を選択
      const from = Math.min(fromMonth, month)
      const to = Math.max(fromMonth, month)
      setFromMonth(from)
      setToMonth(to)
      handleMonthRange(from, to)
    }
  }

  return (
    <div className="space-y-4">
      {/* 決算年度 */}
      <div>
        <label className="text-xs font-medium text-gray-500 mb-2 block">決算年度</label>
        <div className="flex flex-wrap gap-2">
          {fiscalYears.map(fy => (
            <button
              key={fy.label}
              onClick={() => handleYearSelect(fy)}
              className={`px-4 py-2 text-sm rounded-lg border transition ${
                selectedYear?.label === fy.label
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300 hover:bg-violet-50'
              }`}
            >
              {fy.label}
            </button>
          ))}
        </div>
      </div>

      {/* 期間選択 */}
      {selectedYear && (
        <div>
          <label className="text-xs font-medium text-gray-500 mb-2 block">
            対象期間 <span className="text-gray-400">({selectedYear.label})</span>
          </label>

          {/* プリセット */}
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => onSelect(selectedYear.startDate, selectedYear.endDate)}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition"
            >
              通年
            </button>
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                disabled={loading}
                className="px-3 py-1.5 text-xs rounded-lg bg-white text-gray-600 border border-gray-200 hover:border-violet-300 transition disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 月選択（カスタム範囲） */}
          <p className="text-xs text-gray-400 mb-2">または月を2つクリックして範囲指定:</p>
          <div className="grid grid-cols-6 gap-2">
            {MONTHS.map(m => {
              const isFrom = fromMonth === m.month
              const isTo = toMonth === m.month
              const isInRange = fromMonth !== null && toMonth !== null && m.month >= fromMonth && m.month <= toMonth
              return (
                <button
                  key={m.month}
                  onClick={() => handleMonthClick(m.month)}
                  disabled={loading}
                  className={`px-3 py-2 text-sm rounded-lg border transition disabled:opacity-50 ${
                    isFrom || isTo
                      ? 'bg-violet-600 text-white border-violet-600'
                      : isInRange
                        ? 'bg-violet-100 text-violet-700 border-violet-300'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300'
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
