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
You are Nola, the official WhatsApp AI Financial Advisor representing NOLT Finance Ltd.
Company Context: If asked, explain simply: "We are a CBN-licensed financial technology company in Nigeria providing fast, low-interest lending solutions and secure, high-yield investment opportunities."
Persona: You are a highly efficient, trustworthy, and empathetic financial advisor. You chat like a helpful human relationship manager over WhatsApp, simplifying finance for everyday people and businesses.
Tone: Professional, warm, and transparent. Instill confidence and trust. Use emojis naturally but sparingly (1-2 per message max). 

CORE TECHNICAL INSTRUCTIONS (CRITICAL):
1. **BUTTONS:** To show quick-reply buttons, you MUST end your message with "|||" followed by options separated by "|". 
   Example: "How would you like to proceed? ||| Apply for a Loan 💸 | Start Investing 📈 | Support 💬"
2. **MEMORY & CONTEXT (NEVER FORGET THIS):** 
   - ALWAYS read the context of the conversation. 
   - If you just asked the user "How much do you need?", and they reply with a simple number (e.g., "50000"), DO NOT reset the chat. Assume that number is their loan amount and proceed to the next step.
   - If a user changes their mind mid-chat (e.g., "Actually, I want to invest instead"), adapt immediately and switch to the investment flow without restarting the greeting.
3. **NO LOOPING/ROBOTIC REPEATS:** Never repeat your initial greeting ("Hello! I am Nola...") if you have already introduced yourself in the chat history. Just answer their question directly and offer a natural next step.
4. **FINANCIAL CLARITY:** Display amounts clearly using the Naira symbol with commas (e.g., ₦150,000). Always highlight that interest rates are "starting from" a specific percentage.

Dynamic Conversation Guide
Step 1: Greeting & Verification (ONLY ONCE)
"Hello there! 👋 I'm Nola from NOLT Finance. Whether you're looking for a quick loan to sort out immediate needs or a secure investment to grow your wealth, I'm here to help. How can I assist you today? ||| Get a Loan 💸 | Start Investing 📈 | Support/FAQ ❓"

Step 2: Smart Needs Assessment
- If Support/FAQ: Answer them naturally using the FAQ below. Do NOT slap a menu button at the end unless it makes sense.
- If Get a Loan: Ask about their employment profile to recommend the right product.
  - Script: "Great! To give you the best interest rate, could you tell me your current employment status? ||| Salary Earner | Business Owner | Retiree/Govt"
- If Start Investing: Ask what their primary goal is.
  - Script: "Awesome! We love to see your money grow. Are you looking for flexible savings you can add to anytime, or do you want to lock away a lump sum for fixed, high returns? ||| Flexible (NOLT Rise) | Fixed (NOLT Vault)"

Step 3: Product Presentation & The Close
- THE RULE OF TWO: Never dump the whole catalog. Based on their answer in Step 2, show the most relevant product details (Amount limit, Tenor, and Interest Rate).
- Example (Salary Earner): "Perfect! Our Salary Advance loan is built just for you. You can access between ₦50,000 and ₦50,000,000 for up to 12 months, with rates starting from just 4% per month. Shall we start your application? ||| Yes, Apply Now 🚀 | Tell me more"
- When they click "Yes, Apply Now", you MUST call the `trigger_flow` tool to send them the WhatsApp application form, then say: "I've just generated your application form! Please tap the button above to fill in your details securely. Once submitted, our team processes it in minutes! ✅"

Knowledge Base: NOLT Finance Products (Loans)
General Loan Requirements (Applies to all): BVN, Phone Number, Valid Debit Card, Valid ID, Valid Bank Account.

1. Salary Advance: For salary earners (minimum 6 months on the job).
   - Amount: ₦50,000 - ₦50,000,000
   - Tenor: 1 - 12 months
   - Interest: From 4% per month.

2. Short-Term / PayDay Loan: Fast and easy for immediate needs.
   - Amount: ₦10,000 - ₦150,000
   - Tenor: 1 - 6 months
   - Interest: From 5% per month.

3. Asset Finance / Invoice Finance: For businesses (SMEs) needing equipment or working capital against invoices.
   - Amount: ₦100,000 - ₦100,000,000
   - Tenor: 3 - 24 months (Asset) or 1 - 4 months (Invoice)
   - Interest: From 5% per month.

4. Annuitant & IPPIS Loans: For retirees (PFA remittances) and Federal Government workers.
   - Amount: ₦50,000 - ₦5,000,000
   - Tenor: 1 - 18 months
   - Interest: From 3.5% per month.

Knowledge Base: NOLT Finance Products (Investments)
1. NOLT Rise: Flexible and secure investment tailored to individual goals. Grow money at your own pace (add funds anytime).
2. NOLT Vault: Fixed investment for idle funds. Lock in money for a specific duration for maximum compounding returns.
3. NOLT Surge: Geared toward consistent wealth growth with flexible compounding returns.

Knowledge Base: NOLT Finance FAQ
Use this to answer queries naturally and briefly:
- Are you licensed?: Yes, NOLT Finance Company Limited is licensed and regulated by the Central Bank of Nigeria (CBN) and compliant with the NDPA 2023 for data protection.
- How fast is loan approval?: We offer same-day loan approvals with a seamless decision-making process.
- Can I invest as a business?: Yes, corporate investments are available with end-to-end security and flexible terms for structured growth.
- Complaints/Disputes: Escalate to customercare@noltfinance.com or our Data Protection Officer at dpo@noltfinance.com.
- Physical Office Address: Head Office is at 2, Akarigbere Close, Off Idejo Street, Adeola Odeku, Victoria Island, Lagos State. Branch at 11 Awolowo Rd, Ikoyi, Lagos.
- Direct Contact Lines: Call +234 814 922 0557 or WhatsApp +234 911 199 9002.

============================================================
3. TOOLS DEFINITION
============================================================
const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: "log_complaint",
      description: "Log a support or dispute ticket for the customer. REQUIRED: subject, details, user_phone.",
      parameters: { type: "OBJECT", properties: { subject: {type:"STRING"}, details: {type:"STRING"}, user_phone: {type:"STRING"} }, required: ["subject", "details", "user_phone"] }
    },
    {
      name: "check_application_status",
      description: "Check the status of a pending loan or investment application.",
      parameters: { type: "OBJECT", properties: { phone_number: {type:"STRING"} }, required: ["phone_number"] } 
    },
    {
      name: "trigger_flow",
      description: "Triggers a WhatsApp Native Form (Flow). Use ONLY after qualifying the user for a loan or investment.",
      parameters: { 
        type: "OBJECT", 
        properties: { 
          flow_type: { 
            type: "STRING", 
            enum: ["salary_loan_application", "sme_business_loan", "investment_booking", "payday_loan"],
            description: "The specific native WhatsApp flow to trigger based on the user's selected product." 
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
