// api/webhook.js
// VERSION: FIXED - Robust JSON Parsing (No more "...")

export default async function handler(req, res) {
  // ============================================================
  // 1. HELPER: Talk to Supabase
  // ============================================================
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

  // ============================================================
  // 2. CONFIGURATION: The "Muyi" System Persona
  // ============================================================
  const SYSTEM_PROMPT = `
  You are **Muyi**, the AI assistant representing GinoskoAI and Bamisoro.

  YOUR PERSONALITY:
  - **Tone:** Enthusiastic, Energetic, Warm, and Professional! 🌟
  - **Vibe:** You are excited to help African businesses grow.
  - **Emoji Strategy:** Use "Visual Anchors" (e.g., "✅ **Verified**").

  CRITICAL: FORMATTING RULES (WHATSAPP MODE):
  1. **Whitespace:** ALWAYS use double line breaks (\n\n).
  2. **Bold:** Use *asterisks* for headers.
  3. **Brevity:** Keep it punchy.

  YOUR KNOWLEDGE BASE:
  1. **GINOSKOAI:** Mission: Simplify AI for African businesses.
  2. **BAMISORO:** Voice + WhatsApp + Email Omnichannel Platform.
  3. **CONTACT:**
     - 📅 **Book Meeting:** https://calendly.com/muyog03/30min
     - 📞 **Phone:** +234 708 645 4726

  CRITICAL: OUTPUT FORMAT (Strict JSON)
  You MUST return valid JSON. Do not wrap it in markdown code blocks.
  
  Example 1 (Text):
  { "response": { "type": "text", "body": "Hello! How can I help?" }, "memory_update": "User greeted." }

  Example 2 (Buttons):
  { "response": { "type": "button", "body": "Choose an option:", "options": ["Book Demo 📅", "Services 🛠️"] }, "memory_update": "Offered menu." }
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
      
      // --- CAPTURE SYSTEM VARIABLES ---
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
      const dateString = now.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', month: 'long', day: 'numeric' });
      
      // Input Type Handling
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;

      if (userInput) {
        try {
          // --- SMART CANCEL ---
          await supabaseRequest(
            `drip_queue?user_phone=eq.${senderPhone}&status=eq.pending`, 
            'PATCH', 
            { status: 'cancelled' }
          );

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

          // C. PREPARE PROMPT
          const contextString = `
            SYSTEM CONTEXT:
            - 🕒 Time: ${timeString}
            - 📅 Date: ${dateString}
            
            USER DOSSIER:
            - Name: ${currentProfile.name}
            - Phone: ${senderPhone}
            - Facts: ${currentProfile.summary || "None."}
            
            USER INPUT: "${userInput}"
          `;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // D. ASK GEMINI (1.5 Flash)
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: fullConversation,
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: { responseMimeType: "application/json" } // Force JSON mode
            })
          });

          const geminiData = await
