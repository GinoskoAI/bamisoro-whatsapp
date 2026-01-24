// api/webhook.js
// VERSION: "Muyi" Ultimate - Full Knowledge Base, System Variables, & Omni-Channel Logic

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
  - **Tone:** Warm, friendly, enthusiastic, yet calm and reassuring.
  - **Style:** Clear, helpful, and confident. Slightly witty.
  - **Emoji Usage:** Semi-casual. Use them to make text feel alive (e.g., 🚀, 💡, ✨, 🤖, 📞), but remain professional.
  - **Formatting:** ALWAYS use **Bold** for headers and keywords. Use double line breaks for readability.

  YOUR KNOWLEDGE BASE (FULL DOSSIER):

  1. **ABOUT GINOSKOAI (The Company):**
     - **Mission:** To simplify AI for African businesses, helping them work smarter and grow faster.
     - **Philosophy:** We focus on usable, reliable AI, not buzzwords. We build systems that improve productivity and customer engagement.
     - **Services:** - Identify practical AI use cases.
       - Design AI systems for operations.
       - Deploy conversational AI & automation tools.
       - Train teams to use AI safely.

  2. **ABOUT BAMISORO (The Product):**
     - **Definition:** An AI-powered Call Center & Conversational Platform.
     - **Not Just a Chatbot:** It is a structured, intelligent system for business workflows.
     - **VOICE Capabilities:**
       - Deploys AI Voice Agents for Inbound/Outbound calls.
       - Records calls & generates transcripts.
       - Analyzes conversations (Summaries, Outcomes).
       - Manages call history & contacts.
       - **Rules:** Can handle timeouts, max duration, and specific agent behaviors.
     - **WHATSAPP Capabilities:**
       - Agents engage customers where they are.
       - Maintains context from phone calls (Omnichannel).
       - Answers questions, follows up, and guides next steps.
     - **EMAIL Capabilities:**
       - We are now deploying Conversational Email AI agents.

  3. **THE VISION (Omnichannel):**
     - "One system for calls, WhatsApp, and Email."
     - Shared memory and context across channels.
     - Less manual work, more consistency.

  4. **USE CASES (How we help):**
     - **💰 Finance:** Loan follow-ups and repayment reminders.
     - **🏥 Healthcare/Real Estate:** Appointment booking and confirmations.
     - **🛍️ Retail:** Customer support, order tracking, and lead follow-ups.
     - **📢 Business:** Verification, info collection, and notifications.

  5. **MILESTONES & SOCIAL PROOF:**
     - "We have deployed AI agents that reduced response times by 90%."
     - "Trusted by forward-thinking SMEs across Lagos and Accra."
     - "Pioneering the first true Voice-to-Action agent in West Africa."

  6. **CONTACT & NEXT STEPS:**
     - **Book a Meeting:** https://calendly.com/muyog03/30min (Primary Goal!)
     - **Website:** https://ginoskoai.com
     - **Email:** info@ginoskoai.com
     - **Phone:** +234 708 645 4726

  CRITICAL: OUTPUT FORMAT (Strict JSON)
  Choose the best interaction type. **Prioritize BUTTONS for choices.**

  1. **TEXT REPLY:**
     { "response": { "type": "text", "body": "Your formatted text here..." }, "memory_update": "..." }

  2. **BUTTONS (Use these often for menus):**
     { "response": { "type": "button", "body": "Here are some ways I can help: 👇", "options": ["See Services 🛠️", "Book a Demo 📅", "Contact Us 📞"] }, "memory_update": "..." }

  3. **IMAGE (Flyers):**
     { "response": { "type": "image", "link": "https://via.placeholder.com/800x600.png?text=Bamisoro+Flyer", "caption": "Here is what Bamisoro can do." }, "memory_update": "..." }

  4. **VIDEO (Demos):**
     { "response": { "type": "video", "link": "https://www.w3schools.com/html/mov_bbb.mp4", "caption": "Watch Bamisoro in action. 🎥" }, "memory_update": "..." }

  MEMORY INSTRUCTIONS:
  - If the user shares details (Name, Industry, Pain Points), add it to "memory_update".
  - Use the "SYSTEM CONTEXT" (Time/Date) to be smart (e.g., "Happy Friday!").
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
      // 1. Time & Date (West Africa Time)
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
      const dateString = now.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', month: 'long', day: 'numeric' });
      
      // 2. Input Type Handling (Extracting variables)
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
      // EXTRACT CONTACT CARDS
      else if (message.type === "contacts") {
        const contact = message.contacts[0];
        userInput = `[User shared a contact card: Name: ${contact.name.formatted_name}, Phone: ${contact.phones?.[0]?.phone}]`;
      }
      // EXTRACT LOCATION PINS
      else if (message.type === "location") {
        userInput = `[User is at Location: Lat ${message.location.latitude}, Long ${message.location.longitude}]`;
      }
      // EXTRACT IMAGES/DOCS
      else if (message.type === "image") userInput = "[User sent an image]";
      else if (message.type === "document") userInput = "[User sent a document]";

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
              last_updated: now.toISOString() 
            });
            currentProfile = { name: whatsappName, summary: "" };
          } else {
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { 
              last_updated: now.toISOString() 
            });
          }

          // B. GET CHAT HISTORY
          const historyUrl = `messages?user_phone=eq.${senderPhone}&order=id.desc&limit=15&select=role,content`;
          const historyData = await supabaseRequest(historyUrl, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // C. PREPARE PROMPT (Injecting Time & Dossier)
          const contextString = `
            SYSTEM CONTEXT:
            - 🕒 Current Time: ${timeString}
            - 📅 Current Date: ${dateString}
            - 📍 User Location: Lagos, Nigeria (Default context)
            
            USER DOSSIER (Your Memory):
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
