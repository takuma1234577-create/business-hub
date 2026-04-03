const express = require('express');
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

// GET /chat/:friendId - Get chat messages for a friend
router.get('/chat/:friendId', async (req, res) => {
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

    // Return in chronological order
    return res.json(data ? data.reverse() : []);
  } catch (err) {
    console.error('GET /chat/:friendId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /chat/:friendId - Send message (insert into chat_messages)
router.post('/chat/:friendId', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { content, message_type = 'text', direction = 'outgoing' } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        friend_id: friendId,
        content,
        message_type,
        direction,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /chat/:friendId error:', err);
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
    const { keyword, response_text, match_type = 'exact', is_active = true } = req.body;

    if (!keyword || !response_text) {
      return res
        .status(400)
        .json({ error: 'keyword and response_text are required' });
    }

    const { data, error } = await supabase
      .from('auto_responses')
      .insert({ keyword, response_text, match_type, is_active })
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
    const { keyword, response_text, match_type, is_active } = req.body;

    const updates = {};
    if (keyword !== undefined) updates.keyword = keyword;
    if (response_text !== undefined) updates.response_text = response_text;
    if (match_type !== undefined) updates.match_type = match_type;
    if (is_active !== undefined) updates.is_active = is_active;
    updates.updated_at = new Date().toISOString();

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
        updated_at: new Date().toISOString(),
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
          model: 'gpt-4',
          system_prompt: '',
          temperature: 0.7,
        });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
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
      model,
      system_prompt,
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
    if (enabled !== undefined) payload.enabled = enabled;
    if (model !== undefined) payload.model = model;
    if (system_prompt !== undefined) payload.system_prompt = system_prompt;
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

module.exports = router;
