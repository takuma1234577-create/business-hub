const express = require('express');
const axios = require('axios');
const { waitUntil } = require('@vercel/functions');
const { getSupabase } = require('./shared.cjs');
const { notifyEmailAboutLine } = require('./cross-channel-notify.cjs');
const { registerUserByEmail, getLinkedOrders, generateAutoLoginUrl } = require('./shopify-line.cjs');
const { updateFriendChatSummary } = require('./fitpeak-rag.cjs');
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const router = express.Router();

// ===========================================================================
// Friends
// ===========================================================================

// POST /friends/restore - ブロードキャストで友だち復元メッセージを送信
// 友だちがメッセージに反応するとWebhookで自動登録される
router.post('/friends/restore', async (req, res) => {
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN が未設定です' });

    // ブロードキャストで全友だちにメッセージ送信
    const pushRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: [{
          type: 'template',
          altText: '【FITPEAK】システムアップデートのお知らせ',
          template: {
            type: 'buttons',
            title: 'FITPEAK',
            text: 'システムをアップデートしました！下のボタンをタップして再接続してください✨',
            actions: [{
              type: 'message',
              label: '再接続する',
              text: '再接続',
            }],
          },
        }],
      }),
    });

    if (!pushRes.ok) {
      const body = await pushRes.text().catch(() => '');
      return res.status(502).json({ error: `LINE broadcast failed: ${pushRes.status} ${body}` });
    }

    console.log('[friends/restore] Broadcast sent to all friends');
    res.json({ ok: true, message: '全友だちに再接続メッセージをブロードキャストしました。友だちがタップすると自動登録されます。' });
  } catch (err) {
    console.error('[friends/restore] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /friends - List friends with search, tag filter, pagination
router.get('/friends', async (req, res) => {
  try {
    const {
      search,
      tag_id,
      page = '1',
      pageSize = '20',
    } = req.query;

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
    const from = (currentPage - 1) * size;
    const to = from + size - 1;

    // If filtering by tag, we need to get the friend IDs first
    let friendIds = null;
    if (tag_id) {
      const { data: friendTags, error: ftError } = await supabase
        .from('friend_tags')
        .select('friend_id')
        .eq('tag_id', tag_id);

      if (ftError) {
        return res.status(500).json({ error: ftError.message });
      }

      friendIds = friendTags.map((ft) => ft.friend_id);
      if (friendIds.length === 0) {
        return res.json({
          data: [],
          pagination: { page: currentPage, pageSize: size, total: 0, totalPages: 0 },
        });
      }
    }

    let query = supabase
      .from('friends')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (search) {
      query = query.or(
        `display_name.ilike.%${search}%,line_user_id.ilike.%${search}%`
      );
    }

    if (friendIds) {
      query = query.in('id', friendIds);
    }

    const { data: friends, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Fetch tags for each friend
    const ids = friends.map((f) => f.id);
    let friendsWithTags = friends;

    if (ids.length > 0) {
      const { data: ftRows, error: ftError } = await supabase
        .from('friend_tags')
        .select('friend_id, tags(*)')
        .in('friend_id', ids);

      if (!ftError && ftRows) {
        const tagMap = {};
        for (const row of ftRows) {
          if (!tagMap[row.friend_id]) {
            tagMap[row.friend_id] = [];
          }
          if (row.tags) {
            tagMap[row.friend_id].push(row.tags);
          }
        }
        friendsWithTags = friends.map((f) => ({
          ...f,
          tags: tagMap[f.id] || [],
        }));
      }
    }

    return res.json({
      data: friendsWithTags,
      pagination: {
        page: currentPage,
        pageSize: size,
        total: count,
        totalPages: Math.ceil((count || 0) / size),
      },
    });
  } catch (err) {
    console.error('GET /friends error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /friends/:id - Get friend detail with tags
router.get('/friends/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: friend, error } = await supabase
      .from('friends')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Friend not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    // Fetch tags for this friend
    const { data: ftRows, error: ftError } = await supabase
      .from('friend_tags')
      .select('tags(*)')
      .eq('friend_id', id);

    const tags =
      !ftError && ftRows
        ? ftRows.filter((r) => r.tags).map((r) => r.tags)
        : [];

    return res.json({ ...friend, tags });
  } catch (err) {
    console.error('GET /friends/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /friends/:id/read - 既読にする（unread_countをリセット）
router.post('/friends/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('friends').update({ unread_count: 0 }).eq('id', id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /friends/:id/read error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /friends/:id/block - ブロック/解除
router.patch('/friends/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    const { blocked } = req.body; // true = block, false = unblock
    const newStatus = blocked ? 'blocked' : 'active';
    const { data, error } = await supabase
      .from('friends')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.error('PATCH /friends/:id/block error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /friends-blocked - ブロックした/された一覧
router.get('/friends-blocked', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('friends')
      .select('id, display_name, picture_url, status, updated_at')
      .in('status', ['blocked', 'unfollowed'])
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    console.error('GET /friends-blocked error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /friends/:id/tags - Update friend's tags (replace all)
router.put('/friends/:id/tags', async (req, res) => {
  try {
    const { id } = req.params;
    const { tag_ids } = req.body; // array of tag IDs

    if (!Array.isArray(tag_ids)) {
      return res.status(400).json({ error: 'tag_ids must be an array' });
    }

    // Verify friend exists
    const { data: friend, error: friendError } = await supabase
      .from('friends')
      .select('id')
      .eq('id', id)
      .single();

    if (friendError) {
      if (friendError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Friend not found' });
      }
      return res.status(500).json({ error: friendError.message });
    }

    // Delete existing friend_tags for this friend
    const { error: deleteError } = await supabase
      .from('friend_tags')
      .delete()
      .eq('friend_id', id);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    // Insert new friend_tags
    if (tag_ids.length > 0) {
      const rows = tag_ids.map((tag_id) => ({ friend_id: id, tag_id }));
      const { error: insertError } = await supabase
        .from('friend_tags')
        .insert(rows);

      if (insertError) {
        return res.status(500).json({ error: insertError.message });
      }

      // タグ遅延配信キューに登録
      for (const tag_id of tag_ids) {
        enqueueTagDelivery(id, tag_id).catch(() => {});
      }
    }

    // Return updated tags
    const { data: ftRows } = await supabase
      .from('friend_tags')
      .select('tags(*)')
      .eq('friend_id', id);

    const tags = ftRows ? ftRows.filter((r) => r.tags).map((r) => r.tags) : [];

    return res.json({ ok: true, tags });
  } catch (err) {
    console.error('PUT /friends/:id/tags error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Tags
// ===========================================================================

// GET /tags - List all tags
router.get('/tags', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tags')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('GET /tags error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /tags - Create tag
router.post('/tags', async (req, res) => {
  try {
    const { name, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { data, error } = await supabase
      .from('tags')
      .insert({ name, color: color || null })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /tags error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /tags/:id - Delete tag
router.delete('/tags/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Remove related friend_tags first
    await supabase.from('friend_tags').delete().eq('tag_id', id);

    const { error } = await supabase.from('tags').delete().eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /tags/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Chat Messages
// ===========================================================================

// GET /chat-threads - List all chats with their latest message
router.get('/chat-threads', async (req, res) => {
  try {
    const { search } = req.query;

    // 直近のメッセージ500件を取得し、friend_idごとに最新1件にまとめる
    const { data: msgs, error: msgErr } = await supabase
      .from('chat_messages')
      .select('friend_id, content, direction, message_type, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (msgErr) {
      return res.status(500).json({ error: msgErr.message });
    }

    const latestByFriend = new Map();
    for (const m of msgs || []) {
      if (!latestByFriend.has(m.friend_id)) {
        latestByFriend.set(m.friend_id, m);
      }
    }

    const friendIds = Array.from(latestByFriend.keys());
    if (friendIds.length === 0) {
      return res.json([]);
    }

    let friendQuery = supabase
      .from('friends')
      .select('id, line_user_id, display_name, picture_url, status, unread_count')
      .in('id', friendIds);

    if (search) {
      friendQuery = friendQuery.ilike('display_name', `%${search}%`);
    }

    const { data: friends, error: friendErr } = await friendQuery;
    if (friendErr) {
      return res.status(500).json({ error: friendErr.message });
    }

    const threads = (friends || [])
      .map((f) => {
        const last = latestByFriend.get(f.id);
        const normalizedLast = last
          ? {
              friend_id: last.friend_id,
              content: extractTextFromContent(last.content),
              direction: normalizeDirection(last.direction),
              message_type: last.message_type,
              created_at: last.created_at,
            }
          : null;
        return {
          friend: f,
          last_message: normalizedLast,
        };
      })
      .sort((a, b) => {
        const at = a.last_message?.created_at || '';
        const bt = b.last_message?.created_at || '';
        return bt.localeCompare(at);
      });

    return res.json(threads);
  } catch (err) {
    console.error('GET /chat-threads error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Normalize a chat_messages row into the shape the frontend expects
function describeLineMessage(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  if (typeof m.text === 'string') return m.text;
  if (m.type === 'template' && m.template) {
    const t = m.template;
    if (t.type === 'buttons') {
      const lines = [];
      if (t.title) lines.push(t.title);
      if (t.text) lines.push(t.text);
      if (Array.isArray(t.actions) && t.actions.length > 0) {
        const btns = t.actions
          .map((a) => a.label || a.displayText || '')
          .filter(Boolean)
          .map((l) => `［${l}］`)
          .join(' ');
        if (btns) lines.push(btns);
      }
      return lines.join('\n');
    }
    if (t.type === 'carousel' && Array.isArray(t.columns)) {
      return t.columns
        .map((col) => {
          const parts = [];
          if (col.title) parts.push(col.title);
          if (col.text) parts.push(col.text);
          return parts.join(' / ');
        })
        .filter(Boolean)
        .join('\n―――\n');
    }
    if (t.type === 'confirm') {
      return t.text || '';
    }
    return m.altText || '';
  }
  if (m.type === 'image') return '[画像]';
  if (m.type === 'sticker') return '[スタンプ]';
  if (m.type === 'video') return '[動画]';
  if (m.type === 'audio') return '[音声]';
  if (m.type === 'location') return `[位置情報] ${m.title || ''}`;
  if (m.type === 'flex') return m.altText || '[Flex Message]';
  return m.altText || `[${m.type || 'message'}]`;
}

function describePostback(data, content) {
  if (typeof data !== 'string') return '';
  try {
    const params = new URLSearchParams(data);
    const action = params.get('action');
    if (action === 'send_template') {
      // displayTextがあればそれを表示（ユーザーが押したボタンのテキスト）
      if (content && content.displayText) return content.displayText;
      const templateId = params.get('template_id');
      if (templateId) return `テンプレート選択 (${templateId.slice(0, 8)}...)`;
      return 'テンプレート選択';
    }
    if (action) {
      return `操作: ${action}`;
    }
  } catch {
    // fall through
  }
  return data;
}

function extractTextFromContent(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (typeof c !== 'object') return String(c);
  // direct fields
  if (typeof c.text === 'string') return c.text;
  if (typeof c.message === 'string') return c.message;
  // messages array (LINE outbound format)
  if (Array.isArray(c.messages) && c.messages.length > 0) {
    const parts = c.messages.map(describeLineMessage);
    return parts.filter(Boolean).join('\n');
  }
  // postback (inbound)
  if (typeof c.data === 'string') return describePostback(c.data, c);
  return '';
}

function normalizeDirection(d) {
  if (d === 'inbound' || d === 'incoming') return 'incoming';
  if (d === 'outbound' || d === 'outgoing') return 'outgoing';
  return d;
}

function normalizeChatMessage(row) {
  if (!row) return row;
  // content はオブジェクトのまま保持（messages配列内の画像等を維持するため）
  // extractTextFromContent はチャットスレッド一覧のプレビュー用のみ使用
  const rawContent = row.content;
  let content = rawContent;
  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (rawContent && typeof rawContent === 'object') {
    // messages配列がある場合はオブジェクトのまま返す（ChatViewで画像等を表示するため）
    if (Array.isArray(rawContent.messages) || rawContent.url || rawContent.originalContentUrl) {
      content = rawContent;
    } else if (typeof rawContent.text === 'string') {
      content = rawContent;
    } else if (typeof rawContent.data === 'string') {
      content = rawContent;
    } else {
      content = rawContent;
    }
  }
  return {
    id: row.id,
    friend_id: row.friend_id,
    direction: normalizeDirection(row.direction),
    message_type: row.message_type,
    content,
    sent_at: row.created_at,
    created_at: row.created_at,
  };
}

// GET /chat/:friendId/messages - Get chat messages for a friend
router.get('/chat/:friendId/messages', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { limit = '200', before } = req.query;
    const msgLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));

    let query = supabase
      .from('chat_messages')
      .select('*')
      .eq('friend_id', friendId)
      .order('created_at', { ascending: false })
      .limit(msgLimit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Return in chronological order, normalized for frontend
    const rows = data ? data.reverse() : [];
    return res.json(rows.map(normalizeChatMessage));
  } catch (err) {
    console.error('GET /chat/:friendId/messages error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /chat/:friendId/send - Send message (push to LINE + insert into chat_messages)
router.post('/chat/:friendId/send', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { content, message_type = 'text', direction = 'outgoing' } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    // Resolve channel_id and line_user_id from the friend
    const { data: friend, error: friendErr } = await supabase
      .from('friends')
      .select('channel_id, line_user_id')
      .eq('id', friendId)
      .maybeSingle();

    if (friendErr) {
      return res.status(500).json({ error: friendErr.message });
    }
    if (!friend) {
      return res.status(404).json({ error: 'friend not found' });
    }

    // LINE Push API でメッセージを送信
    if (friend.line_user_id && message_type === 'text') {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token) {
        const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: friend.line_user_id,
            messages: [{ type: 'text', text: content }],
          }),
        });
        if (!pushRes.ok) {
          const body = await pushRes.text().catch(() => '');
          console.error('[chat/send] LINE push failed:', pushRes.status, body);
          return res.status(502).json({ error: `LINE送信に失敗しました (${pushRes.status})` });
        }
      } else {
        console.warn('[chat/send] LINE_CHANNEL_ACCESS_TOKEN が未設定のため LINE に送信できません');
      }
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        channel_id: friend.channel_id,
        friend_id: friendId,
        content: { text: content, source: 'crm_ui' },
        message_type,
        direction,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // チャットナレッジを非同期更新（レスポンスは待たない）
    updateFriendChatSummary(friendId, friend.channel_id).catch(err =>
      console.error('[chat/send] summary update error:', err.message));

    return res.status(201).json(normalizeChatMessage(data));
  } catch (err) {
    console.error('POST /chat/:friendId/send error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /chat/:friendId/send-media - Send image/video (push to LINE + insert into chat_messages)
router.post('/chat/:friendId/send-media', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { url, type = 'image', previewUrl } = req.body;
    // type: 'image' or 'video'
    // url: public URL of the media
    // previewUrl: optional preview/thumbnail URL (defaults to url for images)

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const { data: friend, error: friendErr } = await supabase
      .from('friends')
      .select('channel_id, line_user_id')
      .eq('id', friendId)
      .maybeSingle();

    if (friendErr) return res.status(500).json({ error: friendErr.message });
    if (!friend) return res.status(404).json({ error: 'friend not found' });

    // LINE Push API でメディアを送信
    if (friend.line_user_id) {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token) {
        let lineMessage;
        if (type === 'video') {
          lineMessage = {
            type: 'video',
            originalContentUrl: url,
            previewImageUrl: previewUrl || url,
          };
        } else {
          lineMessage = {
            type: 'image',
            originalContentUrl: url,
            previewImageUrl: previewUrl || url,
          };
        }

        const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: friend.line_user_id,
            messages: [lineMessage],
          }),
        });
        if (!pushRes.ok) {
          const body = await pushRes.text().catch(() => '');
          console.error('[chat/send-media] LINE push failed:', pushRes.status, body);
          return res.status(502).json({ error: `LINE送信に失敗しました (${pushRes.status})` });
        }
      } else {
        console.warn('[chat/send-media] LINE_CHANNEL_ACCESS_TOKEN が未設定');
      }
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        channel_id: friend.channel_id,
        friend_id: friendId,
        content: { url, previewUrl: previewUrl || url, type, source: 'crm_ui' },
        message_type: type,
        direction: 'outgoing',
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json(normalizeChatMessage(data));
  } catch (err) {
    console.error('POST /chat/:friendId/send-media error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /chat/upload - Upload media file and get a public URL
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/chat/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const file = req.file;
    const ext = file.originalname.split('.').pop() || 'jpg';
    const fileName = `chat-media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('[chat/upload] storage error:', uploadError.message);
      return res.status(500).json({ error: uploadError.message });
    }

    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(fileName);

    const isVideo = file.mimetype.startsWith('video/');
    return res.json({
      url: urlData.publicUrl,
      type: isVideo ? 'video' : 'image',
      fileName: file.originalname,
    });
  } catch (err) {
    console.error('[chat/upload] error:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// ===========================================================================
// Tag Scheduled Replies（タグベース遅延自動返信）
// タグが付与された友だちに、指定時間後にメッセージを自動送信
// テーブル: tag_scheduled_replies
//   id, tag_id, delay_hours, response_messages (jsonb), is_active, name, created_at
// テーブル: tag_scheduled_logs
//   id, rule_id, friend_id, scheduled_at, sent_at, status
// ===========================================================================

router.get('/tag-scheduled-replies', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tag_scheduled_replies')
      .select('*, tags(id, name, color)')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/tag-scheduled-replies', async (req, res) => {
  try {
    const { tag_id, delay_hours, response_messages, name } = req.body;
    if (!tag_id || !delay_hours || !response_messages) {
      return res.status(400).json({ error: 'tag_id, delay_hours, response_messages are required' });
    }
    const { data, error } = await supabase
      .from('tag_scheduled_replies')
      .insert({ tag_id, delay_hours, response_messages, name: name || '', is_active: true })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/tag-scheduled-replies/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tag_scheduled_replies')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/tag-scheduled-replies/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('tag_scheduled_replies')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/tag-scheduled-replies/:id/toggle', async (req, res) => {
  try {
    const { is_active } = req.body;
    const { data, error } = await supabase
      .from('tag_scheduled_replies')
      .update({ is_active })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// タグ遅延配信 - キューベース新システム
// テーブル: tag_delivery_queue
//   id, rule_id, friend_id, tag_id, scheduled_for, status, sent_at, error_message, created_at
//   UNIQUE(rule_id, friend_id) で重複防止
// ===========================================================================

// ヘルパー: タグ付与時にキューへ登録
async function enqueueTagDelivery(friendId, tagId) {
  try {
    const { data: rules } = await supabase
      .from('tag_scheduled_replies')
      .select('id, delay_hours')
      .eq('tag_id', tagId)
      .eq('is_active', true);

    if (!rules || rules.length === 0) return;

    for (const rule of rules) {
      const scheduledFor = new Date(Date.now() + rule.delay_hours * 60 * 60 * 1000).toISOString();
      await supabase.from('tag_delivery_queue').upsert({
        rule_id: rule.id,
        friend_id: friendId,
        tag_id: tagId,
        scheduled_for: scheduledFor,
        status: 'pending',
      }, { onConflict: 'rule_id,friend_id', ignoreDuplicates: true });
    }
  } catch (err) {
    console.error('[enqueueTagDelivery] error:', err.message);
  }
}

// ヘルパー: processの本体（cronとwebhookの両方から呼ばれる）
async function processTagDeliveryQueue(limit = 50) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { processed: 0, message: 'No LINE token' };

  // キューからpending & 配信時刻到達のアイテムを取得
  const { data: items, error: qErr } = await supabase
    .from('tag_delivery_queue')
    .select('id, rule_id, friend_id')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (qErr || !items || items.length === 0) {
    return { processed: 0 };
  }

  // ルール情報を一括取得
  const ruleIds = [...new Set(items.map(i => i.rule_id))];
  const { data: rules } = await supabase
    .from('tag_scheduled_replies')
    .select('id, response_messages, name, is_active')
    .in('id', ruleIds);
  const ruleMap = Object.fromEntries((rules || []).map(r => [r.id, r]));

  // 友だち情報を一括取得
  const friendIds = [...new Set(items.map(i => i.friend_id))];
  const { data: friends } = await supabase
    .from('friends')
    .select('id, line_user_id, display_name, channel_id, status')
    .in('id', friendIds);
  const friendMap = Object.fromEntries((friends || []).map(f => [f.id, f]));

  // statusを 'sending' に更新（ロック）
  const itemIds = items.map(i => i.id);
  await supabase.from('tag_delivery_queue').update({ status: 'sending' }).in('id', itemIds);

  let processed = 0;
  const results = [];

  for (const item of items) {
    const rule = ruleMap[item.rule_id];
    const friend = friendMap[item.friend_id];

    // ルール無効 or 友だち情報なし → failed
    if (!rule || !rule.is_active || !friend || !friend.line_user_id || friend.status !== 'active') {
      await supabase.from('tag_delivery_queue').update({
        status: 'failed',
        error_message: !rule ? 'Rule not found' : !rule.is_active ? 'Rule disabled' : 'Friend inactive or no LINE ID',
      }).eq('id', item.id);
      continue;
    }

    const messages = Array.isArray(rule.response_messages) ? rule.response_messages : [];
    if (messages.length === 0) {
      await supabase.from('tag_delivery_queue').update({ status: 'failed', error_message: 'No messages configured' }).eq('id', item.id);
      continue;
    }

    try {
      const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: friend.line_user_id, messages: messages.slice(0, 5) }),
      });

      if (!pushRes.ok) {
        const errBody = await pushRes.text().catch(() => '');
        console.error(`[tag-delivery] Push failed for ${friend.display_name}: ${pushRes.status} ${errBody}`);
        await supabase.from('tag_delivery_queue').update({ status: 'failed', error_message: `LINE API ${pushRes.status}: ${errBody.slice(0, 200)}` }).eq('id', item.id);
        results.push({ friend: friend.display_name, status: 'error' });
        continue;
      }

      // 成功
      await supabase.from('tag_delivery_queue').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.id);

      // チャットログに記録
      if (friend.channel_id) {
        const textParts = messages.filter(m => m.type === 'text' && m.text).map(m => m.text);
        await supabase.from('chat_messages').insert({
          channel_id: friend.channel_id,
          friend_id: friend.id,
          direction: 'outgoing',
          message_type: 'text',
          content: { messages, text: textParts.join('\n'), source: 'tag_scheduled_reply', rule_id: item.rule_id },
        });
      }

      console.log(`[tag-delivery] Sent to ${friend.display_name} (rule: ${rule.name})`);
      processed++;
      results.push({ friend: friend.display_name, status: 'sent' });
    } catch (err) {
      console.error(`[tag-delivery] Error for ${friend.display_name}:`, err.message);
      await supabase.from('tag_delivery_queue').update({ status: 'pending', error_message: err.message }).eq('id', item.id);
      results.push({ friend: friend.display_name, status: 'retry' });
    }
  }

  return { processed, total: items.length, results };
}

// GET /tag-scheduled-replies/process - キュー処理（cronから呼ばれる）
router.get('/tag-scheduled-replies/process', async (req, res) => {
  try {
    const result = await processTagDeliveryQueue(50);
    return res.json(result);
  } catch (err) {
    console.error('[tag-scheduled-replies/process] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /tag-scheduled-replies/pending - 配信予定の友だち一覧（キューから直接取得）
router.get('/tag-scheduled-replies/pending', async (req, res) => {
  try {
    const { data: queueItems } = await supabase
      .from('tag_delivery_queue')
      .select('id, rule_id, friend_id, tag_id, scheduled_for, status, created_at')
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(200);

    if (!queueItems || queueItems.length === 0) return res.json([]);

    // ルール情報
    const ruleIds = [...new Set(queueItems.map(i => i.rule_id))];
    const { data: rules } = await supabase
      .from('tag_scheduled_replies')
      .select('id, name, delay_hours, tags(id, name, color)')
      .in('id', ruleIds);
    const ruleMap = Object.fromEntries((rules || []).map(r => [r.id, r]));

    // 友だち情報
    const friendIds = [...new Set(queueItems.map(i => i.friend_id))];
    const { data: friends } = await supabase
      .from('friends')
      .select('id, display_name, picture_url')
      .in('id', friendIds);
    const friendMap = Object.fromEntries((friends || []).map(f => [f.id, f]));

    const pending = queueItems.map(item => {
      const rule = ruleMap[item.rule_id];
      const friend = friendMap[item.friend_id];
      if (!rule || !friend) return null;
      return {
        rule_id: item.rule_id,
        rule_name: rule.name,
        tag_name: rule.tags?.name || '',
        tag_color: rule.tags?.color || '#06C755',
        delay_hours: rule.delay_hours,
        friend_id: item.friend_id,
        friend_name: friend.display_name,
        friend_picture: friend.picture_url || null,
        tagged_at: item.created_at,
        scheduled_send_at: item.scheduled_for,
        is_overdue: new Date(item.scheduled_for) <= new Date(),
      };
    }).filter(Boolean);

    return res.json(pending);
  } catch (err) {
    console.error('[tag-scheduled-replies/pending] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// Friends Analytics (友だち増減)
// ===========================================================================

// GET /friends-analytics - 日別の友だち増減データ
router.get('/friends-analytics', async (req, res) => {
  try {
    const { days = '30' } = req.query;
    const numDays = Math.min(Math.max(parseInt(days, 10) || 30, 7), 365);
    const since = new Date(Date.now() - numDays * 24 * 60 * 60 * 1000).toISOString();

    // 日別の新規フォロー数
    const { data: follows } = await supabase
      .from('friends')
      .select('followed_at')
      .gte('followed_at', since)
      .not('followed_at', 'is', null);

    // 日別のブロック/解除数
    const { data: unfollows } = await supabase
      .from('friends')
      .select('unfollowed_at')
      .gte('unfollowed_at', since)
      .not('unfollowed_at', 'is', null);

    // 全体の統計
    const { count: totalFriends } = await supabase
      .from('friends')
      .select('id', { count: 'exact', head: true });
    const { count: activeFriends } = await supabase
      .from('friends')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    const { count: unfollowedFriends } = await supabase
      .from('friends')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'unfollowed');

    // 日別に集計
    const dailyMap = {};
    for (let i = 0; i < numDays; i++) {
      const d = new Date(Date.now() - (numDays - 1 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { date: key, added: 0, removed: 0 };
    }

    for (const f of (follows || [])) {
      const key = new Date(f.followed_at).toISOString().slice(0, 10);
      if (dailyMap[key]) dailyMap[key].added++;
    }
    for (const u of (unfollows || [])) {
      const key = new Date(u.unfollowed_at).toISOString().slice(0, 10);
      if (dailyMap[key]) dailyMap[key].removed++;
    }

    const daily = Object.values(dailyMap);

    // 累計を計算（期間開始時点のactive数を基準に）
    const addedInPeriod = daily.reduce((s, d) => s + d.added, 0);
    const removedInPeriod = daily.reduce((s, d) => s + d.removed, 0);
    const startCount = (activeFriends || 0) - addedInPeriod + removedInPeriod;

    let cumulative = startCount;
    for (const d of daily) {
      cumulative += d.added - d.removed;
      d.cumulative = cumulative;
    }

    return res.json({
      summary: {
        total: totalFriends || 0,
        active: activeFriends || 0,
        unfollowed: unfollowedFriends || 0,
        addedInPeriod,
        removedInPeriod,
        netChange: addedInPeriod - removedInPeriod,
      },
      daily,
    });
  } catch (err) {
    console.error('GET /friends-analytics error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Auto-Responses
// ===========================================================================

// GET /auto-responses - List auto-responses
router.get('/auto-responses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('auto_responses')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('GET /auto-responses error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auto-responses - Create auto-response
router.post('/auto-responses', async (req, res) => {
  try {
    const {
      name,
      keywords,
      response_messages,
      match_type = 'exact',
      is_active = true,
      priority = 100,
      folder = null,
      tag_actions = [],
    } = req.body;

    if (!name || !Array.isArray(keywords) || keywords.length === 0 || !Array.isArray(response_messages) || response_messages.length === 0) {
      return res
        .status(400)
        .json({ error: 'name, keywords(1件以上), response_messages(1件以上) は必須です' });
    }

    const { data, error } = await supabase
      .from('auto_responses')
      .insert({
        channel_id: DEFAULT_CHANNEL_ID,
        name,
        keywords,
        response_messages,
        match_type,
        is_active,
        priority,
        folder: folder || null,
        tag_actions: Array.isArray(tag_actions) ? tag_actions : [],
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /auto-responses error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /auto-responses/:id - Update auto-response
router.put('/auto-responses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, keywords, response_messages, match_type, is_active, priority, folder, tag_actions } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (keywords !== undefined) updates.keywords = keywords;
    if (response_messages !== undefined) updates.response_messages = response_messages;
    if (match_type !== undefined) updates.match_type = match_type;
    if (is_active !== undefined) updates.is_active = is_active;
    if (priority !== undefined) updates.priority = priority;
    if (folder !== undefined) updates.folder = folder || null;
    if (tag_actions !== undefined) updates.tag_actions = Array.isArray(tag_actions) ? tag_actions : [];

    const { data, error } = await supabase
      .from('auto_responses')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Auto-response not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('PUT /auto-responses/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /auto-responses/:id - Delete auto-response
router.delete('/auto-responses/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('auto_responses')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /auto-responses/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /auto-responses/:id/toggle - Toggle active status
router.patch('/auto-responses/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch current state
    const { data: existing, error: fetchError } = await supabase
      .from('auto_responses')
      .select('is_active')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Auto-response not found' });
      }
      return res.status(500).json({ error: fetchError.message });
    }

    const { data, error } = await supabase
      .from('auto_responses')
      .update({
        is_active: !existing.is_active,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('PATCH /auto-responses/:id/toggle error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Broadcasts
// ===========================================================================

// GET /broadcasts - List broadcasts
router.get('/broadcasts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('broadcasts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('GET /broadcasts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /broadcasts - Create broadcast
router.post('/broadcasts', async (req, res) => {
  try {
    const { name, message_content, messages: customMessages, scheduled_at, target_tags, target_filters } = req.body;

    if (!name || (!message_content && (!customMessages || customMessages.length === 0))) {
      return res
        .status(400)
        .json({ error: 'name and message_content or messages are required' });
    }

    const finalMessages = Array.isArray(customMessages) && customMessages.length > 0
      ? customMessages
      : [{ type: 'text', text: message_content }];

    // channel_idを取得（最初のチャンネルを使用）
    const { data: channel } = await supabase
      .from('friends')
      .select('channel_id')
      .not('channel_id', 'is', null)
      .limit(1)
      .single();

    const { data, error } = await supabase
      .from('broadcasts')
      .insert({
        name,
        channel_id: channel?.channel_id || '00000000-0000-0000-0000-000000000010',
        message_content: message_content || '',
        messages: finalMessages,
        scheduled_at: scheduled_at || null,
        target_tags: target_tags || null,
        target_filters: target_filters || null,
        status: scheduled_at ? 'scheduled' : 'draft',
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /broadcasts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /broadcasts/:id/send - Actually send broadcast to LINE
router.post('/broadcasts/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN未設定' });

    // 配信データを取得
    const { data: bc, error: bcErr } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('id', id)
      .single();
    if (bcErr || !bc) return res.status(404).json({ error: 'Broadcast not found' });
    if (bc.status === 'sent' || bc.status === 'sending') return res.status(400).json({ error: '既に送信済みです' });

    // ステータスを sending に変更
    await supabase.from('broadcasts').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', id);

    // 対象の友だちを取得
    let friendQuery = supabase.from('friends').select('id, line_user_id, display_name, channel_id, created_at').eq('status', 'active');

    // 高機能フィルター (target_filters)
    const filters = bc.target_filters || {};

    // 登録日フィルター
    if (filters.registered_from) {
      friendQuery = friendQuery.gte('created_at', filters.registered_from);
    }
    if (filters.registered_to) {
      friendQuery = friendQuery.lte('created_at', filters.registered_to + 'T23:59:59.999Z');
    }

    // タグ絞り込み（include: 含むタグ / exclude: 除外タグ）
    const includeTags = filters.include_tags || bc.target_tags || [];
    const excludeTags = filters.exclude_tags || [];
    const tagLogic = filters.tag_logic || 'or'; // 'and' | 'or'

    let includeIds = null;
    if (includeTags.length > 0) {
      const { data: taggedFriends } = await supabase
        .from('friend_tags')
        .select('friend_id, tag_id')
        .in('tag_id', includeTags);

      if (tagLogic === 'and') {
        // AND: 全てのタグを持つ友だちのみ
        const countMap = {};
        for (const ft of (taggedFriends || [])) {
          countMap[ft.friend_id] = (countMap[ft.friend_id] || 0) + 1;
        }
        includeIds = Object.entries(countMap)
          .filter(([, count]) => count >= includeTags.length)
          .map(([id]) => id);
      } else {
        // OR: いずれかのタグを持つ友だち
        includeIds = [...new Set((taggedFriends || []).map(ft => ft.friend_id))];
      }

      if (includeIds.length === 0) {
        await supabase.from('broadcasts').update({ status: 'sent', sent_at: new Date().toISOString(), sent_count: 0, total_recipients: 0, success_count: 0, failure_count: 0 }).eq('id', id);
        return res.json({ ok: true, sent_count: 0 });
      }
      friendQuery = friendQuery.in('id', includeIds);
    }

    // 除外タグ
    let excludeIds = new Set();
    if (excludeTags.length > 0) {
      const { data: excludedFriends } = await supabase
        .from('friend_tags')
        .select('friend_id')
        .in('tag_id', excludeTags);
      excludeIds = new Set((excludedFriends || []).map(ft => ft.friend_id));
    }

    const { data: rawFriends } = await friendQuery;
    const friends = excludeIds.size > 0
      ? (rawFriends || []).filter(f => !excludeIds.has(f.id))
      : (rawFriends || []);
    if (!friends || friends.length === 0) {
      await supabase.from('broadcasts').update({ status: 'sent', sent_at: new Date().toISOString(), sent_count: 0, total_recipients: 0, success_count: 0, failure_count: 0 }).eq('id', id);
      return res.json({ ok: true, sent_count: 0 });
    }

    // メッセージ
    const messages = bc.message_content ? [{ type: 'text', text: bc.message_content }] : (Array.isArray(bc.messages) ? bc.messages : []);
    if (messages.length === 0) {
      await supabase.from('broadcasts').update({ status: 'failed' }).eq('id', id);
      return res.status(400).json({ error: 'メッセージが空です' });
    }

    let successCount = 0;
    let failureCount = 0;

    // 1件ずつ push 送信
    for (const friend of friends) {
      if (!friend.line_user_id) { failureCount++; continue; }
      try {
        const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ to: friend.line_user_id, messages: messages.slice(0, 5) }),
        });
        if (pushRes.ok) {
          successCount++;
          // チャットログに記録
          if (friend.channel_id) {
            await supabase.from('chat_messages').insert({
              channel_id: friend.channel_id,
              friend_id: friend.id,
              direction: 'outgoing',
              message_type: 'text',
              content: { messages, text: bc.message_content || '', source: 'broadcast', broadcast_id: id },
            });
          }
        } else {
          failureCount++;
        }
      } catch {
        failureCount++;
      }
    }

    await supabase.from('broadcasts').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_count: successCount,
      total_recipients: friends.length,
      success_count: successCount,
      failure_count: failureCount,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    return res.json({ ok: true, sent_count: successCount, total: friends.length });
  } catch (err) {
    console.error('POST /broadcasts/:id/send error:', err);
    await supabase.from('broadcasts').update({ status: 'failed' }).eq('id', id).catch(() => {});
    return res.status(500).json({ error: err.message });
  }
});

// POST /broadcasts/preview-count - フィルター条件での対象人数を取得
router.post('/broadcasts/preview-count', async (req, res) => {
  try {
    const { include_tags, exclude_tags, tag_logic, registered_from, registered_to } = req.body;

    let query = supabase.from('friends').select('id', { count: 'exact', head: true }).eq('status', 'active');

    if (registered_from) query = query.gte('created_at', registered_from);
    if (registered_to) query = query.lte('created_at', registered_to + 'T23:59:59.999Z');

    // タグ含む
    if (include_tags && include_tags.length > 0) {
      const { data: taggedFriends } = await supabase
        .from('friend_tags')
        .select('friend_id, tag_id')
        .in('tag_id', include_tags);

      let includeIds;
      if (tag_logic === 'and') {
        const countMap = {};
        for (const ft of (taggedFriends || [])) {
          countMap[ft.friend_id] = (countMap[ft.friend_id] || 0) + 1;
        }
        includeIds = Object.entries(countMap)
          .filter(([, count]) => count >= include_tags.length)
          .map(([id]) => id);
      } else {
        includeIds = [...new Set((taggedFriends || []).map(ft => ft.friend_id))];
      }

      if (includeIds.length === 0) return res.json({ count: 0 });
      query = query.in('id', includeIds);
    }

    const { count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let finalCount = count || 0;

    // 除外タグ
    if (exclude_tags && exclude_tags.length > 0 && finalCount > 0) {
      const { data: excludedFriends } = await supabase
        .from('friend_tags')
        .select('friend_id')
        .in('tag_id', exclude_tags);
      const excludeSet = new Set((excludedFriends || []).map(ft => ft.friend_id));
      // 正確なカウントのため再取得
      const { data: allIds } = await supabase.from('friends').select('id').eq('status', 'active')
        .gte('created_at', registered_from || '1970-01-01')
        .lte('created_at', (registered_to || '2099-12-31') + 'T23:59:59.999Z');
      finalCount = (allIds || []).filter(f => !excludeSet.has(f.id)).length;
    }

    return res.json({ count: finalCount });
  } catch (err) {
    console.error('POST /broadcasts/preview-count error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /broadcasts/cron - 予約配信を実行
router.get('/broadcasts/cron', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: scheduled } = await supabase
      .from('broadcasts')
      .select('id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', now);

    if (!scheduled || scheduled.length === 0) {
      return res.json({ processed: 0 });
    }

    const results = [];
    const base = `${req.protocol}://${req.get('host')}`;
    for (const bc of scheduled) {
      try {
        const sendRes = await fetch(`${base}/api/line-crm/broadcasts/${bc.id}/send`, { method: 'POST' });
        results.push({ id: bc.id, status: sendRes.ok ? 'sent' : 'error' });
      } catch (err) {
        results.push({ id: bc.id, status: 'error', error: err.message });
      }
    }

    return res.json({ processed: results.length, results });
  } catch (err) {
    console.error('GET /broadcasts/cron error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// Step Sequences
// ===========================================================================

// GET /step-sequences - List step sequences
router.get('/step-sequences', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('step_sequences')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('GET /step-sequences error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// AI Settings
// ===========================================================================

// GET /ai-settings - Get AI settings
router.get('/ai-settings', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ai_settings')
      .select('*')
      .limit(1)
      .single();

    if (error) {
      // If no settings exist yet, return defaults
      if (error.code === 'PGRST116') {
        return res.json({
          enabled: false,
          is_active: false,
          model: 'claude-sonnet-4-5',
          system_prompt: '',
          system_instructions: '',
          persona: '',
          temperature: 0.7,
        });
      }
      return res.status(500).json({ error: error.message });
    }

    // フロントエンド互換フィールドを付与
    return res.json({
      ...data,
      enabled: data.enabled ?? data.auto_reply_enabled ?? false,
      is_active: data.enabled ?? data.auto_reply_enabled ?? false,
      system_instructions: data.system_instructions || data.system_prompt || '',
      system_prompt: data.system_prompt || data.system_instructions || '',
      persona: data.persona ?? '',
      model: data.model || 'claude-sonnet-4-5',
      temperature: data.temperature ?? 0.7,
    });
  } catch (err) {
    console.error('GET /ai-settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /ai-settings - Update AI settings (upsert)
router.put('/ai-settings', async (req, res) => {
  try {
    const {
      enabled,
      is_active,
      model,
      system_prompt,
      system_instructions,
      persona,
      temperature,
      max_tokens,
      api_key,
    } = req.body;

    // Try to get existing settings
    const { data: existing } = await supabase
      .from('ai_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    const payload = {};
    // フロントエンドは is_active / persona / system_instructions を送信するため両方受け入れる
    if (enabled !== undefined) { payload.enabled = enabled; payload.auto_reply_enabled = enabled; }
    if (is_active !== undefined) { payload.enabled = is_active; payload.auto_reply_enabled = is_active; }
    if (model !== undefined) payload.model = model;
    if (system_prompt !== undefined) { payload.system_prompt = system_prompt; payload.system_instructions = system_prompt; }
    if (system_instructions !== undefined) { payload.system_prompt = system_instructions; payload.system_instructions = system_instructions; }
    if (persona !== undefined) payload.persona = persona;
    if (temperature !== undefined) payload.temperature = temperature;
    if (max_tokens !== undefined) payload.max_tokens = max_tokens;
    payload.updated_at = new Date().toISOString();

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('ai_settings')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      result = data;
    } else {
      const { data, error } = await supabase
        .from('ai_settings')
        .insert(payload)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      result = data;
    }

    return res.json(result);
  } catch (err) {
    console.error('PUT /ai-settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Knowledge Base
// ===========================================================================

// GET /knowledge-base - List knowledge base entries
router.get('/knowledge-base', async (req, res) => {
  try {
    const { search, category } = req.query;

    let query = supabase
      .from('knowledge_base')
      .select('*')
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(
        `title.ilike.%${search}%,content.ilike.%${search}%`
      );
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('GET /knowledge-base error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /knowledge-base - Create entry
router.post('/knowledge-base', async (req, res) => {
  try {
    const { title, content, category } = req.body;

    if (!title || !content) {
      return res
        .status(400)
        .json({ error: 'title and content are required' });
    }

    const { data, error } = await supabase
      .from('knowledge_base')
      .insert({ title, content, category: category || null })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /knowledge-base error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /knowledge-base/:id - Update entry
router.put('/knowledge-base/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (category !== undefined) updates.category = category;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('knowledge_base')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Knowledge base entry not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('PUT /knowledge-base/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /knowledge-base/:id - Delete entry
router.delete('/knowledge-base/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /knowledge-base/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Greeting Settings (友だち追加時の挨拶メッセージ)
// ===========================================================================

// GET /bot-info - LINE Bot情報を取得
router.get('/bot-info', async (_req, res) => {
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN未設定' });

    const resp = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: 'LINE API error' });
    const info = await resp.json();
    return res.json(info);
  } catch (err) {
    console.error('GET /bot-info error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /greeting-settings
router.get('/greeting-settings', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('line_channels')
      .select('id, display_name, greeting_template_id, greeting_enabled')
      .limit(1)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || null);
  } catch (err) {
    console.error('GET /greeting-settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /greeting-settings
router.put('/greeting-settings', async (req, res) => {
  try {
    const { greeting_template_id, greeting_enabled } = req.body || {};
    const updates = {};
    if (greeting_template_id !== undefined) updates.greeting_template_id = greeting_template_id || null;
    if (greeting_enabled !== undefined) updates.greeting_enabled = !!greeting_enabled;

    // 先頭のチャンネルを取得して更新（1チャンネル運用想定）
    const { data: channel, error: fetchErr } = await supabase
      .from('line_channels')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (fetchErr || !channel) return res.status(404).json({ error: 'チャンネルが見つかりません' });

    const { data, error } = await supabase
      .from('line_channels')
      .update(updates)
      .eq('id', channel.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.error('PUT /greeting-settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Rich Menus (エルメ風 リッチメニュー管理)
// ===========================================================================
const LINE_API = 'https://api.line.me';
const LINE_DATA_API = 'https://api-data.line.me';

function lineAuth() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  return { Authorization: `Bearer ${token}` };
}

// GET /rich-menus
router.get('/rich-menus', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('rich_menus')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    console.error('GET /rich-menus error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rich-menus (image_url 付きで保存のみ。LINE公開は /activate で)
router.post('/rich-menus', async (req, res) => {
  try {
    const { name, chat_bar_text, size_width, size_height, areas, image_url } = req.body || {};
    if (!name || !size_width || !size_height || !Array.isArray(areas) || areas.length === 0) {
      return res.status(400).json({ error: 'name, size, areas(1件以上) は必須です' });
    }
    const { data, error } = await supabase
      .from('rich_menus')
      .insert({
        channel_id: DEFAULT_CHANNEL_ID,
        name,
        chat_bar_text: chat_bar_text || 'メニュー',
        size_width,
        size_height,
        areas,
        image_url: image_url || null,
        is_default: false,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /rich-menus error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /rich-menus/:id
router.put('/rich-menus/:id', async (req, res) => {
  try {
    const { name, chat_bar_text, size_width, size_height, areas, image_url } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (chat_bar_text !== undefined) updates.chat_bar_text = chat_bar_text;
    if (size_width !== undefined) updates.size_width = size_width;
    if (size_height !== undefined) updates.size_height = size_height;
    if (areas !== undefined) updates.areas = areas;
    if (image_url !== undefined) updates.image_url = image_url;
    const { data, error } = await supabase
      .from('rich_menus')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.error('PUT /rich-menus/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /rich-menus/:id (LINE側も削除)
router.delete('/rich-menus/:id', async (req, res) => {
  try {
    const { data: menu } = await supabase
      .from('rich_menus')
      .select('line_rich_menu_id, is_default')
      .eq('id', req.params.id)
      .maybeSingle();

    // LINE側から削除
    if (menu?.line_rich_menu_id) {
      try {
        await axios.delete(`${LINE_API}/v2/bot/richmenu/${menu.line_rich_menu_id}`, {
          headers: lineAuth(),
        });
      } catch (err) {
        console.warn('[rich-menu delete] LINE API delete failed:', err.response?.data || err.message);
      }
    }

    const { error } = await supabase.from('rich_menus').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /rich-menus/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rich-menus/:id/activate - LINEに公開 & デフォルトに設定
router.post('/rich-menus/:id/activate', async (req, res) => {
  try {
    const { data: menu, error: fetchErr } = await supabase
      .from('rich_menus')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !menu) return res.status(404).json({ error: 'リッチメニューが見つかりません' });
    if (!menu.image_url) return res.status(400).json({ error: '画像が未設定です' });

    // 既存のline_rich_menu_idがあれば先に削除
    if (menu.line_rich_menu_id) {
      try {
        await axios.delete(`${LINE_API}/v2/bot/richmenu/${menu.line_rich_menu_id}`, {
          headers: lineAuth(),
        });
      } catch (_) { /* ignore */ }
    }

    // 1. LINEでリッチメニューを作成
    const createRes = await axios.post(
      `${LINE_API}/v2/bot/richmenu`,
      {
        size: { width: menu.size_width, height: menu.size_height },
        selected: true,
        name: menu.name,
        chatBarText: menu.chat_bar_text || 'メニュー',
        areas: menu.areas,
      },
      { headers: { ...lineAuth(), 'Content-Type': 'application/json' } },
    );
    const richMenuId = createRes.data.richMenuId;

    // 2. 画像をダウンロード → 必要なら1MB以下に圧縮してLINEにアップロード
    const imgRes = await axios.get(menu.image_url, { responseType: 'arraybuffer' });
    let imgBuffer = Buffer.from(imgRes.data);
    let contentType = imgRes.headers['content-type'] || 'image/jpeg';
    const MAX_BYTES = 1024 * 1024;
    const targetW = 2500;
    const targetH = menu.size_height;

    if (imgBuffer.length > MAX_BYTES || !/image\/(jpeg|png)/i.test(contentType)) {
      const sharp = require('sharp');
      let pipeline = sharp(imgBuffer).resize({
        width: targetW,
        height: targetH,
        fit: 'cover',
        position: 'centre',
      });
      for (const q of [90, 85, 78, 70, 62, 55, 48, 40]) {
        const out = await pipeline.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer();
        if (out.length < MAX_BYTES) {
          imgBuffer = out;
          contentType = 'image/jpeg';
          break;
        }
        imgBuffer = out;
        contentType = 'image/jpeg';
      }
    }

    if (imgBuffer.length > MAX_BYTES) {
      return res.status(413).json({ error: `画像が1MBを超えています (${Math.round(imgBuffer.length / 1024)}KB)。もっと小さい画像を使用してください。` });
    }

    await axios.post(`${LINE_DATA_API}/v2/bot/richmenu/${richMenuId}/content`, imgBuffer, {
      headers: { ...lineAuth(), 'Content-Type': contentType },
      maxBodyLength: Infinity,
    });

    // 3. デフォルトリッチメニューに設定
    await axios.post(`${LINE_API}/v2/bot/user/all/richmenu/${richMenuId}`, null, {
      headers: lineAuth(),
    });

    // 4. 他のメニューのis_defaultを解除
    await supabase
      .from('rich_menus')
      .update({ is_default: false })
      .eq('channel_id', menu.channel_id);

    // 5. このメニューを更新
    const { data: updated, error: updErr } = await supabase
      .from('rich_menus')
      .update({ line_rich_menu_id: richMenuId, is_default: true })
      .eq('id', menu.id)
      .select()
      .single();
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true, rich_menu: updated });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('POST /rich-menus/:id/activate error:', details);
    return res.status(500).json({ error: typeof details === 'string' ? details : JSON.stringify(details) });
  }
});

// ===========================================================================
// Media Upload (画像・動画・音声をSupabase Storageに保存)
// ===========================================================================
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// POST /media/upload - 単一ファイルをSupabase Storageにアップロード
router.post('/media/upload', mediaUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const path = `templates/${filename}`;
    const { error } = await supabase.storage
      .from('line-media')
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false,
      });
    if (error) return res.status(500).json({ error: error.message });
    const { data: pub } = supabase.storage.from('line-media').getPublicUrl(path);
    return res.status(201).json({
      url: pub.publicUrl,
      path,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  } catch (err) {
    console.error('POST /media/upload error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ===========================================================================
// Message Templates (エルメ風 複数メッセージテンプレート)
// ===========================================================================
const DEFAULT_CHANNEL_ID = '00000000-0000-0000-0000-000000000010';

// GET /message-templates
router.get('/message-templates', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    console.error('GET /message-templates error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /message-templates
router.post('/message-templates', async (req, res) => {
  try {
    const { name, messages, folder = null } = req.body || {};
    if (!name || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'name と messages(1件以上) は必須です' });
    }
    const { data, error } = await supabase
      .from('message_templates')
      .insert({
        channel_id: DEFAULT_CHANNEL_ID,
        name,
        type: 'multi',
        content: { messages },
        folder: folder || null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /message-templates error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /message-templates/:id
router.put('/message-templates/:id', async (req, res) => {
  try {
    const { name, messages, folder } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (Array.isArray(messages)) updates.content = { messages };
    if (folder !== undefined) updates.folder = folder || null;
    const { data, error } = await supabase
      .from('message_templates')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.error('PUT /message-templates/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /message-templates/bulk-move - 複数テンプレートを特定フォルダに一括移動
router.patch('/message-templates/bulk-move', async (req, res) => {
  try {
    const { ids, folder } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids(配列) は必須です' });
    }
    const { data, error } = await supabase
      .from('message_templates')
      .update({ folder: folder || null, updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ updated: data?.length || 0 });
  } catch (err) {
    console.error('PATCH /message-templates/bulk-move error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /message-templates/:id
router.delete('/message-templates/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /message-templates/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /message-templates/test-send - テスト配信
router.post('/message-templates/test-send', async (req, res) => {
  try {
    const { friend_id, messages } = req.body;
    if (!friend_id || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'friend_id と messages は必須です' });
    }

    const { data: friend, error: friendErr } = await supabase
      .from('friends')
      .select('line_user_id, display_name')
      .eq('id', friend_id)
      .maybeSingle();

    if (friendErr || !friend) {
      return res.status(404).json({ error: '友だちが見つかりません' });
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN が未設定です' });
    }

    const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: friend.line_user_id,
        messages: messages.slice(0, 5),
      }),
    });

    if (!pushRes.ok) {
      const body = await pushRes.text().catch(() => '');
      console.error('[test-send] LINE push failed:', pushRes.status, body);
      return res.status(502).json({ error: `LINE送信に失敗しました (${pushRes.status})` });
    }

    return res.json({ ok: true, sent_to: friend.display_name });
  } catch (err) {
    console.error('POST /message-templates/test-send error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// Knowledge Chunks (FITPEAK RAG管理)
// ===========================================================================

// GET /knowledge-chunks - List chunks
router.get('/knowledge-chunks', async (req, res) => {
  try {
    const { source, category, search, page = '1', pageSize = '20' } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, parseInt(pageSize, 10) || 20);
    const from = (currentPage - 1) * size;
    const to = from + size - 1;

    let q = supabase
      .from('knowledge_chunks')
      .select('id, source, source_id, category, title, content, metadata, created_at, updated_at', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (source) q = q.eq('source', source);
    if (category) q = q.eq('category', category);
    if (search) q = q.or(`title.ilike.%${search}%,content.ilike.%${search}%`);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      data: data || [],
      pagination: { page: currentPage, pageSize: size, total: count || 0, totalPages: Math.ceil((count || 0) / size) },
    });
  } catch (err) {
    console.error('GET /knowledge-chunks error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /knowledge-chunks/bulk - 複数のナレッジをまとめて作成（バッチ埋め込み）
router.post('/knowledge-chunks/bulk', async (req, res) => {
  try {
    const { items, category = 'manual', source = 'manual' } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items(配列) は必須です' });
    }
    const validItems = items.filter(it => it && typeof it.content === 'string' && it.content.trim());
    if (validItems.length === 0) return res.status(400).json({ error: '有効なitemsがありません' });

    const MAX = 64;
    if (validItems.length > MAX) {
      return res.status(400).json({ error: `一度に登録できるのは${MAX}件までです（${validItems.length}件指定）` });
    }

    const { embedTexts } = require('./fitpeak-rag.cjs');
    const embeddings = await embedTexts(validItems.map(it => it.content), 'document');

    const rows = validItems.map((it, idx) => {
      const sourceId = `${source}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}:${idx}`;
      return {
        source,
        source_id: sourceId,
        category: it.category || category,
        title: it.title || (it.content.slice(0, 40) + (it.content.length > 40 ? '…' : '')),
        content: it.content,
        metadata: it.metadata || {},
        embedding: embeddings[idx],
      };
    });

    const { error } = await supabase.from('knowledge_chunks').insert(rows);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ inserted: rows.length });
  } catch (err) {
    console.error('POST /knowledge-chunks/bulk error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /knowledge-chunks - Create manual chunk (embedding生成付き)
router.post('/knowledge-chunks', async (req, res) => {
  try {
    const { category = 'manual', title, content, metadata = {} } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'title と content は必須です' });

    const { embedText } = require('./fitpeak-rag.cjs');
    const embedding = await embedText(content, 'document');
    const sourceId = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabase
      .from('knowledge_chunks')
      .insert({
        source: 'manual',
        source_id: sourceId,
        category,
        title,
        content,
        metadata,
        embedding,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /knowledge-chunks error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// DELETE /knowledge-chunks/:id
router.delete('/knowledge-chunks/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('knowledge_chunks').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /knowledge-chunks/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /knowledge-chunks/search - ベクトル検索デバッグ
router.post('/knowledge-chunks/search', async (req, res) => {
  try {
    const { query, category, limit = 10 } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query は必須です' });

    const { searchKnowledge } = require('./fitpeak-rag.cjs');
    const chunks = await searchKnowledge(query, { category: category || null, limit });
    return res.json({ query, results: chunks });
  } catch (err) {
    console.error('POST /knowledge-chunks/search error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /knowledge-chunks/stats
router.get('/knowledge-chunks/stats', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('knowledge_chunks').select('source, category');
    if (error) return res.status(500).json({ error: error.message });
    const bySource = {};
    const byCategory = {};
    for (const r of data || []) {
      bySource[r.source] = (bySource[r.source] || 0) + 1;
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    }
    return res.json({ total: data?.length || 0, bySource, byCategory });
  } catch (err) {
    console.error('GET /knowledge-chunks/stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ===========================================================================
// LINE Messaging API Webhook (FITPEAK RAG)
// ===========================================================================
const crypto = require('crypto');
const { generateFITPEAKReply } = require('./fitpeak-rag.cjs');
const { postSlackThreadReply } = require('./slack-notify.cjs');
const { embedText } = require('./fitpeak-rag.cjs');

// ── Slack Events 受信（スレッド返信をお客様に転送） ──

function verifySlackSignature(rawBody, timestamp, signature) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  // 5分以上古いリクエストは拒否
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

async function pushToCustomer(lineUserId, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN未設定');
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE push failed ${res.status}`);
}

async function saveEscalationToKnowledge(escalation, staffReply) {
  try {
    const content = `質問: ${escalation.original_message}\n\n回答: ${staffReply}${escalation.reason ? `\n\n対応理由: ${escalation.reason}` : ''}`;
    const title = (escalation.reason || escalation.original_message || '').slice(0, 100);
    const embedding = await embedText(content, 'document');
    await supabase.from('knowledge_chunks').upsert({
      source: 'slack_escalation',
      source_id: escalation.id,
      category: 'message',
      title,
      content,
      metadata: {
        channel_type: escalation.channel_type,
        customer_name: escalation.customer_name,
        reason: escalation.reason,
        resolved_by: 'slack_staff',
      },
      embedding,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source,source_id' });
    console.log(`[slack→knowledge] synced escalation ${escalation.id}`);
  } catch (err) {
    console.error('[slack→knowledge] sync error:', err.message);
  }
}

router.post('/slack/events', async (req, res) => {
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : (req.rawBody?.toString('utf8') || JSON.stringify(req.body || {}));
  const sigTimestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];

  // URL検証チャレンジ
  if (req.body && req.body.type === 'url_verification') {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // 署名検証
  if (!verifySlackSignature(rawBody, sigTimestamp, signature)) {
    console.error('[slack-events] invalid signature');
    return res.status(401).json({ error: 'invalid signature' });
  }

  // Slackには即200を返す
  res.status(200).json({ ok: true });

  // イベント処理
  const event = req.body?.event;
  if (!event || event.type !== 'message' || event.subtype) return;
  if (event.bot_id) return; // Bot自身のメッセージは無視

  const threadTs = event.thread_ts;
  if (!threadTs) return; // スレッド返信以外は無視

  try {
    // 該当するエスカレーションを検索
    const { data: esc } = await supabase
      .from('slack_escalations')
      .select('*')
      .eq('slack_ts', threadTs)
      .eq('status', 'pending')
      .maybeSingle();

    if (!esc) return;

    const staffInstruction = (event.text || '').trim();
    if (!staffInstruction) return;

    if (!(esc.channel_type === 'LINE' && esc.line_user_id)) {
      await postSlackThreadReply(event.channel, threadTs, `⚠️ チャネル未対応: ${esc.channel_type}`);
      return;
    }

    await postSlackThreadReply(event.channel, threadTs, '🤖 指示を分析中...');

    // Claude APIで指示を解析
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: `あなたはFITPEAKカスタマーサポートの指示解析AIです。
担当者の指示を分析して、実行すべきアクションをJSON形式で返してください。

利用可能なアクション:
1. "mcf_ship" - Amazon MCFで商品を発送する（無料交換・追加発送）
2. "coupon" - Shopifyクーポンを発行する
3. "message_only" - お客様にメッセージを送るだけ

必ず以下のJSON形式で返してください:
{
  "action": "mcf_ship" | "coupon" | "message_only",
  "product_name": "商品名（mcf_shipの場合）",
  "size": "サイズ（mcf_shipの場合、S/M/L/2L等）",
  "coupon_amount": 1000（couponの場合、金額）,
  "customer_message": "対応完了後にお客様に送るメッセージ",
  "summary": "実行内容の要約（Slack通知用）"
}

お客様の元のメッセージと、担当者の指示の両方を考慮してください。`,
        messages: [{
          role: 'user',
          content: `お客様のメッセージ: ${esc.original_message}\n\n担当者の指示: ${staffInstruction}`,
        }],
      }),
    });

    const analysisData = await analysisRes.json();
    const analysisText = analysisData.content?.[0]?.text || '';

    let action;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      action = JSON.parse(jsonMatch[0]);
    } catch {
      await postSlackThreadReply(event.channel, threadTs, `⚠️ 指示の解析に失敗しました。もう少し具体的に書いてください。\n\n解析結果: ${analysisText.slice(0, 300)}`);
      return;
    }

    await postSlackThreadReply(event.channel, threadTs, `📋 解析結果: ${action.summary}\n\nアクション: ${action.action}\n実行中...`);

    // アクション実行
    let actionResult = '';
    const { data: friend } = await supabase.from('friends')
      .select('id, channel_id, display_name').eq('line_user_id', esc.line_user_id).maybeSingle();

    try {
      if (action.action === 'mcf_ship') {
        // Amazon MCFで発送
        const { getAccessToken } = require('./amazon-helpers.cjs');
        let tokenData;
        try {
          // amazon.cjsのgetAccessTokenを直接使えないので、supabaseからSP-API認証情報を取得
          const { data: spAccount } = await supabase.from('sp_api_accounts').select('*').eq('is_active', true).limit(1).single();
          const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: spAccount.refresh_token,
              client_id: spAccount.client_id,
              client_secret: spAccount.client_secret,
            }).toString(),
          });
          const tokenJson = await tokenRes.json();
          tokenData = { token: tokenJson.access_token, endpoint: spAccount.endpoint || 'https://sellingpartnerapi-fe.amazon.com' };
        } catch (authErr) {
          throw new Error(`Amazon認証エラー: ${authErr.message}`);
        }

        // SKUマッピングから商品を検索
        const searchTerm = `${action.product_name || ''} ${action.size || ''}`.trim();
        const { data: mappings } = await supabase.from('sku_mappings')
          .select('amazon_sku, channel_sku')
          .eq('channel', 'SHOPIFY')
          .eq('is_active', true);

        // 顧客の注文履歴から住所を取得
        const { data: recentOrder } = await supabase.from('orders')
          .select('*')
          .eq('channel', 'SHOPIFY')
          .not('address_line1', 'is', null)
          .order('created_at', { ascending: false })
          .limit(50);

        // LINEユーザーIDからShopify注文を探す（友だちの名前で照合）
        let shippingAddress = null;
        if (friend && recentOrder) {
          const friendName = friend.display_name || '';
          for (const order of recentOrder) {
            if (order.recipient_name && (order.recipient_name.includes(friendName) || friendName.includes(order.recipient_name))) {
              shippingAddress = order;
              break;
            }
          }
        }

        if (!shippingAddress) {
          // 住所が見つからない場合、お客様に聞く
          await pushToCustomer(esc.line_user_id, `${friend?.display_name || 'お客様'}、ご対応ありがとうございます。\n\n新しい商品をお送りするため、お届け先のご住所をお教えいただけますか？\n（郵便番号、都道府県、市区町村、番地、お名前）\n\n─────────\nFITPEAK AIより`);
          await postSlackThreadReply(event.channel, threadTs, '📦 お客様の住所が見つからなかったため、LINEで住所を確認中です。住所が届いたら再度指示してください。');
          return;
        }

        // Amazon MCF発送
        let amazonSku = mappings?.[0]?.amazon_sku; // デフォルト
        // 商品名・サイズでマッピングを探す
        if (action.product_name) {
          const { data: products } = await supabase.from('shopify_products')
            .select('shopify_variant_id, title, variants')
            .ilike('title', `%${action.product_name}%`);

          if (products && products.length > 0) {
            const product = products[0];
            let variantId = product.shopify_variant_id;

            if (action.size && Array.isArray(product.variants)) {
              const sizeVariant = product.variants.find(v =>
                v.title && v.title.toLowerCase().includes(action.size.toLowerCase())
              );
              if (sizeVariant) variantId = sizeVariant.id;
            }

            const { data: mapping } = await supabase.from('sku_mappings')
              .select('amazon_sku')
              .eq('channel_sku', String(variantId))
              .eq('is_active', true)
              .maybeSingle();

            if (mapping) amazonSku = mapping.amazon_sku;
          }
        }

        if (!amazonSku) {
          throw new Error('商品のAmazon SKUが見つかりません。SKUマッピングを確認してください。');
        }

        const mcfOrderId = `MCF-ESC-${esc.id.slice(0, 8)}-${Date.now()}`;
        await fetch(`${tokenData.endpoint}/fba/outbound/2020-07-01/fulfillmentOrders`, {
          method: 'POST',
          headers: { 'x-amz-access-token': tokenData.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sellerFulfillmentOrderId: mcfOrderId,
            displayableOrderId: `ESC-${esc.id.slice(0, 8)}`,
            displayableOrderDate: new Date().toISOString(),
            displayableOrderComment: `エスカレーション対応: ${staffInstruction.slice(0, 100)}`,
            shippingSpeedCategory: 'Standard',
            destinationAddress: {
              name: shippingAddress.recipient_name,
              addressLine1: shippingAddress.address_line1,
              addressLine2: shippingAddress.address_line2 || '',
              city: shippingAddress.city,
              stateOrRegion: shippingAddress.state_or_region || '',
              postalCode: shippingAddress.postal_code,
              countryCode: shippingAddress.country_code || 'JP',
            },
            items: [{
              sellerSku: amazonSku,
              sellerFulfillmentOrderItemId: `${mcfOrderId}-1`,
              quantity: 1,
            }],
          }),
        });

        actionResult = `Amazon MCF発送完了 (${mcfOrderId})\nSKU: ${amazonSku}\n宛先: ${shippingAddress.recipient_name}`;

      } else if (action.action === 'coupon') {
        // Shopifyクーポン発行
        const { data: store } = await supabase.from('channel_stores')
          .select('shop_domain, access_token')
          .eq('channel', 'SHOPIFY').eq('is_active', true).limit(1).single();

        if (store) {
          const amount = action.coupon_amount || 1000;
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          let code = 'SUPPORT-';
          for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 30);

          await fetch(`https://${store.shop_domain}/admin/api/2025-01/price_rules.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              price_rule: {
                title: `Support - ${code}`,
                target_type: 'line_item', target_selection: 'all', allocation_method: 'across',
                value_type: 'fixed_amount', value: `-${amount}`,
                customer_selection: 'all',
                starts_at: new Date().toISOString(), ends_at: expiresAt.toISOString(),
                usage_limit: 1, once_per_customer: true,
              },
            }),
          }).then(async r => {
            const priceRule = (await r.json()).price_rule;
            await fetch(`https://${store.shop_domain}/admin/api/2025-01/price_rules/${priceRule.id}/discount_codes.json`, {
              method: 'POST',
              headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ discount_code: { code } }),
            });
          });

          actionResult = `クーポン発行完了: ${code} (${amount}円OFF)`;
          if (action.customer_message) {
            action.customer_message = action.customer_message.replace(/\{code\}/g, code).replace(/\{amount\}/g, String(amount));
          }
        }

      } else {
        actionResult = 'メッセージ送信のみ';
      }
    } catch (actionErr) {
      await postSlackThreadReply(event.channel, threadTs, `❌ アクション実行エラー: ${actionErr.message}`);
      return;
    }

    // お客様にメッセージ送信
    const customerMsg = action.customer_message || `${friend?.display_name || 'お客様'}、ご対応ありがとうございます。ご依頼の件、対応いたしました。ご不明点がございましたらお気軽にお問い合わせください。`;
    await pushToCustomer(esc.line_user_id, customerMsg + '\n\n─────────\nFITPEAK AIより');

    // chat_messagesに記録
    if (friend) {
      await supabase.from('chat_messages').insert({
        channel_id: friend.channel_id,
        friend_id: friend.id,
        direction: 'outgoing',
        message_type: 'text',
        content: { text: customerMsg, source: 'slack_escalation_action' },
        created_at: new Date().toISOString(),
      });
      updateFriendChatSummary(friend.id, friend.channel_id).catch(() => {});
    }

    await postSlackThreadReply(event.channel, threadTs, `✅ 対応完了\n\n${actionResult}\n\nお客様への送信メッセージ:\n${customerMsg}`);

    // エスカレーション完了
    await supabase.from('slack_escalations').update({
      status: 'resolved',
      resolution_text: `指示: ${staffInstruction}\n結果: ${actionResult}`,
      resolved_by: event.user || 'slack_user',
      resolved_at: new Date().toISOString(),
    }).eq('id', esc.id);

    // ナレッジベースに保存
    await saveEscalationToKnowledge({ ...esc, resolution_text: `${staffInstruction} → ${actionResult}` }, customerMsg);
  } catch (err) {
    console.error('[slack-events] error:', err.message);
  }
});

function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature || !rawBody) return false;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  // タイミング攻撃対策
  const a = Buffer.from(hash);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function replyToLine(replyToken, textOrMessages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  const messages = Array.isArray(textOrMessages)
    ? textOrMessages
    : [{ type: 'text', text: textOrMessages }];
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE reply failed ${res.status}: ${body}`);
  }
}

async function logWebhookMessage(event, userMessage, aiReply) {
  // 既存の chat_messages テーブルは channel_id / friend_id が必須なので、
  // 友だちを解決できた場合のみ記録する（失敗してもWebhook本処理を止めない）
  try {
    const lineUserId = event?.source?.userId;
    if (!lineUserId) return;
    const { data: friend } = await supabase
      .from('friends')
      .select('id, channel_id')
      .eq('line_user_id', lineUserId)
      .maybeSingle();
    if (!friend) return;

    const now = new Date().toISOString();
    const rows = [
      {
        channel_id: friend.channel_id,
        friend_id: friend.id,
        direction: 'incoming',
        message_type: 'text',
        content: { text: userMessage, source: 'line_webhook' },
        line_message_id: event?.message?.id ?? null,
        created_at: now,
      },
    ];
    if (aiReply) {
      rows.push({
        channel_id: friend.channel_id,
        friend_id: friend.id,
        direction: 'outgoing',
        message_type: 'text',
        content: { text: aiReply, source: 'fitpeak_rag' },
        created_at: now,
      });
    }
    await supabase.from('chat_messages').insert(rows);
    // 未読カウントを増やす
    await supabase.rpc('increment_unread', { friend_id_input: friend.id });
  } catch (err) {
    console.error('[line-webhook] logWebhookMessage error:', err.message);
  }
}

// POST /api/line-crm/webhook  （LINE Messaging API）
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const rawBody = req.rawBody;

  if (!verifyLineSignature(rawBody, signature)) {
    console.error('[webhook] Signature verification failed', { hasSecret: !!process.env.LINE_CHANNEL_SECRET, hasSignature: !!signature, hasRawBody: !!rawBody });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  // LINE仕様: 何があっても即 200 を返す
  res.status(200).json({ status: 'ok' });

  // waitUntilでレスポンス後もfunctionを生かし続ける
  waitUntil(Promise.allSettled([
    processWebhookEvents(events),
    // piggyback: webhook受信のたびにキュー処理も実行（確実な発火のため）
    processTagDeliveryQueue(10).catch(() => {}),
  ]));
});

async function processWebhookEvents(events) {
  try {

  // AI自動応答の有効/無効をチェック
  let aiEnabled = true;
  try {
    const { data: aiSettings } = await supabase
      .from('ai_settings')
      .select('enabled, auto_reply_enabled')
      .limit(1)
      .maybeSingle();
    if (aiSettings && (aiSettings.enabled === false || aiSettings.auto_reply_enabled === false)) {
      aiEnabled = false;
    }
  } catch (err) {
    console.error('[line-webhook] ai_settings check error:', err.message);
  }

  for (const event of events) {
    const lineUserId = event?.source?.userId;

    // ── Followイベント処理（友だち追加）──
    if (event?.type === 'follow' && lineUserId) {
      try {
        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        // LINEプロフィール取得
        let displayName = 'Unknown';
        let pictureUrl = null;
        let statusMessage = null;
        if (token) {
          try {
            const profResp = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (profResp.ok) {
              const prof = await profResp.json();
              displayName = prof.displayName || 'Unknown';
              pictureUrl = prof.pictureUrl || null;
              statusMessage = prof.statusMessage || null;
            }
          } catch {}
        }

        // 流入経路の判定: 直近5分以内のクリックからマッチング
        let trafficSourceId = null;
        try {
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: recentClick } = await supabase
            .from('traffic_clicks')
            .select('source_id')
            .gte('clicked_at', fiveMinAgo)
            .order('clicked_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (recentClick) {
            trafficSourceId = recentClick.source_id;
            // friend_countをインクリメント
            const { count } = await supabase.from('friends').select('id', { count: 'exact', head: true }).eq('traffic_source_id', trafficSourceId);
            await supabase.from('traffic_sources').update({ friend_count: (count || 0) + 1 }).eq('id', trafficSourceId);
          }
        } catch (err) {
          console.error('[follow] traffic source matching error:', err.message);
        }

        // friends テーブルに upsert
        const { data: existingFriend } = await supabase
          .from('friends')
          .select('id')
          .eq('line_user_id', lineUserId)
          .maybeSingle();

        if (existingFriend) {
          await supabase.from('friends').update({
            display_name: displayName,
            picture_url: pictureUrl,
            status_message: statusMessage,
            status: 'active',
            followed_at: new Date().toISOString(),
            ...(trafficSourceId ? { traffic_source_id: trafficSourceId } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', existingFriend.id);
        } else {
          await supabase.from('friends').insert({
            line_user_id: lineUserId,
            display_name: displayName,
            picture_url: pictureUrl,
            status_message: statusMessage,
            status: 'active',
            channel_id: DEFAULT_CHANNEL_ID,
            traffic_source_id: trafficSourceId,
            followed_at: new Date().toISOString(),
          });
        }
        console.log(`[follow] ${displayName} added. Source: ${trafficSourceId || 'direct'}`);

        // 挨拶メッセージを送信
        try {
          const { data: channelSettings } = await supabase
            .from('line_channels')
            .select('greeting_enabled, greeting_template_id')
            .limit(1)
            .maybeSingle();

          if (channelSettings?.greeting_enabled && channelSettings?.greeting_template_id && token) {
            const { data: tmpl } = await supabase
              .from('message_templates')
              .select('content')
              .eq('id', channelSettings.greeting_template_id)
              .maybeSingle();

            if (tmpl?.content?.messages && Array.isArray(tmpl.content.messages) && tmpl.content.messages.length > 0) {
              const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ to: lineUserId, messages: tmpl.content.messages.slice(0, 5) }),
              });
              if (pushRes.ok) {
                console.log(`[follow] Greeting sent to ${displayName}`);
                // チャットログに記録
                const { data: friendRow } = await supabase.from('friends').select('id, channel_id').eq('line_user_id', lineUserId).maybeSingle();
                if (friendRow?.channel_id) {
                  const textParts = tmpl.content.messages.filter(m => m.type === 'text' && m.text).map(m => m.text);
                  await supabase.from('chat_messages').insert({
                    channel_id: friendRow.channel_id,
                    friend_id: friendRow.id,
                    direction: 'outgoing',
                    message_type: 'text',
                    content: { messages: tmpl.content.messages, text: textParts.join('\n'), source: 'greeting' },
                  });
                }
              } else {
                console.error(`[follow] Greeting push failed:`, pushRes.status);
              }
            }
          }
        } catch (greetErr) {
          console.error('[follow] greeting send error:', greetErr.message);
        }
      } catch (err) {
        console.error('[follow] error:', err.message);
      }
      continue;
    }

    // ── Unfollowイベント処理 ──
    if (event?.type === 'unfollow' && lineUserId) {
      try {
        await supabase.from('friends').update({ status: 'unfollowed', unfollowed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('line_user_id', lineUserId);
      } catch {}
      continue;
    }

    // ── Postbackイベント処理（リッチメニューのボタン等）──
    if (event?.type === 'postback') {
      const postbackData = event.postback?.data || '';
      const params = new URLSearchParams(postbackData);
      const action = params.get('action');

      if (action === 'register_email') {
        // 会員登録: コード付きリンクを送信
        let replyText = '';
        try {
          const url = await generateAutoLoginUrl(lineUserId, '/line-link');
          replyText = `会員登録・LINE連携はこちらから行えます。\n\n${url}\n\n上のリンクをタップして、My FITPEAKのメールアドレスとパスワードを入力してください。`;
          await replyToLine(event.replyToken, replyText);
        } catch (err) {
          console.error('[line-webhook] register prompt error:', err.message);
          try {
            replyText = '会員登録ありがとうございます。\n\n公式サイトでのご購入時に使用した、または使用するメールアドレスを教えてください。';
            await replyToLine(event.replyToken, replyText);
          } catch {}
        }
        logWebhookMessage(event, '[postback:register_email]', replyText);
        continue;
      }

      if (action === 'send_template') {
        const templateId = params.get('template_id');
        if (templateId && lineUserId) {
          try {
            const { data: tmpl } = await supabase
              .from('message_templates')
              .select('id, name, content')
              .eq('id', templateId)
              .maybeSingle();

            if (tmpl && tmpl.content && tmpl.content.messages) {
              // テンプレートをLINEに送信
              // LINE Push APIでテンプレートを送信
              const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
              if (token) {
                await fetch('https://api.line.me/v2/bot/message/push', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ to: lineUserId, messages: tmpl.content.messages }),
                });
              }

              // チャットログに記録
              const { data: friend } = await supabase
                .from('friends')
                .select('id, channel_id')
                .eq('line_user_id', lineUserId)
                .maybeSingle();

              if (friend) {
                const now = new Date().toISOString();
                await supabase.from('chat_messages').insert([
                  {
                    channel_id: friend.channel_id,
                    friend_id: friend.id,
                    direction: 'incoming',
                    message_type: 'postback',
                    content: { data: postbackData, displayText: event.postback?.params?.displayText || `テンプレート「${tmpl.name}」を選択` },
                    created_at: now,
                  },
                  {
                    channel_id: friend.channel_id,
                    friend_id: friend.id,
                    direction: 'outgoing',
                    message_type: 'text',
                    content: { messages: tmpl.content.messages, source: 'template_postback', template_id: templateId },
                    created_at: now,
                  },
                ]);
                // チャットナレッジを非同期更新
                updateFriendChatSummary(friend.id, friend.channel_id).catch(err =>
                  console.error('[template] summary update error:', err.message));
              }
            }
          } catch (err) {
            console.error('[line-webhook] send_template error:', err.message);
          }
        }
        continue;
      }

      if (action === 'check_orders') {
        // 注文確認 - トークン付きURLでMy FITPEAKに遷移
        let replyText = '';
        try {
          const result = await getLinkedOrders(lineUserId);
          if (!result.linked) {
            replyText = result.message;
          } else {
            const url = await generateAutoLoginUrl(lineUserId, '/orders');
            replyText = `注文履歴はこちらからご確認いただけます。\n\n${url}`;
          }
          await replyToLine(event.replyToken, replyText);
        } catch (err) {
          console.error('[line-webhook] check_orders error:', err.message);
          try {
            replyText = '注文情報の取得に失敗しました。';
            await replyToLine(event.replyToken, replyText);
          } catch {}
        }
        logWebhookMessage(event, '[postback:check_orders]', replyText);
        continue;
      }
      continue;
    }

    // ── 画像・動画・スタンプなど非テキストメッセージの処理 ──
    if (event?.type === 'message' && event?.message?.type !== 'text') {
      const msgType = event.message.type; // image, video, sticker, audio, file, location
      const lineUserId = event?.source?.userId;
      if (lineUserId) {
        try {
          const { data: friend } = await supabase
            .from('friends')
            .select('id, channel_id')
            .eq('line_user_id', lineUserId)
            .maybeSingle();

          if (friend) {
            let contentData = { source: 'line_webhook', type: msgType };

            // 画像・動画: LINE Content APIからダウンロードしてSupabase Storageに保存
            if ((msgType === 'image' || msgType === 'video') && event.message.id) {
              try {
                const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
                const contentRes = await axios.get(
                  `https://api-data.line.me/v2/bot/message/${event.message.id}/content`,
                  { headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer' }
                );
                const ext = msgType === 'video' ? 'mp4' : 'jpg';
                const fileName = `line-media/${friend.id}/${Date.now()}.${ext}`;
                const contentType = contentRes.headers['content-type'] || (msgType === 'video' ? 'video/mp4' : 'image/jpeg');

                const { error: uploadErr } = await supabase.storage
                  .from('chat-media')
                  .upload(fileName, contentRes.data, { contentType, upsert: true });

                if (uploadErr) {
                  console.error(`[line-webhook] storage upload error:`, uploadErr.message);
                  // chat-mediaバケットが失敗する場合、line-mediaバケットで再試行
                  const altFileName = `chat/${friend.id}/${Date.now()}.${ext}`;
                  const { error: altErr } = await supabase.storage
                    .from('line-media')
                    .upload(altFileName, contentRes.data, { contentType, upsert: true });
                  if (!altErr) {
                    const { data: altUrl } = supabase.storage.from('line-media').getPublicUrl(altFileName);
                    contentData.url = altUrl?.publicUrl || '';
                    contentData.originalContentUrl = contentData.url;
                  } else {
                    console.error(`[line-webhook] alt storage upload also failed:`, altErr.message);
                  }
                } else {
                  const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(fileName);
                  contentData.url = urlData?.publicUrl || '';
                  contentData.originalContentUrl = contentData.url;
                }
              } catch (dlErr) {
                console.error(`[line-webhook] media download error:`, dlErr.message);
              }
            }

            // スタンプ
            if (msgType === 'sticker') {
              contentData.stickerId = event.message.stickerId;
              contentData.packageId = event.message.packageId;
            }

            await supabase.from('chat_messages').insert({
              channel_id: friend.channel_id,
              friend_id: friend.id,
              direction: 'incoming',
              message_type: msgType,
              content: contentData,
              line_message_id: event.message.id,
              created_at: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.error('[line-webhook] non-text message log error:', err.message);
        }
      }
      continue;
    }

    // ── メッセージ受信時の友だち自動登録 ──
    if (event?.type === 'message' && lineUserId) {
      try {
        const { data: existingFriend } = await supabase
          .from('friends')
          .select('id')
          .eq('line_user_id', lineUserId)
          .maybeSingle();
        if (!existingFriend) {
          const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
          let displayName = 'Unknown', pictureUrl = null, statusMessage = null;
          if (token) {
            try {
              const profResp = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (profResp.ok) {
                const prof = await profResp.json();
                displayName = prof.displayName || 'Unknown';
                pictureUrl = prof.pictureUrl || null;
                statusMessage = prof.statusMessage || null;
              }
            } catch {}
          }
          await supabase.from('friends').insert({
            line_user_id: lineUserId,
            display_name: displayName,
            picture_url: pictureUrl,
            status_message: statusMessage,
            status: 'active',
            channel_id: DEFAULT_CHANNEL_ID,
          });
          console.log(`[webhook] Auto-registered friend: ${displayName}`);
        }
      } catch (err) {
        console.error('[webhook] Auto-register friend error:', err.message);
      }
    }

    // ── テキストメッセージ処理 ──
    if (event?.type !== 'message' || event?.message?.type !== 'text') continue;
    const userMessage = event.message.text;

    // 外部ツール（L Message等）のボタンポストバックデータをスキップ
    if (/^reply=\d+&post_back=/.test(userMessage.trim())) {
      continue;
    }

    // テキストコマンド: 「会員登録」「注文確認」
    if (userMessage.trim() === '会員登録' || userMessage.trim() === '会員登録・ログイン') {
      let replyText = '';
      try {
        const url = await generateAutoLoginUrl(lineUserId, '/line-link');
        replyText = `会員登録・LINE連携はこちらから行えます。\n\n${url}\n\n上のリンクをタップして、My FITPEAKのメールアドレスとパスワードを入力してください。`;
        await replyToLine(event.replyToken, replyText);
      } catch (err) {
        console.error('[line-webhook] register text command error:', err.message);
      }
      logWebhookMessage(event, userMessage, replyText || null);
      continue;
    }

    if (userMessage.trim() === '注文確認' || userMessage.trim() === '注文を確認する') {
      let replyText = '';
      try {
        const result = await getLinkedOrders(lineUserId);
        if (!result.linked) {
          replyText = result.message;
        } else {
          const url = await generateAutoLoginUrl(lineUserId, '/orders');
          replyText = `注文履歴はこちらからご確認いただけます。\n\n${url}`;
        }
        await replyToLine(event.replyToken, replyText);
      } catch (err) {
        console.error('[line-webhook] orders text command error:', err.message);
      }
      logWebhookMessage(event, userMessage, replyText || null);
      continue;
    }

    // キーワード自動応答 (auto_responses テーブル)
    let matched = null;
    try {
      const { data: rules } = await supabase
        .from('auto_responses')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false });
      const target = userMessage.trim();
      for (const rule of (rules || [])) {
        const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
        const matchType = rule.match_type || 'contains';
        for (const kw of keywords) {
          const k = String(kw || '').trim();
          if (!k) continue;
          if (matchType === 'exact' && target === k) { matched = rule; break; }
          if (matchType === 'contains' && target.includes(k)) { matched = rule; break; }
          if ((matchType === 'starts_with' || matchType === 'startsWith') && target.startsWith(k)) { matched = rule; break; }
          if (matchType === 'regex') {
            try { if (new RegExp(k).test(target)) { matched = rule; break; } } catch (_) {}
          }
        }
        if (matched) break;
      }
      if (matched) {
        const messages = Array.isArray(matched.response_messages) ? matched.response_messages : [];
        if (messages.length > 0) {
          // メッセージ配列をそのままLINEに送信（テンプレート・画像等も対応）
          try {
            await replyToLine(event.replyToken, messages);
          } catch (replyErr) {
            console.error('[auto_response] replyToLine failed:', replyErr.message);
          }

          // チャットログに記録（自動応答の内容をoutgoingとして保存）
          try {
            const { data: friend } = await supabase
              .from('friends')
              .select('id, channel_id')
              .eq('line_user_id', lineUserId)
              .maybeSingle();
            if (friend) {
              const incomingAt = new Date();
              const outgoingAt = new Date(incomingAt.getTime() + 1);
              await supabase.from('chat_messages').insert([
                {
                  channel_id: friend.channel_id,
                  friend_id: friend.id,
                  direction: 'incoming',
                  message_type: 'text',
                  content: { text: userMessage, source: 'line_webhook' },
                  line_message_id: event?.message?.id ?? null,
                  created_at: incomingAt.toISOString(),
                },
                {
                  channel_id: friend.channel_id,
                  friend_id: friend.id,
                  direction: 'outgoing',
                  message_type: 'text',
                  content: { messages, source: 'auto_response', auto_response_id: matched.id },
                  created_at: outgoingAt.toISOString(),
                },
              ]);

              // タグアクションを実行（追加・削除）
              const tagActions = Array.isArray(matched.tag_actions) ? matched.tag_actions : [];
              for (const action of tagActions) {
                try {
                  if (action.action === 'add' && action.tag_id) {
                    // 既に付いていなければタグを追加
                    const { data: existing } = await supabase
                      .from('friend_tags')
                      .select('tag_id')
                      .eq('friend_id', friend.id)
                      .eq('tag_id', action.tag_id)
                      .maybeSingle();
                    if (!existing) {
                      await supabase.from('friend_tags').insert({
                        friend_id: friend.id,
                        tag_id: action.tag_id,
                      });
                      // タグ遅延配信キューに登録
                      enqueueTagDelivery(friend.id, action.tag_id).catch(() => {});
                    }
                  } else if (action.action === 'remove' && action.tag_id) {
                    await supabase
                      .from('friend_tags')
                      .delete()
                      .eq('friend_id', friend.id)
                      .eq('tag_id', action.tag_id);
                  }
                } catch (tagErr) {
                  console.error('[auto_response] tag action error:', tagErr.message);
                }
              }

              // チャットナレッジを非同期更新
              updateFriendChatSummary(friend.id, friend.channel_id).catch(err =>
                console.error('[auto_response] summary update error:', err.message));
            }
          } catch (logErr) {
            console.error('[line-webhook] auto_response log error:', logErr.message);
          }
          continue;
        }
      }
    } catch (err) {
      console.error('[line-webhook] auto_responses check error:', err.message);
      // マッチしたルールがあればAI返信に流さない
      if (matched) continue;
    }

    // メールアドレスの登録チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(userMessage.trim())) {
      // メールアドレスが入力された → 会員登録を試みる
      try {
        // 友だちを取得/作成
        let friendId = null;
        const { data: friend } = await supabase
          .from('friends')
          .select('id')
          .eq('line_user_id', lineUserId)
          .maybeSingle();
        friendId = friend?.id;

        if (friendId) {
          const result = await registerUserByEmail(lineUserId, friendId, userMessage.trim());
          await replyToLine(event.replyToken, result.message);
          logWebhookMessage(event, userMessage, result.message);
          continue;
        }
      } catch (err) {
        console.error('[line-webhook] email registration error:', err.message);
      }
    }

    // AI即時返信: キーワード不一致時にAIで即時返信
    logWebhookMessage(event, userMessage, null);

    if (aiEnabled) {
      try {
        const { data: friend } = await supabase
          .from('friends')
          .select('id, display_name, line_user_id, channel_id')
          .eq('line_user_id', lineUserId)
          .maybeSingle();

        if (friend) {
          // 会話履歴を取得
          let chatHistory = [];
          try {
            const { data: history } = await supabase
              .from('chat_messages')
              .select('direction, content, created_at')
              .eq('friend_id', friend.id)
              .order('created_at', { ascending: false })
              .limit(20);
            if (history && history.length > 0) {
              chatHistory = history.reverse().map(m => {
                const role = m.direction === 'inbound' || m.direction === 'incoming' ? 'user' : 'assistant';
                if (m.content?.text) return { role, content: m.content.text };
                // 自動応答等の messages 配列からテキストを抽出
                if (Array.isArray(m.content?.messages)) {
                  const texts = m.content.messages
                    .filter(msg => msg.type === 'text' && msg.text)
                    .map(msg => msg.text);
                  if (texts.length > 0) return { role, content: texts.join('\n') };
                }
                return null;
              }).filter(Boolean);
            }
          } catch {}

          // 友だちのタグ情報を取得（当選番号タグ等の文脈判断用）
          let friendTags = [];
          try {
            const { data: ftRows } = await supabase
              .from('friend_tags')
              .select('tags(name)')
              .eq('friend_id', friend.id);
            friendTags = (ftRows || []).map(r => r.tags?.name).filter(Boolean);
          } catch {}

          // 直前の送信メッセージが自動応答かチェック（直前1件のみ・1時間以内）
          let recentAutoResponse = '';
          try {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const { data: recentAR } = await supabase
              .from('chat_messages')
              .select('content, created_at')
              .eq('friend_id', friend.id)
              .eq('direction', 'outgoing')
              .gte('created_at', oneHourAgo)
              .order('created_at', { ascending: false })
              .limit(1);
            if (recentAR && recentAR[0]?.content?.source === 'auto_response') {
              const arTexts = (recentAR[0].content.messages || []).filter(m => m.type === 'text' && m.text).map(m => m.text);
              if (arTexts.length > 0) recentAutoResponse = `直近の自動応答: ${arTexts.join(' / ')}`;
            }
          } catch {}

          const aiReply = await generateFITPEAKReply(userMessage, {
            channel: 'LINE',
            customerName: friend.display_name || '',
            lineUserId: friend.line_user_id,
            friendId: friend.id,
            chatHistory,
            friendTags,
            recentAutoResponse,
          });

          if (aiReply) {
            const aiReplyWithFooter = aiReply + '\n\n─────────\nFITPEAK AIより';
            const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
            if (token) {
              const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: aiReplyWithFooter }] }),
              });
              if (pushRes.ok) {
                await supabase.from('chat_messages').insert({
                  channel_id: friend.channel_id,
                  friend_id: friend.id,
                  direction: 'outgoing',
                  message_type: 'text',
                  content: { text: aiReplyWithFooter, source: 'fitpeak_rag_instant' },
                });
                console.log(`[line-webhook] AI instant reply sent to ${friend.display_name}`);
              } else {
                console.error(`[line-webhook] AI push failed:`, pushRes.status, await pushRes.text().catch(() => ''));
              }
            }
          }
        }
      } catch (err) {
        console.error('[line-webhook] AI instant reply error:', err.message);
      }
    }
  }
  } catch (err) {
    console.error('[webhook] processWebhookEvents error:', err.message);
  }
}

// ===========================================================================
// 遅延AI返信: 12時間未返信のメッセージにAI返信を送信
// GET /delayed-ai-reply で呼び出す（Vercel Cronまたは外部cronから定期実行）
// ===========================================================================
router.get('/delayed-ai-reply', async (req, res) => {
  try {
    const AI_DELAY_HOURS = 12;
    const cutoffTime = new Date(Date.now() - AI_DELAY_HOURS * 60 * 60 * 1000).toISOString();

    // AI自動応答が有効かチェック
    const { data: aiSettings } = await supabase
      .from('ai_settings')
      .select('enabled, auto_reply_enabled')
      .limit(1)
      .maybeSingle();
    if (aiSettings && (aiSettings.enabled === false || aiSettings.auto_reply_enabled === false)) {
      return res.json({ message: 'AI disabled', processed: 0 });
    }

    // 5時間以上前の受信メッセージで、その後にoutgoingメッセージがないものを探す
    // 1. 5時間以上前のincomingメッセージを取得
    const { data: oldIncoming } = await supabase
      .from('chat_messages')
      .select('id, channel_id, friend_id, content, created_at')
      .eq('direction', 'incoming')
      .lte('created_at', cutoffTime)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!oldIncoming || oldIncoming.length === 0) {
      return res.json({ message: 'No pending messages', processed: 0 });
    }

    // channel_id ごとに最新のincomingを1件だけ処理（重複防止）
    const channelsSeen = new Set();
    const toProcess = [];
    for (const msg of oldIncoming) {
      if (channelsSeen.has(msg.channel_id)) continue;
      channelsSeen.add(msg.channel_id);
      toProcess.push(msg);
    }

    let processed = 0;
    const results = [];

    for (const msg of toProcess) {
      // ★ チェック1（最重要）: このチャンネルで手動返信が1度でもあればAI永久スキップ
      // source が crm_ui = 管理画面から手動送信、source なし = 外部ツール等からの手動送信
      // これらがあるチャンネルではAIは絶対に起動しない
      const { data: manualMsgs } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('channel_id', msg.channel_id)
        .in('direction', ['outgoing', 'outbound'])
        .or('content->>source.eq.crm_ui,content->>source.eq.slack_escalation,content->>source.is.null')
        .limit(1);

      if (manualMsgs && manualMsgs.length > 0) {
        continue;
      }

      // ★ チェック2: このチャンネルの最新メッセージがoutgoing（返信済み）ならスキップ
      const { data: lastMsg } = await supabase
        .from('chat_messages')
        .select('id, direction')
        .eq('channel_id', msg.channel_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastMsg && lastMsg.direction === 'outgoing') {
        continue;
      }

      // ★ チェック3: このincomingメッセージ以降にどんなoutgoingメッセージもあればスキップ
      const { data: replies } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('channel_id', msg.channel_id)
        .eq('direction', 'outgoing')
        .gte('created_at', msg.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      // ★ チェック4: delayed_ai_replyで既に返信済みかチェック
      const { data: aiReplies } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('channel_id', msg.channel_id)
        .eq('direction', 'outgoing')
        .gte('created_at', cutoffTime)
        .limit(1);

      if (aiReplies && aiReplies.length > 0) continue;

      // 友だち情報を取得
      const { data: friend } = await supabase
        .from('friends')
        .select('id, display_name, line_user_id, channel_id')
        .eq('id', msg.friend_id)
        .maybeSingle();

      if (!friend || !friend.line_user_id) continue;

      // 会話履歴を取得
      let chatHistory = [];
      try {
        const { data: history } = await supabase
          .from('chat_messages')
          .select('direction, content, created_at')
          .eq('friend_id', friend.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (history && history.length > 0) {
          chatHistory = history
            .reverse()
            .map(m => {
              const role = m.direction === 'inbound' || m.direction === 'incoming' ? 'user' : 'assistant';
              if (m.content?.text) return { role, content: m.content.text };
              if (m.content?.messages && Array.isArray(m.content.messages)) {
                const textParts = m.content.messages
                  .filter(tm => tm.type === 'text' && tm.text)
                  .map(tm => tm.text);
                if (textParts.length > 0) return { role, content: textParts.join('\n') };
              }
              return null;
            })
            .filter(Boolean);
        }
      } catch {}

      // 最後のユーザーメッセージを特定
      const userMessage = msg.content?.text || '';
      if (!userMessage) continue;

      // AI返信を生成
      let aiReply;
      try {
        aiReply = await generateFITPEAKReply(userMessage, {
          channel: 'LINE',
          customerName: friend.display_name || '',
          lineUserId: friend.line_user_id,
          friendId: friend.id,
          chatHistory,
        });
      } catch (err) {
        console.error('[delayed-ai] generateFITPEAKReply error:', err.message);
        continue;
      }

      // LINE Push APIで送信
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && aiReply) {
        try {
          const delayedReplyWithFooter = aiReply + '\n\n─────────\nFITPEAK AIより';
          const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              to: friend.line_user_id,
              messages: [{ type: 'text', text: delayedReplyWithFooter }],
            }),
          });
          if (pushRes.ok) {
            // チャットログに記録
            await supabase.from('chat_messages').insert({
              channel_id: friend.channel_id,
              friend_id: friend.id,
              direction: 'outgoing',
              message_type: 'text',
              content: { text: delayedReplyWithFooter, source: 'delayed_ai_reply' },
            });
            processed++;
            results.push({ friend: friend.display_name, status: 'sent' });
            console.log(`[delayed-ai] Sent reply to ${friend.display_name}: "${aiReply.slice(0, 50)}..."`);
            // チャットナレッジを非同期更新
            updateFriendChatSummary(friend.id, friend.channel_id).catch(err =>
              console.error('[delayed-ai] summary update error:', err.message));
          } else {
            const body = await pushRes.text().catch(() => '');
            console.error(`[delayed-ai] LINE push failed for ${friend.display_name}:`, pushRes.status, body);
            results.push({ friend: friend.display_name, status: 'line_error' });
          }
        } catch (err) {
          console.error(`[delayed-ai] push error for ${friend.display_name}:`, err.message);
          results.push({ friend: friend.display_name, status: 'error' });
        }
      }
    }

    return res.json({ message: 'Delayed AI reply processed', processed, results });
  } catch (err) {
    console.error('[delayed-ai-reply] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// 流入経路 (Traffic Sources)
// ===========================================================================

// GET /traffic-sources
router.get('/traffic-sources', async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('traffic_sources')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /traffic-sources error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /traffic-sources
router.post('/traffic-sources', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const code = Math.random().toString(36).substring(2, 10);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('traffic_sources')
      .insert({ name, description: description || null, code, channel_id: DEFAULT_CHANNEL_ID })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('POST /traffic-sources error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /traffic-sources/:id
router.put('/traffic-sources/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('traffic_sources')
      .update({ name, description, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('PUT /traffic-sources/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /traffic-sources/:id
router.delete('/traffic-sources/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('traffic_sources')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /traffic-sources/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /traffic-sources/:id/friends - その流入経路から追加された友だち一覧
router.get('/traffic-sources/:id/friends', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('friends')
      .select('id, display_name, picture_url, status, created_at')
      .eq('traffic_source_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /track/:code - クリック追跡 → LINE友だち追加URLにリダイレクト
router.get('/track/:code', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: source } = await supabase
      .from('traffic_sources')
      .select('id, click_count')
      .eq('code', req.params.code)
      .maybeSingle();

    if (!source) return res.status(404).send('Not found');

    // クリックを記録 & カウント更新（並行実行）
    await Promise.all([
      supabase.from('traffic_clicks').insert({
        source_id: source.id,
        ip_address: req.headers['x-forwarded-for'] || req.ip || null,
        user_agent: req.headers['user-agent'] || null,
      }),
      supabase.from('traffic_sources')
        .update({ click_count: (source.click_count || 0) + 1 })
        .eq('id', source.id),
    ]);

    // LINE Bot Info からBASIC IDを取得してリダイレクト
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    let addUrl = 'https://line.me/R/ti/p/@956iyppc'; // fallback
    if (token) {
      try {
        const botResp = await fetch('https://api.line.me/v2/bot/info', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (botResp.ok) {
          const botInfo = await botResp.json();
          if (botInfo.basicId) addUrl = `https://line.me/R/ti/p/@${botInfo.basicId}`;
        }
      } catch {}
    }

    res.redirect(addUrl);
  } catch (err) {
    console.error('GET /track/:code error:', err);
    res.redirect('https://line.me/R/ti/p/@956iyppc');
  }
});

// ===========================================================================
// My FITPEAK 管理ダッシュボード
// ===========================================================================

// GET /fitpeak/surveys - アンケート回答一覧
router.get('/fitpeak/surveys', async (req, res) => {
  try {
    const { page = 1, per_page = 30, rating, product_name } = req.query;
    const offset = (Number(page) - 1) * Number(per_page);

    let query = supabase
      .from('surveys')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(per_page) - 1);

    if (rating) query = query.eq('rating', Number(rating));
    if (product_name) query = query.ilike('product_name', `%${product_name}%`);

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json({ data: data || [], total: count || 0, page: Number(page), per_page: Number(per_page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /fitpeak/surveys/:id - アンケート詳細
router.get('/fitpeak/surveys/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('surveys')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Not found' });

    // クーポン情報
    let coupon = null;
    if (data.coupon_id) {
      const { data: c } = await supabase.from('coupons').select('*').eq('id', data.coupon_id).maybeSingle();
      coupon = c;
    }

    // 友だち情報（LINE連携している場合）
    let friend = null;
    if (data.line_user_id) {
      const { data: f } = await supabase.from('friends').select('id, display_name, picture_url').eq('line_user_id', data.line_user_id).maybeSingle();
      friend = f;
    }

    res.json({ ...data, coupon, friend });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /fitpeak/surveys/stats - アンケート統計
router.get('/fitpeak/stats', async (req, res) => {
  try {
    const { data: surveys } = await supabase.from('surveys').select('rating, routed_to, amazon_button_clicked_at, created_at');
    if (!surveys) return res.json({});

    // アンケート送信数: tag_delivery_queue → ブロードキャスト送信数 → LINE友だち数をフォールバック
    let sentCount = 0;
    const { count: tagSent } = await supabase
      .from('tag_delivery_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent');
    if (tagSent && tagSent > 0) {
      sentCount = tagSent;
    } else {
      // ブロードキャスト経由の送信数
      const { data: bcs } = await supabase
        .from('broadcasts')
        .select('sent_count')
        .eq('status', 'sent');
      if (bcs && bcs.length > 0) {
        sentCount = bcs.reduce((sum, b) => sum + (b.sent_count || 0), 0);
      } else {
        // フォールバック: LINE友だち数（アンケートURLは全員に送信されている前提）
        const { count: friendCount } = await supabase
          .from('friends')
          .select('id', { count: 'exact', head: true });
        sentCount = friendCount || 0;
      }
    }

    // URLクリック数: scratch_codes使用数 or アンケート回答のユニークユーザー数
    const { count: scratchUsed } = await supabase
      .from('scratch_codes')
      .select('id', { count: 'exact', head: true })
      .eq('is_used', true);
    // アンケートにスクラッチコードが紐づいている数も含める
    const { count: surveyWithCode } = await supabase
      .from('surveys')
      .select('id', { count: 'exact', head: true })
      .not('scratch_code', 'is', null);
    const urlClickCount = Math.max(scratchUsed || 0, surveyWithCode || 0);

    const total = surveys.length;
    const ratingDist = [0, 0, 0, 0, 0];
    let reviewClicked = 0;
    let supportRouted = 0;
    const byMonth = {};

    for (const s of surveys) {
      if (s.rating >= 1 && s.rating <= 5) ratingDist[s.rating - 1]++;
      if (s.amazon_button_clicked_at) reviewClicked++;
      if (s.routed_to === 'amazon_support') supportRouted++;
      const month = (s.created_at || '').slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    const avgRating = total > 0 ? (surveys.reduce((s, r) => s + r.rating, 0) / total).toFixed(1) : 0;

    res.json({
      total,
      avgRating: Number(avgRating),
      ratingDistribution: ratingDist,
      reviewClicked,
      reviewClickRate: total > 0 ? Math.round(reviewClicked / total * 100) : 0,
      supportRouted,
      byMonth,
      sentCount: sentCount || 0,
      urlClickCount: urlClickCount || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// レビュー特典（無料プレゼント）申請 review_gift_claims の管理
// スクショ確認 / 個別判定（承認→即発行・却下）/ 判定KB
// ===========================================================================

// GET /fitpeak/review-gifts - 申請一覧（スクショ・AI判定・抽出項目つき）
router.get('/fitpeak/review-gifts', async (req, res) => {
  try {
    const { status, page = 1, per_page = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(per_page);

    let query = supabase
      .from('review_gift_claims')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(per_page) - 1);
    if (status) query = query.eq('verification_status', status);

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // 友だち名を補完
    const lineIds = [...new Set((data || []).map((c) => c.line_user_id).filter(Boolean))];
    let friendMap = {};
    if (lineIds.length) {
      const { data: friends } = await supabase
        .from('friends')
        .select('line_user_id, display_name, picture_url')
        .in('line_user_id', lineIds);
      for (const f of friends || []) friendMap[f.line_user_id] = f;
    }
    const rows = (data || []).map((c) => ({
      ...c,
      friend: c.line_user_id ? friendMap[c.line_user_id] || null : null,
    }));

    res.json({ data: rows, total: count || 0, page: Number(page), per_page: Number(per_page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /fitpeak/review-gifts/counts - ステータス別件数
router.get('/fitpeak/review-gifts/counts', async (req, res) => {
  try {
    const statuses = ['pending', 'verified', 'rejected'];
    const counts = {};
    for (const s of statuses) {
      const { count } = await supabase
        .from('review_gift_claims')
        .select('id', { count: 'exact', head: true })
        .eq('verification_status', s);
      counts[s] = count || 0;
    }
    const { count: issued } = await supabase
      .from('review_gift_claims')
      .select('id', { count: 'exact', head: true })
      .not('shopify_invoice_url', 'is', null);
    counts.issued = issued || 0;
    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /fitpeak/review-gifts/:id/approve - 手動承認 → 即プレゼント発行
router.post('/fitpeak/review-gifts/:id/approve', async (req, res) => {
  try {
    const { by, note } = req.body || {};
    const id = req.params.id;

    const { data: claim } = await supabase
      .from('review_gift_claims')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!claim) return res.status(404).json({ error: '申請が見つかりません' });

    // verified にして手動判定を記録
    await supabase
      .from('review_gift_claims')
      .update({
        verification_status: 'verified',
        reviewed_by: by || 'admin',
        reviewed_at: new Date().toISOString(),
        manual_note: note || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // my-fitpeak の発行エンドポイントを呼ぶ（Shopify無料ドラフト注文）
    let invoiceUrl = claim.shopify_invoice_url || null;
    let issueError = null;
    try {
      const r = await fetch('https://my.fitpeak.co/api/review-gift/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: id }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.invoiceUrl) invoiceUrl = d.invoiceUrl;
      else issueError = d.error || '発行に失敗しました';
    } catch (e) {
      issueError = e.message;
    }

    res.json({ ok: true, invoiceUrl, issueError });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /fitpeak/review-gifts/:id/reject - 手動却下（理由・KB追加）
router.post('/fitpeak/review-gifts/:id/reject', async (req, res) => {
  try {
    const { reason, by, addToKb } = req.body || {};
    const id = req.params.id;

    await supabase
      .from('review_gift_claims')
      .update({
        verification_status: 'rejected',
        reviewed_by: by || 'admin',
        reviewed_at: new Date().toISOString(),
        manual_note: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // AI誤判定の学習: 理由をナレッジベースに追加
    if (addToKb && reason) {
      await supabase.from('review_gift_verify_kb').insert({
        reason,
        note: `claim ${id} の手動却下より`,
        created_by: by || 'admin',
      });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 判定ナレッジベース（review_gift_verify_kb）
router.get('/fitpeak/verify-kb', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('review_gift_verify_kb')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/fitpeak/verify-kb', async (req, res) => {
  try {
    const { reason, note, by } = req.body || {};
    if (!reason) return res.status(400).json({ error: 'reason required' });
    const { data, error } = await supabase
      .from('review_gift_verify_kb')
      .insert({ reason, note: note || null, created_by: by || 'admin' })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.patch('/fitpeak/verify-kb/:id/toggle', async (req, res) => {
  try {
    const { data: cur } = await supabase.from('review_gift_verify_kb').select('is_active').eq('id', req.params.id).maybeSingle();
    const { data, error } = await supabase
      .from('review_gift_verify_kb')
      .update({ is_active: !cur?.is_active })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.delete('/fitpeak/verify-kb/:id', async (req, res) => {
  try {
    await supabase.from('review_gift_verify_kb').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /fitpeak/heatmap - 画面到達ヒートマップ（survey_events集計）
const SURVEY_STEP_ORDER = [
  'landing', 'questions', 'submitted', 'coupon', 'pre_review', 'review_cta',
  'review_gift_offer', 'review_gift_submitted', 'gift_verified', 'gift_issued',
  'support_cta', 'completed',
];
const SURVEY_STEP_LABELS = {
  landing: 'アンケート開始画面', questions: '設問回答', submitted: '回答送信完了',
  coupon: 'クーポン画面', pre_review: 'プレゼントオファー(★5)', review_cta: 'レビュー促進',
  review_gift_offer: 'スクショ提出画面', review_gift_submitted: 'スクショ提出完了',
  gift_verified: 'レビュー検証OK', gift_issued: 'プレゼント発行', support_cta: 'サポート導線(★1-3)',
  completed: '完了',
};
router.get('/fitpeak/heatmap', async (req, res) => {
  try {
    const { data: events } = await supabase
      .from('survey_events')
      .select('step, line_user_id, user_id, scratch_code')
      .limit(50000);

    const usersByStep = {};   // step -> Set(userKey)
    const eventsByStep = {};  // step -> count
    for (const s of SURVEY_STEP_ORDER) { usersByStep[s] = new Set(); eventsByStep[s] = 0; }
    for (const e of events || []) {
      if (!(e.step in eventsByStep)) { usersByStep[e.step] = new Set(); eventsByStep[e.step] = 0; }
      eventsByStep[e.step]++;
      const key = e.line_user_id || e.user_id || e.scratch_code;
      if (key) usersByStep[e.step].add(key);
    }

    const steps = SURVEY_STEP_ORDER.map((s) => ({
      step: s,
      label: SURVEY_STEP_LABELS[s] || s,
      users: usersByStep[s] ? usersByStep[s].size : 0,
      events: eventsByStep[s] || 0,
    }));
    const startUsers = steps[0]?.users || 0;
    for (const st of steps) st.rate = startUsers > 0 ? Math.round((st.users / startUsers) * 100) : 0;

    res.json({ steps, totalEvents: (events || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// アンケートフォローアップ（未回答リマインド / レビュー未クリックリマインド）
// テーブル: survey_followup_rules, survey_followup_log
// ===========================================================================

// CRUD: ルール一覧
router.get('/survey-followups', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('survey_followup_rules')
      .select('*')
      .order('type').order('delay_days');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// CRUD: ルール作成
router.post('/survey-followups', async (req, res) => {
  try {
    const { name, type, delay_days, response_messages } = req.body;
    if (!type || !delay_days || !response_messages) {
      return res.status(400).json({ error: 'type, delay_days, response_messages required' });
    }
    const { data, error } = await supabase
      .from('survey_followup_rules')
      .insert({ name: name || '', type, delay_days, response_messages, is_active: true })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// CRUD: ルール更新
router.put('/survey-followups/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('survey_followup_rules')
      .update(req.body)
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// CRUD: ルール削除
router.delete('/survey-followups/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('survey_followup_rules')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// CRUD: ルール有効/無効切替
router.patch('/survey-followups/:id/toggle', async (req, res) => {
  try {
    const { is_active } = req.body;
    const { data, error } = await supabase
      .from('survey_followup_rules')
      .update({ is_active })
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /survey-followups/stats - フォローアップ統計
router.get('/survey-followups/stats', async (req, res) => {
  try {
    // 送信済みフォローアップ数
    const { count: totalSent } = await supabase
      .from('survey_followup_log')
      .select('id', { count: 'exact', head: true });

    // ルール別送信数
    const { data: rules } = await supabase
      .from('survey_followup_rules')
      .select('id, name, type');

    const ruleStats = [];
    for (const rule of (rules || [])) {
      const { count } = await supabase
        .from('survey_followup_log')
        .select('id', { count: 'exact', head: true })
        .eq('rule_id', rule.id);
      ruleStats.push({ ...rule, sent_count: count || 0 });
    }

    return res.json({ totalSent: totalSent || 0, rules: ruleStats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /survey-followups/process - cronから呼ばれるフォローアップ処理
router.get('/survey-followups/process', async (req, res) => {
  try {
    const result = await processSurveyFollowups();
    return res.json(result);
  } catch (err) {
    console.error('[survey-followups/process] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

async function processSurveyFollowups() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { processed: 0, message: 'No LINE token' };

  // アクティブなルールを取得
  const { data: rules } = await supabase
    .from('survey_followup_rules')
    .select('*')
    .eq('is_active', true);

  if (!rules || rules.length === 0) return { processed: 0, message: 'No active rules' };

  let processed = 0;
  const results = [];

  for (const rule of rules) {
    const messages = Array.isArray(rule.response_messages) ? rule.response_messages : [];
    if (messages.length === 0) continue;

    let targets = [];

    if (rule.type === 'no_survey') {
      // アンケート未回答者: リンク送信済み + delay_days経過 + surveysに回答なし
      const cutoff = new Date(Date.now() - rule.delay_days * 24 * 60 * 60 * 1000).toISOString();

      const { data: sentItems } = await supabase
        .from('tag_delivery_queue')
        .select('friend_id')
        .eq('status', 'sent')
        .lte('sent_at', cutoff);

      if (!sentItems || sentItems.length === 0) continue;

      const friendIds = [...new Set(sentItems.map(i => i.friend_id))];

      // 友だち情報取得
      const { data: friends } = await supabase
        .from('friends')
        .select('id, line_user_id, display_name, channel_id, status')
        .in('id', friendIds)
        .eq('status', 'active');

      if (!friends || friends.length === 0) continue;

      // 回答済みline_user_idを取得
      const lineUserIds = friends.map(f => f.line_user_id).filter(Boolean);
      const { data: answeredSurveys } = await supabase
        .from('surveys')
        .select('line_user_id, user_id')
        .or(lineUserIds.length > 0
          ? `line_user_id.in.(${lineUserIds.join(',')})`
          : 'line_user_id.is.null');

      const answeredLineIds = new Set((answeredSurveys || []).map(s => s.line_user_id).filter(Boolean));
      const answeredEmails = new Set((answeredSurveys || []).map(s => s.user_id).filter(Boolean));

      // line_shopify_linksでメール紐付けも確認
      const { data: links } = await supabase
        .from('line_shopify_links')
        .select('line_user_id, shopify_email')
        .in('line_user_id', lineUserIds);
      const emailByLineId = Object.fromEntries((links || []).map(l => [l.line_user_id, l.shopify_email]));

      // フォローアップ済みを除外
      const { data: alreadySent } = await supabase
        .from('survey_followup_log')
        .select('friend_id')
        .eq('rule_id', rule.id);
      const sentFriendIds = new Set((alreadySent || []).map(s => s.friend_id));

      targets = friends.filter(f => {
        if (sentFriendIds.has(f.id)) return false;
        if (answeredLineIds.has(f.line_user_id)) return false;
        const email = emailByLineId[f.line_user_id];
        if (email && answeredEmails.has(email)) return false;
        return true;
      });

    } else if (rule.type === 'no_review') {
      // レビュー未クリック者: アンケート回答済み(★4-5) + delay_days経過 + レビュー未クリック
      const cutoff = new Date(Date.now() - rule.delay_days * 24 * 60 * 60 * 1000).toISOString();

      const minRating = rule.min_rating || 4;
      const { data: unreviewedSurveys } = await supabase
        .from('surveys')
        .select('id, line_user_id, user_id')
        .gte('rating', minRating)
        .is('amazon_button_clicked_at', null)
        .lte('created_at', cutoff);

      if (!unreviewedSurveys || unreviewedSurveys.length === 0) continue;

      // line_user_idまたはemailから友だちを特定
      const surveyLineIds = unreviewedSurveys.map(s => s.line_user_id).filter(Boolean);
      const surveyEmails = unreviewedSurveys.map(s => s.user_id).filter(Boolean);

      let friendCandidates = [];

      if (surveyLineIds.length > 0) {
        const { data: f1 } = await supabase
          .from('friends')
          .select('id, line_user_id, display_name, channel_id, status')
          .in('line_user_id', surveyLineIds)
          .eq('status', 'active');
        if (f1) friendCandidates.push(...f1);
      }

      // emailからline_user_id経由で友だちを検索
      if (surveyEmails.length > 0) {
        const { data: emailLinks } = await supabase
          .from('line_shopify_links')
          .select('line_user_id, shopify_email')
          .in('shopify_email', surveyEmails);

        if (emailLinks && emailLinks.length > 0) {
          const emailLinkedLineIds = emailLinks.map(l => l.line_user_id);
          const { data: f2 } = await supabase
            .from('friends')
            .select('id, line_user_id, display_name, channel_id, status')
            .in('line_user_id', emailLinkedLineIds)
            .eq('status', 'active');
          if (f2) friendCandidates.push(...f2);
        }
      }

      // 重複除去
      const seen = new Set();
      friendCandidates = friendCandidates.filter(f => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });

      // フォローアップ済みを除外
      const { data: alreadySent } = await supabase
        .from('survey_followup_log')
        .select('friend_id')
        .eq('rule_id', rule.id);
      const sentFriendIds = new Set((alreadySent || []).map(s => s.friend_id));

      targets = friendCandidates.filter(f => !sentFriendIds.has(f.id));
    }

    // 対象者にメッセージ送信
    for (const friend of targets.slice(0, 50)) {
      if (!friend.line_user_id) continue;

      try {
        const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ to: friend.line_user_id, messages: messages.slice(0, 5) }),
        });

        if (pushRes.ok) {
          // ログ記録
          await supabase.from('survey_followup_log').insert({
            rule_id: rule.id,
            friend_id: friend.id,
          });

          // チャットログに記録
          if (friend.channel_id) {
            const textParts = messages.filter(m => m.type === 'text' && m.text).map(m => m.text);
            await supabase.from('chat_messages').insert({
              channel_id: friend.channel_id,
              friend_id: friend.id,
              direction: 'outgoing',
              message_type: 'text',
              content: { messages, text: textParts.join('\n'), source: 'survey_followup', rule_id: rule.id, rule_type: rule.type },
            });
          }

          console.log(`[survey-followup] Sent ${rule.type} to ${friend.display_name} (rule: ${rule.name})`);
          processed++;
          results.push({ friend: friend.display_name, type: rule.type, status: 'sent' });
        } else {
          const errBody = await pushRes.text().catch(() => '');
          console.error(`[survey-followup] Push failed for ${friend.display_name}: ${pushRes.status} ${errBody}`);
          results.push({ friend: friend.display_name, type: rule.type, status: 'error' });
        }
      } catch (err) {
        console.error(`[survey-followup] Error for ${friend.display_name}:`, err.message);
        results.push({ friend: friend.display_name, type: rule.type, status: 'error' });
      }
    }
  }

  return { processed, results };
}

// GET /survey-followups/:id/recipients - 配信予定者・配信済み者一覧
router.get('/survey-followups/:id/recipients', async (req, res) => {
  try {
    const { id } = req.params;

    // ルール取得
    const { data: rule, error: ruleErr } = await supabase
      .from('survey_followup_rules')
      .select('*')
      .eq('id', id)
      .single();
    if (ruleErr || !rule) return res.status(404).json({ error: 'Rule not found' });

    // 配信済み一覧
    const { data: sentLogs } = await supabase
      .from('survey_followup_log')
      .select('friend_id, sent_at')
      .eq('rule_id', id)
      .order('sent_at', { ascending: false });

    const sentFriendIds = (sentLogs || []).map(l => l.friend_id);
    const sentAtMap = Object.fromEntries((sentLogs || []).map(l => [l.friend_id, l.sent_at]));

    let sentFriends = [];
    if (sentFriendIds.length > 0) {
      const { data } = await supabase
        .from('friends')
        .select('id, display_name, picture_url, line_user_id')
        .in('id', sentFriendIds);
      sentFriends = (data || []).map(f => ({ ...f, sent_at: sentAtMap[f.id] }))
        .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
    }

    // 配信予定者（processSurveyFollowupsと同じロジック）
    let pendingFriends = [];
    const cutoff = new Date(Date.now() - rule.delay_days * 24 * 60 * 60 * 1000).toISOString();
    const sentSet = new Set(sentFriendIds);

    if (rule.type === 'no_survey') {
      const { data: sentItems } = await supabase
        .from('tag_delivery_queue')
        .select('friend_id')
        .eq('status', 'sent')
        .lte('sent_at', cutoff);

      if (sentItems && sentItems.length > 0) {
        const friendIds = [...new Set(sentItems.map(i => i.friend_id))];
        const { data: friends } = await supabase
          .from('friends')
          .select('id, line_user_id, display_name, picture_url, status')
          .in('id', friendIds)
          .eq('status', 'active');

        if (friends && friends.length > 0) {
          const lineUserIds = friends.map(f => f.line_user_id).filter(Boolean);
          const { data: answeredSurveys } = await supabase
            .from('surveys')
            .select('line_user_id, user_id')
            .or(lineUserIds.length > 0
              ? `line_user_id.in.(${lineUserIds.join(',')})`
              : 'line_user_id.is.null');

          const answeredLineIds = new Set((answeredSurveys || []).map(s => s.line_user_id).filter(Boolean));
          const answeredEmails = new Set((answeredSurveys || []).map(s => s.user_id).filter(Boolean));

          const { data: links } = await supabase
            .from('line_shopify_links')
            .select('line_user_id, shopify_email')
            .in('line_user_id', lineUserIds);
          const emailByLineId = Object.fromEntries((links || []).map(l => [l.line_user_id, l.shopify_email]));

          pendingFriends = friends.filter(f => {
            if (sentSet.has(f.id)) return false;
            if (answeredLineIds.has(f.line_user_id)) return false;
            const email = emailByLineId[f.line_user_id];
            if (email && answeredEmails.has(email)) return false;
            return true;
          }).map(f => ({ id: f.id, display_name: f.display_name, picture_url: f.picture_url }));
        }
      }
    } else if (rule.type === 'no_review') {
      const minRating = rule.min_rating || 4;
      const { data: unreviewedSurveys } = await supabase
        .from('surveys')
        .select('id, line_user_id, user_id')
        .gte('rating', minRating)
        .is('amazon_button_clicked_at', null)
        .lte('created_at', cutoff);

      if (unreviewedSurveys && unreviewedSurveys.length > 0) {
        const surveyLineIds = unreviewedSurveys.map(s => s.line_user_id).filter(Boolean);
        const surveyEmails = unreviewedSurveys.map(s => s.user_id).filter(Boolean);

        let friendCandidates = [];

        if (surveyLineIds.length > 0) {
          const { data: f1 } = await supabase
            .from('friends')
            .select('id, line_user_id, display_name, picture_url, status')
            .in('line_user_id', surveyLineIds)
            .eq('status', 'active');
          if (f1) friendCandidates.push(...f1);
        }

        if (surveyEmails.length > 0) {
          const { data: emailLinks } = await supabase
            .from('line_shopify_links')
            .select('line_user_id, shopify_email')
            .in('shopify_email', surveyEmails);
          if (emailLinks && emailLinks.length > 0) {
            const emailLinkedLineIds = emailLinks.map(l => l.line_user_id);
            const { data: f2 } = await supabase
              .from('friends')
              .select('id, line_user_id, display_name, picture_url, status')
              .in('line_user_id', emailLinkedLineIds)
              .eq('status', 'active');
            if (f2) friendCandidates.push(...f2);
          }
        }

        const seen = new Set();
        friendCandidates = friendCandidates.filter(f => {
          if (seen.has(f.id)) return false;
          seen.add(f.id);
          return true;
        });

        pendingFriends = friendCandidates.filter(f => !sentSet.has(f.id))
          .map(f => ({ id: f.id, display_name: f.display_name, picture_url: f.picture_url }));
      }
    }

    return res.json({ pending: pendingFriends, sent: sentFriends });
  } catch (err) {
    console.error('GET /survey-followups/:id/recipients error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
