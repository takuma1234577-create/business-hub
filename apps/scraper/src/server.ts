import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { getSupabase } from './supabase';
import { processScrapeJob, submit2faCode } from './jobs/processor';

const app = express();
app.use(cors());
app.use(express.json());

const SCRAPER_API_SECRET = process.env.SCRAPER_API_SECRET || '';

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!SCRAPER_API_SECRET) { next(); return; }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== SCRAPER_API_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

// ヘルスチェック（認証不要）
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'bank-scraper' });
});

app.use(authMiddleware);

// スクレイピング開始
app.post('/scrape', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) { res.status(400).json({ error: 'jobId は必須です' }); return; }

    // 非同期で処理開始（即レスポンス返す）
    processScrapeJob(jobId).catch(err =>
      console.error(`[Scrape] ジョブ ${jobId} エラー:`, err.message)
    );

    res.json({ status: 'started', jobId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2FAコード受信
app.post('/scrape/:jobId/2fa', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { code } = req.body;
    if (!code) { res.status(400).json({ error: '2FAコードは必須です' }); return; }

    await submit2faCode(jobId, code);
    res.json({ success: true, message: '2FAコードを送信しました' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ジョブ状態確認
app.get('/scrape/:jobId', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('scraping_jobs')
      .select('*').eq('id', req.params.jobId).single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = parseInt(process.env.PORT || '3002', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bank Scraper server running on port ${PORT}`);
});
