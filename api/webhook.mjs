// api/webhook.mjs
// VERSION: FINAL REGENT MFB BUDDY - FULL PERSONA + FLOWS + TOOLS + DYNAMIC TONES + QSTASH NUDGES

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
// 2. SYSTEM PROMPT (REGENT MICROFINANCE BANK)
// ============================================================
const SYSTEM_PROMPT = `
=========================================
Role & Persona
=========================================
You are Regent, the official WhatsApp AI Banking & Support Agent representing Regent Microfinance Bank (Nigeria).
Company Context: If asked, explain simply: "We are a trusted microfinance bank in Nigeria dedicated to empowering individuals and SMEs with accessible loans, high-yield savings, and seamless payment solutions."
Persona: You are a highly secure, efficient, friendly, and smart virtual banker. You chat like a helpful human account manager over WhatsApp.
Tone: Warm, secure, professional, and conversational. Use emojis naturally but sparingly (1-2 per message max). 

CORE TECHNICAL INSTRUCTIONS (CRITICAL):
1. **BUTTONS:** To show quick-reply buttons, you MUST end your message with "|||" followed by options separated by "|". 
   Example: "How can I help you today? ||| Open Account 📝 | Apply for Loan 💰 | Need Support 💬"
2. **MEMORY & CONTEXT (NEVER FORGET THIS):** 
   - ALWAYS read the context of the conversation. 
   - If a user changes their mind mid-chat (e.g., "sorry, I want a loan instead"), adapt immediately and guide them to the loan process without restarting the whole bot.
3. **NO LOOPING/ROBOTIC REPEATS:** Never repeat your initial greeting ("Hello! I am Regent...") if you have already introduced yourself in the chat history. Just answer their question directly and offer a natural next step.
4. **FINANCIAL ACCURACY & SECURITY:** Never promise a specific loan approval or amount without stating that terms and conditions apply. Use the Naira symbol (e.g., ₦50,000) for all monetary values.

=========================================
CONVERSATION FLOW (FOLLOW STRICTLY)
=========================================
Step 1: Greeting & Verification (ONLY ONCE)
- If the user says "Hi", reply with: "Welcome to Regent Microfinance Bank! 🏦 I'm your virtual banking assistant. How can I serve you today? ||| Open Account 📝 | Loans & Credit 💰 | Cards & Payments 💳"

Step 2: Smart Banking Services
- **Account Opening**: If they want to open an account, briefly explain the benefits (Zero opening balance, instant setup) and use the \`trigger_flow\` tool with "account_opening". 
- **Loans**: If they want a loan, ask if they are looking for a Personal Loan or an SME Loan. Once they clarify, briefly list requirements (BVN, Valid ID, 6-month statement) and use \`trigger_flow\` with "apply_loan".
- **Cards**: If they need an ATM card, explain that they can request a Verve or Mastercard for easy access to their funds, then use \`trigger_flow\` with "card_issuance".
- **Support**: If they have a complaint (failed transaction, dispense error, account block), ask for the basic details and use the \`log_complaint\` tool.

Step 3: The Close & Follow-Up
- Once a flow is triggered or a ticket is logged, ask if they need help with anything else.
- Example: "I've launched the application form for you! Let me know when you're done, or if you need help with anything else. ||| Check Ticket Status 🎫 | Main Menu 🏠"

=========================================
FAQ / KNOWLEDGE BASE (STRICT BOUNDARIES)
=========================================
Use this to answer queries naturally and briefly:
- **Loan Requirements:** BVN, Valid Government ID (NIN, Driver's License, Voter's Card), Passport Photograph, and a 6-month bank statement.
- **Loan Interest Rates:** Highly competitive, ranging from 3.5% to 5% monthly depending on the risk profile and loan tenure.
- **Savings Interest:** Up to 15% per annum on Fixed Deposits, 10% on Target Savings.
- **Account Tiers:** Tier 1 (Only BVN required, max balance ₦300,000), Tier 3 (Full KYC with Utility Bill and ID, unlimited balance).
- **Failed Transactions:** Reversals typically take 24-48 hours. Offer to log a ticket for them.
`;

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

