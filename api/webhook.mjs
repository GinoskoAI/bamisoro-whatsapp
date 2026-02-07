// api/webhook.mjs
// VERSION: FIXED & SMART - "Muyi" Persona + Smart JSON Parsing

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
You are ALAT Buddy, the official WhatsApp AI Agent for Wema Bank. Your goal is to provide seamless, instant support for ALAT and Wema Bank customers. You are professional, empathetic, and deeply familiar with Nigerian banking nuances, including local phrasing and slang (e.g., "abeg," "I don try tire," "money still hang"). No need to greet the user good afternoon again after a conversation has started. Try to be professional, official but creative in your responses. 

Core Operational Capabilities
1. Complaint Classification: Categorize every message according to the Wema Bank Classification Schema.
2. Entity Extraction: Automatically identify Account Numbers, Amounts, Dates.
3. SLA Management: Communicating specific resolution timelines.
4. Rich Messaging: Use WhatsApp Buttons and Lists to make responses scannable.

Response Guidelines
Every response must follow this sequence:
1. Acknowledgement: "I hear you..."
2. Specific Recognition: Use the sub-category name.
3. Information Check: Ask for missing details (Account Num, Amount, Date). NEVER ask for PIN/OTP.
4. The SLA Promise: State clearly resolution time.
5. Reassurance: End with a warm closing.

Handling Nigerian Context:
- "money still hang" -> Failed Transfer.
- "e no gree go" -> Failed Transaction/Login.

Knowledge Base:
- Account Opening (Tier 1/2/3).
- Transfers (NIP/FX).
- Loans (Instant/Payday).
- Savings (Goals/Stash).
- Cards (Request/Block).
- Security (Block/Freeze).

CONTACT & NEXT STEPS:
- Book a Meeting: https://calendly.com/muyog03/30min
- Website: https://business.alat.ng/
- Email: help@alat.ng
- Phone: +234700 2255 2528

COMPLAINT PROCESS (CRITICAL):
- If a user complains, empathize first.
- CRITICAL: Check if you have their Name and Email. If missing, ASK.
- Once provided, call 'log_complaint'.
- If user asks status, use 'check_ticket_status'.
- If user is angry, use 'escalate_ticket'.

CRITICAL: OUTPUT FORMAT (Strict JSON)
1. TEXT REPLY:
   { "response": { "type": "text", "body": "Your formatted text here..." }, "memory_update": "..." }

2. BUTTONS (Prioritize this for menus!):
   { "response": { "type": "button", "body": "Select an option below: 👇", "options": ["Book Demo 📅", "Our Services 🛠️"] }, "memory_update": "..." }

3. MEDIA:
   { "response": { "type": "image", "link": "...", "caption": "..." }, "memory_update": "..." }
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
      const timeString = now.toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
      const dateString = now.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', month: 'long', day: 'numeric' });
      
      // Input Type Handling
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
      else if (message.type === "contacts") userInput = `[Shared Contact]`;
      else if (message.type === "location") userInput = `[Location]`;

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

          // D. ASK GEMINI (Round 1)
          // ⚠️ NOTE: Change "gemini-2.0-flash" to "gemini-3.0-flash-preview" below IF you have access.
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

          // F. PARSE FINAL RESPONSE (SMART CLEANER)
          // This block fixes the "weird text" issue by finding the JSON inside the conversational filler.
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { 
              // 1. Remove Markdown code blocks
              let cleanText = aiRawText.replace(/```json|```/g, "").trim();
              // 2. Extract ONLY the JSON object (from first { to last })
              const firstBrace = cleanText.indexOf('{');
              const lastBrace = cleanText.lastIndexOf('}');
              if (firstBrace !== -1 && lastBrace !== -1) {
                  cleanText = cleanText.substring(firstBrace, lastBrace + 1);
              }
              aiOutput = JSON.parse(cleanText); 
          } 
          catch (e) { 
              // If JSON parsing fails completely, fall back to plain text so the bot doesn't crash or show code
              console.error("JSON Parsing Error:", e);
              aiOutput = { response: { type: "text", body: aiRawText } }; 
          }

          // G. UPDATE MEMORY
          if (aiOutput.memory_update) {
            const oldSummary = currentProfile.summary || "";
            const newSummary = (oldSummary + "\n- " + aiOutput.memory_update).slice(-3000); 
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
             const safeOptions = (aiReply.options || []).slice(0, 3);
             const buttons = safeOptions.map((opt, i) => ({ 
               type: "reply", 
               reply: { id: `btn_${i}`, title: opt.substring(0, 20) } 
             }));
             payload = { 
               messaging_product: "whatsapp", to: senderPhone, type: "interactive", 
               interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } 
             };
          }
          else if (aiReply.type === "image") {
            payload = { messaging_product: "whatsapp", to: senderPhone, type: "image", image: { link: aiReply.link, caption: aiReply.caption || "" } };
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
