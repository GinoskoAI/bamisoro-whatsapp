// api/webhook.mjs
// VERSION: AUDIO-ENABLED | SMART BUTTONS | FLOWS FIXED

import { createTicket, getTicketStatus, updateTicket } from './utils/freshdesk.mjs';

// ============================================================
// 1. CONSTANTS & CONFIG
// ============================================================
const FLOW_IDS = {
  card_issuance: "25887159307582516",
  account_opening: "1237906148250385",
  apply_loan: "2059431588182826"
};

// ============================================================
// 2. HELPER FUNCTIONS
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

// NEW: Helper to download Audio from WhatsApp
async function downloadWhatsAppMedia(mediaId) {
  try {
    // 1. Get URL
    const metaUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
    const metaHeaders = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` };
    const metaRes = await fetch(metaUrl, { headers: metaHeaders });
    const metaData = await metaRes.json();
    
    if (!metaData.url) return null;

    // 2. Download Binary
    const mediaRes = await fetch(metaData.url, { headers: metaHeaders });
    const arrayBuffer = await mediaRes.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  } catch (e) {
    console.error("Audio Download Error:", e);
    return null;
  }
}

// ============================================================
// 3. SYSTEM PROMPT
// ============================================================
const SYSTEM_PROMPT = `
Role: ALAT Buddy (Wema Bank).
Tone: Professional, Empathetic, NIGERIAN FRIENDLY ("Abeg", "We dey for you").
Goal: Solve issues, Drive Conversions (Loans/Cards).

CRITICAL INSTRUCTIONS:
1. **EMOJIS:** Use 2-3 emojis in EVERY message. Make it lively! 🚀✨
2. **BUTTONS:** End messages with "|||" followed by options. 
   - **IMPORTANT:** Keep button text SUPER SHORT (under 20 chars).
   - Example: "Select option: ||| Apply 💰 | Status 🔍 | Help ℹ️"
3. **KNOWLEDGE:** Answer questions about Loans, Savings, Cards freely.
4. **AUDIO:** If the user sends a voice note, LISTEN to it and reply accordingly.

FLOWS (Forms):
- Use 'trigger_flow' ONLY after qualifying:
  - **Loan:** Ask: "Salary earner & Active account?" -> 'trigger_flow(apply_loan)'
  - **Account:** Ask: "Have BVN & ID?" -> 'trigger_flow(account_opening)'
  - **Card:** Ask: "Physical or Virtual?" -> 'trigger_flow(card_issuance)'

CAPABILITIES:
- Complaint -> Ask details -> 'log_complaint'.
- Status -> 'check_ticket_status'.
- Escalate -> 'escalate_ticket'.

CONTEXT:
- "Money hang" = Failed Transfer.
- "No gree go" = App Issue.

... (keep existing prompt text) ...

  NATIVE FLOWS (FORMS):
  Use these ID's ONLY when the user explicitly agrees to apply.
  1. Loan Application: "928085692908196" (Screen: "DETAILS")
  2. Card Request: "25887159307582516" (Screen: "CARD_SELECTION_SCREEN")
  3. Account Opening: "1237906148250385" (Screen: "DETAILS")

  OUTPUT FORMAT FOR FLOWS:
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
// 4. TOOLS
// ============================================================
const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: "log_complaint",
      description: "Log ticket. REQUIRED: subject, details, user_email, user_name.",
      parameters: { type: "OBJECT", properties: { subject: {type:"STRING"}, details: {type:"STRING"}, user_email: {type:"STRING"}, user_name: {type:"STRING"} }, required: ["subject", "details", "user_email", "user_name"] }
    },
    {
      name: "check_ticket_status",
      description: "Check ticket status.",
      parameters: { type: "OBJECT", properties: {} } 
    },
    {
      name: "escalate_ticket",
      description: "Escalate a ticket.",
      parameters: { type: "OBJECT", properties: { ticket_id: {type:"NUMBER"}, update_text: {type:"STRING"}, is_urgent: {type:"BOOLEAN"} }, required: ["ticket_id", "update_text"] }
    },
    {
      name: "trigger_flow",
      description: "Triggers a WhatsApp Form. Use ONLY after qualifying.",
      parameters: { 
        type: "OBJECT", 
        properties: { 
          flow_type: { type: "STRING", enum: ["card_issuance", "account_opening", "apply_loan"] } 
        }, 
        required: ["flow_type"] 
      }
    }
  ]
}];

