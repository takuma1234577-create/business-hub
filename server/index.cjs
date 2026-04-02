const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Tool route modules (use absolute paths for Vercel compatibility)
const invoiceRoutes = require(path.join(__dirname, 'invoice.cjs'));
const tasksRoutes = require(path.join(__dirname, 'tasks.cjs'));
const amazonRoutes = require(path.join(__dirname, 'amazon.cjs'));
const lineCrmRoutes = require(path.join(__dirname, 'line-crm.cjs'));
const accountingRoutes = require(path.join(__dirname, 'accounting.cjs'));

// Mount each tool at its prefix
app.use('/api/invoice', invoiceRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/amazon', amazonRoutes);
app.use('/api/line-crm', lineCrmRoutes);
app.use('/api/accounting', accountingRoutes);

// Global health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools: ['invoice', 'tasks', 'amazon', 'line-crm', 'accounting'],
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
