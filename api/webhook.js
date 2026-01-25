// api/webhook.js
// VERSION: NUCLEAR FIX - Safety Filters Disabled + Aggressive Logging

export default async function handler(req, res) {
  // 1. HELPER: Talk to Supabase
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
    try {
      const response = await fetch(url, options);
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (err) { return null; }
  }

  // 2. CONFIGURATION
  const SYSTEM_PROMPT = `
  You are **Muyi**, the AI assistant representing GinoskoAI and Bamisoro.
  Your goal is to help businesses and answer questions about loans/accounts.

  CRITICAL: OUTPUT JSON ONLY.
  { "response": { "type": "text", "body": "Your answer here" }, "memory_update": "Summary" }
  `;

  // 3. Verify Webhook (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 4. Handle Messages (POST)
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const senderPhone = message.from;
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      const now = new Date();
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;

      if (userInput) {
        try {
          // --- SMART CANCEL ---
          await supabaseRequest(`drip_queue?user_phone=eq.${senderPhone}&status=eq.pending`, 'PATCH', { status: 'cancelled' });

          // A. GET PROFILE
          const profileUrl = `user_profiles?phone=eq.${senderPhone}&select=*`;
          const profileData = await supabaseRequest(profileUrl, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName, last_updated: now.toISOString() });
            currentProfile = { name: whatsappName, summary: "" };
          } else {
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { last_updated: now.toISOString() });
          }

          // B. GET HISTORY
          const historyUrl = `messages?user_phone=eq.${senderPhone}&order=id.desc&limit=15&select=role,content`;
          const historyData = await supabaseRequest(historyUrl, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          const fullConversation = [
            ...chatHistory, 
            { role: "user", parts: [{ text: `User Name: ${currentProfile.name}\nKnown Facts: ${currentProfile.summary}\n\nUser Input: ${userInput}` }] }
          ];

          // C. ASK GEMINI (With Safety Filters DISABLED)
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiPayload = {
            contents: fullConversation,
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: { responseMimeType: "application/json" },
            // 🔥 DISABLE SAFETY FILTERS (This fixes the "Loan" blocking issue)
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          };

          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
          });

          const geminiData = await geminiResponse.json();
          
          // D. LOGGING (So we see if it fails)
          if (!geminiData.candidates) {
            console.error("❌ GEMINI BLOCKED/FAILED:", JSON.stringify(geminiData));
          }

          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
          
          // E. ROBUST PARSING
          let aiOutput;
          try {
             aiOutput = JSON.parse(aiRawText.replace(/```json|```/g, "").trim());
          } catch (e) {
             // Fallback if AI sends text instead of JSON
             aiOutput = { response: { type: "text", body: aiRawText.length > 0 ? aiRawText : "I am researching that loan info for you, one moment..." } };
          }

          // F. SEND TO WHATSAPP
          const aiReply = aiOutput.response || { type: "text", body: "I am researching that loan info for you, one moment..." }; // NO MORE "..."
          
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};

          if (aiReply.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          } 
          else if (aiReply.type === "button") {
             const safeOptions = (aiReply.options || []).slice(0, 3);
             const buttons = safeOptions.map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } };
          }

          if (payload.messaging_product) {
            await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });
            
            // Log interaction
            const logContent = aiReply.type === 'text' ? aiReply.body : `[Sent ${aiReply.type}]`;
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: logContent });
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'user', content: userInput });
          }

        } catch (error) { console.error("CRITICAL ERROR:", error); }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
