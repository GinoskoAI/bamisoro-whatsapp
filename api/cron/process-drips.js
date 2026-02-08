// api/cron/process-drips.js
// VERSION: WINDOW RESCUE (20-24 Hour Target)

export default async function handler(req, res) {
  
  // 1. QUIET HOURS (8 PM - 8 AM)
  // Even if the window is closing, we shouldn't wake people up.
  // If we miss the window because of sleep, we accept that we lost it.
  const now = new Date();
  const options = { timeZone: "Africa/Lagos", hour: 'numeric', hour12: false };
  const currentHour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now));

  if (currentHour < 8 || currentHour >= 20) {
    return res.status(200).json({ status: "skipped_quiet_hours" });
  }

  try {
    // 2. DEFINE THE "DANGER ZONE"
    // We want users who last spoke between 20 and 23.5 hours ago.
    // If it's > 24 hours, it's too late (text will fail).
    // If it's < 20 hours, it's too soon (don't annoy them).
    
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // QUERY: last_updated is OLDER than 20h AND NEWER than 24h
    // This strictly targets the open window.
    const usersUrl = `${process.env.SUPABASE_URL}/rest/v1/user_profiles?last_updated=lt.${twentyHoursAgo}&last_updated=gt.${twentyFourHoursAgo}&select=*&limit=10`;
    
    const headers = {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    const userRes = await fetch(usersUrl, { headers });
    const users = await userRes.json();

    if (!users || users.length === 0) {
      return res.status(200).json({ status: "no_users_in_danger_zone" });
    }

    // 3. PROCESS USERS
    const results = [];
    
    for (const user of users) {
      // A. GENERATE URGENT/ENGAGING PROMPT
      // Goal: Get them to reply to extend the window.
      const strategyPrompt = `
        CONTEXT:
        User Name: ${user.name}
        History: ${user.summary || "Unknown"}
        
        GOAL:
        The WhatsApp session is about to close (24h rule). 
        Re-engage the user immediately so they reply.
        
        INSTRUCTIONS:
        - Write a short, question-based nudge.
        - Do NOT say "Hello" or "Checking in".
        - Reference their last interest (Loan, Savings, Card).
        - Example: "Did you manage to try that transfer? Let me know if you need help!"
      `;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const aiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: strategyPrompt }] }] })
      });
      
      const aiData = await aiRes.json();
      const nudge = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (nudge) {
        // B. SEND MESSAGE
        const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
        const sendRes = await fetch(WHATSAPP_URL, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ 
            messaging_product: "whatsapp", 
            to: user.phone, 
            text: { body: nudge } 
          })
        });

        // C. CRITICAL: UPDATE TIMESTAMP
        // We MUST update this to "now". 
        // 1. If they reply -> Window extends 24h.
        // 2. If they don't reply -> They fall out of the 20-24h zone and we won't message them again (avoiding errors).
        if (sendRes.ok) {
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles?phone=eq.${user.phone}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ last_updated: new Date().toISOString() })
            });
            results.push({ user: user.phone, status: "rescued" });
        } else {
            // If send failed (e.g. window actually closed), mark updated anyway to stop retrying
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles?phone=eq.${user.phone}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ last_updated: new Date().toISOString() })
            });
            results.push({ user: user.phone, status: "failed_window_closed" });
        }
      }
    }

    return res.status(200).json({ status: "success", results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
