const express = require('express');
const { getSupabase } = require('./shared.cjs');
const router = express.Router();

// バックアップ対象テーブル（重要なデータのみ）
const BACKUP_TABLES = [
  'app_users',
  'oauth_tokens',
  'api_keys',
  'channel_stores',
  'amazon_sp_accounts',
  'friends',
  'tags',
  'friend_tags',
  'chat_messages',
  'auto_responses',
  'broadcasts',
  'ai_settings',
  'knowledge_chunks',
  'friend_chat_summaries',
  'message_templates',
  'tag_scheduled_replies',
  'tag_delivery_queue',
  'surveys',
  'survey_followup_rules',
  'survey_followup_log',
  'line_shopify_links',
  'line_channels',
  'rich_menus',
  'traffic_sources',
  'clients',
  'email_templates',
  'invoice_settings',
  'schedules',
  'invoice_history',
  'amazon_accounts',
  'fee_rules',
  'orders',
  'order_items',
  'sku_mappings',
  'customers',
  'tasks',
  'consulting_leads',
  'outreach_templates',
  'hp_outreach_leads',
  'hp_outreach_cursor',
  'return_settings',
  'email_auto_reply_settings',
  'account_titles',
  'fiscal_periods',
  'journal_entries',
  'journal_entry_lines',
  'company_profile',
  'fiscal_years',
];

// GET /run - 日次バックアップ実行
router.get('/run', async (_req, res) => {
  const startTime = Date.now();
  try {
    const supabase = getSupabase();
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // 2026-05-20
    const backup = {};
    const errors = [];

    for (const table of BACKUP_TABLES) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(50000);
        if (error) {
          errors.push(`${table}: ${error.message}`);
        } else {
          backup[table] = { count: (data || []).length, rows: data || [] };
        }
      } catch (err) {
        errors.push(`${table}: ${err.message}`);
      }
    }

    const json = JSON.stringify(backup);
    const filePath = `daily/${dateStr}.json`;

    // Supabase Storageにアップロード
    const { error: uploadErr } = await supabase.storage
      .from('backups')
      .upload(filePath, json, {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadErr) {
      console.error('[backup] Upload failed:', uploadErr.message);
      return res.status(500).json({ error: uploadErr.message });
    }

    // 30日より古いバックアップを削除
    try {
      const { data: files } = await supabase.storage.from('backups').list('daily', { limit: 100 });
      if (files && files.length > 30) {
        const sorted = files.sort((a, b) => a.name.localeCompare(b.name));
        const toDelete = sorted.slice(0, files.length - 30).map(f => `daily/${f.name}`);
        if (toDelete.length > 0) {
          await supabase.storage.from('backups').remove(toDelete);
          console.log(`[backup] Cleaned up ${toDelete.length} old backups`);
        }
      }
    } catch (cleanErr) {
      console.warn('[backup] Cleanup error:', cleanErr.message);
    }

    const tableStats = Object.entries(backup).map(([t, v]) => `${t}: ${v.count}`).join(', ');
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[backup] Saved ${dateStr}.json (${(json.length / 1024).toFixed(0)}KB, ${duration}s) tables: ${Object.keys(backup).length}`);

    res.json({
      ok: true,
      file: filePath,
      size_kb: Math.round(json.length / 1024),
      tables: Object.keys(backup).length,
      errors: errors.length > 0 ? errors : undefined,
      duration_s: parseFloat(duration),
    });
  } catch (err) {
    console.error('[backup] Fatal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