// ============================================================
// 5. MAIN HANDLER
// ============================================================
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
      
      // 1. INPUT HANDLING (Text vs Audio vs Interactive)
      let userInputPart = { text: "" }; // Default to text
      let userLogText = "";

      if (message.type === "text") {
        userInputPart = { text: message.text.body };
        userLogText = message.text.body;
      } 
      else if (message.type === "audio") {
        // AUDIO HANDLING
        const audioBase64 = await downloadWhatsAppMedia(message.audio.id);
        if (audioBase64) {
          userInputPart = { inlineData: { mimeType: "audio/ogg", data: audioBase64 } };
          userLogText = "[Voice Note]";
        } else {
          userInputPart = { text: "[User sent a voice note, but download failed]" };
          userLogText = "[Voice Note Failed]";
        }
      }
      else if (message.type === "interactive") {
         if (message.interactive.type === "nfm_reply") {
             const responseJson = JSON.parse(message.interactive.nfm_reply.response_json);
             const flowData = JSON.stringify(responseJson);
             userInputPart = { text: `[User Completed Flow. Data: ${flowData}]` };
             userLogText = `[Flow Data: ${flowData}]`;
         } else {
             const btnText = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
             userInputPart = { text: btnText };
             userLogText = btnText;
         }
      }

      if (userLogText) {
        try {
          console.log(`[${senderPhone}] Input: ${userLogText}`);

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

          // B. PREPARE PROMPT (Multimodal Friendly)
          const systemPart = { text: `SYSTEM_INSTRUCTION: ${SYSTEM_PROMPT}\nUSER_CONTEXT: Name=${currentProfile.name}` };
          const fullConversation = [
              ...chatHistory, 
              { role: "user", parts: [userInputPart] } // Insert Text OR Audio part here
          ];

          // C. CALL GEMINI (2.5 FLASH - Multimodal)
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          let apiBody = {
            contents: fullConversation,
            tools: GEMINI_TOOLS,
            system_instruction: { parts: [systemPart] }
          };

          let geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
          
          if (!geminiResponse.ok) console.error("Gemini Error:", await geminiResponse.text());

          let geminiData = await geminiResponse.json();
          let candidate = geminiData.candidates?.[0]?.content?.parts?.[0];
          
          let activeFlowId = null;
          let activeFlowCta = "Open Form";

          // D. CHECK FOR TOOL USE
          if (candidate?.functionCall) {
              const call = candidate.functionCall;
              const args = call.args;
              let toolResultText = "Done.";
              console.log(`Tool: ${call.name}`);

              if (call.name === "log_complaint") {
                 const tID = await createTicket(senderPhone, args.subject, args.details, args.user_email, args.user_name);
                 toolResultText = tID ? `Ticket #${tID} created.` : "Failed.";
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
                      screen: aiReply.screen || "DETAILS" 
                    }
                  }
                }
              }
            };
          }
                
              else if (call.name === "check_ticket_status") toolResultText = await getTicketStatus(senderPhone);
              else if (call.name === "escalate_ticket") toolResultText = await updateTicket(args.ticket_id, args.update_text, args.is_urgent);
              else if (call.name === "trigger_flow") {
                  activeFlowId = FLOW_IDS[args.flow_type];
                  toolResultText = `Flow triggered.`;
                  activeFlowCta = args.flow_type === "apply_loan" ? "Apply Now 💰" : "Start Now 🚀";
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
            flow_cta: aiReply.cta || "Start Application",
            flow_action: "navigate",
            flow_action_payload: {
              screen: aiReply.screen || "DETAILS" 
            }
          }
        }
      }
    };
  }            

              // Round 2
              const followUpContents = [
                  ...fullConversation,
                  { role: "model", parts: [{ functionCall: call }] },
                  { role: "function", parts: [{ functionResponse: { name: call.name, response: { result: toolResultText } } }] }
              ];
              apiBody.contents = followUpContents;
              geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
              geminiData = await geminiResponse.json();
          }

          // E. PARSE RESPONSE
          let finalAiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "System Error";
          let messageBody = finalAiText;
          let buttons = [];
          
          // SMART BUTTON TRUNCATOR
          if (finalAiText.includes("|||")) {
             const parts = finalAiText.split("|||");
             messageBody = parts[0].trim();
             // Split -> Trim -> Slice to 3 buttons -> TRUNCATE to 20 chars
             buttons = parts[1].split("|")
                .map(b => b.trim())
                .filter(b => b.length > 0)
                .slice(0, 3)
                .map(b => {
                    if (b.length <= 20) return b;
                    // Try removing emojis to save space
                    const noEmoji = b.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
                    if (noEmoji.length <= 20) return noEmoji;
                    // Hard truncate
                    return b.substring(0, 19) + ".";
                });
          }

          // F. SEND TO WHATSAPP
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};

          if (activeFlowId) {
              payload = {
                  messaging_product: "whatsapp",
                  to: senderPhone,
                  type: "interactive",
                  interactive: {
                      type: "flow",
                      header: { type: "text", text: "ALAT Services" },
                      body: { text: messageBody },
                      footer: { text: "Secure by Wema" },
                      action: {
                          name: "flow",
                          parameters: {
                              flow_message_version: "3",
                              flow_token: `${Date.now()}`, // Dynamic token
                              flow_id: activeFlowId,
                              flow_cta: activeFlowCta,
                              flow_action: "navigate",
                              flow_action_payload: { screen: "QUESTION_1" } 
                          }
                      }
                  }
              };
          }
          else if (buttons.length > 0) {
             const btnObjects = buttons.map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: messageBody }, action: { buttons: btnObjects } } };
          }
          else {
             payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: messageBody } };
          }

          if (payload.messaging_product) {
            await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });
            // Log plain text only for DB
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: messageBody });
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'user', content: userLogText });
          }

        } catch (error) { console.error("CRITICAL ERROR:", error); }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
