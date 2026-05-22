const express = require('express');
const router = express.Router();
const { getSupabase, getAnthropicClient, getGoogleAuthClient, google } = require('./shared.cjs');

const SPREADSHEET_ID = '1z1c6itTzAPVAqBlbhVmMhNrkUOEv_1tWu4Limgq2kps';
const GMAIL_SENDER = 'takuma1234577@gmail.com';

// ── Google Places API (New) ──
async function searchPlaces(query, apiKey) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.types,places.businessStatus,places.rating,places.userRatingCount,places.editorialSummary,places.reviews,places.photos,places.regularOpeningHours,places.priceLevel',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: 20,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Places API error: ${res.status} - ${err.error?.message || ''}`);
  }
  return res.json();
}

// Place Details (New API) で追加情報を取得
async function getPlaceDetails(placeId, apiKey) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,googleMapsUri,types,businessStatus,editorialSummary,reviews,photos,regularOpeningHours,priceLevel',
      'X-Goog-Api-Language-Code': 'ja',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Place Details API error: ${res.status} - ${err.error?.message || ''}`);
  }
  return res.json();
}

// Google Maps写真URLを取得
function getPhotoUrl(photoRef, apiKey, maxWidth = 800) {
  // Places API (New) の写真フォーマット: places/{placeId}/photos/{photoRef}/media
  return `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${maxWidth}&key=${apiKey}`;
}

// Place IDから詳細情報＋写真URLを取得
async function getFullPlaceInfo(placeId, apiKey) {
  const details = await getPlaceDetails(placeId, apiKey);

  // 写真URLリスト生成
  const photos = (details.photos || []).slice(0, 10).map(p => ({
    url: getPhotoUrl(p.name, apiKey, 1200),
    attribution: p.authorAttributions?.[0]?.displayName || '',
  }));

  // 営業時間
  const hours = details.regularOpeningHours?.weekdayDescriptions || [];

  // レビュー整形
  const reviews = (details.reviews || []).map(r => ({
    author: r.authorAttribution?.displayName || '匿名',
    rating: r.rating || 0,
    text: r.text?.text || r.originalText?.text || '',
    time: r.relativePublishTimeDescription || '',
    profilePhoto: r.authorAttribution?.photoUri || '',
  }));

  return {
    id: details.id,
    name: details.displayName?.text || '',
    address: details.formattedAddress || '',
    phone: details.nationalPhoneNumber || '',
    googleMapsUrl: details.googleMapsUri || '',
    types: details.types || [],
    businessStatus: details.businessStatus || '',
    editorial: details.editorialSummary?.text || '',
    priceLevel: details.priceLevel || '',
    photos,
    hours,
    reviews,
  };
}

// ウェブサイトからメール・Instagram等を抽出
async function scrapeContactInfo(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BusinessBot/1.0)' },
    });
    clearTimeout(timeout);
    if (!res.ok) return {};

    const html = await res.text();

    // メールアドレス抽出
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = [...new Set((html.match(emailRegex) || []).filter(e =>
      !e.includes('example.com') && !e.includes('wixpress') && !e.includes('sentry')
    ))];

    // Instagram抽出
    const igRegex = /(?:instagram\.com|instagr\.am)\/([a-zA-Z0-9_.]+)/g;
    const igMatches = [...html.matchAll(igRegex)];
    const instagrams = [...new Set(igMatches.map(m => m[1]).filter(u =>
      !['p', 'explore', 'reel', 'stories', 'accounts'].includes(u)
    ))];

    // Twitter/X抽出
    const twRegex = /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/g;
    const twMatches = [...html.matchAll(twRegex)];
    const twitters = [...new Set(twMatches.map(m => m[1]).filter(u =>
      !['intent', 'share', 'search', 'hashtag', 'home'].includes(u)
    ))];

    // Facebook抽出
    const fbRegex = /facebook\.com\/([a-zA-Z0-9.]+)/g;
    const fbMatches = [...html.matchAll(fbRegex)];
    const facebooks = [...new Set(fbMatches.map(m => m[1]).filter(u =>
      !['sharer', 'share', 'dialog', 'plugins', 'tr'].includes(u)
    ))];

    return { emails, instagrams, twitters, facebooks };
  } catch {
    return {};
  }
}

// 複数の方法でメール・SNSを探す
async function findContactInfo(placeName, address, phone) {
  const result = { emails: [], instagrams: [], twitters: [], facebooks: [] };

  // 方法1: 店名で検索して関連ページからメール抽出
  const searchQueries = [
    `${placeName} ${address.split('区')[0] || ''} メール email`,
    `${placeName} instagram`,
    `"${placeName}" メールアドレス`,
  ];

  for (const q of searchQueries) {
    try {
      const res = await fetch(`https://www.google.com/search?q=${encodeURIComponent(q)}&hl=ja&num=5`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      if (!res.ok) continue;
      const html = await res.text();

      // メール抽出
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const foundEmails = (html.match(emailRegex) || []).filter(e =>
        !e.includes('example.') && !e.includes('google.') && !e.includes('gstatic.') &&
        !e.includes('schema.org') && !e.includes('wixpress') && !e.includes('sentry') &&
        !e.includes('w3.org') && !e.includes('googleapis') && !e.endsWith('.png') &&
        !e.endsWith('.jpg') && !e.endsWith('.svg')
      );
      result.emails.push(...foundEmails);

      // Instagram抽出
      const igRegex = /instagram\.com\/([a-zA-Z0-9_.]{2,30})/g;
      const igMatches = [...html.matchAll(igRegex)];
      result.instagrams.push(...igMatches.map(m => m[1]).filter(u =>
        !['p', 'explore', 'reel', 'reels', 'stories', 'accounts', 'about', 'directory', 'developer', 'legal'].includes(u)
      ));

      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }

  // 方法2: 食べログ・ホットペッパー等のグルメサイトから探す
  try {
    const groumetQ = encodeURIComponent(`${placeName} site:tabelog.com OR site:hotpepper.jp OR site:gnavi.co.jp`);
    const res = await fetch(`https://www.google.com/search?q=${groumetQ}&hl=ja&num=3`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (res.ok) {
      const html = await res.text();
      // URLを抽出してそのページからメール取得を試みる
      const urlRegex = /https?:\/\/(?:tabelog\.com|www\.hotpepper\.jp|r\.gnavi\.co\.jp)\/[^\s"<>]+/g;
      const urls = [...new Set((html.match(urlRegex) || []).slice(0, 2))];
      for (const url of urls) {
        try {
          const pageInfo = await scrapeContactInfo(url);
          if (pageInfo.emails) result.emails.push(...pageInfo.emails);
          if (pageInfo.instagrams) result.instagrams.push(...pageInfo.instagrams);
        } catch {}
      }
    }
  } catch {}

  // 方法3: エキテン・iタウンページ等から探す
  try {
    const localQ = encodeURIComponent(`${placeName} site:ekiten.jp OR site:itp.ne.jp OR site:navitokyo.com`);
    const res = await fetch(`https://www.google.com/search?q=${localQ}&hl=ja&num=3`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (res.ok) {
      const html = await res.text();
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const foundEmails = (html.match(emailRegex) || []).filter(e =>
        !e.includes('example.') && !e.includes('google.') && !e.includes('gstatic.') &&
        !e.includes('schema.org') && !e.endsWith('.png') && !e.endsWith('.jpg')
      );
      result.emails.push(...foundEmails);
    }
  } catch {}

  // 重複除去
  result.emails = [...new Set(result.emails)];
  result.instagrams = [...new Set(result.instagrams)];

  return result;
}

// Claude でビジネス詳細を分析・生成
async function analyzeBusinessWithAI(place) {
  try {
    const anthropic = await getAnthropicClient();
    const reviews = (place.reviews || []).slice(0, 5).map(r => r.text).join('\n');
    const summary = place.editorial_summary?.overview || '';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `以下のGoogleマップの店舗情報をもとに、この店舗のビジネス内容を詳しく分析してください。
LP（ランディングページ）作成の材料として使えるように、以下の項目を含めて日本語で出力してください。

店舗名: ${place.name}
住所: ${place.formatted_address || '不明'}
電話: ${place.formatted_phone_number || '不明'}
カテゴリ: ${(place.types || []).join(', ')}
概要: ${summary}
レビュー抜粋:
${reviews || 'なし'}

以下のJSON形式で出力してください:
{
  "business_type": "業種（飲食店、フィットネスジム、カフェ、美容院、クリニックなど）",
  "business_description": "ビジネスの詳細説明（サービス内容、特徴、ターゲット顧客、雰囲気など。200文字以上で詳しく）",
  "strengths": "この店舗の強み・特徴（レビューなどから推測）",
  "target_audience": "想定ターゲット層",
  "lp_keywords": "LP作成時に使えるキーワード（カンマ区切り）"
}

JSONのみ出力してください。`,
      }],
    });

    const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[HpOutreach] AI analysis error:', err.message);
    return null;
  }
}

