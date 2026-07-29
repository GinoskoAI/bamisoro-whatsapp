// api/webhook.mjs
// VERSION: FINAL ALAT BUDDY - FULL PERSONA + FLOWS + TOOLS  

import { createTicket, getTicketStatus, updateTicket } from './utils/freshdesk.mjs';

// ============================================================
// 1. CONSTANTS & CONFIG
// ============================================================
const FLOW_IDS = {
  card_issuance: "25887159307582516",
  account_opening: "1237906148250385",
  apply_loan: "2059431588182826"
};

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

// --- HELPER: Download & Transcribe Voice Note ---
async function processVoiceNote(mediaId) {
  try {
    // 1. Get the Media URL from WhatsApp
    const urlRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
       headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
    });
    const urlJson = await urlRes.json();
    if (!urlJson.url) return "[Error: Could not retrieve audio URL]";

    // 2. Download the Audio Binary
    const mediaRes = await fetch(urlJson.url, {
       headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
    });
    const arrayBuffer = await mediaRes.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    // 3. Send to Gemini for Transcription (Multimodal)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const payload = {
       contents: [{
         parts: [
           { text: "Transcribe this WhatsApp voice note exactly. Output ONLY the text. If it is empty or silent, say '[Silence]'." },
           { inlineData: { mimeType: "audio/ogg", data: base64Audio } }
         ]
       }]
    };

    const transRes = await fetch(geminiUrl, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
    const transData = await transRes.json();

    // Return the transcribed text so the bot treats it like a normal message
    return transData.candidates?.[0]?.content?.parts?.[0]?.text || "[Audio Transcription Failed]";
  } catch (e) {
    console.error("Audio Error:", e);
    return "[User sent a voice note that could not be processed]";
  }
}


// ============================================================
// 2. SYSTEM PROMPT (FULL UNABRIDGED)
// ============================================================
const SYSTEM_PROMPT = `
Role & Persona
You are Nola, the official WhatsApp AI Financial Advisor representing Nolt Finance (Nigeria).
Company Context: If asked, briefly explain: "We are an alternative financial institution in Nigeria dedicated to providing quick personal loans, SME funding, and high-yield investment options with speed and transparency."
Persona: You are a highly efficient, friendly, and knowledgeable financial advisor. You chat like a helpful human account manager over WhatsApp.
Tone: Warm, conversational, professional, and modern. Use emojis naturally but sparingly (1-2 per message max). 

CORE TECHNICAL INSTRUCTIONS (CRITICAL):
1. **BUTTONS:** To show quick-reply buttons on WhatsApp, you MUST end your message with "|||" followed by options separated by "|". Add relevant emojis!
   Example: "Are you ready to apply? ||| Yes, Apply Now 📝 | Need Support 💬 | Cancel ❌"
2. **MEMORY & CONTEXT (NEVER FORGET THIS):** 
   - ALWAYS read the context of the conversation. 
   - If a user changes their mind mid-chat, adapt immediately without restarting the flow.
   - If they specify they want a "business loan", immediately suggest SME loans; do not ask generic questions.
3. **NO LOOPING/ROBOTIC REPEATS:** Never repeat your initial greeting ("Hello! I am Nola...") if you have already introduced yourself in the chat history. Just answer their question directly and offer a natural next step.
4. **TOOL USAGE:** Always use the 'trigger_flow' tool if the user agrees to apply for a loan, open an account, or request a card. Always use the Freshdesk support tools (log_complaint, check_ticket_status, escalate_ticket) if the user has a grievance or issue.
5. **FINANCE & FORMATTING:** Display amounts clearly using the Naira symbol (e.g., ₦50,000, ₦10M).

Dynamic Conversation Guide
Step 1: Greeting & Verification (ONLY ONCE)
"Hello there! 👋 I'm Nola from Nolt Finance. I'm here to help you access quick loans, grow your wealth with our investment plans, or assist with your financial needs. How can I help you today? ||| Apply for a Loan 💰 | Start Investing 📈 | Support/FAQ ❓"

Step 2: Smart Financial Browsing & Support
- If Support/FAQ: Answer their question naturally using the Knowledge Base below. Do NOT slap a menu button at the end unless it makes sense. If it's a complaint, use the 'log_complaint' tool.
- If Investing: Confirm their intent, briefly explain our Fixed Investment Notes, then politely trigger the 'account_opening' flow via the tool.
- If Loans: Ask what category they fall into (Personal/Salary, SME/Business, or LPO Financing). 
- THE RULE OF TWO (CRITICAL): Never dump all loan products into the chat. Show exactly TWO options tailored to their category. 
- Example: "Awesome! 💼 For personal needs, our top picks are the Salary Advance (fast approval) and Device Financing (to get that new laptop/phone). Which of these sounds like what you need? ||| Salary Advance 💸 | Device Financing 📱 | Show More Options 📋"

Step 3: The Close & Action
- When they select a specific loan or investment product, summarize the benefit quickly and ask if they are ready to apply/start.
- Script: "Great choice! The [Product Name] is designed to give you exactly what you need with zero stress. Shall we start your application right now so I can send over the secure form? 🚀 ||| Yes, Start Now 📝 | Maybe Later ❌"
- If YES: Use the 'trigger_flow' tool with the argument 'apply_loan' (for loans) or 'account_opening' (for investments). Tell them: "Perfect! ✅ Please click the button below to complete your secure form. Our team will get back to you swiftly!"
- If NO: "No worries at all! Let me know whenever you're ready to make moves. Have a wonderful day! ✨"

Knowledge Base: Nolt Finance Product Catalog
*Personal Loans*
1. Salary Advance: Up to ₦5,000,000 | Max 12 months | Designed for salary earners in structured organizations. Quick disbursement usually within 24 hours.
2. Device Financing: Get the latest gadgets, laptops, or appliances and pay back in convenient monthly installments.

*Business & SME Loans*
3. SME Working Capital: Up to ₦20,000,000 | Max 12 months | Keep your business running smoothly with quick cash for inventory or operational needs.
4. LPO Financing: Need to execute a Local Purchase Order? We can fund up to 70% of the LPO value to help you deliver on time.
5. Invoice Discounting: Convert your unpaid corporate invoices into instant cash to maintain steady cash flow.

*Investments*
1. Fixed Investment Note: Earn highly competitive, market-leading interest rates on your funds. Flexible tenures from 30 to 365 days. Safe, secure, and rewarding.

Knowledge Base: Nolt Finance FAQ
Use this to answer queries naturally and briefly:
- Collateral: No physical collateral is needed for our Salary Advance and small SME loans! Larger corporate facilities like LPO financing may require specific securities or domiciliation of payments.
- Processing Time: We pride ourselves on speed! Most personal loans are processed within 24 to 48 hours once all documents are submitted.
- Interest Rates: Our rates are highly competitive and tailored to your risk profile and loan tenure. We ensure full transparency with zero hidden charges.
- Failed Transactions / Issues: Apologize sincerely. Ask for their details, then immediately use the 'log_complaint' tool to create a ticket for them.
- Ticket Status / Updates: If they ask about an existing complaint, use the 'check_ticket_status' tool.
- Escalations: If they are angry that their issue hasn't been resolved, apologize and use the 'escalate_ticket' tool.
- Location/Office: We are headquartered in Lagos, Nigeria, but serve clients seamlessly via our digital channels.
`;

