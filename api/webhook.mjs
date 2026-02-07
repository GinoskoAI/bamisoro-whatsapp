// api/webhook.mjs
// VERSION: PROFESSIONAL - FIXED FRESHDESK & BLOCKS

import { createTicket, getTicketStatus, updateTicket } from './utils/freshdesk.mjs';

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

// STRICT PROFESSIONAL PROMPT
const SYSTEM_PROMPT = `
Role: ALAT Support Agent (Wema Bank).
Tone: Strict Professional English. NO Slang. NO Pidgin. Concise.
Goal: Solve issues efficiently.

RULES:
1. **LANGUAGE:** Speak standard, professional English only. Do not use words like "Abeg", "Wahala", or "Dey".
2. **BUTTONS:** To show options, you MUST end your message with "|||" followed by options separated by "|".
   Example: "Select an option below: ||| Log Complaint | Check Status"
3. **TICKET CREATION:** - Ask for Name, Email, Subject, and Details first.
   - Then CALL the 'log_complaint' tool.
   - Do NOT say you created a ticket unless the tool returns a Success message with an ID.

CAPABILITIES:
- Complaint -> 'log_complaint'
- Status -> 'check_ticket_status'
- Escalate -> 'escalate_ticket'
`;

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: "log_complaint",
      description: "Creates a support ticket. REQUIRED: subject, details, user_email, user_name.",
      parameters: { type: "OBJECT", properties: { subject: {type:"STRING"}, details: {type:"STRING"}, user_email: {type:"STRING"}, user_name: {type:"STRING"} }, required: ["subject", "details", "user_email", "user_name"] }
    },
    {
      name: "check_ticket_status",
      description: "Checks status of tickets.",
      parameters: { type: "OBJECT", properties: {} } 
    },
    {
      name: "escalate_ticket",
      description: "Escalates a ticket.",
      parameters: { type: "OBJECT", properties: { ticket_id: {type:"NUMBER"}, update_text: {type:"STRING"}, is_urgent: {type:"BOOLEAN"} }, required: ["ticket_id", "update_text"] }
    }
  ]
}];

export default async function handler(req, res) {
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
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
      else userInput = "[Media/Other]";

      if (userInput) {
        try {
          console.log(`[${senderPhone}] Incoming: ${userInput}`);

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

          const contextString = `USER: ${currentProfile.name} (${senderPhone})\nINPUT: "${userInput}"`;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // GEMINI 2.5 FLASH
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          let apiBody = {
            contents: fullConversation,
            tools: GEMINI_TOOLS,
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }
          };

          let geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
          
          if (!geminiResponse.ok) {
             const errText = await geminiResponse.text();
             console.error("Gemini Error:", errText);
          }

          let geminiData = await geminiResponse.json();
          let candidate = geminiData.candidates?.[0]?.content?.parts?.[0];
          
          if (candidate?.functionCall) {
              const call = candidate.functionCall;
              const args = call.args;
              let toolResultText = "Failed.";
              console.log(`Tool Call: ${call.name}`);

              if (call.name === "log_complaint") {
                 const tID = await createTicket(senderPhone, args.subject, args.details, args.user_email, args.user_name);
                 toolResultText = tID ? `Ticket #${tID} created successfully.` : "Failed to create ticket. Please ensure Name and Email are valid.";
                 console.log(toolResultText);
              }
              else if (call.name === "check_ticket_status") toolResultText = await getTicketStatus(senderPhone);
              else if (call.name === "escalate_ticket") toolResultText = await updateTicket(args.ticket_id, args.update_text, args.is_urgent);

              const followUpContents = [
                  ...fullConversation,
                  { role: "model", parts: [{ functionCall: call }] },
                  { role: "function", parts: [{ functionResponse: { name: call.name, response: { result: toolResultText } } }] }
              ];
              apiBody.contents = followUpContents;
              geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
              geminiData = await geminiResponse.json();
          }

          // PARSE RESPONSE
          let finalAiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "System Error";
          
          let messageBody = finalAiText;
          let buttons = [];
          
          if (finalAiText.includes("|||")) {
             const parts = finalAiText.split("|||");
             messageBody = parts[0].trim();
             const buttonPart = parts[1].trim();
             buttons = buttonPart.split("|").map(b => b.trim()).filter(b => b.length > 0).slice(0, 3);
          }

          // SEND TO WHATSAPP
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};

          if (buttons.length > 0) {
             const btnObjects = buttons.map((opt, i) => ({ 
               type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } 
             }));
             payload = { 
               messaging_product: "whatsapp", to: senderPhone, type: "interactive", 
               interactive: { type: "button", body: { text: messageBody }, action: { buttons: btnObjects } } 
             };
          } else {
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
