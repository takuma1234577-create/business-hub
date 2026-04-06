const express = require('express');
const axios = require('axios');
const { getSupabase } = require('./shared.cjs');
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const router = express.Router();

// ===========================================================================
// Friends
// ===========================================================================

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
      .select('id, line_user_id, display_name, picture_url, status')
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

function describePostback(data) {
  if (typeof data !== 'string') return '';
  // Parse query-string style postback data
  try {
    const params = new URLSearchParams(data);
    const action = params.get('action');
    if (action === 'send_template') {
      return 'テンプレート送信をリクエスト';
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
  if (typeof c.data === 'string') return describePostback(c.data);
  return '';
}

function normalizeDirection(d) {
  if (d === 'inbound' || d === 'incoming') return 'incoming';
  if (d === 'outbound' || d === 'outgoing') return 'outgoing';
  return d;
}

function normalizeChatMessage(row) {
  if (!row) return row;
  return {
    id: row.id,
    friend_id: row.friend_id,
    direction: normalizeDirection(row.direction),
    message_type: row.message_type,
    content: extractTextFromContent(row.content),
    sent_at: row.created_at,
    created_at: row.created_at,
  };
}

// GET /chat/:friendId/messages - Get chat messages for a friend
router.get('/chat/:friendId/messages', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { limit = '50', before } = req.query;
    const msgLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));

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

    return res.status(201).json(normalizeChatMessage(data));
  } catch (err) {
    console.error('POST /chat/:friendId/send error:', err);
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
    const { name, keywords, response_messages, match_type, is_active, priority, folder } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (keywords !== undefined) updates.keywords = keywords;
    if (response_messages !== undefined) updates.response_messages = response_messages;
    if (match_type !== undefined) updates.match_type = match_type;
    if (is_active !== undefined) updates.is_active = is_active;
    if (priority !== undefined) updates.priority = priority;
    if (folder !== undefined) updates.folder = folder || null;

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
    const { title, content, scheduled_at, target_tag_ids } = req.body;

    if (!title || !content) {
      return res
        .status(400)
        .json({ error: 'title and content are required' });
    }

    const { data, error } = await supabase
      .from('broadcasts')
      .insert({
        title,
        content,
        scheduled_at: scheduled_at || null,
        target_tag_ids: target_tag_ids || null,
        status: 'draft',
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

// POST /broadcasts/:id/send - Mark broadcast as sending
router.post('/broadcasts/:id/send', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('broadcasts')
      .update({
        status: 'sending',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Broadcast not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, broadcast: data });
  } catch (err) {
    console.error('POST /broadcasts/:id/send error:', err);
    return res.status(500).json({ error: 'Internal server error' });
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
      is_active: data.enabled ?? false,
      system_instructions: data.system_prompt ?? '',
      persona: data.persona ?? '',
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
    if (enabled !== undefined) payload.enabled = enabled;
    if (is_active !== undefined) payload.enabled = is_active;
    if (model !== undefined) payload.model = model;
    if (system_prompt !== undefined) payload.system_prompt = system_prompt;
    if (system_instructions !== undefined) payload.system_prompt = system_instructions;
    if (persona !== undefined) payload.persona = persona;
    if (temperature !== undefined) payload.temperature = temperature;
    if (max_tokens !== undefined) payload.max_tokens = max_tokens;
    if (api_key !== undefined) payload.api_key = api_key;
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
const multer = require('multer');
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

async function replyToLine(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
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
  } catch (err) {
    console.error('[line-webhook] logWebhookMessage error:', err.message);
  }
}

// POST /api/line-crm/webhook  （LINE Messaging API）
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const rawBody = req.rawBody;

  if (!verifyLineSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // LINE仕様: 何があっても即 200 を返す
  res.status(200).json({ status: 'ok' });

  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  // AI自動応答の有効/無効をチェック
  let aiEnabled = true;
  try {
    const { data: aiSettings } = await supabase
      .from('ai_settings')
      .select('enabled')
      .limit(1)
      .maybeSingle();
    if (aiSettings && aiSettings.enabled === false) {
      aiEnabled = false;
    }
  } catch (err) {
    console.error('[line-webhook] ai_settings check error:', err.message);
  }

  for (const event of events) {
    if (event?.type !== 'message' || event?.message?.type !== 'text') continue;
    const userMessage = event.message.text;

    if (!aiEnabled) {
      // AI無効時はメッセージの記録のみ行い、返信しない
      logWebhookMessage(event, userMessage, null);
      continue;
    }

    let aiReply;
    try {
      aiReply = await generateFITPEAKReply(userMessage);
    } catch (err) {
      console.error('[line-webhook] generateFITPEAKReply error:', err.message);
      aiReply = '確認してご連絡します🙏';
    }
    try {
      await replyToLine(event.replyToken, aiReply);
    } catch (err) {
      console.error('[line-webhook] replyToLine error:', err.message);
    }
    logWebhookMessage(event, userMessage, aiReply);
  }
});

module.exports = router;
