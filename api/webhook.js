// api/cron/process-drips.js
// VERSION: Gemini 3 Flash Preview + Supabase

export default async function handler(req, res) {
  // 1. HELPER: Supabase Request
  async function supabaseRequest(endpoint, method, body = null) {
    const url = `${process.env.SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers = {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };
    if (method === 'GET') headers['Prefer'] = 'return=representation';
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    if (!response.ok) return null;
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  const now = new Date().toISOString();

  // 2. FIND DUE TASKS
  // We look for tasks that are 'pending' and the scheduled time has passed
  const tasks = await supabaseRequest(`drip_queue?status=eq.pending&scheduled_at=lte.${now}&limit=10&select=*`, 'GET');

  if (!tasks || tasks.length === 0) return res.json({ status: "No tasks due" });

  const results = [];

  for (const task of tasks) {
    try {
      // A. GENERATE MESSAGE WITH GEMINI 3
      const prompt = `
        You are the ALAT by Wema AI Assistant.
        CONTEXT: The user (${task.user_phone}) stopped responding earlier.
        GOAL: ${task.context}
        
        Write a short, friendly, professional WhatsApp message to re-engage them.
        Keep it under 1 sentence. No emojis.
      `;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "text/plain" }
        })
      });

      const geminiData = await geminiResponse.json();
      // Fallback text if Gemini fails
      const aiMessage = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Hello! Just checking in.";

      // B. SEND TO WHATSAPP
      const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
      await fetch(WHATSAPP_URL, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
          messaging_product: "whatsapp", 
          to: task.user_phone, 
          text: { body: aiMessage } 
        })
      });

      // C. MARK AS SENT
      await supabaseRequest(`drip_queue?id=eq.${task.id}`, 'PATCH', { status: 'sent' });
      
      // D. LOG HISTORY
      await supabaseRequest('messages', 'POST', { user_phone: task.user_phone, role: 'assistant', content: `[Drip]: ${aiMessage}` });

      results.push({ phone: task.user_phone, status: "Sent" });

    } catch (e) {
      console.error("Drip Error:", e);
      // Mark failed so we don't loop forever
      await supabaseRequest(`drip_queue?id=eq.${task.id}`, 'PATCH', { status: 'failed' });
    }
  }

  return res.json({ processed: results });
}
