// api/save-call.js
// VERSION: Robust Upsert (Creates Profile if Missing)

export default async function handler(req, res) {
  // 1. Universal Parser (Body + Query)
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payload = { ...data, ...req.query };
  const { phone, summary, new_facts, name } = payload; // Ultravox should pass 'name' too if known

  if (!phone || !summary) {
    return res.status(400).json({ error: 'Missing phone or summary', received: payload });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  const HEADERS = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal' // Default for inserts
  };

  try {
    // 2. CHECK: Does this user exist?
    const checkReq = await fetch(`${supabaseUrl}/rest/v1/user_profiles?phone=eq.${phone}&select=*`, {
      method: 'GET',
      headers: { ...HEADERS, 'Prefer': 'return=representation' }
    });
    
    const users = await checkReq.json();
    const userExists = users && users.length > 0;
    const currentSummary = userExists ? users[0].summary : "";

    // 3. LOGIC: Insert or Update
    if (!userExists) {
      // SCENARIO A: NEW USER (The "Missing Record" Fix)
      // We create the profile using the Name from the Voice Call (which is usually better than WhatsApp name)
      console.log("🆕 Creating new profile from Voice Call data...");
      
      const initialSummary = `[Initial Voice Call]: ${summary}\n- Facts: ${new_facts || "None"}`;
      
      await fetch(`${supabaseUrl}/rest/v1/user_profiles`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          phone: phone,
          name: name || "Voice Lead", // Fallback if Ultravox didn't catch the name
          summary: initialSummary,
          last_updated: new Date().toISOString()
        })
      });

    } else {
      // SCENARIO B: EXISTING USER
      // We append to the history, we DO NOT overwrite the name (unless you want to logic for that)
      console.log("🔄 Updating existing profile...");
      
      const updatedSummary = (currentSummary + `\n\n[Voice Call]: ${summary}\n- Facts: ${new_facts || ""}`).slice(-3000);
      
      await fetch(`${supabaseUrl}/rest/v1/user_profiles?phone=eq.${phone}`, {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({
          summary: updatedSummary,
          last_updated: new Date().toISOString()
        })
      });
    }

    // 4. Log the "Fake" Message for Chat Context
    await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        user_phone: phone,
        role: 'assistant',
        content: `[SYSTEM: Voice Call Ended. Summary: ${summary}]`
      })
    });

    return res.status(200).json({ status: 'Memory Saved' });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
