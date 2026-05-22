const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '');
}

// Gmail送信
async function sendEmailInternal(req, to, subject, body) {
  const res = await fetch(`${req.protocol}://${req.get('host')}/api/invoice/gmail/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, body }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status}`);
  return res.json();
}

// ===========================================================================
// Amazon セラー検索（商品ページからセラー情報を抽出）
// ===========================================================================
router.post('/search-amazon', async (req, res) => {
  try {
    const { keyword, category } = req.body;
    if (!keyword) return res.status(400).json({ error: 'keyword required' });

    const searchUrl = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}${category ? `&i=${encodeURIComponent(category)}` : ''}`;
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) throw new Error(`Amazon fetch failed: ${resp.status}`);
    const html = await resp.text();
    const $ = cheerio.load(html);

    const sellers = [];
    const seen = new Set();

    $('[data-component-type="s-search-result"]').each((_, el) => {
      const $el = $(el);
      // 販売者名を取得
      const byLine = $el.find('.a-row.a-size-base .a-size-base-plus, .a-row .a-size-base.a-link-normal').first().text().trim();
      const brand = $el.find('.a-size-base-plus.a-color-base').first().text().trim();
      const sellerName = byLine || brand;
      if (!sellerName || seen.has(sellerName)) return;
      seen.add(sellerName);

      const productTitle = $el.find('h2 .a-text-normal').first().text().trim();
      const productUrl = $el.find('h2 a.a-link-normal').first().attr('href');
      const price = $el.find('.a-price .a-offscreen').first().text().trim();

      sellers.push({
        seller_name: sellerName,
        product_title: productTitle,
        product_url: productUrl ? `https://www.amazon.co.jp${productUrl}` : null,
        price,
        category: category || keyword,
      });
    });

    res.json({ sellers, count: sellers.length });
  } catch (err) {
    console.error('[outreach] search-amazon error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// 企業Webサイトからメールアドレスを抽出
// ===========================================================================
router.post('/extract-email', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const emails = new Set();
    const pagesToCheck = [url];

    // メインページ + /contact, /company, /about ページを確認
    const base = new URL(url).origin;
    for (const path of ['/contact', '/company', '/about', '/inquiry', '/お問い合わせ']) {
      pagesToCheck.push(base + path);
    }

    for (const pageUrl of pagesToCheck) {
      try {
        const resp = await fetch(pageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) continue;
        const html = await resp.text();

        // メールアドレスを正規表現で抽出
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const found = html.match(emailRegex) || [];
        for (const e of found) {
          const lower = e.toLowerCase();
          // 画像・CSS等のファイル拡張子を除外
          if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff|ttf)$/i.test(lower)) {
            emails.add(lower);
          }
        }
      } catch { /* timeout or network error */ }
    }

    res.json({ emails: [...emails] });
  } catch (err) {
    console.error('[outreach] extract-email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// リード CRUD
// ===========================================================================
router.get('/leads', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { status } = req.query;
    let q = supabase.from('consulting_leads').select('*').order('created_at', { ascending: false });
    if (status && status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/leads', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { company_name, seller_name, amazon_url, website_url, email, category, estimated_revenue, notes, source } = req.body;
    if (!company_name) return res.status(400).json({ error: 'company_name required' });
    const { data, error } = await supabase.from('consulting_leads').insert({
      company_name, seller_name, amazon_url, website_url, email, category,
      estimated_revenue, notes, source: source || 'manual',
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/leads/bulk', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: 'leads array required' });
    const { data, error } = await supabase.from('consulting_leads').insert(leads).select();
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/leads/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('consulting_leads')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/leads/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.from('consulting_leads').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// テンプレート CRUD
// ===========================================================================
router.get('/templates', async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from('outreach_templates').select('*').order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/templates', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('outreach_templates').insert(req.body).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('outreach_templates').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.from('outreach_templates').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================================================================
// メール送信（単体 / 一括）
// ===========================================================================
router.post('/send-email', async (req, res) => {
  try {
    const { lead_id, template_id, custom_subject, custom_body } = req.body;
    const supabase = getSupabase();

    const { data: lead } = await supabase.from('consulting_leads').select('*').eq('id', lead_id).single();
    if (!lead || !lead.email) return res.status(400).json({ error: 'リードにメールアドレスがありません' });

    let subject = custom_subject;
    let body = custom_body;

    if (template_id && (!subject || !body)) {
      const { data: tmpl } = await supabase.from('outreach_templates').select('*').eq('id', template_id).single();
      if (tmpl) {
        subject = subject || tmpl.subject;
        body = body || tmpl.body;
      }
    }

    if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

    // テンプレート変数を置換
    const replacements = {
      '{company_name}': lead.company_name || '',
      '{seller_name}': lead.seller_name || '',
      '{category}': lead.category || '',
      '{estimated_revenue}': lead.estimated_revenue || '',
    };
    for (const [key, val] of Object.entries(replacements)) {
      subject = subject.split(key).join(val);
      body = body.split(key).join(val);
    }

    await sendEmailInternal(req, lead.email, subject, body);

    // ログ記録
    await supabase.from('outreach_logs').insert({
      lead_id, template_id: template_id || null, subject, body,
    });

    // リード更新
    await supabase.from('consulting_leads').update({
      last_emailed_at: new Date().toISOString(),
      email_count: (lead.email_count || 0) + 1,
      status: lead.status === 'new' ? 'contacted' : lead.status,
      updated_at: new Date().toISOString(),
    }).eq('id', lead_id);

    res.json({ success: true });
  } catch (err) {
    console.error('[outreach] send-email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /send-bulk - 複数リードに一括送信
router.post('/send-bulk', async (req, res) => {
  try {
    const { lead_ids, template_id } = req.body;
    if (!Array.isArray(lead_ids) || !template_id) {
      return res.status(400).json({ error: 'lead_ids and template_id required' });
    }

    const supabase = getSupabase();
    const { data: tmpl } = await supabase.from('outreach_templates').select('*').eq('id', template_id).single();
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });

    const { data: leads } = await supabase.from('consulting_leads')
      .select('*').in('id', lead_ids);

    const results = [];
    for (const lead of (leads || [])) {
      if (!lead.email) {
        results.push({ id: lead.id, company: lead.company_name, status: 'skipped', reason: 'no email' });
        continue;
      }

      try {
        const replacements = {
          '{company_name}': lead.company_name || '',
          '{seller_name}': lead.seller_name || '',
          '{category}': lead.category || '',
          '{estimated_revenue}': lead.estimated_revenue || '',
        };
        let subject = tmpl.subject;
        let body = tmpl.body;
        for (const [key, val] of Object.entries(replacements)) {
          subject = subject.split(key).join(val);
          body = body.split(key).join(val);
        }

        await sendEmailInternal(req, lead.email, subject, body);

        await supabase.from('outreach_logs').insert({ lead_id: lead.id, template_id, subject, body });
        await supabase.from('consulting_leads').update({
          last_emailed_at: new Date().toISOString(),
          email_count: (lead.email_count || 0) + 1,
          status: lead.status === 'new' ? 'contacted' : lead.status,
          updated_at: new Date().toISOString(),
        }).eq('id', lead.id);

        results.push({ id: lead.id, company: lead.company_name, status: 'sent' });

        // レート制限: 1通ごとに1秒待機
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        results.push({ id: lead.id, company: lead.company_name, status: 'failed', reason: err.message });
      }
    }

    res.json({ results, sent: results.filter(r => r.status === 'sent').length, total: results.length });
  } catch (err) {
    console.error('[outreach] send-bulk error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /logs - 送信ログ
router.get('/logs', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from('outreach_logs')
      .select('*, consulting_leads(company_name, email)')
      .order('sent_at', { ascending: false })
      .limit(100);
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
