const path = require('path');
const express = require('express');
const cors = require('cors');

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

// Tool route modules (use absolute paths for Vercel compatibility)
const invoiceRoutes = require(path.join(__dirname, 'invoice.cjs'));
const tasksRoutes = require(path.join(__dirname, 'tasks.cjs'));
const amazonRoutes = require(path.join(__dirname, 'amazon.cjs'));
const lineCrmRoutes = require(path.join(__dirname, 'line-crm.cjs'));
const accountingRoutes = require(path.join(__dirname, 'accounting.cjs'));
const bankScraperRoutes = require(path.join(__dirname, 'bank-scraper.cjs'));
const accountingCoreRoutes = require(path.join(__dirname, 'accounting-core.cjs'));
const fiscalAnalysisRoutes = require(path.join(__dirname, 'fiscal-analysis.cjs'));
const settingsRoutes = require(path.join(__dirname, 'settings.cjs'));

// Mount each tool at its prefix
app.use('/api/invoice', invoiceRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/amazon', amazonRoutes);
app.use('/api/line-crm', lineCrmRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/accounting/bank-sync', bankScraperRoutes);
app.use('/api/accounting/core', accountingCoreRoutes);
app.use('/api/accounting/fiscal', fiscalAnalysisRoutes);
app.use('/api/settings', settingsRoutes);

// Global health check
app.get('/api/health', (_req, res) => {
  const ek = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || '';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools: ['invoice', 'tasks', 'amazon', 'line-crm', 'accounting'],
    encKeyFirst8: ek.substring(0, 8),
    encKeyLen: ek.length,
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