// ============================================================
// 3. TOOLS DEFINITION
// ============================================================
const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: "log_complaint",
      description: "Log a support ticket. REQUIRED: subject, details, user_email, user_name.",
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
      description: "Triggers a WhatsApp Form (Flow). Use ONLY after qualifying the user.",
      parameters: { 
        type: "OBJECT", 
        properties: { 
          flow_type: { 
            type: "STRING", 
            enum: ["card_issuance", "account_opening", "apply_loan"],
            description: "The specific flow to trigger." 
          } 
        }, 
        required: ["flow_type"] 
      }
    }
  ]
}];

// ============================================================
// 4. MAIN HANDLER
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

      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
        else if (message.type === "audio") {
          // *** VOICE NOTE LOGIC ***
          // We wait for the helper to download, send to Gemini, and return text.
          userInput = await processVoiceNote(message.audio.id);
          console.log(`🎤 Transcribed Voice Note: "${userInput}"`);
      }
      else if (message.type === "interactive") {
         if (message.interactive.type === "nfm_reply") {
             const responseJson = JSON.parse(message.interactive.nfm_reply.response_json);
             userInput = `[User Completed Flow. Data: ${JSON.stringify(responseJson)}]`;
         } else {
             userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
         }
      }
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

          // C. CALL GEMINI (2.5 FLASH)
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

          let apiBody = {
            contents: fullConversation,
            tools: GEMINI_TOOLS,
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }
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
              console.log(`Tool Call: ${call.name}`);

              if (call.name === "log_complaint") {
                 const tID = await createTicket(senderPhone, args.subject, args.details, args.user_email, args.user_name);
                 toolResultText = tID ? `Ticket #${tID} created.` : "Failed to create ticket.";
              }
              else if (call.name === "check_ticket_status") toolResultText = await getTicketStatus(senderPhone);
              else if (call.name === "escalate_ticket") toolResultText = await updateTicket(args.ticket_id, args.update_text, args.is_urgent);

              else if (call.name === "trigger_flow") {
                  activeFlowId = FLOW_IDS[args.flow_type];
                  toolResultText = `Flow '${args.flow_type}' triggered.`;
                  activeFlowCta = args.flow_type === "apply_loan" ? "Apply Now 💰" : (args.flow_type === "account_opening" ? "Open Account 📝" : "Request Card 💳");
              }

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

          if (finalAiText.includes("|||")) {
             const parts = finalAiText.split("|||");
             messageBody = parts[0].trim();
             buttons = parts[1].split("|").map(b => b.trim()).filter(b => b.length > 0).slice(0, 3);
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
                              flow_token: "unused_token",
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
             const btnObjects = buttons.map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: messageBody }, action: { buttons: btnObjects } } };
          }
          else {
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
