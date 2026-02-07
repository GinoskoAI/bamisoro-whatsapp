// api/webhook.mjs
// VERSION: GEMINI 2.5 FLASH - NATIVE WHATSAPP BLOCKS & TOOLS

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
    if (response.status === 204) return true; 
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (err) { return null; }
}

// ============================================================
// 2. SYSTEM PROMPT (Optimized for Blocks)
// ============================================================
const SYSTEM_PROMPT = `
Role: ALAT Support Agent (Wema Bank).
Tone: Professional, Helpful, Nigerian Friendly (use "Abeg", "We dey for you").
Goal: Solve issues efficiently using Tools and Buttons.

CRITICAL RULES:
1. **MODEL:** You are running on Gemini 2.5 Flash. Be fast and accurate.
2. **BUTTONS (BLOCKS):** To send WhatsApp Buttons, you MUST add them at the very end of your message separated by "|||".
   Format: "Your message text here. ||| Button 1 | Button 2 | Button 3"
   Example: "How can I help you? ||| Log Complaint | Check Status | Talk to Agent"
3. **TOOL USE:** - You MUST use the 'log_complaint' tool to create tickets. 
   - NEVER say "I have logged the ticket" unless you have actually called the tool and received a Ticket ID.
   - If you need Name/Email, ASK the user first.

CAPABILITIES:
- If user complains -> Ask for details -> Call 'log_complaint'.
- If user asks status -> Call 'check_ticket_status'.
- If user is angry -> Call 'escalate_ticket'.

CONTEXT:
User is Nigerian. "Money hung" = Failed Transfer.
`;

// ============================================================
// 3. TOOLS DEFINITION
// ============================================================
const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: "log_complaint",
      description: "Creates a support ticket. REQUIRED: subject, details, user_email, user_name.",
      parameters: { type: "OBJECT", properties: { subject: {type:"STRING"}, details: {type:"STRING"}, user_email: {type:"STRING"}, user_name: {type:"STRING"} }, required: ["subject", "details", "user_email", "user_name"] }
    },
    {
      name: "check_ticket_status",
      description: "Checks status of tickets for this phone number.",
      parameters: { type: "OBJECT", properties: {} } 
    },
    {
      name: "escalate_ticket",
      description: "Escalates a specific ticket ID.",
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
          console.log(`[${senderPhone}] Incoming: ${userInput}`);

          // A. PROFILE & HISTORY
          const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=*`, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName });
            currentProfile = { name: whatsappName };
          }

          const historyData = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=8&select=role,content`, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // B. PREPARE PROMPT
          const contextString = `USER: ${currentProfile.name} (${senderPhone})\nINPUT: "${userInput}"`;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // C. CALL GEMINI (STRICTLY 2.5 FLASH)
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          let apiBody = {
            contents: fullConversation,
            tools: GEMINI_TOOLS,
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }
          };

          let geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
          
          // Debugging: Check if 2.5 Exists/Works
          if (!geminiResponse.ok) {
             const errText = await geminiResponse.text();
             console.error("Gemini 2.5 Error:", errText);
             // If 2.5 fails, it returns a text error. We log it but do not crash.
          }

          let geminiData = await geminiResponse.json();
          let candidate = geminiData.candidates?.[0]?.content?.parts?.[0];
          
          // D. CHECK FOR TOOL USE
          if (candidate?.functionCall) {
              const call = candidate.functionCall;
              const args = call.args;
              let toolResultText = "Failed.";
              console.log(`Tool Call: ${call.name}`);

              if (call.name === "log_complaint") {
                 const tID = await createTicket(senderPhone, args.subject, args.details, args.user_email, args.user_name);
                 toolResultText = tID ? `Ticket #${tID} created.` : "Failed to create ticket.";
                 console.log(toolResultText);
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

          // E. PARSE RESPONSE FOR BLOCKS (BUTTONS)
          let finalAiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "System Error";
          
          let messageBody = finalAiText;
          let buttons = [];
          
          // Detect "|||" to trigger WhatsApp Blocks
          if (finalAiText.includes("|||")) {
             const parts = finalAiText.split("|||");
             messageBody = parts[0].trim();
             const buttonPart = parts[1].trim();
             // Split by | and take max 3 buttons
             buttons = buttonPart.split("|").map(b => b.trim()).filter(b => b.length > 0).slice(0, 3);
          }

          // F. SEND TO WHATSAPP
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};

          if (buttons.length > 0) {
             // Send Interactive Button Block
             const btnObjects = buttons.map((opt, i) => ({ 
               type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } 
             }));
             payload = { 
               messaging_product: "whatsapp", to: senderPhone, type: "interactive", 
               interactive: { type: "button", body: { text: messageBody }, action: { buttons: btnObjects } } 
             };
          } else {
             // Send Plain Text
             payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: messageBody } };
          }

          if (payload.messaging_product) {
            await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: messageBody });
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'user', content: userInput });
          }

        } catch (error) { console.error("CRITICAL ERROR:", error); }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
