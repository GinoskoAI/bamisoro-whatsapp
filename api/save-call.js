// api/save-call.js
// VERSION: Hardened Body Parsing (Fixes "undefined" error)

export default async function handler(req, res) {
  // 1. Allow POST only
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. DEFENSIVE PARSING (The Fix)
  // Sometimes req.body is a string, sometimes undefined, sometimes an object.
  let body = req.body;

  try {
    // If body is missing, check if it's strictly undefined
    if (!body) {
      return res.status(400).json({ error: 'Request body is empty' });
    }
    // If Vercel passed it as a string (raw), parse it manually
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body', details: e.message });
  }

  // 3. Destructure from the SAFE body object
  const { phone, summary, new_facts } = body;

  if (!phone || !summary) {
    console.error("Missing Data:", body); // Log what we actually got
    return res.status(400).json({ error: 'Missing phone or summary fields', received: body });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // HELPER: Simple Fetch Wrapper
    async function supabase(endpoint, method, payload) {
      return fetch(`${supabaseUrl}/rest/v1/${endpoint}`, {
        method,
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      });
    }

    // 4. LOG TO MESSAGE HISTORY (Short-Term Memory)
    await supabase('messages', 'POST', {
      user_phone: phone,
      role: 'assistant',
      content: `[VOICE CALL SUMMARY]: ${summary}`
    });

    // 5. UPDATE USER PROFILE (Long-Term Memory)
    if (new_facts) {
      const getProfile = await fetch(`${supabaseUrl}/rest/v1/user_profiles?phone=eq.${phone}&select=summary`, {
         headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      
      let existingSummary = "";
      if (getProfile.ok) {
        const data = await getProfile.json();
        if (data && data.length > 0) existingSummary = data[0].summary || "";
      }

      const updatedSummary = (existingSummary + "\n- " + new_facts).slice(-3000);

      await supabase(`user_profiles?phone=eq.${phone}`, 'PATCH', {
        summary: updatedSummary,
        last_updated: new Date().toISOString()
      });
    }

    return res.status(200).json({ status: 'Memory Updated' });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