// ── API キー取得ヘルパー ──
async function getGoogleMapsApiKey() {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('api_keys').select('api_key_encrypted').eq('id', 'google_maps').eq('is_active', true).single();
    if (data && data.api_key_encrypted) {
      const crypto = require('crypto');
      const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
      const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
      const { iv, data: encData, tag } = JSON.parse(data.api_key_encrypted);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      let decrypted = decipher.update(encData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
  } catch {}
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

// ══════════════════════════════════════
// POST /search - Google Maps店舗検索
// ══════════════════════════════════════
router.post('/search', async (req, res) => {
  try {
    const { area, category, keyword } = req.body;
    if (!area) return res.status(400).json({ error: 'エリアを入力してください' });

    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) return res.status(400).json({ error: 'Google Maps APIキーが未設定です。API設定画面から設定してください。' });

    const query = `${category || '店舗'} ${area} ${keyword || ''}`.trim();
    console.log(`[HpOutreach] Searching: "${query}"`);

    const result = await searchPlaces(query, apiKey);

    // New API returns { places: [...] }
    const places = result.places || [];
    const businesses = [];

    for (const place of places) {
      const hasWebsite = !!place.websiteUri;
      const reviews = (place.reviews || []).slice(0, 3).map(r => ({
        text: r.text?.text || r.originalText?.text || '',
        rating: r.rating || 0,
      }));

      // 写真URL（最大3枚、検索結果用サムネイル）
      const photoRefs = (place.photos || []).slice(0, 3).map(p => ({
        url: getPhotoUrl(p.name, apiKey, 400),
        name: p.name,
      }));

      businesses.push({
        place_id: place.id,
        name: place.displayName?.text || '',
        address: place.formattedAddress || '',
        phone: place.nationalPhoneNumber || '',
        website: place.websiteUri || '',
        google_maps_url: place.googleMapsUri || '',
        types: place.types || [],
        has_website: hasWebsite,
        rating: place.rating || 0,
        user_ratings_total: place.userRatingCount || 0,
        business_status: place.businessStatus || '',
        editorial_summary: place.editorialSummary?.text || '',
        reviews,
        photos: photoRefs,
        hours: place.regularOpeningHours?.weekdayDescriptions || [],
      });
    }

    // HP無し店舗を先頭に
    businesses.sort((a, b) => (a.has_website ? 1 : 0) - (b.has_website ? 1 : 0));

    const noWebsiteCount = businesses.filter(b => !b.has_website).length;
    console.log(`[HpOutreach] Found ${businesses.length} businesses, ${noWebsiteCount} without website`);

    res.json({
      businesses,
      total: businesses.length,
      no_website_count: noWebsiteCount,
    });
  } catch (err) {
    console.error('[HpOutreach] Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /analyze - AI でビジネス詳細分析
// ══════════════════════════════════════
router.post('/analyze', async (req, res) => {
  try {
    const { place } = req.body;
    if (!place) return res.status(400).json({ error: '店舗情報が必要です' });

    const analysis = await analyzeBusinessWithAI(place);
    if (!analysis) throw new Error('AI分析に失敗しました');

    // コンタクト情報も取得
    let contact = {};
    if (place.website) {
      contact = await scrapeContactInfo(place.website);
    }
    if ((!contact.emails || contact.emails.length === 0) && (!contact.instagrams || contact.instagrams.length === 0)) {
      const mapContact = await findContactFromGoogleMaps(place.name, place.address);
      contact = { ...contact, ...mapContact };
    }

    res.json({ analysis, contact });
  } catch (err) {
    console.error('[HpOutreach] Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /add-to-sheet - スプレッドシートに追加
// ══════════════════════════════════════
router.post('/add-to-sheet', async (req, res) => {
  try {
    const { business } = req.body;
    if (!business) return res.status(400).json({ error: '店舗情報が必要です' });

    const auth = await getGoogleAuthClient('sheets');
    const sheets = google.sheets({ version: 'v4', auth });

    // ヘッダー行があるか確認
    const headerCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A1:J1',
    });
    if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'A1:J1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['店舗名', '業種', 'ビジネス内容', 'メールアドレス', 'Instagram', '電話番号', '住所', 'GoogleマップURL', 'LP URL', 'ステータス', 'PlaceID']],
        },
      });
    }

    // 重複チェック（店舗名+住所で判定）
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:G',
    });
    const rows = existing.data.values || [];
    const isDuplicate = rows.some(row =>
      row[0] === business.name && row[6] === business.address
    );
    if (isDuplicate) {
      return res.json({ added: false, message: 'この店舗は既にスプレッドシートに登録されています' });
    }

    // 行追加
    const contactParts = [];
    if (business.email) contactParts.push(business.email);
    const igParts = [];
    if (business.instagram) igParts.push(`@${business.instagram}`);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:K',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          business.name || '',
          business.business_type || '',
          business.business_description || '',
          business.email || '',
          business.instagram ? `https://instagram.com/${business.instagram}` : '',
          business.phone || '',
          business.address || '',
          business.google_maps_url || '',
          '',  // LP URL（後で生成時に更新）
          '未対応',
          business.place_id || '',
        ]],
      },
    });

    // Supabaseにも保存
    const sb = getSupabase();
    await sb.from('hp_outreach_leads').insert({
      name: business.name,
      business_type: business.business_type || '',
      business_description: business.business_description || '',
      email: business.email || null,
      instagram: business.instagram || null,
      phone: business.phone || '',
      address: business.address || '',
      google_maps_url: business.google_maps_url || '',
      status: 'new',
    });

    res.json({ added: true });
  } catch (err) {
    console.error('[HpOutreach] Add to sheet error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// GET /sheet - スプレッドシートのリード一覧取得
// ══════════════════════════════════════
router.get('/sheet', async (_req, res) => {
  try {
    const auth = await getGoogleAuthClient('sheets');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2:K',
    });
    const rows = result.data.values || [];
    const leads = rows.map((row, i) => ({
      row_index: i + 2,
      name: row[0] || '',
      business_type: row[1] || '',
      business_description: row[2] || '',
      email: row[3] || '',
      instagram: row[4] || '',
      phone: row[5] || '',
      address: row[6] || '',
      google_maps_url: row[7] || '',
      lp_url: row[8] || '',
      status: row[9] || '未対応',
      place_id: row[10] || '',
    }));
    res.json(leads);
  } catch (err) {
    console.error('[HpOutreach] Sheet fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /place-info - 店舗の詳細情報＋写真を取得
// ══════════════════════════════════════
router.post('/place-info', async (req, res) => {
  try {
    const { place_id, google_maps_url } = req.body;

    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) return res.status(400).json({ error: 'Google Maps APIキーが未設定です' });

    // place_idがない場合、google_maps_urlから抽出を試みる
    let pid = place_id;
    if (!pid && google_maps_url) {
      const match = google_maps_url.match(/place_id[=:]([^&/]+)/);
      if (match) pid = match[1];
    }
    if (!pid) return res.status(400).json({ error: 'place_idが必要です' });

    const info = await getFullPlaceInfo(pid, apiKey);
    res.json(info);
  } catch (err) {
    console.error('[HpOutreach] Place info error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /generate-lp - テンプレートベースLP生成（API不使用）
// ══════════════════════════════════════

// 業種別配色テーマ
const THEMES = {
  '飲食店':     { primary: '#D97706', secondary: '#92400E', accent: '#FDE68A', bg: '#FFFBEB', hero: 'from-amber-900 to-amber-700' },
  'カフェ':     { primary: '#6B7280', secondary: '#374151', accent: '#D1FAE5', bg: '#F9FAFB', hero: 'from-stone-800 to-stone-600' },
  'ラーメン':   { primary: '#DC2626', secondary: '#991B1B', accent: '#FEE2E2', bg: '#FFF5F5', hero: 'from-red-900 to-red-700' },
  '居酒屋':     { primary: '#D97706', secondary: '#78350F', accent: '#FEF3C7', bg: '#FFFBEB', hero: 'from-yellow-900 to-amber-800' },
  'レストラン': { primary: '#7C3AED', secondary: '#5B21B6', accent: '#EDE9FE', bg: '#FAF5FF', hero: 'from-purple-900 to-purple-700' },
  '焼肉':       { primary: '#B91C1C', secondary: '#7F1D1D', accent: '#FEE2E2', bg: '#FFF5F5', hero: 'from-red-950 to-red-800' },
  'フィットネスジム': { primary: '#1F2937', secondary: '#111827', accent: '#DBEAFE', bg: '#F3F4F6', hero: 'from-gray-900 to-gray-700' },
  'パーソナルジム':   { primary: '#1E40AF', secondary: '#1E3A5F', accent: '#BFDBFE', bg: '#EFF6FF', hero: 'from-blue-950 to-blue-800' },
  'ヨガスタジオ':     { primary: '#059669', secondary: '#065F46', accent: '#D1FAE5', bg: '#ECFDF5', hero: 'from-emerald-900 to-emerald-700' },
  '美容院':     { primary: '#EC4899', secondary: '#9D174D', accent: '#FCE7F3', bg: '#FDF2F8', hero: 'from-pink-900 to-pink-700' },
  'ネイルサロン': { primary: '#F472B6', secondary: '#BE185D', accent: '#FCE7F3', bg: '#FDF2F8', hero: 'from-pink-800 to-rose-600' },
  'エステサロン': { primary: '#A855F7', secondary: '#7E22CE', accent: '#F3E8FF', bg: '#FAF5FF', hero: 'from-purple-900 to-fuchsia-800' },
  'クリニック': { primary: '#0284C7', secondary: '#075985', accent: '#E0F2FE', bg: '#F0F9FF', hero: 'from-sky-900 to-sky-700' },
  '歯科医院':   { primary: '#0891B2', secondary: '#155E75', accent: '#CFFAFE', bg: '#ECFEFF', hero: 'from-cyan-900 to-cyan-700' },
  '整骨院':     { primary: '#0D9488', secondary: '#115E59', accent: '#CCFBF1', bg: '#F0FDFA', hero: 'from-teal-900 to-teal-700' },
  '整体院':     { primary: '#0D9488', secondary: '#115E59', accent: '#CCFBF1', bg: '#F0FDFA', hero: 'from-teal-900 to-teal-700' },
  '学習塾':     { primary: '#2563EB', secondary: '#1E40AF', accent: '#DBEAFE', bg: '#EFF6FF', hero: 'from-blue-900 to-blue-700' },
  '不動産':     { primary: '#0F766E', secondary: '#134E4A', accent: '#CCFBF1', bg: '#F0FDFA', hero: 'from-teal-950 to-teal-800' },
  'default':    { primary: '#3B82F6', secondary: '#1D4ED8', accent: '#DBEAFE', bg: '#F8FAFC', hero: 'from-slate-900 to-slate-700' },
};

function getTheme(businessType) {
  for (const [key, theme] of Object.entries(THEMES)) {
    if (key !== 'default' && businessType && businessType.includes(key)) return theme;
  }
  return THEMES.default;
}

// 業種別キャッチコピー
const CATCHPHRASES = {
  '飲食店': '心を込めた一皿を、あなたに',
  'カフェ': 'ほっとひと息、特別な時間を',
  'ラーメン': '一杯に込めた、こだわりの味',
  '居酒屋': '仲間と語る、最高のひと時',
  'レストラン': '特別な日に、特別な料理を',
  '焼肉': '厳選素材で、至福の味わい',
  'フィットネスジム': 'あなたの理想の身体へ',
  'パーソナルジム': '一人ひとりに合った、最適なトレーニング',
  'ヨガスタジオ': '心と体を整える、癒しの空間',
  '美容院': 'あなたらしい美しさを引き出す',
  'ネイルサロン': '指先から始まる、自分らしさ',
  'エステサロン': '本来の美しさを、取り戻す',
  'クリニック': '安心と信頼の医療を提供',
  '歯科医院': '笑顔あふれる健康な歯を',
  '整骨院': 'つらい痛み、根本から改善',
  '整体院': '体のバランスを整え、快適な毎日を',
  '学習塾': 'お子さまの可能性を最大限に',
  '不動産': '理想の暮らしをお手伝い',
};

function getFallbackCatchphrase(businessType) {
  for (const [key, phrase] of Object.entries(CATCHPHRASES)) {
    if (businessType && businessType.includes(key)) return phrase;
  }
  return 'お客様に最高のサービスを';
}

// AIでカスタムキャッチコピー＋サブコピーを生成（ハイブリッド）
async function generateCatchphrase(name, businessType, description, reviews) {
  try {
    const anthropic = await getAnthropicClient();
    const reviewSnippets = (reviews || []).slice(0, 3).map(r => r.text).filter(Boolean).join(' / ');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `以下の店舗のヒーローセクション用キャッチコピーを生成して。

店名: ${name}
業種: ${businessType}
概要: ${description || 'なし'}
レビュー: ${reviewSnippets || 'なし'}

ルール:
- メインコピー: 感情に訴える短い一文（10〜20文字）。店の特徴・雰囲気・ターゲット客層を反映
- サブコピー: メインを補足する1文（20〜40文字）
- 例: ファミリー向け寿司店→メイン「家族と紡ぐ、一生の思い出を」サブ「新鮮なネタと温かいおもてなしで、大切な時間をお届けします」
- 例: 隠れ家バー→メイン「静寂の中、至高の一杯を」サブ「喧騒を離れた大人の空間で、こだわりのカクテルをどうぞ」
- 具体的でその店だけの言葉にする。汎用的なコピーは禁止

JSON形式で: {"main":"メインコピー","sub":"サブコピー"}
JSONのみ出力。`,
      }],
    });

    const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const match = text.match(/\{[\s\S]*"main"[\s\S]*"sub"[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    console.error('[HpOutreach] Catchphrase AI error:', err.message);
  }
  return null;
}

// レビューからメニュー情報を抽出（飲食店のみ）
async function extractMenuFromReviews(name, businessType, reviews) {
  try {
    const anthropic = await getAnthropicClient();
    const reviewTexts = (reviews || []).map(r => r.text).filter(Boolean).join('\n');
    if (!reviewTexts) return null;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `以下はGoogleレビューの抜粋です。この飲食店のメニュー（料理名）を抽出してください。

店名: ${name}（${businessType}）
レビュー:
${reviewTexts.slice(0, 1500)}

ルール:
- レビューに登場する具体的な料理名・ドリンク名を抽出
- 価格がわかればそれも含める
- 最大8品まで
- 推測で料理を追加しない。レビューに書かれているもののみ
- カテゴリ分けする（例: 人気メニュー、ドリンク、デザートなど）

JSON形式:
{"categories":[{"name":"カテゴリ名","items":[{"name":"料理名","price":"¥1,000","description":"一言説明（任意）"}]}]}
JSONのみ出力。`,
      }],
    });

    const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const match = text.match(/\{[\s\S]*"categories"[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    console.error('[HpOutreach] Menu extraction error:', err.message);
  }
  return null;
}

// 星評価HTML生成
function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '<span class="text-yellow-400">' + '★'.repeat(full) + (half ? '☆' : '') + '</span>' + '<span class="text-gray-300">' + '★'.repeat(empty) + '</span>';
}

router.post('/generate-lp', async (req, res) => {
  try {
    const { lead } = req.body;
    if (!lead) return res.status(400).json({ error: 'リード情報が必要です' });

    // Google Mapsから詳細情報を取得
    const apiKey = await getGoogleMapsApiKey();
    let placeInfo = null;

    if (apiKey && lead.google_maps_url) {
      try {
        // place_idを取得（複数の形式に対応）
        let pid = lead.place_id || null;
        if (!pid && lead.google_maps_url) {
          const m1 = lead.google_maps_url.match(/place_id[=:]([^&/]+)/);
          if (m1) pid = m1[1];
          if (!pid) {
            const m2 = lead.google_maps_url.match(/(ChIJ[A-Za-z0-9_-]+)/);
            if (m2) pid = m2[1];
          }
        }
        // New APIのplace_idは "places/..." 形式が必要
        if (pid && !pid.startsWith('places/')) pid = `places/${pid}`;
        if (pid) {
          placeInfo = await getFullPlaceInfo(pid, apiKey);
        }
      } catch (err) {
        console.log('[HpOutreach] Place info fetch failed, using lead data:', err.message);
      }
    }

    // データ統合（placeInfoがあれば優先）
    const name = placeInfo?.name || lead.name;
    const address = placeInfo?.address || lead.address || '';
    const phone = placeInfo?.phone || lead.phone || '';
    const businessType = lead.business_type || '';
    const description = lead.business_description || placeInfo?.editorial || '';
    const photos = placeInfo?.photos || [];
    const reviews = placeInfo?.reviews || [];
    const hours = placeInfo?.hours || [];
    const rating = placeInfo?.rating || lead.rating || 0;
    const googleMapsUrl = placeInfo?.googleMapsUrl || lead.google_maps_url || '';

    const theme = getTheme(businessType);

    // AIでカスタムキャッチコピー生成（ハイブリッド：ここだけAPI使用）
    const aiCopy = await generateCatchphrase(name, businessType, description, reviews);
    const catchphrase = aiCopy?.main || getFallbackCatchphrase(businessType);
    const subCopy = aiCopy?.sub || '';

    // 写真セクション生成
    const heroImage = photos.length > 0 ? photos[0].url : null;

    // 飲食店系ならメニュー抽出
    const isRestaurant = businessType.match(/飲食|カフェ|ラーメン|居酒屋|レストラン|焼肉|パン|ケーキ|スイーツ|寿司|蕎麦|うどん|中華|イタリアン|フレンチ|和食|洋食|定食|食堂|バー|ダイニング/);
    let menuData = null;
    if (isRestaurant && reviews.length > 0) {
      menuData = await extractMenuFromReviews(name, businessType, reviews);
    }

    const galleryHtml = photos.length > 1
      ? photos.slice(1, 7).map(p =>
        `<div class="overflow-hidden rounded-xl shadow-lg"><img src="${p.url}" alt="${name}" class="w-full h-48 object-cover hover:scale-110 transition-transform duration-500" loading="lazy"/></div>`
      ).join('\n')
      : '';

    // レビューセクション生成
    const reviewsHtml = reviews.slice(0, 6).map(r => `
      <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div class="flex items-center gap-3 mb-3">
          ${r.profilePhoto ? `<img src="${r.profilePhoto}" alt="" class="w-9 h-9 rounded-full object-cover"/>` : `<div class="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-bold">${(r.author || '?')[0]}</div>`}
          <div>
            <p class="text-sm font-semibold text-gray-800">${r.author}</p>
            <div class="text-xs">${renderStars(r.rating)} <span class="text-gray-400 ml-1">${r.time || ''}</span></div>
          </div>
        </div>
        <p class="text-sm text-gray-600 leading-relaxed">${(r.text || '').slice(0, 150)}${r.text && r.text.length > 150 ? '...' : ''}</p>
      </div>
    `).join('\n');

    // 営業時間セクション
    const hoursHtml = hours.length > 0
      ? hours.map(h => `<p class="text-sm text-gray-600 py-1 border-b border-gray-100 last:border-0">${h}</p>`).join('\n')
      : '';

    // Google Maps埋め込み
    const mapEmbed = address
      ? `<iframe src="https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed&z=16" class="w-full h-64 rounded-xl" style="border:0" allowfullscreen loading="lazy"></iframe>`
      : '';

    // 業種固有セクション
    let industrySection = '';
    if (businessType.match(/飲食|カフェ|ラーメン|居酒屋|レストラン|焼肉|パン|ケーキ/)) {
      industrySection = `
      <section class="py-16 px-6" style="background-color: ${theme.bg}">
        <div class="max-w-4xl mx-auto text-center">
          <h2 class="text-2xl font-bold text-gray-800 mb-2">ご予約・お問い合わせ</h2>
          <p class="text-gray-500 mb-8">お電話またはGoogleマップからご予約いただけます</p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            ${phone ? `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition" style="background-color: ${theme.primary}">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
              ${phone}
            </a>` : ''}
            ${googleMapsUrl ? `<a href="${googleMapsUrl}" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border-2 font-bold text-lg hover:shadow-lg transition" style="border-color: ${theme.primary}; color: ${theme.primary}">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              Google Mapで見る
            </a>` : ''}
          </div>
        </div>
      </section>`;
    } else if (businessType.match(/ジム|フィットネス|ヨガ|パーソナル/)) {
      industrySection = `
      <section class="py-16 px-6" style="background-color: ${theme.bg}">
        <div class="max-w-4xl mx-auto text-center">
          <h2 class="text-2xl font-bold text-gray-800 mb-2">無料体験・見学受付中</h2>
          <p class="text-gray-500 mb-8">まずはお気軽にお問い合わせください</p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            ${phone ? `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition" style="background-color: ${theme.primary}">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
              今すぐ電話する
            </a>` : ''}
            ${googleMapsUrl ? `<a href="${googleMapsUrl}" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border-2 font-bold text-lg hover:shadow-lg transition" style="border-color: ${theme.primary}; color: ${theme.primary}">
              アクセス・地図を見る
            </a>` : ''}
          </div>
        </div>
      </section>`;
    } else {
      industrySection = `
      <section class="py-16 px-6" style="background-color: ${theme.bg}">
        <div class="max-w-4xl mx-auto text-center">
          <h2 class="text-2xl font-bold text-gray-800 mb-2">お問い合わせ</h2>
          <p class="text-gray-500 mb-8">ご質問・ご予約はお気軽にどうぞ</p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            ${phone ? `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg" style="background-color: ${theme.primary}">${phone}</a>` : ''}
            ${googleMapsUrl ? `<a href="${googleMapsUrl}" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border-2 font-bold text-lg" style="border-color: ${theme.primary}; color: ${theme.primary}">Google Mapで見る</a>` : ''}
          </div>
        </div>
      </section>`;
    }

    // 完全なHTML生成
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${name} | 公式ホームページ</title>
  <meta name="description" content="${description.slice(0, 160)}"/>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700;900&display=swap" rel="stylesheet"/>
  <style>
    * { font-family: 'Noto Sans JP', sans-serif; }
    html { scroll-behavior: smooth; }
  </style>
</head>
<body class="bg-white text-gray-800">

  <!-- ヒーロー -->
  <header class="relative h-[70vh] min-h-[500px] flex items-center justify-center overflow-hidden">
    ${heroImage
      ? `<img src="${heroImage}" alt="${name}" class="absolute inset-0 w-full h-full object-cover"/>
    <div class="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/70"></div>`
      : `<div class="absolute inset-0 bg-gradient-to-br ${theme.hero}"></div>`}
    <div class="relative z-10 text-center px-6 max-w-3xl">
      <p class="text-white/80 text-sm tracking-[0.3em] uppercase mb-4">${businessType}</p>
      <h1 class="text-4xl md:text-6xl font-black text-white mb-4 leading-tight">${name}</h1>
      <p class="text-2xl md:text-3xl text-white font-bold mb-2">${catchphrase}</p>
      ${subCopy ? `<p class="text-base md:text-lg text-white/80 font-light max-w-xl mx-auto">${subCopy}</p>` : ''}
      ${phone ? `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="inline-flex items-center gap-2 mt-8 px-8 py-3 rounded-full text-white font-bold shadow-2xl hover:scale-105 transition-transform" style="background-color: ${theme.primary}">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
        お電話でのご予約
      </a>` : ''}
    </div>
  </header>

  <!-- 紹介 -->
  <section class="py-20 px-6">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="text-3xl font-bold mb-6" style="color: ${theme.secondary}">私たちについて</h2>
      <div class="w-16 h-1 mx-auto mb-8 rounded-full" style="background-color: ${theme.primary}"></div>
      <p class="text-gray-600 leading-relaxed text-lg">${description || `${address}にある${businessType}です。皆さまのご来店を心よりお待ちしております。`}</p>
      ${rating ? `<div class="mt-8 inline-flex items-center gap-2 px-6 py-3 bg-yellow-50 rounded-full">
        <span class="text-yellow-500 text-lg">★</span>
        <span class="text-xl font-bold text-gray-800">${rating}</span>
        <span class="text-sm text-gray-500">Google評価</span>
      </div>` : ''}
    </div>
  </section>

  ${galleryHtml ? `
  <!-- フォトギャラリー -->
  <section class="py-16 px-6 bg-gray-50">
    <div class="max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold text-center mb-10" style="color: ${theme.secondary}">ギャラリー</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        ${galleryHtml}
      </div>
    </div>
  </section>` : ''}

  ${menuData && menuData.categories && menuData.categories.length > 0 ? `
  <!-- メニュー -->
  <section class="py-16 px-6">
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-bold text-center mb-2" style="color: ${theme.secondary}">メニュー</h2>
      <p class="text-center text-gray-400 mb-10">Menu</p>
      <div class="grid grid-cols-1 md:grid-cols-${menuData.categories.length > 1 ? '2' : '1'} gap-8">
        ${menuData.categories.map(cat => `
          <div>
            <h3 class="text-lg font-bold mb-4 pb-2 border-b-2" style="color: ${theme.primary}; border-color: ${theme.accent}">${cat.name}</h3>
            <div class="space-y-3">
              ${(cat.items || []).map(item => `
                <div class="flex items-baseline justify-between gap-2">
                  <div class="flex-1">
                    <span class="text-sm font-semibold text-gray-800">${item.name}</span>
                    ${item.description ? `<p class="text-xs text-gray-400 mt-0.5">${item.description}</p>` : ''}
                  </div>
                  ${item.price ? `<span class="text-sm font-bold shrink-0" style="color: ${theme.primary}">${item.price}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <p class="text-center text-xs text-gray-400 mt-8">※ メニュー内容・価格は変更になる場合がございます</p>
    </div>
  </section>` : ''}

  ${reviewsHtml ? `
  <!-- レビュー -->
  <section class="py-16 px-6">
    <div class="max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold text-center mb-2" style="color: ${theme.secondary}">お客様の声</h2>
      <p class="text-center text-gray-400 mb-10">Google レビューより</p>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        ${reviewsHtml}
      </div>
    </div>
  </section>` : ''}

  ${industrySection}

  <!-- アクセス -->
  <section class="py-16 px-6 bg-gray-50">
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-bold text-center mb-10" style="color: ${theme.secondary}">アクセス</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <table class="w-full text-sm">
            <tr class="border-b border-gray-200">
              <td class="py-3 pr-4 font-semibold text-gray-500 w-24">店舗名</td>
              <td class="py-3 text-gray-800">${name}</td>
            </tr>
            <tr class="border-b border-gray-200">
              <td class="py-3 pr-4 font-semibold text-gray-500">住所</td>
              <td class="py-3 text-gray-800">${address}</td>
            </tr>
            ${phone ? `<tr class="border-b border-gray-200">
              <td class="py-3 pr-4 font-semibold text-gray-500">電話</td>
              <td class="py-3"><a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="font-semibold" style="color: ${theme.primary}">${phone}</a></td>
            </tr>` : ''}
            ${hoursHtml ? `<tr>
              <td class="py-3 pr-4 font-semibold text-gray-500 align-top">営業時間</td>
              <td class="py-3">${hoursHtml}</td>
            </tr>` : ''}
          </table>
        </div>
        <div>${mapEmbed}</div>
      </div>
    </div>
  </section>

  <!-- フッター -->
  <footer class="py-8 px-6 text-center" style="background-color: ${theme.secondary}">
    <p class="text-white/80 text-sm">&copy; ${new Date().getFullYear()} ${name}. All rights reserved.</p>
  </footer>

</body>
</html>`;

    res.json({ html, name });
  } catch (err) {
    console.error('[HpOutreach] LP generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /send-proposal - 営業メール送信
// ══════════════════════════════════════
router.post('/send-proposal', async (req, res) => {
  try {
    const { lead, lp_url, message_type } = req.body;
    if (!lead) return res.status(400).json({ error: 'リード情報が必要です' });

    const anthropic = await getAnthropicClient();

    // AI でパーソナライズされた営業メールを生成
    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `以下の店舗に対して、ホームページ制作の営業メールを生成してください。

店舗名: ${lead.name}
業種: ${lead.business_type}
ビジネス内容: ${lead.business_description}
${lp_url ? `サンプルLP: ${lp_url}` : ''}

要件:
- 丁寧で親しみやすいビジネスメール
- 「たまたまGoogleマップでお店を見つけた」という自然な入りで
- HPがないことのデメリット（集客機会の損失など）を軽く触れる
- すでにサンプルLPを作成済みであることをアピール${lp_url ? `（URL: ${lp_url}）` : ''}
- 初回は無料 or 格安で制作可能なことを伝える
- 返信を促すCTA
- 送信者名: Takuma

JSON形式で出力:
{
  "subject": "メール件名",
  "body": "メール本文"
}

JSONのみ出力してください。`,
      }],
    });

    const aiText = aiRes.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const jsonMatch = aiText.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (!jsonMatch) throw new Error('メール生成に失敗しました');
    const emailData = JSON.parse(jsonMatch[0]);

    if (message_type === 'email' && lead.email) {
      // Gmail送信
      const auth = await getGoogleAuthClient('gmail');
      const gmail = google.gmail({ version: 'v1', auth });

      const emailContent = [
        `To: ${lead.email}`,
        `From: ${GMAIL_SENDER}`,
        `Subject: =?UTF-8?B?${Buffer.from(emailData.subject).toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        emailData.body,
      ].join('\r\n');

      const encodedMessage = Buffer.from(emailContent)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });

      // スプレッドシートのステータス更新
      if (lead.row_index) {
        const auth2 = await getGoogleAuthClient('sheets');
        const sheets = google.sheets({ version: 'v4', auth: auth2 });
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `J${lead.row_index}`,
          valueInputOption: 'RAW',
          requestBody: { values: [['メール送信済']] },
        });
      }

      res.json({ sent: true, type: 'email', subject: emailData.subject });
    } else {
      // メール未送信（プレビューのみ or Instagram用）
      res.json({ sent: false, type: 'preview', ...emailData });
    }
  } catch (err) {
    console.error('[HpOutreach] Send proposal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /update-status - ステータス更新
// ══════════════════════════════════════
router.post('/update-status', async (req, res) => {
  try {
    const { row_index, status } = req.body;
    const auth = await getGoogleAuthClient('sheets');
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `J${row_index}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// GET /cron/research - 自動リサーチ（定期実行）
// 日本全国のエリア×業種を巡回してHP無し店舗を自動発掘
// ══════════════════════════════════════

const RESEARCH_AREAS = [
  // 東京23区
  '渋谷区', '新宿区', '港区', '目黒区', '世田谷区', '品川区', '大田区',
  '中野区', '杉並区', '豊島区', '北区', '板橋区', '練馬区', '足立区',
  '葛飾区', '江戸川区', '墨田区', '江東区', '台東区', '荒川区', '文京区',
  '千代田区', '中央区',
  // 東京市部
  '武蔵野市', '三鷹市', '調布市', '府中市', '町田市', '八王子市', '立川市',
  // 神奈川
  '横浜市中区', '横浜市西区', '横浜市港北区', '横浜市青葉区',
  '川崎市中原区', '川崎市高津区', '藤沢市', '鎌倉市', '相模原市',
  // 埼玉
  'さいたま市大宮区', 'さいたま市浦和区', '川口市', '越谷市', '所沢市', '川越市',
  // 千葉
  '千葉市中央区', '船橋市', '柏市', '市川市', '松戸市', '浦安市',
  // 大阪
  '大阪市北区', '大阪市中央区', '大阪市天王寺区', '大阪市浪速区',
  '大阪市西区', '大阪市福島区', '大阪市阿倍野区',
  '堺市', '豊中市', '吹田市', '高槻市', '枚方市',
  // 京都
  '京都市中京区', '京都市下京区', '京都市東山区', '京都市左京区',
  // 兵庫
  '神戸市中央区', '神戸市灘区', '西宮市', '尼崎市', '芦屋市',
  // 愛知
  '名古屋市中区', '名古屋市中村区', '名古屋市千種区', '名古屋市名東区',
  '名古屋市東区', '豊田市', '岡崎市',
  // 福岡
  '福岡市中央区', '福岡市博多区', '福岡市早良区', '北九州市小倉北区',
  // 北海道
  '札幌市中央区', '札幌市北区', '札幌市豊平区',
  // 宮城
  '仙台市青葉区', '仙台市太白区',
  // 広島
  '広島市中区', '広島市南区',
  // その他主要都市
  '静岡市葵区', '浜松市中央区', '新潟市中央区', '岡山市北区',
  '熊本市中央区', '鹿児島市', '那覇市',
];

const RESEARCH_CATEGORIES = [
  '飲食店', 'カフェ', 'ラーメン', '居酒屋', 'レストラン', '焼肉',
  'フィットネスジム', 'パーソナルジム', 'ヨガスタジオ',
  '美容院', 'ネイルサロン', 'エステサロン', 'マッサージ', 'リラクゼーション',
  '歯科医院', 'クリニック', '整骨院', '整体院', '鍼灸院',
  '学習塾', '英会話教室', 'ピアノ教室', 'プログラミング教室',
  '花屋', 'ペットショップ', 'トリミングサロン', '写真スタジオ',
  '不動産', '工務店', 'リフォーム',
  'パン屋', 'ケーキ屋', 'スイーツ',
];

router.get('/cron/research', async (_req, res) => {
  console.log('[HpOutreach/cron] Starting auto-research...');
  const results = { searched: 0, found: 0, added: 0, errors: [] };

  try {
    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) {
      return res.json({ ok: false, error: 'Google Maps APIキーが未設定' });
    }

    // Supabaseから前回のインデックスを取得して続きから検索
    const sb = getSupabase();
    let { data: state } = await sb.from('hp_outreach_leads')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);

    // 検索済みの組み合わせを管理するテーブルから取得
    let areaIndex = 0;
    let catIndex = 0;
    try {
      const { data: cursor } = await sb.from('hp_outreach_cursor')
        .select('area_index, category_index')
        .eq('id', 'main')
        .single();
      if (cursor) {
        areaIndex = cursor.area_index || 0;
        catIndex = cursor.category_index || 0;
      }
    } catch {}

    // 1回のcronで3つの組み合わせを検索（API使用量を抑制）
    const BATCH_SIZE = 3;
    let searchCount = 0;

    // スプレッドシート準備
    const auth = await getGoogleAuthClient('sheets');
    const sheets = google.sheets({ version: 'v4', auth });

    // ヘッダー確認
    const headerCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A1:J1',
    });
    if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'A1:J1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['店舗名', '業種', 'ビジネス内容', 'メールアドレス', 'Instagram', '電話番号', '住所', 'GoogleマップURL', 'LP URL', 'ステータス', 'PlaceID']],
        },
      });
    }

    // 既存リードを取得（重複防止）
    const existingData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:G',
    });
    const existingRows = existingData.data.values || [];
    const existingKeys = new Set(existingRows.map(row => `${row[0]}||${row[6]}`));

    while (searchCount < BATCH_SIZE) {
      if (areaIndex >= RESEARCH_AREAS.length) {
        areaIndex = 0;
        catIndex++;
      }
      if (catIndex >= RESEARCH_CATEGORIES.length) {
        catIndex = 0; // 全組み合わせを回ったら最初に戻る
      }

      const area = RESEARCH_AREAS[areaIndex];
      const category = RESEARCH_CATEGORIES[catIndex];
      const query = `${category} ${area}`;

      console.log(`[HpOutreach/cron] Searching: "${query}" (area=${areaIndex}, cat=${catIndex})`);

      try {
        const result = await searchPlaces(query, apiKey);
        const places = result.places || [];
        results.searched++;

        for (const place of places) {
          const hasWebsite = !!place.websiteUri;
          if (hasWebsite) continue; // HP有りはスキップ

          const name = place.displayName?.text || '';
          const address = place.formattedAddress || '';
          const phone = place.nationalPhoneNumber || '';
          const gmapsUrl = place.googleMapsUri || '';
          const reviews = (place.reviews || []).slice(0, 3);

          // 重複チェック
          const key = `${name}||${address}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);

          results.found++;

          // cronでは高速化のためAI分析をスキップ（手動画面で後から分析可能）
          // レビューとtypesからビジネス概要を簡易生成
          const businessType = category;
          const reviewTexts = reviews.map(r => r.text?.text || r.originalText?.text || '').filter(Boolean);
          const editorialText = place.editorialSummary?.text || '';
          const businessDesc = editorialText
            ? editorialText
            : reviewTexts.length > 0
              ? `【レビューより】${reviewTexts.slice(0, 2).join(' / ')}`
              : `${area}の${category}`;

          const email = '';
          const instagram = '';

          // スプレッドシートに追加
          try {
            await sheets.spreadsheets.values.append({
              spreadsheetId: SPREADSHEET_ID,
              range: 'A:K',
              valueInputOption: 'RAW',
              requestBody: {
                values: [[
                  name,
                  businessType,
                  businessDesc,
                  email,
                  instagram ? `https://instagram.com/${instagram}` : '',
                  phone,
                  address,
                  gmapsUrl,
                  '',
                  '未対応',
                  place.id || '',
                ]],
              },
            });

            // Supabaseにも保存
            await sb.from('hp_outreach_leads').insert({
              name,
              business_type: businessType,
              business_description: businessDesc,
              email: email || null,
              instagram: instagram || null,
              phone,
              address,
              google_maps_url: gmapsUrl,
              status: 'new',
            });

            results.added++;
            console.log(`[HpOutreach/cron] Added: ${name} (${businessType}) - ${address}`);
          } catch (err) {
            results.errors.push(`Sheet append error for ${name}: ${err.message}`);
          }

          // レート制限対策
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (err) {
        console.error(`[HpOutreach/cron] Search error for "${query}":`, err.message);
        results.errors.push(`Search error: ${query} - ${err.message}`);
      }

      areaIndex++;
      searchCount++;

      // API間隔
      await new Promise(r => setTimeout(r, 1000));
    }

    // カーソル保存（次回の続きから）
    try {
      await sb.from('hp_outreach_cursor').upsert({
        id: 'main',
        area_index: areaIndex,
        category_index: catIndex,
        last_run_at: new Date().toISOString(),
      });
    } catch {}

    console.log(`[HpOutreach/cron] Done. Searched: ${results.searched}, Found: ${results.found}, Added: ${results.added}`);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[HpOutreach/cron] Fatal error:', err.message);
    res.status(500).json({ ok: false, error: err.message, results });
  }
});

// ══════════════════════════════════════
// GET /cron/enrich - 連絡先自動スクレイピング（cron）
// メール・Instagram未取得のリードを自動で検索
// ══════════════════════════════════════
router.get('/cron/enrich', async (_req, res) => {
  console.log('[HpOutreach/enrich-cron] Starting auto contact enrichment...');
  const results = { processed: 0, emails_found: 0, instagrams_found: 0, errors: [] };

  try {
    const sb = getSupabase();

    // メール・Instagram両方nullのリードを取得（5件ずつ - タイムアウト対策）
    const { data: leads } = await sb.from('hp_outreach_leads')
      .select('*')
      .is('email', null)
      .is('instagram', null)
      .order('created_at', { ascending: true })
      .limit(5);

    if (!leads || leads.length === 0) {
      console.log('[HpOutreach/enrich-cron] No leads to enrich');
      return res.json({ ok: true, results, message: '未取得リードなし' });
    }

    for (const lead of leads) {
      try {
        console.log(`[HpOutreach/enrich-cron] Searching contacts for: ${lead.name}`);

        // ウェブサイトからスクレイピング
        let contact = {};
        if (lead.website) {
          contact = await scrapeContactInfo(lead.website);
        }

        // Google検索でも探す
        const searchContact = await findContactInfo(lead.name, lead.address || '', lead.phone || '');
        const emails = [...new Set([...(contact.emails || []), ...(searchContact.emails || [])])];
        const instagrams = [...new Set([...(contact.instagrams || []), ...(searchContact.instagrams || [])])];

        const foundEmail = emails[0] || null;
        const foundIg = instagrams[0] || null;

        // DBを更新（見つからなくても "searched" ステータスに更新して再検索を防ぐ）
        const updateData = { updated_at: new Date().toISOString() };
        if (foundEmail) updateData.email = foundEmail;
        if (foundIg) updateData.instagram = foundIg;
        if (!foundEmail && !foundIg) {
          // 何も見つからなかった場合、空文字をセットして再検索対象から外す
          updateData.email = '';
          updateData.instagram = '';
        }
        await sb.from('hp_outreach_leads').update(updateData).eq('id', lead.id);

        // スプレッドシートも更新
        if (foundEmail || foundIg) {
          try {
            const sheetAuth = await getGoogleAuthClient('sheets');
            const sheets = google.sheets({ version: 'v4', auth: sheetAuth });
            const sd = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A:A' });
            const ri = (sd.data.values || []).findIndex(r => r[0] === lead.name);
            if (ri >= 0) {
              await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                  valueInputOption: 'RAW',
                  data: [
                    ...(foundEmail ? [{ range: `D${ri + 1}`, values: [[foundEmail]] }] : []),
                    ...(foundIg ? [{ range: `E${ri + 1}`, values: [[`https://instagram.com/${foundIg}`]] }] : []),
                  ],
                },
              });
            }
          } catch {}
        }

        if (foundEmail) results.emails_found++;
        if (foundIg) results.instagrams_found++;
        results.processed++;
        console.log(`[HpOutreach/enrich-cron] ${lead.name}: email=${foundEmail || 'none'}, ig=${foundIg || 'none'}`);

        // レート制限
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        results.errors.push(`${lead.name}: ${err.message}`);
      }
    }

    console.log(`[HpOutreach/enrich-cron] Done. Processed: ${results.processed}, Emails: ${results.emails_found}, IGs: ${results.instagrams_found}`);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[HpOutreach/enrich-cron] Fatal error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
// GET /cron/pipeline - 全自動パイプライン
// リサーチ済みリードの LP生成→公開→営業メール送信→Instagram DM を自動実行
// ══════════════════════════════════════
router.get('/cron/pipeline', async (req, res) => {
  console.log('[HpOutreach/pipeline] Starting auto pipeline...');
  const results = { processed: 0, lp_generated: 0, emails_sent: 0, dms_generated: 0, errors: [] };

  try {
    const sb = getSupabase();
    const apiKey = await getGoogleMapsApiKey();
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // ステータスが 'new' のリードを取得（まだLP未生成）
    const { data: newLeads } = await sb.from('hp_outreach_leads')
      .select('*')
      .eq('status', 'new')
      .is('lp_html', null)
      .order('created_at', { ascending: true })
      .limit(1); // タイムアウト対策（メール探索含むため1件ずつ）

    if (!newLeads || newLeads.length === 0) {
      console.log('[HpOutreach/pipeline] No new leads to process');
      return res.json({ ok: true, results, message: '処理対象なし' });
    }

    for (const lead of newLeads) {
      try {
        console.log(`[HpOutreach/pipeline] Processing: ${lead.name}`);

        // 即座にステータスを変更して重複処理を防止
        await sb.from('hp_outreach_leads').update({
          status: 'processing',
          updated_at: new Date().toISOString(),
        }).eq('id', lead.id).eq('status', 'new');

        // ── Step 1: 写真・詳細情報取得 ──
        let placeInfo = null;
        if (apiKey && lead.google_maps_url) {
          try {
            let pid = null;
            const m1 = lead.google_maps_url.match(/place_id[=:]([^&/]+)/);
            if (m1) pid = m1[1];
            if (!pid) {
              const m2 = lead.google_maps_url.match(/(ChIJ[A-Za-z0-9_-]+)/);
              if (m2) pid = m2[1];
            }
            if (pid) {
              if (!pid.startsWith('places/')) pid = `places/${pid}`;
              placeInfo = await getFullPlaceInfo(pid, apiKey);
            }
          } catch (err) {
            console.log(`[HpOutreach/pipeline] Place info failed for ${lead.name}: ${err.message}`);
          }
        }

        const photos = placeInfo?.photos || [];
        const reviews = placeInfo?.reviews || [];
        const hours = placeInfo?.hours || [];
        const businessType = lead.business_type || '';
        const description = lead.business_description || placeInfo?.editorial || '';
        const name = placeInfo?.name || lead.name;
        const address = placeInfo?.address || lead.address || '';
        const phone = placeInfo?.phone || lead.phone || '';
        const rating = placeInfo?.rating || 0;
        const googleMapsUrl = placeInfo?.googleMapsUrl || lead.google_maps_url || '';

        // ── Step 1.5: メール・SNS探索（未取得の場合） ──
        let leadEmail = lead.email || '';
        let leadInstagram = lead.instagram || '';
        if (!leadEmail && !leadInstagram) {
          try {
            console.log(`[HpOutreach/pipeline] Finding contact for: ${name}`);
            const contact = await findContactInfo(name, address, phone);
            if (contact.emails.length > 0) leadEmail = contact.emails[0];
            if (contact.instagrams.length > 0) leadInstagram = contact.instagrams[0];

            // DBとスプレッドシートを更新
            if (leadEmail || leadInstagram) {
              await sb.from('hp_outreach_leads').update({
                email: leadEmail || null,
                instagram: leadInstagram || null,
              }).eq('id', lead.id);

              try {
                const sheetAuth0 = await getGoogleAuthClient('sheets');
                const sheets0 = google.sheets({ version: 'v4', auth: sheetAuth0 });
                const sd = await sheets0.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A:A' });
                const ri = (sd.data.values || []).findIndex(r => r[0] === lead.name);
                if (ri >= 0) {
                  await sheets0.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: {
                      valueInputOption: 'RAW',
                      data: [
                        { range: `D${ri + 1}`, values: [[leadEmail]] },
                        { range: `E${ri + 1}`, values: [[leadInstagram ? `https://instagram.com/${leadInstagram}` : '']] },
                      ],
                    },
                  });
                }
              } catch {}
              console.log(`[HpOutreach/pipeline] Contact found: email=${leadEmail}, ig=${leadInstagram}`);
            }
          } catch (err) {
            console.log(`[HpOutreach/pipeline] Contact search failed: ${err.message}`);
          }
        }

        // ── Step 2: AIキャッチコピー生成 ──
        const aiCopy = await generateCatchphrase(name, businessType, description, reviews);
        const catchphrase = aiCopy?.main || getFallbackCatchphrase(businessType);
        const subCopy = aiCopy?.sub || '';

        // ── Step 3: メニュー抽出（飲食店のみ） ──
        const isRestaurant = businessType.match(/飲食|カフェ|ラーメン|居酒屋|レストラン|焼肉|パン|ケーキ|スイーツ|寿司|蕎麦|うどん|中華|イタリアン|フレンチ|和食|洋食|定食|食堂|バー|ダイニング/);
        let menuData = null;
        if (isRestaurant && reviews.length > 0) {
          menuData = await extractMenuFromReviews(name, businessType, reviews);
        }

        // ── Step 4: テンプレートLP生成 ──
        const theme = getTheme(businessType);
        const heroImage = photos.length > 0 ? photos[0].url : null;

        const galleryHtml = photos.length > 1
          ? photos.slice(1, 7).map(p =>
            `<div class="overflow-hidden rounded-xl shadow-lg"><img src="${p.url}" alt="${name}" class="w-full h-48 object-cover hover:scale-110 transition-transform duration-500" loading="lazy"/></div>`
          ).join('\n')
          : '';

        const reviewsHtml = reviews.slice(0, 6).map(r => `
          <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div class="flex items-center gap-3 mb-3">
              ${r.profilePhoto ? `<img src="${r.profilePhoto}" alt="" class="w-9 h-9 rounded-full object-cover"/>` : `<div class="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-bold">${(r.author || '?')[0]}</div>`}
              <div>
                <p class="text-sm font-semibold text-gray-800">${r.author}</p>
                <div class="text-xs">${renderStars(r.rating)} <span class="text-gray-400 ml-1">${r.time || ''}</span></div>
              </div>
            </div>
            <p class="text-sm text-gray-600 leading-relaxed">${(r.text || '').slice(0, 150)}${r.text && r.text.length > 150 ? '...' : ''}</p>
          </div>`).join('\n');

        const hoursHtml = hours.length > 0
          ? hours.map(h => `<p class="text-sm text-gray-600 py-1 border-b border-gray-100 last:border-0">${h}</p>`).join('\n')
          : '';

        const mapEmbed = address
          ? `<iframe src="https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed&z=16" class="w-full h-64 rounded-xl" style="border:0" allowfullscreen loading="lazy"></iframe>`
          : '';

        // メニューHTML
        const menuHtml = menuData && menuData.categories && menuData.categories.length > 0
          ? `<section class="py-16 px-6"><div class="max-w-4xl mx-auto"><h2 class="text-2xl font-bold text-center mb-2" style="color: ${theme.secondary}">メニュー</h2><p class="text-center text-gray-400 mb-10">Menu</p><div class="grid grid-cols-1 md:grid-cols-${menuData.categories.length > 1 ? '2' : '1'} gap-8">${menuData.categories.map(cat => `<div><h3 class="text-lg font-bold mb-4 pb-2 border-b-2" style="color: ${theme.primary}; border-color: ${theme.accent}">${cat.name}</h3><div class="space-y-3">${(cat.items || []).map(item => `<div class="flex items-baseline justify-between gap-2"><div class="flex-1"><span class="text-sm font-semibold text-gray-800">${item.name}</span>${item.description ? `<p class="text-xs text-gray-400 mt-0.5">${item.description}</p>` : ''}</div>${item.price ? `<span class="text-sm font-bold shrink-0" style="color: ${theme.primary}">${item.price}</span>` : ''}</div>`).join('')}</div></div>`).join('')}</div><p class="text-center text-xs text-gray-400 mt-8">※ メニュー内容・価格は変更になる場合がございます</p></div></section>`
          : '';

        // CTA
        const ctaHtml = `<section class="py-16 px-6" style="background-color: ${theme.bg}"><div class="max-w-4xl mx-auto text-center"><h2 class="text-2xl font-bold text-gray-800 mb-2">${isRestaurant ? 'ご予約・お問い合わせ' : 'お問い合わせ'}</h2><p class="text-gray-500 mb-8">お気軽にご連絡ください</p><div class="flex flex-col sm:flex-row gap-4 justify-center">${phone ? `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg" style="background-color: ${theme.primary}">${phone}</a>` : ''}${googleMapsUrl ? `<a href="${googleMapsUrl}" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border-2 font-bold text-lg" style="border-color: ${theme.primary}; color: ${theme.primary}">Google Mapで見る</a>` : ''}</div></div></section>`;

        const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${name} | 公式ホームページ</title><meta name="description" content="${description.slice(0, 160)}"/><script src="https://cdn.tailwindcss.com"><\/script><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700;900&display=swap" rel="stylesheet"/><style>*{font-family:'Noto Sans JP',sans-serif}html{scroll-behavior:smooth}</style></head><body class="bg-white text-gray-800"><header class="relative h-[70vh] min-h-[500px] flex items-center justify-center overflow-hidden">${heroImage ? `<img src="${heroImage}" alt="${name}" class="absolute inset-0 w-full h-full object-cover"/><div class="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/70"></div>` : `<div class="absolute inset-0 bg-gradient-to-br ${theme.hero}"></div>`}<div class="relative z-10 text-center px-6 max-w-3xl"><p class="text-white/80 text-sm tracking-[0.3em] uppercase mb-4">${businessType}</p><h1 class="text-4xl md:text-6xl font-black text-white mb-4 leading-tight">${name}</h1><p class="text-2xl md:text-3xl text-white font-bold mb-2">${catchphrase}</p>${subCopy ? `<p class="text-base md:text-lg text-white/80 font-light max-w-xl mx-auto">${subCopy}</p>` : ''}${phone ? `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="inline-flex items-center gap-2 mt-8 px-8 py-3 rounded-full text-white font-bold shadow-2xl hover:scale-105 transition-transform" style="background-color: ${theme.primary}">お電話でのご予約</a>` : ''}</div></header><section class="py-20 px-6"><div class="max-w-3xl mx-auto text-center"><h2 class="text-3xl font-bold mb-6" style="color: ${theme.secondary}">私たちについて</h2><div class="w-16 h-1 mx-auto mb-8 rounded-full" style="background-color: ${theme.primary}"></div><p class="text-gray-600 leading-relaxed text-lg">${description || `${address}にある${businessType}です。`}</p>${rating ? `<div class="mt-8 inline-flex items-center gap-2 px-6 py-3 bg-yellow-50 rounded-full"><span class="text-yellow-500 text-lg">★</span><span class="text-xl font-bold text-gray-800">${rating}</span><span class="text-sm text-gray-500">Google評価</span></div>` : ''}</div></section>${galleryHtml ? `<section class="py-16 px-6 bg-gray-50"><div class="max-w-5xl mx-auto"><h2 class="text-2xl font-bold text-center mb-10" style="color: ${theme.secondary}">ギャラリー</h2><div class="grid grid-cols-2 md:grid-cols-3 gap-4">${galleryHtml}</div></div></section>` : ''}${menuHtml}${reviewsHtml ? `<section class="py-16 px-6"><div class="max-w-5xl mx-auto"><h2 class="text-2xl font-bold text-center mb-2" style="color: ${theme.secondary}">お客様の声</h2><p class="text-center text-gray-400 mb-10">Google レビューより</p><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">${reviewsHtml}</div></div></section>` : ''}${ctaHtml}<section class="py-16 px-6 bg-gray-50"><div class="max-w-4xl mx-auto"><h2 class="text-2xl font-bold text-center mb-10" style="color: ${theme.secondary}">アクセス</h2><div class="grid grid-cols-1 md:grid-cols-2 gap-8"><div><table class="w-full text-sm"><tr class="border-b border-gray-200"><td class="py-3 pr-4 font-semibold text-gray-500 w-24">店舗名</td><td class="py-3 text-gray-800">${name}</td></tr><tr class="border-b border-gray-200"><td class="py-3 pr-4 font-semibold text-gray-500">住所</td><td class="py-3 text-gray-800">${address}</td></tr>${phone ? `<tr class="border-b border-gray-200"><td class="py-3 pr-4 font-semibold text-gray-500">電話</td><td class="py-3"><a href="tel:${phone.replace(/[^0-9+]/g, '')}" class="font-semibold" style="color: ${theme.primary}">${phone}</a></td></tr>` : ''}${hoursHtml ? `<tr><td class="py-3 pr-4 font-semibold text-gray-500 align-top">営業時間</td><td class="py-3">${hoursHtml}</td></tr>` : ''}</table></div><div>${mapEmbed}</div></div></div></section><footer class="py-8 px-6 text-center" style="background-color: ${theme.secondary}"><p class="text-white/80 text-sm">&copy; ${new Date().getFullYear()} ${name}. All rights reserved.</p></footer></body></html>`;

        // ── Step 5: LP保存（公開） ──
        const lpPath = `/api/hp-outreach/lp/${lead.id}`;
        await sb.from('hp_outreach_leads').update({
          lp_html: html,
          lp_url: lpPath,
          status: 'lp_created',
          updated_at: new Date().toISOString(),
        }).eq('id', lead.id);

        // スプレッドシートも更新（LP URL + ステータス）
        try {
          const sheetAuth = await getGoogleAuthClient('sheets');
          const sheets = google.sheets({ version: 'v4', auth: sheetAuth });
          // 店舗名で行を特定
          const sheetData = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A:A' });
          const rows = sheetData.data.values || [];
          const rowIdx = rows.findIndex(r => r[0] === lead.name);
          if (rowIdx >= 0) {
            const rowNum = rowIdx + 1;
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: SPREADSHEET_ID,
              requestBody: {
                valueInputOption: 'RAW',
                data: [
                  { range: `I${rowNum}`, values: [[lpPath]] },
                  { range: `J${rowNum}`, values: [[lead.email ? 'LP作成済' : 'LP作成済(メール無)']] },
                ],
              },
            });
          }
        } catch (sheetErr) {
          console.log(`[HpOutreach/pipeline] Sheet update failed: ${sheetErr.message}`);
        }

        results.lp_generated++;
        console.log(`[HpOutreach/pipeline] LP generated for: ${lead.name}`);

        // ── Step 6: 営業メール自動送信（メールがある場合） ──
        if (leadEmail) {
          try {
            const lpUrl = `${baseUrl}/api/hp-outreach/lp/${lead.id}`;
            const subject = `${lead.name}様のホームページを作成いたしました【ご提案】`;
            const body = `${lead.name} ご担当者様\n\n初めまして、Web制作のTakumaと申します。\n\nたまたまGoogleマップでお店を拝見し、素敵なお店だと感じたのですが、\nホームページをお持ちでないことに気づき、ご連絡させていただきました。\n\n実は、${lead.name}様のためにサンプルのホームページを作成いたしました。\nぜひ一度ご覧いただけますと幸いです。\n\n▼ サンプルホームページ\n${lpUrl}\n\n━━━━━━━━━━━━━━━━━━\n　ホームページ制作プラン\n━━━━━━━━━━━━━━━━━━\n\n【A】そのままお渡しプラン ─ ¥10,000（税込）\n　サンプルページをそのままお渡し。\n　独自ドメイン設定込み。最短即日納品。\n\n【B】カスタマイズプラン ─ ¥50,000（税込）\n　写真差し替え・テキスト修正・カラー変更など\n　お客様のご要望に合わせて調整いたします。\n\n【C】フルデザインプラン ─ ¥100,000〜（税込）\n　完全オリジナルデザイン。\n　予約システム・SNS連携・SEO対策込み。\n\n━━━━━━━━━━━━━━━━━━\n\nご興味がございましたら、ご希望のプラン（A / B / C）を\nこのメールにご返信いただくだけでOKです。\n\nホームページがあることで、Google検索からの集客や\nお客様からの信頼度アップにつながります。\n\nご不明点がございましたら、お気軽にご連絡ください。\n\n━━━━━━━━━━━━━━━━━━\nTakuma\nWeb制作 & デジタルマーケティング\nEmail: ${GMAIL_SENDER}\n━━━━━━━━━━━━━━━━━━`;

            const auth = await getGoogleAuthClient('gmail');
            const gmail = google.gmail({ version: 'v1', auth });

            const emailContent = [
              `To: ${leadEmail}`,
              `From: ${GMAIL_SENDER}`,
              `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
              'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', body,
            ].join('\r\n');

            await gmail.users.messages.send({
              userId: 'me',
              requestBody: { raw: Buffer.from(emailContent).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
            });

            await sb.from('hp_outreach_leads').update({
              status: 'email_sent',
              email: leadEmail,
              proposal_subject: subject,
              sent_at: new Date().toISOString(),
            }).eq('id', lead.id);

            // スプレッドシートのステータスも更新
            try {
              const sheetAuth2 = await getGoogleAuthClient('sheets');
              const sheets2 = google.sheets({ version: 'v4', auth: sheetAuth2 });
              const sheetData2 = await sheets2.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A:A' });
              const rows2 = sheetData2.data.values || [];
              const rowIdx2 = rows2.findIndex(r => r[0] === lead.name);
              if (rowIdx2 >= 0) {
                await sheets2.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `J${rowIdx2 + 1}`,
                  valueInputOption: 'RAW',
                  requestBody: { values: [['メール送信済']] },
                });
              }
            } catch {}

            results.emails_sent++;
            console.log(`[HpOutreach/pipeline] Sales email sent to: ${lead.email}`);
          } catch (err) {
            console.error(`[HpOutreach/pipeline] Email error for ${lead.name}: ${err.message}`);
            results.errors.push(`Email: ${lead.name} - ${err.message}`);
          }
        } else if (leadInstagram && !leadEmail) {
          // ── Step 6b: Instagram DM文面を自動生成（メールなし・Instagramありの場合） ──
          try {
            const lpUrl = `${baseUrl}/api/hp-outreach/lp/${lead.id}`;
            const anthropic = await getAnthropicClient();
            const aiRes = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 800,
              messages: [{
                role: 'user',
                content: `以下の店舗に対して、Instagram DMで送る営業メッセージを生成してください。

店舗名: ${lead.name}
業種: ${lead.business_type || '不明'}
説明: ${lead.business_description || ''}
サンプルHP: ${lpUrl}

要件:
- Instagram DMなので、メールよりカジュアルで短め（200〜400文字）
- 「Googleマップで見つけて素敵なお店だと思った」という自然な入り
- HPがないことを柔らかく指摘
- サンプルHPを作ったことを伝える（URL: ${lpUrl}）
- 料金プラン: A) そのままお渡し ¥10,000 / B) カスタマイズ ¥50,000 / C) フルデザイン ¥100,000〜
- 興味があればDMで返信してほしいと伝える
- 送信者: Takuma（Web制作）
- 絵文字は控えめに1〜2個だけ

テキストのみ出力。JSON不要。`,
              }],
            });
            const dmText = aiRes.content.filter(c => c.type === 'text').map(c => c.text).join('').trim();

            await sb.from('hp_outreach_leads').update({
              status: 'dm_ready',
              proposal_body: dmText,
              updated_at: new Date().toISOString(),
            }).eq('id', lead.id);

            // Slack通知（DM送信依頼）
            try {
              const { escalate } = require('./slack-notify.cjs');
              await escalate({
                channel: 'HP制作営業',
                customerName: lead.name,
                customerMessage: `Instagram: @${leadInstagram}\nLP: ${lpUrl}`,
                reason: 'Instagram DM文面を自動生成しました。手動でDM送信してください。',
                context: `DM文面:\n${dmText.slice(0, 300)}...`,
              });
            } catch {}

            results.dms_generated++;
            console.log(`[HpOutreach/pipeline] DM generated for: ${lead.name} (@${leadInstagram})`);
          } catch (err) {
            console.error(`[HpOutreach/pipeline] DM error for ${lead.name}: ${err.message}`);
            results.errors.push(`DM: ${lead.name} - ${err.message}`);
          }
        }

        results.processed++;
      } catch (err) {
        console.error(`[HpOutreach/pipeline] Error processing ${lead.name}: ${err.message}`);
        results.errors.push(`${lead.name}: ${err.message}`);
        // エラー時は 'error' にしてリトライループを防止
        await sb.from('hp_outreach_leads').update({
          status: 'error',
          updated_at: new Date().toISOString(),
        }).eq('id', lead.id).catch(() => {});
      }
    }

    console.log(`[HpOutreach/pipeline] Done. Processed: ${results.processed}, LPs: ${results.lp_generated}, Emails: ${results.emails_sent}, DMs: ${results.dms_generated}`);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[HpOutreach/pipeline] Fatal error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
// GET /lp/:id - LP公開ホスティング
// ══════════════════════════════════════
router.get('/lp/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('hp_outreach_leads')
      .select('lp_html, name')
      .eq('id', req.params.id)
      .single();
    if (!data || !data.lp_html) {
      return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>ページが見つかりません</h1></body></html>');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(data.lp_html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// ══════════════════════════════════════
// POST /publish-lp - LPを保存・公開してURLを返す
// ══════════════════════════════════════
router.post('/publish-lp', async (req, res) => {
  try {
    const { lead, html } = req.body;
    if (!html) return res.status(400).json({ error: 'HTMLが必要です' });

    const sb = getSupabase();

    // Supabaseにlp_htmlを保存（既存レコードがあればupdate、なければinsert）
    let recordId = null;

    // 名前+住所で既存レコード検索
    const { data: existing } = await sb.from('hp_outreach_leads')
      .select('id')
      .eq('name', lead.name)
      .limit(1);

    if (existing && existing.length > 0) {
      recordId = existing[0].id;
      await sb.from('hp_outreach_leads').update({
        lp_html: html,
        updated_at: new Date().toISOString(),
      }).eq('id', recordId);
    } else {
      const { data: inserted } = await sb.from('hp_outreach_leads').insert({
        name: lead.name,
        business_type: lead.business_type || '',
        business_description: lead.business_description || '',
        email: lead.email || null,
        phone: lead.phone || '',
        address: lead.address || '',
        google_maps_url: lead.google_maps_url || '',
        lp_html: html,
        status: 'lp_created',
      }).select('id').single();
      recordId = inserted?.id;
    }

    if (!recordId) throw new Error('LP保存に失敗しました');

    // 公開URL生成
    const lpUrl = `/api/hp-outreach/lp/${recordId}`;

    // スプレッドシートのLP URLカラムを更新
    if (lead.row_index) {
      try {
        const auth = await getGoogleAuthClient('sheets');
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `I${lead.row_index}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[lpUrl]] },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `J${lead.row_index}`,
          valueInputOption: 'RAW',
          requestBody: { values: [['LP作成済']] },
        });
      } catch {}
    }

    res.json({ ok: true, lp_url: lpUrl, id: recordId });
  } catch (err) {
    console.error('[HpOutreach] Publish LP error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /send-sales-email - 営業メール送信（LP URL + プラン提案）
// ══════════════════════════════════════
router.post('/send-sales-email', async (req, res) => {
  try {
    const { lead, lp_url } = req.body;
    if (!lead || !lead.email) return res.status(400).json({ error: 'メールアドレスが必要です' });

    // フルURL生成
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fullLpUrl = lp_url ? `${baseUrl}${lp_url}` : '';

    const subject = `${lead.name}様のホームページを作成いたしました【ご提案】`;

    const body = `${lead.name} ご担当者様

初めまして、Web制作のTakumaと申します。

たまたまGoogleマップでお店を拝見し、素敵なお店だと感じたのですが、
ホームページをお持ちでないことに気づき、ご連絡させていただきました。

実は、${lead.name}様のためにサンプルのホームページを作成いたしました。
ぜひ一度ご覧いただけますと幸いです。

▼ サンプルホームページ
${fullLpUrl}

━━━━━━━━━━━━━━━━━━
　ホームページ制作プラン
━━━━━━━━━━━━━━━━━━

【A】そのままお渡しプラン ─ ¥10,000（税込）
　サンプルページをそのままお渡し。
　独自ドメイン設定込み。最短即日納品。

【B】カスタマイズプラン ─ ¥50,000（税込）
　写真差し替え・テキスト修正・カラー変更など
　お客様のご要望に合わせて調整いたします。

【C】フルデザインプラン ─ ¥100,000〜（税込）
　完全オリジナルデザイン。
　予約システム・SNS連携・SEO対策込み。

━━━━━━━━━━━━━━━━━━

ご興味がございましたら、ご希望のプラン（A / B / C）を
このメールにご返信いただくだけでOKです。

ホームページがあることで、Google検索からの集客や
お客様からの信頼度アップにつながります。

ご不明点がございましたら、お気軽にご連絡ください。

━━━━━━━━━━━━━━━━━━
Takuma
Web制作 & デジタルマーケティング
Email: ${GMAIL_SENDER}
━━━━━━━━━━━━━━━━━━`;

    // Gmail送信
    const auth = await getGoogleAuthClient('gmail');
    const gmail = google.gmail({ version: 'v1', auth });

    const emailContent = [
      `To: ${lead.email}`,
      `From: ${GMAIL_SENDER}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n');

    const encodedMessage = Buffer.from(emailContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sentMsg = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    // Supabaseに送信記録
    const sb = getSupabase();
    await sb.from('hp_outreach_leads').update({
      status: 'email_sent',
      proposal_subject: subject,
      proposal_body: body,
      sent_at: new Date().toISOString(),
    }).eq('name', lead.name);

    // スプレッドシートステータス更新
    if (lead.row_index) {
      try {
        const auth2 = await getGoogleAuthClient('sheets');
        const sheets = google.sheets({ version: 'v4', auth: auth2 });
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `J${lead.row_index}`,
          valueInputOption: 'RAW',
          requestBody: { values: [['メール送信済']] },
        });
      } catch {}
    }

    res.json({ sent: true, messageId: sentMsg.data.id });
  } catch (err) {
    console.error('[HpOutreach] Sales email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// GET /cron/check-replies - 返信チェック＆自動処理（cron）
// プラン選択返信を検知 → 請求書作成 → 送信 or Slack通知
// ══════════════════════════════════════
router.get('/cron/check-replies', async (req, res) => {
  console.log('[HpOutreach/replies] Checking for plan replies...');
  const results = { checked: 0, processed: 0, invoices: 0, escalated: 0, errors: [] };

  try {
    const auth = await getGoogleAuthClient('gmail');
    const gmail = google.gmail({ version: 'v1', auth });
    const sb = getSupabase();

    // 過去24時間の受信メールで「ホームページ」「プラン」に関する返信を検索
    const searchRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:inbox newer_than:1d subject:(ホームページ OR プラン) -from:me',
      maxResults: 20,
    });

    const messages = searchRes.data.messages || [];
    results.checked = messages.length;

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });

        const headers = detail.data.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';

        // 本文取得
        let bodyText = '';
        const parts = detail.data.payload.parts || [detail.data.payload];
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            bodyText = Buffer.from(part.body.data, 'base64').toString('utf-8');
            break;
          }
        }

        // 既に処理済みかチェック
        const { data: processed } = await sb.from('hp_outreach_replies')
          .select('id').eq('gmail_message_id', msg.id).limit(1);
        if (processed && processed.length > 0) continue;

        // プラン判定
        const fullText = (subject + ' ' + bodyText).toLowerCase();
        let plan = null;
        let planName = '';
        let amount = 0;

        if (fullText.match(/[AaＡａ]|そのまま|1万|10,?000|お渡し/)) {
          plan = 'A'; planName = 'そのままお渡しプラン'; amount = 10000;
        } else if (fullText.match(/[BbＢｂ]|カスタマイズ|5万|50,?000/)) {
          plan = 'B'; planName = 'カスタマイズプラン'; amount = 50000;
        } else if (fullText.match(/[CcＣｃ]|フルデザイン|がっつり|10万|100,?000|オリジナル/)) {
          plan = 'C'; planName = 'フルデザインプラン'; amount = 100000;
        }

        if (!plan) continue; // プラン判定できなければスキップ

        // 送信者のメールアドレス抽出
        const emailMatch = from.match(/<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/);
        const replyEmail = emailMatch ? emailMatch[1] : from;

        // リード情報を検索
        const { data: lead } = await sb.from('hp_outreach_leads')
          .select('*')
          .eq('email', replyEmail)
          .limit(1)
          .single();

        const customerName = lead?.name || from.replace(/<.*>/, '').trim() || replyEmail;

        // 返信記録保存
        await sb.from('hp_outreach_replies').insert({
          gmail_message_id: msg.id,
          from_email: replyEmail,
          customer_name: customerName,
          plan,
          plan_name: planName,
          amount,
          body: bodyText.slice(0, 2000),
          processed: false,
        });

        results.processed++;

        if (plan === 'C') {
          // ══ がっつりデザインプラン → Slackエスカレーション ══
          try {
            const { escalate } = require('./slack-notify.cjs');
            await escalate({
              channel: 'HP制作営業',
              customerName,
              customerMessage: bodyText.slice(0, 500),
              reason: `フルデザインプラン（¥100,000〜）の申し込み`,
              context: `メール: ${replyEmail}\nGmail: https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(replyEmail)}\n${lead ? `LP: ${req.protocol}://${req.get('host')}${lead.lp_url || ''}` : ''}`,
            });
            results.escalated++;
          } catch (err) {
            console.error('[HpOutreach/replies] Slack escalation error:', err.message);
          }

          // 確認メール送信
          const confirmBody = `${customerName} 様\n\nフルデザインプラン（¥100,000〜）のお申し込みありがとうございます。\n\n担当者よりあらためてご連絡いたします。\nデザインのご要望やイメージなどがございましたら、お気軽にご返信ください。\n\n━━━━━━━━━━━━━━━━━━\nTakuma\nWeb制作 & デジタルマーケティング\nEmail: ${GMAIL_SENDER}\n━━━━━━━━━━━━━━━━━━`;

          const confirmEmail = [
            `To: ${replyEmail}`,
            `From: ${GMAIL_SENDER}`,
            `Subject: =?UTF-8?B?${Buffer.from(`【ご確認】フルデザインプランのお申し込みについて`).toString('base64')}?=`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            '',
            confirmBody,
          ].join('\r\n');

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: Buffer.from(confirmEmail).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
          });

        } else {
          // ══ プランA/B → 請求書自動作成・送信 ══
          try {
            // 請求書番号生成
            const now = new Date();
            const invoiceNumber = `HP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

            // 請求書メール本文
            const invoiceSubject = `【請求書】${planName} - ${invoiceNumber}`;
            const invoiceBody = `${customerName} 様

${planName}のお申し込みありがとうございます。

下記の通り、請求書をお送りいたします。

━━━━━━━━━━━━━━━━━━
　請求書
━━━━━━━━━━━━━━━━━━

請求書番号: ${invoiceNumber}
発行日: ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日

■ ご請求内容
${planName}　　¥${amount.toLocaleString()}（税込）

■ お支払い方法
銀行振込（請求書記載の口座へお振込みください）

■ お支払い期限
${new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).getFullYear()}年${new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).getMonth() + 1}月${new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).getDate()}日

━━━━━━━━━━━━━━━━━━

${plan === 'A' ? 'お振込み確認後、即日ホームページをお渡しいたします。' : 'お振込み確認後、カスタマイズのヒアリングをさせていただきます。'}

ご不明点がございましたら、お気軽にご連絡ください。

━━━━━━━━━━━━━━━━━━
Takuma
Web制作 & デジタルマーケティング
Email: ${GMAIL_SENDER}
━━━━━━━━━━━━━━━━━━`;

            const invoiceEmail = [
              `To: ${replyEmail}`,
              `From: ${GMAIL_SENDER}`,
              `Subject: =?UTF-8?B?${Buffer.from(invoiceSubject).toString('base64')}?=`,
              'MIME-Version: 1.0',
              'Content-Type: text/plain; charset=UTF-8',
              '',
              invoiceBody,
            ].join('\r\n');

            await gmail.users.messages.send({
              userId: 'me',
              requestBody: { raw: Buffer.from(invoiceEmail).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
            });

            // 請求書履歴に保存
            await sb.from('invoice_history').insert({
              type: 'sent',
              to: replyEmail,
              subject: invoiceSubject,
              invoice_number: invoiceNumber,
              sent_at: new Date().toISOString(),
            }).catch(() => {});

            // 返信処理済みに更新
            await sb.from('hp_outreach_replies').update({
              processed: true,
              invoice_number: invoiceNumber,
            }).eq('gmail_message_id', msg.id);

            // リードステータス更新
            if (lead) {
              await sb.from('hp_outreach_leads').update({
                status: 'invoice_sent',
              }).eq('id', lead.id);
            }

            results.invoices++;
            console.log(`[HpOutreach/replies] Invoice sent: ${invoiceNumber} to ${replyEmail} (${planName})`);

            // Slack通知（請求書発行通知 + Gmail URL）
            try {
              const gmailUrl = `https://mail.google.com/mail/u/0/#search/to%3A${encodeURIComponent(replyEmail)}+subject%3A${encodeURIComponent(invoiceNumber)}`;
              const siteBase = `${req.protocol}://${req.get('host')}`;
              const { escalate } = require('./slack-notify.cjs');
              await escalate({
                channel: 'HP制作営業',
                customerName,
                customerMessage: `プラン${plan}（${planName}）を選択\n金額: ¥${amount.toLocaleString()}\n請求書番号: ${invoiceNumber}`,
                reason: `請求書を自動発行・送信しました`,
                context: `メール: ${replyEmail}\nGmail: ${gmailUrl}\n${lead?.lp_url ? `LP: ${siteBase}${lead.lp_url}` : ''}`,
              });
            } catch (slackErr) {
              console.error('[HpOutreach/replies] Slack notify error:', slackErr.message);
            }
          } catch (err) {
            console.error('[HpOutreach/replies] Invoice error:', err.message);
            results.errors.push(`Invoice error for ${replyEmail}: ${err.message}`);
          }
        }
      } catch (err) {
        results.errors.push(`Message processing error: ${err.message}`);
      }
    }

    console.log(`[HpOutreach/replies] Done. Checked: ${results.checked}, Processed: ${results.processed}, Invoices: ${results.invoices}, Escalated: ${results.escalated}`);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[HpOutreach/replies] Fatal error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
// POST /enrich-contacts - 全リードの連絡先を一括スクレイピング
// ══════════════════════════════════════
router.post('/enrich-contacts', async (req, res) => {
  console.log('[HpOutreach] Starting contact enrichment...');
  const results = { processed: 0, emails_found: 0, instagrams_found: 0, errors: [] };

  try {
    const sb = getSupabase();
    const { limit = 10 } = req.body;

    // メール・Instagram両方nullのリードを取得
    const { data: leads } = await sb.from('hp_outreach_leads')
      .select('*')
      .is('email', null)
      .is('instagram', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (!leads || leads.length === 0) {
      return res.json({ ok: true, results, message: '未取得リードなし' });
    }

    for (const lead of leads) {
      try {
        console.log(`[HpOutreach/enrich] Searching contacts for: ${lead.name}`);

        // ウェブサイトからスクレイピング
        let contact = {};
        if (lead.website) {
          contact = await scrapeContactInfo(lead.website);
        }

        // Google検索でも探す
        const searchContact = await findContactInfo(lead.name, lead.address || '', lead.phone || '');
        const emails = [...new Set([...(contact.emails || []), ...(searchContact.emails || [])])];
        const instagrams = [...new Set([...(contact.instagrams || []), ...(searchContact.instagrams || [])])];

        const foundEmail = emails[0] || null;
        const foundIg = instagrams[0] || null;

        if (foundEmail || foundIg) {
          await sb.from('hp_outreach_leads').update({
            email: foundEmail,
            instagram: foundIg,
            updated_at: new Date().toISOString(),
          }).eq('id', lead.id);

          if (foundEmail) results.emails_found++;
          if (foundIg) results.instagrams_found++;
        }

        results.processed++;
        console.log(`[HpOutreach/enrich] ${lead.name}: email=${foundEmail || 'none'}, ig=${foundIg || 'none'}`);

        // レート制限
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        results.errors.push(`${lead.name}: ${err.message}`);
      }
    }

    console.log(`[HpOutreach/enrich] Done. Processed: ${results.processed}, Emails: ${results.emails_found}, IGs: ${results.instagrams_found}`);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[HpOutreach/enrich] Fatal error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════
// GET /dm-queue - Instagram DM送信対象リスト
// ══════════════════════════════════════
router.get('/dm-queue', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('hp_outreach_leads')
      .select('id, name, business_type, business_description, instagram, address, phone, google_maps_url, lp_url, status, proposal_body')
      .not('instagram', 'is', null)
      .neq('instagram', '')
      .not('status', 'in', '("dm_sent")')
      .order('created_at', { ascending: true });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /generate-dm - Instagram DM文面をAI生成
// ══════════════════════════════════════
router.post('/generate-dm', async (req, res) => {
  try {
    const { lead } = req.body;
    if (!lead) return res.status(400).json({ error: 'リード情報が必要です' });

    const anthropic = await getAnthropicClient();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const lpUrl = lead.lp_url ? `${baseUrl}${lead.lp_url}` : '';

    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `以下の店舗に対して、Instagram DMで送る営業メッセージを生成してください。

店舗名: ${lead.name}
業種: ${lead.business_type || '不明'}
説明: ${lead.business_description || ''}
${lpUrl ? `サンプルHP: ${lpUrl}` : ''}

要件:
- Instagram DMなので、メールよりカジュアルで短め（200〜400文字）
- 「Googleマップで見つけて素敵なお店だと思った」という自然な入り
- HPがないことを柔らかく指摘
- サンプルHPを作ったことを伝える${lpUrl ? `（URL: ${lpUrl}）` : ''}
- 料金プラン:
  A) そのままお渡し ¥10,000
  B) カスタマイズ ¥50,000
  C) フルデザイン ¥100,000〜
- 興味があればDMで返信してほしいと伝える
- 送信者: Takuma（Web制作）
- 絵文字は控えめに1〜2個だけ

テキストのみ出力。JSON不要。`,
      }],
    });

    const dmText = aiRes.content.filter(c => c.type === 'text').map(c => c.text).join('');
    res.json({ dm_text: dmText.trim() });
  } catch (err) {
    console.error('[HpOutreach] Generate DM error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// POST /mark-dm-sent - DM送信済みマーク
// ══════════════════════════════════════
router.post('/mark-dm-sent', async (req, res) => {
  try {
    const { lead_id } = req.body;
    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const sb = getSupabase();
    await sb.from('hp_outreach_leads').update({
      status: 'dm_sent',
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', lead_id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
// GET /outreach-stats - 営業全体のステータス集計
// ══════════════════════════════════════
router.get('/outreach-stats', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('hp_outreach_leads').select('id, email, instagram, status');
    const leads = data || [];
    res.json({
      total: leads.length,
      no_contact: leads.filter(l => !l.email && !l.instagram).length,
      has_email: leads.filter(l => l.email).length,
      has_instagram: leads.filter(l => l.instagram).length,
      email_sent: leads.filter(l => l.status === 'email_sent').length,
      dm_sent: leads.filter(l => l.status === 'dm_sent').length,
      lp_created: leads.filter(l => l.status === 'lp_created').length,
      new_leads: leads.filter(l => l.status === 'new').length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
