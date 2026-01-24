// api/save-call.js
// This tool allows the Voice Agent to "save" memories into the Chatbot's brain.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { phone, summary, new_facts } = req.body;

  if (!phone || !summary) {
    return res.status(400).json({ error: 'Missing phone or summary' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // HELPER: Simple Fetch Wrapper for Supabase
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

    // 1. LOG TO MESSAGE HISTORY (Short-Term Memory)
    // This inserts a "fake" message so the Chatbot sees it as the last thing that happened.
    await supabase('messages', 'POST', {
      user_phone: phone,
      role: 'assistant', // Log it as the AI speaking (or 'system' if you prefer)
      content: `[VOICE CALL SUMMARY]: ${summary}`
    });

    // 2. UPDATE USER PROFILE (Long-Term Memory)
    // If the Voice Agent learned new facts (e.g. "User is a Baker"), we append it.
    if (new_facts) {
      // First, get the existing profile to avoid overwriting
      const getProfile = await fetch(`${supabaseUrl}/rest/v1/user_profiles?phone=eq.${phone}&select=summary`, {
         headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      
      let existingSummary = "";
      if (getProfile.ok) {
        const data = await getProfile.json();
        if (data.length > 0) existingSummary = data[0].summary || "";
      }

      // Append new facts
      const updatedSummary = (existingSummary + "\n- " + new_facts).slice(-3000);

      // Save back to DB
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
