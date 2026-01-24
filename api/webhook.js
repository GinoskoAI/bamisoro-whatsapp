// api/webhook.js
// VERSION: Bulletproof JSON Handling

export default async function handler(req, res) {
  // ============================================================
  // 1. HELPER: Talk to Supabase (Now Crash-Proof!)
  // ============================================================
  async function supabaseRequest(endpoint, method, body = null) {
    const url = `${process.env.SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers = {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal' // Tells Supabase: "Don't send back the whole object, just save it."
    };
    
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    
    try {
      const response = await fetch(url, options);
      
      // FIX: If the response is empty (204 No Content), stop here.
      if (response.status === 204) return null;

      const text = await response.text();
      // Only try to parse if there is actually text
      return text ? JSON.parse(text) : null;

    } catch (err) {
      console.error(`Supabase Error (${endpoint}):`, err);
      return null;
    }
  }

  // ============================================================
  // 2. CONFIGURATION: System Prompt
  // ============================================================
  const SYSTEM_PROMPT = `
  You are Bamisoro, a smart AI assistant for Nigerian businesses.
  CRITICAL: Reply in strict JSON format.
  1. TEXT: { "type": "text", "body": "..." }
  2. BUTTONS: { "type": "button", "body": "...", "options": ["..."] }
  Context: Use the conversation history provided.
  `;

  // 3. Verify Webhook (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 4. Handle Messages (POST)
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const senderPhone = message.from;
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;

      if (userInput) {
        try {
          console.log("🔍 processing for:", senderPhone);

          // A. READ MEMORY (Safe Fetch)
          // We ask for role and content. We handle if the result is null.
          const historyUrl = `messages?user_phone=eq.${senderPhone}&order=id.desc&limit=10&select=role,content`;
          const historyData = await supabaseRequest(historyUrl, 'GET') || [];

          // Format history safely
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: userInput }] }];

          // B. ASK GEMINI
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: fullConversation,
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: { responseMimeType: "application/json" }
            })
          });

          // Handle Gemini Errors Safely
          if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Gemini API Error: ${errText}`);
          }

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          aiRawText = aiRawText.replace(/```json|```/g, "").trim();
          
          let aiInstruction;
          try {
             aiInstruction = JSON.parse(aiRawText);
          } catch (e) {
             console.error("AI returned bad JSON:", aiRawText);
             aiInstruction = { type: "text", body: "I am having trouble thinking right now." };
          }

          // C. WRITE MEMORY (Safe Save)
          await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'user', content: userInput });
          
          if (aiInstruction.body) {
             await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: aiInstruction.body });
          }

          // D. REPLY TO WHATSAPP
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          let payload = {};

          if (aiInstruction.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiInstruction.body } };
          } else if (aiInstruction.type === "button") {
             const buttons = aiInstruction.options.map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: aiInstruction.body }, action: { buttons: buttons } } };
          }

          if (payload.messaging_product) await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });

        } catch (error) { 
          console.error("CRITICAL ERROR:", error); 
        }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
