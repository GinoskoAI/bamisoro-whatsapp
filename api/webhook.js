// api/webhook.js
// VERSION: STABLE ROLLBACK (ALAT Persona - No Drip Logic)

export default async function handler(req, res) {
  
  // 1. HELPER: Simple Supabase Fetcher
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
    } catch (err) {
      console.error("Supabase Error:", err);
      return null;
    }
  }

  // 2. THE ALAT SYSTEM PROMPT
  const SYSTEM_PROMPT = `
  You are the **ALAT by Wema AI Assistant**. 🟣
  You represent **ALAT**, Nigeria's first fully digital bank.

  YOUR PERSONALITY:
  - **Tone:** Professional, Modern, Helpful, and Secure.
  - **Vibe:** Friendly but precise about money. "The Bank of the Future."
  - **Formatting:** Use clear paragraphs. Use emojis sparingly (e.g., 🟣, ₦, 💳).

  YOUR GOALS:
  1. **Account Opening:** Guide users to open accounts (BVN/NIN).
  2. **Loans:** Explain eligibility (Salary earners, business loans).
  3. **Support:** Help with card requests and app issues.

  KEY KNOWLEDGE:
  - **Loans:** Require a salary account or active turnover. Range: ₦5k - ₦2M.
  - **Tiers:** Tier 1 (Low limits, BVN only), Tier 3 (Unlimited, ID + Utility Bill).
  - **Cards:** Physical and Virtual Dollar Cards available.

  CRITICAL: OUTPUT JSON ONLY
  You must output valid JSON. No markdown.
  
  Example 1:
  { "response": { "type": "text", "body": "To get a loan, do you have a salary account?" }, "memory_update": "User asked about loans" }

  Example 2 (Buttons):
  { "response": { "type": "button", "body": "How can I help?", "options": ["Get a Loan 💰", "Open Account 📱"] }, "memory_update": "Offered menu" }
  `;

  // 3. VERIFY WEBHOOK (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 4. HANDLE MESSAGES (POST)
  if (req.method === 'POST') {
    const body = req.body;
    
    // Check if it's a valid WhatsApp message
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const senderPhone = message.from;
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      // Determine User Input
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;

      if (userInput) {
        try {
          // A. GET PROFILE
          const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=*`, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          // If new user, create profile
          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { 
              phone: senderPhone, 
              name: whatsappName, 
              last_updated: new Date().toISOString() 
            });
            currentProfile = { name: whatsappName, summary: "" };
          }

          // B. GET CHAT HISTORY
          const historyData = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=10&select=role,content`, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // C. PREPARE CONVERSATION FOR GEMINI
          const contextString = `
            USER INFO:
            - Name: ${currentProfile.name}
            - Phone: ${senderPhone}
            - Memory: ${currentProfile.summary || "None."}
            
            USER INPUT: "${userInput}"
          `;

          const fullConversation = [
            ...chatHistory, 
            { role: "user", parts: [{ text: contextString }] }
          ];

          // D. CALL GEMINI API
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: fullConversation,
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              // Safety settings to prevent blocking financial/loan talk
              safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
              ]
            })
          });

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

          // E. PARSE JSON RESPONSE
          let aiOutput;
          try {
            // Strip markdown if present
            const cleanJson = aiRawText.replace(/```json|```/g, "").trim();
            aiOutput = JSON.parse(cleanJson);
          } catch (e) {
            // Fallback to text if JSON fails
            if (aiRawText.length > 0) {
              aiOutput = { response: { type: "text", body: aiRawText } };
            } else {
              aiOutput = { response: { type: "text", body: "I'm having a connection issue. Please try again." } };
            }
          }

          // F. UPDATE MEMORY (Supabase)
          if (aiOutput.memory_update) {
            const oldSummary = currentProfile.summary || "";
            const newSummary = (oldSummary + "\n- " + aiOutput.memory_update).slice(-3000);
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { summary: newSummary });
          }

          // G. SEND REPLY TO WHATSAPP
          const aiReply = aiOutput.response || { type: "text", body: "One moment..." };
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const WP_HEADERS = { 
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
            'Content-Type': 'application/json' 
          };

          let payload = {};
          if (aiReply.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          } else if (aiReply.type === "button") {
            const buttons = (aiReply.options || []).slice(0, 3).map((opt, i) => ({ 
              type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } 
            }));
            payload = { 
              messaging_product: "whatsapp", to: senderPhone, type: "interactive", 
              interactive: { type: "button", body: { text: aiReply.body }, action: { buttons } } 
            };
          }

          if (payload.messaging_product) {
            await fetch(WHATSAPP_URL, { method: 'POST', headers: WP_HEADERS, body: JSON.stringify(payload) });
            
            // H. LOG TO DATABASE
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: aiReply.type === 'text' ? aiReply.body : `[Sent ${aiReply.type}]` });
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'user', content: userInput });
          }

        } catch (error) {
          console.error("WEBHOOK ERROR:", error);
        }
      }
    }
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
