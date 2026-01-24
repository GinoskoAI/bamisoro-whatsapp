// api/webhook.js
// VERSION: Deep Memory & Metadata Tracker

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

  // 2. CONFIGURATION: The "Sherlock" Brain
  const SYSTEM_PROMPT = `
  You are Bamisoro.
  
  CRITICAL: Reply in JSON format with TWO parts:
  1. "response": The reply to the user.
  2. "memory_update": A specialized summary of NEW facts learned in this turn.
  
  JSON STRUCTURE:
  {
    "response": { "type": "text", "body": "..." },
    "memory_update": "User mentioned they own a bakery. User is looking for gluten-free options." (OR null if nothing new)
  }

  MEMORY RULES:
  - You will be provided with a "USER SUMMARY" (Past facts).
  - If the user mentions a NEW fact (hobbies, job, family, preferences), add it to "memory_update".
  - Do NOT repeat facts already in the "USER SUMMARY".
  `;

  if (req.method === 'GET') {
     if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
     return res.status(403).json({ error: 'Verification failed.' });
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const senderPhone = message.from;
      
      // --- CAPTURE METADATA ---
      // WhatsApp often sends the user's profile name in the "contacts" object
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;

      if (userInput) {
        try {
          // A. GET PROFILE (Facts + Summary)
          const profileUrl = `user_profiles?phone=eq.${senderPhone}&select=*`;
          const profileData = await supabaseRequest(profileUrl, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          // If new user, create basic profile immediately using WhatsApp Name
          if (!currentProfile.phone) {
            console.log("👤 New User detected:", whatsappName);
            await supabaseRequest('user_profiles', 'POST', { 
              phone: senderPhone, 
              name: whatsappName, // Use the name from WhatsApp!
              last_updated: new Date().toISOString()
            });
            currentProfile = { name: whatsappName, summary: "" };
          } else {
            // Update "Last Seen" timestamp
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { 
              last_updated: new Date().toISOString() 
            });
          }

          // B. GET RECENT CHAT (Context)
          const historyUrl = `messages?user_phone=eq.${senderPhone}&order=id.desc&limit=15&select=role,content`;
          const historyData = await supabaseRequest(historyUrl, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // C. PREPARE PROMPT (Injecting the "Summary")
          const contextString = `
            USER DOSSIER (KNOWN FACTS):
            - Name: ${currentProfile.name}
            - Phone: ${senderPhone}
            - Last Seen: ${new Date().toISOString()}
            - KNOWN FACTS: ${currentProfile.summary || "No details yet."}
            
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

          // E. PROCESS RESPONSE
          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { aiOutput = JSON.parse(aiRawText.replace(/```json|```/g, "").trim()); } 
          catch (e) { aiOutput = { response: { type: "text", body: "Thinking..." } }; }

          // F. UPDATE MEMORY (The "Summary" Append)
          if (aiOutput.memory_update) {
            console.log("🧠 New Fact Learned:", aiOutput.memory_update);
            
            // We append the new fact to the existing summary
            const oldSummary = currentProfile.summary || "";
            const newSummary = oldSummary + "\n- " + aiOutput.memory_update;
            
            // Limit summary size (keep last 2000 chars to avoid overflow if needed)
            const finalSummary = newSummary.slice(-2000); 

            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { 
              summary: finalSummary
            });
          }

          // G. SAVE CHAT & REPLY
          const aiReply = aiOutput.response || { type: "text", body: "..." };
          
          await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'user', content: userInput });
          if (aiReply.body) await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: aiReply.body });

          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          let payload = {};

          if (aiReply.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          } else if (aiReply.type === "button") {
             const buttons = aiReply.options.map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } };
          }

          if (payload.messaging_product) await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });

        } catch (error) { console.error("CRITICAL ERROR:", error); }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
