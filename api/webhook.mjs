// api/webhook.mjs
// VERSION: ROBUST "MUYI" - Aggressive JSON & Emoji Enforcer

import { createTicket, getTicketStatus, updateTicket } from './utils/freshdesk.mjs';

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
Role: ALAT Buddy (Wema Bank AI).
Tone: Professional but NIGERIAN FRIENDLY. Use emojis (👋, 🚀, ✅, 💳) in EVERY SINGLE MESSAGE.
Goal: Support customers & Manage Tickets.

CRITICAL RULES:
1. **EMOJIS:** You MUST use emojis. If you don't, the system fails.
2. **JSON ONLY:** Output ONLY valid JSON. Do not add conversational filler like "Here is the JSON".
3. **SHORT:** Keep text under 300 characters unless explaining a complex process.

COMPLAINT PROCESS:
1. User complains -> Check if you know Name/Email.
2. If unknown -> Ask: "To help you, I just need your Name and Email please? 📝"
3. If known -> Call 'log_complaint'.
4. If angry -> Call 'escalate_ticket'.

OUTPUT FORMAT (Strict JSON):
{ "response": { "type": "text", "body": "👋 Hi! *Welcome to ALAT*..." }, "memory_update": "User said hi" }
OR
{ "response": { "type": "button", "body": "Select an option: 👇", "options": ["Book Demo 📅", "Services 🛠️"] }, "memory_update": "Menu shown" }
`;

// ============================================================
// 3. TOOLS DEFINITION
// ============================================================
const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: "log_complaint",
      description: "Log ticket. Use ONLY after you have the user's Name and Email.",
      parameters: { type: "OBJECT", properties: { subject: {type:"STRING"}, details: {type:"STRING"}, user_email: {type:"STRING"}, user_name: {type:"STRING"} }, required: ["subject", "details"] }
    },
    {
      name: "check_ticket_status",
      description: "Check status of recent tickets.",
      parameters: { type: "OBJECT", properties: {} } 
    },
    {
      name: "escalate_ticket",
      description: "Escalate a ticket.",
      parameters: { type: "OBJECT", properties: { ticket_id: {type:"NUMBER"}, update_text: {type:"STRING"}, is_urgent: {type:"BOOLEAN"} }, required: ["ticket_id", "update_text"] }
    }
  ]
}];

// ============================================================
// 4. MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  
  // Verify Webhook (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // Handle Messages (POST)
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const senderPhone = message.from;
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
      else userInput = "[Media/Other]";

      if (userInput) {
        try {
          // A. PROFILE & HISTORY
          const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=*`, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName });
            currentProfile = { name: whatsappName, summary: "" };
          }

          // Context Building
          const historyData = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=8&select=role,content`, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          const contextString = `
            USER: ${currentProfile.name} (${senderPhone})
            FACTS: ${currentProfile.summary || "None"}
            INPUT: "${userInput}"
          `;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // B. CALL GEMINI (Round 1)
          // Using gemini-2.0-flash for stability. Change to 3.0-flash-preview ONLY if necessary.
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          let apiBody = {
            contents: fullConversation,
            tools: GEMINI_TOOLS,
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: { responseMimeType: "application/json" }
          };

          let geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
          let geminiData = await geminiResponse.json();
          let candidate = geminiData.candidates?.[0]?.content?.parts?.[0];
          
          // C. CHECK FOR TOOL USE
          if (candidate?.functionCall) {
              const call = candidate.functionCall;
              const args = call.args;
              let toolResultText = "Failed.";

              if (call.name === "log_complaint") {
                 const tID = await createTicket(senderPhone, args.subject, args.details, args.user_email, args.user_name);
                 toolResultText = tID ? `Ticket #${tID} created successfully!` : "Failed to create ticket.";
              }
              else if (call.name === "check_ticket_status") toolResultText = await getTicketStatus(senderPhone);
              else if (call.name === "escalate_ticket") toolResultText = await updateTicket(args.ticket_id, args.update_text, args.is_urgent);

              // Round 2 (Send result back)
              // IMPORTANT: We re-send system instructions to force JSON again
              const followUpContents = [
                  ...fullConversation,
                  { role: "model", parts: [{ functionCall: call }] },
                  { role: "function", parts: [{ functionResponse: { name: call.name, response: { result: toolResultText } } }] }
              ];
              apiBody.contents = followUpContents;
              geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
              geminiData = await geminiResponse.json();
          }

          // D. ROBUST JSON PARSING
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
          let aiOutput = {};

          try {
              // 1. Clean Markdown
              let cleanText = aiRawText.replace(/```json|```/g, "").trim();
              // 2. Extract JSON Object
              const firstBrace = cleanText.indexOf('{');
              const lastBrace = cleanText.lastIndexOf('}');
              if (firstBrace !== -1 && lastBrace !== -1) {
                  cleanText = cleanText.substring(firstBrace, lastBrace + 1);
                  aiOutput = JSON.parse(cleanText);
              } else {
                  throw new Error("No JSON found");
              }
          } catch (e) {
              // FALLBACK: If JSON fails, use the raw text directly. 
              // This fixes the "..." issue.
              aiOutput = { response: { type: "text", body: aiRawText || "I'm having a moment! 😅 Please try again." } };
          }

          // E. HANDLE MISSING RESPONSE KEY
          // If Gemini sent JSON but forgot the "response" key
          if (!aiOutput.response && aiOutput.memory_update) {
             aiOutput.response = { type: "text", body: "✅ Update recorded." };
          }
          if (!aiOutput.response) {
             aiOutput.response = { type: "text", body: aiRawText || "..." };
          }

          // F. UPDATE MEMORY
          if (aiOutput.memory_update) {
            const newSummary = ((currentProfile.summary || "") + "\n" + aiOutput.memory_update).slice(-2000); 
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { summary: newSummary });
          }
          
          // G. SEND TO WHATSAPP
          const aiReply = aiOutput.response;
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};
          if (aiReply.type === "text") {
             payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          } 
          else if (aiReply.type === "button") {
             const buttons = (aiReply.options || ["Menu"]).slice(0, 3).map((opt, i) => ({ 
               type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } 
             }));
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
