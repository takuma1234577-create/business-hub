import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Copy, Check, RefreshCw, Sparkles } from 'lucide-react'

export default function ProposalGenerator() {
  const navigate = useNavigate()
  const [jobPost, setJobPost] = useState('')
  const [proposal, setProposal] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!jobPost.trim()) return
    setGenerating(true)
    setError('')
    setProposal('')
    try {
      const res = await fetch('/api/proposal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_post: jobPost }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '生成に失敗しました')
      }
      const data = await res.json()
      setProposal(data.proposal)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(proposal)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
              <FileText size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">CW提案文生成</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Input */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            案件内容を貼り付け
          </label>
          <textarea
            value={jobPost}
            onChange={e => setJobPost(e.target.value)}
            placeholder="クラウドワークスの案件タイトル・説明文をここに貼り付けてください..."
            rows={10}
            className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-400">{jobPost.length} 文字</p>
            <button
              onClick={handleGenerate}
              disabled={generating || !jobPost.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer transition-colors"
            >
              {generating ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {generating ? '生成中...' : '提案文を生成'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Output */}
        {proposal && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">生成された提案文</h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer transition-colors"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
              {proposal}
            </div>
            <p className="text-xs text-slate-400 mt-2">{proposal.length} 文字</p>
          </div>
        )}
      </main>
    </div>
  )
}
