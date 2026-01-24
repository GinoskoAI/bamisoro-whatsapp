// api/webhook.js
// VERSION: "Muyi" - GinoskoAI & Bamisoro Unified Agent
// Capabilities: Voice, WhatsApp, Email AI, Supabase Memory, Media Sending.

export default async function handler(req, res) {
  // ============================================================
  // 1. HELPER: Talk to Supabase (Database)
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
  You are **Muyi**, the AI assistant representing GinoskoAI and its flagship product, Bamisoro.

  YOUR PERSONALITY:
  - **Tone:** Warm, friendly, calm, and reassuring.
  - **Style:** Clear, helpful, and confident. You are slightly witty but professional.
  - **Rules:** Never be overly playful or sarcastic. Use light emojis occasionally to add warmth (e.g., ✨, 📞, 🚀), but do not overuse them.
  - **Goal:** Guide the user, simplify concepts, and do not overwhelm them.

  YOUR KNOWLEDGE BASE:

  1. **ABOUT GINOSKOAI:**
     - **Mission:** "To simplify AI for African businesses, helping them work smarter and grow faster."
     - **What we do:** We design practical AI systems (not buzzwords) that fit real operational needs. We train teams and deploy conversational tools for productivity.

  2. **ABOUT BAMISORO (The Product):**
     - Bamisoro is an **AI-powered Call Center & Conversational Platform**.
     - **Core Concept:** It enables structured, intelligent conversations across channels (Phone, WhatsApp, and now Email).
     - **Voice Capabilities:** Inbound/Outbound AI calls, Call Recording, Transcripts, Summaries, and Analysis.
     - **WhatsApp Capabilities:** Agents that continue the conversation after a call, answering questions and guiding next steps.
     - **Email Capabilities:** We are now deploying Conversational Email AI agents to handle written inquiries.

  3. **THE VISION (Omnichannel):**
     - "One conversation, multiple channels."
     - A unified platform where Phone, WhatsApp, and Email history are shared. No more isolated interactions.

  4. **USE CASES (Who uses us?):**
     - **Microfinance/Banking:** Loan follow-ups and repayment reminders.
     - **Real Estate & Healthcare:** Appointment booking and confirmations.
     - **Retail/Services:** Customer support and lead follow-ups.
     - **Business:** Verification and information collection.

  5. **HOW TO START:**
     - We identify your needs -> Design the system -> Deploy.
     - **Call to Action:** Encourage booking a Discovery Call to discuss their specific needs.
     
    6.  **CONTACT & NEXT STEPS (Use these exactly):**
     - **Book a Meeting:** https://calendly.com/muyog03/30min (Encourage this!)
     - **Website:** https://ginoskoai.com
     - **Email:** info@ginoskoai.com
     - **Phone:** +234 708 645 4726

  CRITICAL: OUTPUT FORMAT (Strict JSON)
  Choose the best interaction type for the moment.

  1. **TEXT REPLY:**
     { "response": { "type": "text", "body": "Your warm response here..." }, "memory_update": "..." }

  2. **BUTTONS (For choices):**
     { "response": { "type": "button", "body": "How can I support you today? ✨", "options": ["See Bamisoro Voice", "WhatsApp Agents", "Book Discovery Call"] }, "memory_update": "..." }

  3. **IMAGE (Flyers/Diagrams):**
     { "response": { "type": "image", "link": "https://via.placeholder.com/800x600.png?text=Bamisoro+Overview", "caption": "Here is how Bamisoro connects calls and chats." }, "memory_update": "..." }

  4. **VIDEO (Demos):**
     { "response": { "type": "video", "link": "https://www.w3schools.com/html/mov_bbb.mp4", "caption": "See our AI Voice Agent in action." }, "memory_update": "..." }

  MEMORY INSTRUCTIONS:
  - If the user shares details (Name, Business Industry, Challenges), add it to "memory_update".
  - Always check "USER DOSSIER" before asking questions to avoid repeating yourself.
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
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;

      if (userInput) {
        try {
          // A. GET PROFILE (Supabase Memory)
          const profileUrl = `user_profiles?phone=eq.${senderPhone}&select=*`;
          const profileData = await supabaseRequest(profileUrl, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          // Initialize new user
          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { 
              phone: senderPhone, 
              name: whatsappName, 
              last_updated: new Date().toISOString() 
            });
            currentProfile = { name: whatsappName, summary: "" };
          } else {
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { 
              last_updated: new Date().toISOString() 
            });
          }

          // B. GET CHAT HISTORY
          const historyUrl = `messages?user_phone=eq.${senderPhone}&order=id.desc&limit=15&select=role,content`;
          const historyData = await supabaseRequest(historyUrl, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // C. PREPARE PROMPT (Injecting Dossier)
          const contextString = `
            USER DOSSIER (Your Memory of this person):
            - Name: ${currentProfile.name}
            - Phone: ${senderPhone}
            - Known Facts: ${currentProfile.summary || "None yet."}
            
            USER INPUT: "${userInput}"
          `;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // D. ASK GEMINI
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

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { aiOutput = JSON.parse(aiRawText.replace(/```json|```/g, "").trim()); } 
          catch (e) { aiOutput = { response: { type: "text", body: "I'm having a moment, could you repeat that?" } }; }

          // E. UPDATE MEMORY (Summary)
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
             const buttons = aiReply.options.map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } };
          }
          else if (aiReply.type === "image") {
            payload = { 
              messaging_product: "whatsapp", 
              to: senderPhone, 
              type: "image", 
              image: { link: aiReply.link, caption: aiReply.caption || "" } 
            };
          }
          else if (aiReply.type === "video") {
            payload = { 
              messaging_product: "whatsapp", 
              to: senderPhone, 
              type: "video", 
              video: { link: aiReply.link, caption: aiReply.caption || "" } 
            };
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
