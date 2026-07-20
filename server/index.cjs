const path = require('path');
const express = require('express');
const cors = require('cors');
const { waitUntil } = require('@vercel/functions');

const app = express();

// Middleware
app.set('trust proxy', 1);
app.use(cors());
app.use(
  express.json({
    limit: '50mb',
    // LINE Webhook 署名検証のため生ボディを保持する
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Auth
const authRoutes = require(path.join(__dirname, 'auth.cjs'));
const { authMiddleware } = require(path.join(__dirname, 'auth.cjs'));
app.use('/api/auth', authRoutes);

// ===== Public endpoints (認証不要) =====
const { createClient: createPublicClient } = require('@supabase/supabase-js');
function getPublicSupabase() {
  return createPublicClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '');
}

// レビューウィジェットデータ（CORS許可）
app.get('/api/public/reviews/:product_id', cors(), async (req, res) => {
  try {
    const supabase = getPublicSupabase();
    const pid = req.params.product_id;

    const [reviewsRes, statsRes] = await Promise.all([
      supabase.from('shopify_reviews')
        .select('author_name, rating, title, body, verified_purchase, created_at, source')
        .eq('shopify_product_id', pid).eq('status', 'approved')
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('shopify_review_stats')
        .select('*').eq('shopify_product_id', pid).maybeSingle(),
    ]);

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.json({ reviews: reviewsRes.data || [], stats: statsRes.data || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// レビューウィジェットJS（静的ファイル配信）
app.get('/api/public/review-widget.js', cors(), (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
  res.sendFile(path.join(__dirname, '..', 'public', 'review-widget.js'));
});

app.use(authMiddleware);

// Tool route modules (use absolute paths for Vercel compatibility)
const invoiceRoutes = require(path.join(__dirname, 'invoice.cjs'));
const tasksRoutes = require(path.join(__dirname, 'tasks.cjs'));
const amazonRoutes = require(path.join(__dirname, 'amazon.cjs'));
const lineCrmRoutes = require(path.join(__dirname, 'line-crm.cjs'));
const accountingRoutes = require(path.join(__dirname, 'accounting.cjs'));
const accountingCoreRoutes = require(path.join(__dirname, 'accounting-core.cjs'));
const fiscalAnalysisRoutes = require(path.join(__dirname, 'fiscal-analysis.cjs'));
const settingsRoutes = require(path.join(__dirname, 'settings.cjs'));
const emailAutoReplyRoutes = require(path.join(__dirname, 'email-autoresponder.cjs'));
const returnReviewRoutes = require(path.join(__dirname, 'return-review.cjs'));
const shopifyLineRoutes = require(path.join(__dirname, 'shopify-line.cjs'));
const myFitpeakRoutes = require(path.join(__dirname, 'my-fitpeak.cjs'));
const amazonConsultingRoutes = require(path.join(__dirname, 'amazon-consulting.cjs'));
const outreachRoutes = require(path.join(__dirname, 'outreach.cjs'));
const proposalRoutes = require(path.join(__dirname, 'proposal.cjs'));
const salesEmailRoutes = require(path.join(__dirname, 'sales-email.cjs'));
const streamerClipRoutes = require(path.join(__dirname, 'streamer-clip.cjs'));
const amazonAnalyticsRoutes = require(path.join(__dirname, 'amazon-analytics.cjs'));
const amazonReviewMonitorRoutes = require(path.join(__dirname, 'amazon-review-monitor.cjs'));
const hpOutreachRoutes = require(path.join(__dirname, 'hp-outreach.cjs'));
const backupRoutes = require(path.join(__dirname, 'backup.cjs'));
const shopifyReviewsRoutes = require(path.join(__dirname, 'shopify-reviews.cjs'));
const fitpeakSnsRoutes = require(path.join(__dirname, 'fitpeak-sns.cjs'));
const salesAgentRoutes = require(path.join(__dirname, 'sales-agent.cjs'));

// Mount each tool at its prefix
app.use('/api/invoice', invoiceRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/amazon', amazonRoutes);
app.use('/api/line-crm', lineCrmRoutes);
app.use('/api/my-fitpeak', myFitpeakRoutes);
app.use('/api/consulting', amazonConsultingRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/line-crm/email-auto-reply', emailAutoReplyRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/accounting/core', accountingCoreRoutes);
app.use('/api/accounting/fiscal', fiscalAnalysisRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/return-review', returnReviewRoutes);
app.use('/api/shopify-line', shopifyLineRoutes);
app.use('/api/proposal', proposalRoutes);
app.use('/api/sales-email', salesEmailRoutes);
app.use('/api/streamer-clip', streamerClipRoutes);
app.use('/api/amazon-analytics', amazonAnalyticsRoutes);
app.use('/api/amazon-review-monitor', amazonReviewMonitorRoutes);
app.use('/api/hp-outreach', hpOutreachRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/shopify-reviews', shopifyReviewsRoutes);
app.use('/api/fitpeak-sns', fitpeakSnsRoutes);
app.use('/api/sales-agent', salesAgentRoutes);

// Internal request helper: Express appに対して内部リクエストを実行（外部fetchなし）
function internalGet(routePath) {
  return new Promise((resolve) => {
    const mockReq = Object.create(require('http').IncomingMessage.prototype);
    Object.assign(mockReq, {
      method: 'GET', url: routePath, path: routePath, originalUrl: routePath,
      headers: { 'x-vercel-cron': '1' }, query: {}, params: {},
      get(h) { return this.headers[h?.toLowerCase()]; },
    });
    const mockRes = Object.create(require('http').ServerResponse.prototype);
    Object.assign(mockRes, {
      statusCode: 200, _headers: {}, _sent: false,
      setHeader(k, v) { this._headers[k] = v; return this; },
      getHeader(k) { return this._headers[k]; },
      status(code) { this.statusCode = code; return this; },
      json(data) { if (!this._sent) { this._sent = true; resolve({ status: this.statusCode, data }); } return this; },
      send(data) { if (!this._sent) { this._sent = true; resolve({ status: this.statusCode, data }); } return this; },
      end(data) { if (!this._sent) { this._sent = true; resolve({ status: this.statusCode, data }); } return this; },
      write() { return this; },
      header(k, v) { this._headers[k] = v; return this; },
    });
    try {
      app.handle(mockReq, mockRes, () => { if (!mockRes._sent) { mockRes._sent = true; resolve({ status: 404, data: 'not found' }); } });
    } catch (err) {
      if (!mockRes._sent) { mockRes._sent = true; resolve({ status: 500, data: err.message }); }
    }
  });
}

// Daily cron gateway: 即レスポンスを返し、各タスクはバックグラウンドで並列実行
app.get('/api/daily-cron', async (req, res) => {
  const taskPaths = {
    invoiceCron:         '/api/invoice/cron',
    emailAutoReply:      '/api/line-crm/email-auto-reply/cron',
    followups:           '/api/shopify-line/cron/followups',
    delayedAiReply:      '/api/line-crm/delayed-ai-reply',
    tagScheduledReplies: '/api/line-crm/tag-scheduled-replies/process',
    broadcastsCron:      '/api/line-crm/broadcasts/cron',
    amazonSync:          '/api/amazon/cron/sync',
    salesEmail:          '/api/sales-email/cron',
    reviewSolicitations: '/api/amazon-analytics/cron/review-solicitations',
    reviewMonitor:       '/api/amazon-review-monitor/cron/check',
    // HP営業cron一時停止（同一メール重複送信のため停止 2026-05-21）
    // hpOutreach:          '/api/hp-outreach/cron/research',
    // hpEnrich:            '/api/hp-outreach/cron/enrich',
    // hpPipeline:          '/api/hp-outreach/cron/pipeline',
    // hpReplies:           '/api/hp-outreach/cron/check-replies',
    surveyFollowups:     '/api/line-crm/survey-followups/process',
    // 営業エージェント: 提案生成（既定は無効。設定でenabled、mode='auto'のときのみ送信）
    salesAgent:          '/api/sales-agent/cron',
    dailyBackup:         '/api/backup/run',
  };

  // 即レスポンスを返す
  res.json({ triggered: Object.keys(taskPaths), time: new Date().toISOString() });

  // タグ遅延配信は全件処理されるまでループ（20件ずつバッチ処理）
  const tagScheduledLoop = async () => {
    let totalSent = 0;
    for (let i = 0; i < 50; i++) {
      try {
        const r = await internalGet(taskPaths.tagScheduledReplies);
        const processed = r.data?.processed || 0;
        totalSent += processed;
        if (processed === 0) break;
        console.log(`[daily-cron] tagScheduled batch ${i + 1}: sent ${processed}`);
      } catch (err) {
        console.error(`[daily-cron] tagScheduled loop error:`, err.message);
        break;
      }
    }
    console.log(`[daily-cron] tagScheduled total: ${totalSent} sent`);
  };

  // waitUntilでfunction終了を延長し、バックグラウンドで全タスクを内部実行
  waitUntil(
    Promise.allSettled([
      ...Object.entries(taskPaths)
        .filter(([name]) => name !== 'tagScheduledReplies')
        .map(([name, taskPath]) =>
          internalGet(taskPath)
            .then(r => console.log(`[daily-cron] ${name}: status=${r.status}`))
            .catch(err => console.error(`[daily-cron] ${name} failed:`, err.message))
        ),
      tagScheduledLoop(),
    ])
  );
});

// Global health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools: ['invoice', 'tasks', 'amazon', 'line-crm', 'accounting', 'my-fitpeak'],
  });
});

// Local dev server
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Business Hub API running at http://localhost:${PORT}`);
  });
}

module.exports = app;