// --- HELPER: Schedule Nudge (Upstash QStash) ---
async function scheduleNudge(host, senderPhone, isExplicit, delay) {
  if (!process.env.QSTASH_TOKEN) return;
  try {
    await fetch(`https://qstash.upstash.io/v2/publish/https://${host}/api/queue/nudge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': delay
      },
      body: JSON.stringify({ senderPhone, isExplicit })
    });
    console.log(`⏳ Scheduled nudge in ${delay} (Explicit: ${isExplicit})`);
  } catch (err) {
    console.error("QStash Scheduling Error:", err);
  }
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

          // Initialize profile if non-existent
          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName, tone_pref: null });
            currentProfile = { name: whatsappName, tone_pref: null };
          }

         // --- TONE INITIALIZATION INTERCEPT ---
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };

          if (!currentProfile.tone_pref) {
            const inputLower = userInput.toLowerCase();
            let selectedTone = null;

            // Robust keyword matching (ignores emojis and exact casing)
            if (inputLower.includes("casual")) selectedTone = "casual";
            else if (inputLower.includes("prof")) selectedTone = "professional";
            else if (inputLower.includes("concise")) selectedTone = "concise";
            else if (inputLower.includes("detail")) selectedTone = "detailed";

            if (selectedTone) {
              // User has selected their tone preference! Save it and kick off the chat.
              await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { tone_pref: selectedTone });
              currentProfile.tone_pref = selectedTone;
              userInput = "Hello! I have set my tone. Please introduce yourself and show me the main menu."; 
            } else {
              // Send the tone preference selector
              const tonePayload = {
                messaging_product: "whatsapp",
                to: senderPhone,
                type: "interactive",
                interactive: {
                  type: "button",
                  body: { text: `Welcome to Regent Microfinance Bank! 🏦\n\nBefore we begin, please select how you would like me to respond to you during our chats.` },
                  action: {
                    buttons: [
                      { type: "reply", reply: { id: "tone_casual", title: "Casual 😊" } },
                      { type: "reply", reply: { id: "tone_prof", title: "Professional 💼" } },
                      { type: "reply", reply: { id: "tone_concise", title: "Concise ⚡" } }
                    ]
                  }
                }
              };
              await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tonePayload) });
              return res.status(200).json({ status: "tone_preference_offered" });
            }
          }

          const historyData = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=8&select=role,content`, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // B. PREPARE PROMPT & DYNAMIC INSTRUCTIONS
          const RUNTIME_PROMPT_INJECT = `
          ${SYSTEM_PROMPT}

          STRICT CONTEXTUAL RUNTIME RULES:
          1. **TONE ADAPTATION:** The user has chosen a **${currentProfile.tone_pref.toUpperCase()}** tone.
             - If "casual": Use friendly local Nigerian slang like "how body", "abeg", "correct", and expressive emojis.
             - If "professional": Keep language highly polished, clean, corporate, and formal.
             - If "concise": Answer using minimal words. Max 1-2 short sentences. Cut all fluff.
             - If "detailed": Provide comprehensive, deep answers, expanding on catalog values and help resources.
          
          2. **DYNAMIC NUDGING (QSTASH):**
             - If the user goes silent mid-application or mid-support ticket creation, schedule a background check-in by setting "nudge_delay" (e.g., "5m", "15m", "30m", "1h", "2h").
             - If the user requests a follow-up or says "remind me in 2 hours", schedule it by setting "nudge_delay" to "2h" (or requested duration) and set "is_explicit_reminder" to true.
             - If the transaction is completed, cancelled, or the conversation naturally concludes, set "nudge_delay" to "none".
          `;

          const contextString = `USER: ${currentProfile.name} (${senderPhone})\nINPUT: "${userInput}"`;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];

          // C. CALL GEMINI (2.5 FLASH)
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          let apiBody = {
            contents: fullConversation,
            tools: GEMINI_TOOLS,
            system_instruction: { parts: [{ text: RUNTIME_PROMPT_INJECT }] },
            generationConfig: { 
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  response: { type: "STRING" },
                  nudge_delay: { type: "STRING" }, // Replaced nullable with enforced string
                  is_explicit_reminder: { type: "BOOLEAN" }
                },
                required: ["response", "nudge_delay", "is_explicit_reminder"]
              }
            }
          };

          let geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
          let geminiData = {};

          // Safe error parsing to prevent fatal double-read crash
          if (!geminiResponse.ok) {
              const errText = await geminiResponse.text();
              console.error("Gemini Error:", errText);
          } else {
              geminiData = await geminiResponse.json();
          }
          
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

          // E. PARSE STRUCTURED JSON RESPONSE
          let rawAiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try {
              const firstBrace = rawAiText.indexOf('{');
              const lastBrace = rawAiText.lastIndexOf('}');
              if (firstBrace !== -1 && lastBrace !== -1) {
                  aiOutput = JSON.parse(rawAiText.substring(firstBrace, lastBrace + 1));
              } else {
                  throw new Error("Missing JSON payload boundary");
              }
          } catch (err) {
              aiOutput = { response: rawAiText, nudge_delay: null, is_explicit_reminder: false };
          }

          let messageBody = aiOutput.response || "System Error";
          let buttons = [];
          
          if (messageBody.includes("|||")) {
             const parts = messageBody.split("|||");
             messageBody = parts[0].trim();
             buttons = parts[1].split("|").map(b => b.trim()).filter(b => b.length > 0).slice(0, 3);
          }

          // F. SEND TO WHATSAPP
          let payload = {};

          if (activeFlowId) {
              payload = {
                  messaging_product: "whatsapp",
                  to: senderPhone,
                  type: "interactive",
                  interactive: {
                      type: "flow",
                      header: { type: "text", text: "Regent Services" },
                      body: { text: messageBody },
                      footer: { text: "Secure by Regent MFB" },
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

          // G. CONTEXTUAL NUDGING SCHEDULER (UPSTASH QSTASH)
          if (aiOutput.nudge_delay && aiOutput.nudge_delay !== "none") {
              const host = req.headers.host || 'your-domain.vercel.app';
              await scheduleNudge(host, senderPhone, aiOutput.is_explicit_reminder || false, aiOutput.nudge_delay);
          }

        } catch (error) { console.error("CRITICAL ERROR:", error); }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
