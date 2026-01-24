// api/save-call.js
// VERSION: Deep Logging & Debugging

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. LOG RAW INPUT (Crucial for debugging)
  console.log("📥 Raw Body Type:", typeof req.body);
  console.log("📥 Raw Body Content:", JSON.stringify(req.body));

  let body = req.body;

  // 2. Defensive Parsing
  try {
    if (!body) return res.status(400).json({ error: 'Request body is empty' });
    if (typeof body === 'string') {
        console.log("⚠️ Body is string, parsing manually...");
        body = JSON.parse(body);
    }
  } catch (e) {
    console.error("❌ JSON Parse Error:", e.message);
    return res.status(400).json({ error: 'Invalid JSON body', details: e.message });
  }

  // 3. Extract & Validate
  const { phone, summary, new_facts } = body;

  // Debug Log
  console.log("🔍 Extracted Data -> Phone:", phone, "| Summary:", summary ? "Yes" : "No");

  if (!phone || !summary) {
    console.error("❌ Validation Failed. Missing phone or summary.");
    return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['phone', 'summary'], 
        received: Object.keys(body) 
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // Helper
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

    // 4. Save to Messages
    await supabase('messages', 'POST', {
      user_phone: phone,
      role: 'assistant',
      content: `[VOICE CALL SUMMARY]: ${summary}`
    });

    // 5. Save to Profile
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

    console.log("✅ Memory Saved Successfully");
    return res.status(200).json({ status: 'Memory Updated' });

  } catch (error) {
    console.error("❌ Internal API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error', msg: error.message });
  }
}
