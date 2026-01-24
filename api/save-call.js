// api/save-call.js
// VERSION: Universal Parser (Checks Body AND Query)

export default async function handler(req, res) {
  // 1. Allow POST (and GET for easier browser testing/debugging)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. UNIVERSAL PARSER: Check Body first, then Query
  let data = req.body;
  
  // If body is undefined or empty string, try parsing or fallback to query
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string' && req.body.length > 0) {
      try { data = JSON.parse(req.body); } catch(e) {}
    }
  }
  
  // MERGE: Combine Query and Body (Query takes priority if Body fails)
  // This fixes the issue if Ultravox sends params in the URL
  const payload = { ...data, ...req.query };

  console.log("📥 Received Data:", JSON.stringify(payload));

  const { phone, summary, new_facts } = payload;

  if (!phone || !summary) {
    return res.status(400).json({ 
      error: 'Missing required fields', 
      details: 'We need "phone" and "summary".',
      received: payload 
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // Helper Function
    async function supabase(endpoint, method, body) {
      return fetch(`${supabaseUrl}/rest/v1/${endpoint}`, {
        method,
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(body)
      });
    }

    // 3. Save to Messages
    await supabase('messages', 'POST', {
      user_phone: phone,
      role: 'assistant',
      content: `[VOICE CALL SUMMARY]: ${summary}`
    });

    // 4. Save to Profile
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
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
