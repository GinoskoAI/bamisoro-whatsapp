// api/webhook.mjs
// VERSION: FINAL FIXED - "Muyi" Persona + Freshdesk Tools + ES Modules

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
 Role & Persona
You are ALAT Buddy, the official WhatsApp AI Agent for Wema Bank. Your goal is to provide seamless, instant support for ALAT and Wema Bank customers. You are professional, empathetic, and deeply familiar with Nigerian banking nuances.

Core Operational Capabilities
1. Complaint Classification: Categorize every message (e.g., Failed Transfer, POS Issues).
2. Entity Extraction: Identify Account Numbers, Amounts, Dates.
3. SLA Management: State resolution timelines.
4. Rich Messaging: Use Buttons and Lists.

Response Guidelines
1. Acknowledgement: "I hear you..."
2. Specific Recognition: "I see you're having trouble with..."
3. Information Check: Ask for missing details (Account Num, Amount, Date). NEVER ask for PIN/OTP.
4. SLA Promise: "Update in 24 hours..."
5. Reassurance: "We've got you covered."

COMPLAINT PROCESS (CRITICAL):
- If a user complains, check if you have their Name and Email.
- If missing, ASK: 'To file this report, I just need your name and email address.'
- Once you have them, use the 'log_complaint' tool.
- If user asks for status, use 'check_ticket_status'.
- If user is angry/escalating, use 'escalate_ticket'.

OUTPUT FORMAT (JSON):
{ "response": { "type": "text", "body": "..." }, "memory_update": "..." }
OR
{ "response": { "type": "button", "body": "...", "options": ["A", "B"] }, "memory_update": "..." }
`;

// ============================================================
// 3. TOOLS DEFINITION
// ============================================================
const GEMINI_TOOLS = [
  {
    function_declarations: [
      {
        name: "log_complaint",
        description: "Creates a support ticket. Use ONLY after asking for Name and Email.",
        parameters: {
          type: "OBJECT",
          properties: {
            subject: { type: "STRING" },
            details: { type: "STRING" },
            user_email: { type: "STRING" },
            user_name: { type: "STRING" }
          },
          required: ["subject", "details"]
        }
      },
      {
        name: "check_ticket_status",
        description: "Checks status of support tickets.",
        parameters: { type: "OBJECT", properties: {} } 
      },
      {
        name: "escalate_ticket",
        description: "Escalates a ticket.",
        parameters: {
          type: "OBJECT",
          properties: {
            ticket_id: { type: "NUMBER" },
            update_text: { type: "STRING" },
            is_urgent: { type: "BOOLEAN" }
          },
          required: ["ticket_id", "update_text"]
        }
      }
    ]
  }
];

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
      
      const now = new Date();
      
      // Input Type Handling
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
      else if (message.type === "contacts") userInput = "[Shared Contact]";
      else if (message.type === "location") userInput = "[Location]";

      if (userInput) {
        try {
          // A. GET PROFILE
          const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=*`, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName, last_updated: now.toISOString() });
            currentProfile = { name: whatsappName, summary: "" };
          }

          // B. GET HISTORY
          const historyData = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=15&select=role,content`, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // C. PREPARE PROMPT
          const contextString = `
            USER: ${currentProfile.name} (${senderPhone})
            HISTORY: ${currentProfile.summary || "None"}
            INPUT: "${userInput}"
          `;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // D. ASK GEMINI (Round 1)
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
          
          // E. CHECK FOR TOOL USE
          if (candidate?.functionCall) {
              const call = candidate.functionCall;
              const args = call.args;
              let toolResultText = "Tool execution failed.";

              if (call.name === "log_complaint") {
                 const tID = await createTicket(senderPhone, args.subject, args.details, args.user_email, args.user_name);
                 toolResultText = tID ? `SUCCESS: Ticket #${tID} created.` : "ERROR: Failed to create ticket.";
              }
              else if (call.name === "check_ticket_status") toolResultText = await getTicketStatus(senderPhone);
              else if (call.name === "escalate_ticket") toolResultText = await updateTicket(args.ticket_id, args.update_text, args.is_urgent);

              // Round 2 (Send result back)
              const followUpContents = [
                  ...fullConversation,
                  { role: "model", parts: [{ functionCall: call }] },
                  { role: "function", parts: [{ functionResponse: { name: call.name, response: { result: toolResultText } } }] }
              ];
              apiBody.contents = followUpContents;
              geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
              geminiData = await geminiResponse.json();
          }

          // F. PARSE RESPONSE
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { aiOutput = JSON.parse(aiRawText.replace(/```json|```/g, "").trim()); } 
          catch (e) { aiOutput = { response: { type: "text", body: aiRawText || "System Error" } }; }

          // G. UPDATE MEMORY
          if (aiOutput.memory_update) {
            const newSummary = ((currentProfile.summary || "") + "\n- " + aiOutput.memory_update).slice(-3000); 
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { summary: newSummary });
          }
          
          // H. SEND TO WHATSAPP
          const aiReply = aiOutput.response || { type: "text", body: "..." };
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};
          if (aiReply.type === "text") payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          else if (aiReply.type === "button") {
             const buttons = (aiReply.options || []).slice(0, 3).map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
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
// --- END OF FILE ---
