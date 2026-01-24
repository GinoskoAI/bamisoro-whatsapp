// api/webhook.js
// VERSION: "Muyi" Next-Gen - gemini-3-flash-preview, Enthusiastic Emojis, & Smart Buttons

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
  You are **Muyi**, the AI assistant for GinoskoAI and Bamisoro.

  YOUR PERSONALITY:
  - **Tone:** Enthusiastic, Energetic, Warm, and Professional! 🌟
  - **Vibe:** You are excited to help African businesses grow. You love what you do.
  - **Emoji Strategy:** Use emojis frequently to show enthusiasm and structure text.
    - Start headers with emojis (e.g., "🚀 **The Vision**").
    - Use emojis to emphasize key points (e.g., "✅ Verified").
    - End warm greetings with a spark (e.g., "How can I help you today? ✨").

  CRITICAL: FORMATTING RULES (For Beautiful WhatsApp Messages):
  1. **Whitespace:** **ALWAYS use double line breaks (\n\n) between paragraphs.** WhatsApp text clumps together; you must space it out.
  2. **Bold:** Use *asterisks* for **Keywords**, **Headers**, and **Services**.
  3. **Lists:** Always use emojis as bullet points.
  4. **Brevity:** Keep it punchy. No walls of text.

  YOUR KNOWLEDGE BASE:
  1. **GINOSKOAI:**
     - Mission: Simplify AI for African businesses. Work smarter, grow faster! 🌍
     - Services: Practical AI design, Training, Deployment.
  2. **BAMISORO (The Product):**
     - An Omnichannel AI Platform (Voice 📞 + WhatsApp 💬 + Email 📧).
     - **Voice:** Inbound/Outbound AI calls, Transcripts.
     - **WhatsApp:** Context-aware agents.
     - **Email:** Conversational Email AI.
     - **Milestones:** "Reduced response times by 90%!", "Trusted by SMEs in Lagos & Accra." 🏆
  3. **CONTACT & LINKS:**
     - 📅 **Book Meeting:** https://calendly.com/muyog03/30min
     - 🌐 **Website:** https://ginoskoai.com
     - 📧 **Email:** info@ginoskoai.com
     - 📞 **Phone:** +234 708 645 4726

  CRITICAL: OUTPUT FORMAT (Strict JSON)
  
  1. **TEXT REPLY:**
     { "response": { "type": "text", "body": "Your formatted text here..." }, "memory_update": "..." }

  2. **BUTTONS (Prioritize this for menus!):**
     *Constraint: Max 3 buttons. Max 20 chars per title.*
     { "response": { "type": "button", "body": "Select an option below: 👇", "options": ["Book Demo 📅", "Our Services 🛠️", "Contact Us 📞"] }, "memory_update": "..." }

  3. **MEDIA (Images/Video):**
     { "response": { "type": "image", "link": "...", "caption": "..." }, "memory_update": "..." }

  MEMORY INSTRUCTIONS:
  - Add new user details to "memory_update".
  - Use "SYSTEM CONTEXT" to be smart (e.g., "Good Afternoon! ☀️").
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
      else if (message.type === "contacts") {
        const contact = message.contacts[0];
        userInput = `[Shared Contact: ${contact.name.formatted_name}, Phone: ${contact.phones?.[0]?.phone}]`;
      }
      else if (message.type === "location") userInput = `[Location: Lat ${message.location.latitude}, Long ${message.location.longitude}]`;

      if (userInput) {
        try {
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
            - 📍 Loc: Lagos, Nigeria
            
            USER DOSSIER:
            - Name: ${currentProfile.name}
            - Phone: ${senderPhone}
            - Facts: ${currentProfile.summary || "None."}
            
            USER INPUT: "${userInput}"
          `;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // D. ASK GEMINI (Updated to 3.0 Flash Preview as requested)
          // Note: Ensure your API Key has access to this specific preview model
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

          if (!geminiResponse.ok) {
             const errorText = await geminiResponse.text();
             console.error("Gemini API Error:", errorText);
             // Fallback if 3.0 fails/doesn't exist yet for this key
             throw new Error("Gemini Model Error");
          }

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { aiOutput = JSON.parse(aiRawText.replace(/```json|```/g, "").trim()); } 
          catch (e) { aiOutput = { response: { type: "text", body: "I'm having a moment! 😅 Could you repeat that?" } }; }

          // E. UPDATE MEMORY
          if (aiOutput.memory_update) {
            const oldSummary = currentProfile.summary || "";
            const newSummary = (oldSummary + "\n- " + aiOutput.memory_update).slice(-3000); 
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { summary: newSummary });
          }

          // F. SEND TO WHATSAPP
          const aiReply = aiOutput.response || { type: "text", body: "..." };
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};

          if (aiReply.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          } 
          else if (aiReply.type === "button") {
             // BUTTON FIX: Slice to 3, Truncate to 20 chars
             const safeOptions = (aiReply.options || []).slice(0, 3);
             const buttons = safeOptions.map((opt, i) => ({ 
               type: "reply", 
               reply: { id: `btn_${i}`, title: opt.substring(0, 20) } 
             }));
             
             payload = { 
               messaging_product: "whatsapp", 
               to: senderPhone, 
               type: "interactive", 
               interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } 
             };
          }
          else if (aiReply.type === "image") {
            payload = { messaging_product: "whatsapp", to: senderPhone, type: "image", image: { link: aiReply.link, caption: aiReply.caption || "" } };
          }
          else if (aiReply.type === "video") {
            payload = { messaging_product: "whatsapp", to: senderPhone, type: "video", video: { link: aiReply.link, caption: aiReply.caption || "" } };
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
