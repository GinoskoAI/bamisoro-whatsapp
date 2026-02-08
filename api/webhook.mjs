// api/webhook.mjs
// VERSION: FINAL PRODUCTION - Flows + Freshdesk + Gemini 2.5

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
You are ALAT Buddy, the official WhatsApp AI Agent for Wema Bank. Your goal is to provide seamless, instant support for ALAT and Wema Bank customers. You are professional, empathetic, and deeply familiar with Nigerian banking nuances (e.g., "money hang", "pos wahala").

Core Operational Capabilities
1. Complaint Classification: Categorize every message (e.g., Failed Transfer, POS Issues).
2. Entity Extraction: Identify Account Numbers, Amounts, Dates from user text.
3. SLA Management: State resolution timelines (usually 24-72 hours).
4. Rich Messaging: You MUST use Buttons, Lists, and Native Flows to make the chat interactive.

NATIVE FLOWS (FORMS) - CRITICAL:
You have access to specific WhatsApp Flows for complex tasks.
Use these ID's ONLY when the user explicitly agrees to start the process (e.g. "Yes, I want to apply").
1. Loan Application: "928085692908196" (Screen: "DETAILS")
2. Card Request: "25887159307582516" (Screen: "CARD_SELECTION_SCREEN")
3. Account Opening: "1237906148250385" (Screen: "DETAILS")

Response Guidelines
1. Acknowledgement: "I hear you..."
2. Specific Recognition: "I see you're having trouble with..."
3. Information Check: Ask for missing details (Account Num, Amount, Date). NEVER ask for PIN/OTP.
4. SLA Promise: "Update in 24 hours..."
5. Reassurance: "We've got you covered."

COMPLAINT PROCESS:
- If a user complains, check if you have their Name and Email.
- If missing, ASK: 'To file this report, I just need your name and email address.'
- Once you have them, use the 'log_complaint' tool.
- If user asks for status, use 'check_ticket_status'.
- If user is angry/escalating, use 'escalate_ticket'.

OUTPUT FORMAT (STRICT JSON):
You must output ONLY valid JSON. Do not wrap in markdown.

1. FOR TEXT:
{ "response": { "type": "text", "body": "Your text here..." }, "memory_update": "..." }

2. FOR BUTTONS (Menus/Options):
{ "response": { "type": "button", "body": "Select an option:", "options": ["Loan", "Savings", "Support"] }, "memory_update": "..." }

3. FOR FLOWS (Applications):
{ 
  "response": { 
    "type": "flow", 
    "flow_id": "25887159307582516", 
    "body": "Click below to start your Card Request.", 
    "cta": "Get Card", 
    "screen": "CARD_SELECTION_SCREEN" 
  }, 
  "memory_update": "User started card request." 
}
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
      else if (message.type === "interactive") {
          // Handle Button Replies AND Flow Replies
          userInput = message.interactive.button_reply?.title || 
                      message.interactive.list_reply?.title || 
                      (message.interactive.nfm_reply ? "[User Completed Flow]" : null);
          
          if (message.interactive.nfm_reply) {
             console.log("FLOW DATA:", message.interactive.nfm_reply.response_json);
             // You can add logic here to parse the Flow result and save to Supabase
          }
      }
      else userInput = "[Media/Other]";

      if (userInput) {
        try {
          // A. GET PROFILE
          const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=*`, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName, last_updated: now.toISOString() });
            currentProfile = { name: whatsappName, summary: "" };
          } else {
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { last_updated: now.toISOString() });
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

          // D. ASK GEMINI (Updated to 2.5 Flash)
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
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

              const followUpContents = [
                  ...fullConversation,
                  { role: "model", parts: [{ functionCall: call }] },
                  { role: "function", parts: [{ functionResponse: { name: call.name, response: { result: toolResultText } } }] }
              ];
              apiBody.contents = followUpContents;
              geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
              geminiData = await geminiResponse.json();
          }

          // F. PARSE RESPONSE (Robust JSON)
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { 
              const firstBrace = aiRawText.indexOf('{');
              const lastBrace = aiRawText.lastIndexOf('}');
              if (firstBrace !== -1 && lastBrace !== -1) {
                  aiOutput = JSON.parse(aiRawText.substring(firstBrace, lastBrace + 1));
              } else {
                  throw new Error("No JSON found");
              }
          } 
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
          
          if (aiReply.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          }
          else if (aiReply.type === "button") {
             const buttons = (aiReply.options || []).slice(0, 3).map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } };
          }
          else if (aiReply.type === "flow") {
            payload = {
              messaging_product: "whatsapp",
              to: senderPhone,
              type: "interactive",
              interactive: {
                type: "flow",
                header: { type: "text", text: "ALAT Application" },
                body: { text: aiReply.body },
                footer: { text: "Secure by Wema" },
                action: {
                  name: "flow",
                  parameters: {
                    flow_message_version: "3",
                    flow_token: "unused_token",
                    flow_id: aiReply.flow_id,
                    flow_cta: aiReply.cta || "Start",
                    flow_action: "navigate",
                    flow_action_payload: {
                      screen: aiReply.screen || "DETAILS" // Default fallback, but prompt uses specific screens
                    }
                  }
                }
              }
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
