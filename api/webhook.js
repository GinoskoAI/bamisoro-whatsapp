// api/webhook.js
// VERSION: GEMINI 3 FLASH PREVIEW (User Specified)

export default async function handler(req, res) {
  
  // 1. HELPER: Supabase Fetcher
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
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Supabase Error (${endpoint}): ${errText}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  // 2. SYSTEM PROMPT (ALAT)
  const SYSTEM_PROMPT = `
  You are the **ALAT by Wema AI Assistant**. 🟣
  You represent **ALAT**, Nigeria's first fully digital bank.

  YOUR PERSONALITY:
  - **Tone:** Professional, Modern, Helpful, and Secure.
  - **Vibe:** "The Bank of the Future." Friendly but precise.

  YOUR GOALS:
  1. **Account Opening:** Guide users to open accounts.
  2. **Loans:** Explain eligibility (Salary earners, business loans).
  3. **Support:** Help with card requests and app issues.

  CRITICAL: OUTPUT JSON ONLY.
  { "response": { "type": "text", "body": "..." }, "memory_update": "..." }
  `;

  // 3. VERIFY (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 4. HANDLE MESSAGES (POST)
  if (req.method === 'POST') {
    const body = req.body;
    
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const senderPhone = message.from;
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;

      if (userInput) {
        try {
          // A. GET PROFILE
          let currentProfile = {};
          try {
            const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=*`, 'GET');
            currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};
            
            if (!currentProfile.phone) {
                await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName });
            }
          } catch (dbErr) { console.error("DB Error:", dbErr); }

          // B. PREPARE CONTEXT
          const fullConversation = [
            { role: "user", parts: [{ text: `User: ${whatsappName}\nInput: "${userInput}"` }] }
          ];

          // C. CALL GEMINI (USER SPECIFIED MODEL)
          // Exact model name: gemini-3-flash-preview
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: fullConversation,
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: { responseMimeType: "application/json" }
            })
          });

          const geminiData = await geminiResponse.json();
          
          // --- DEBUG GEMINI ERROR ---
          if (geminiData.error) {
             throw new Error(`Gemini API Error: ${geminiData.error.message}`);
          }

          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
          let aiOutput = JSON.parse(aiRawText);

          // D. SEND REPLY
          const aiReply = aiOutput.response || { type: "text", body: "..." };
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const WP_HEADERS = { 
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
            'Content-Type': 'application/json' 
          };

          await fetch(WHATSAPP_URL, {
              method: 'POST', 
              headers: WP_HEADERS, 
              body: JSON.stringify({ 
                  messaging_product: "whatsapp", 
                  to:
