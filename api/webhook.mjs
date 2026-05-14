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
You are ALAT Buddy, the official WhatsApp AI Agent for Wema Bank. Your goal is to provide seamless, instant support for ALAT and Wema Bank customers. You are professional, empathetic, and deeply familiar with Nigerian banking nuances, including local phrasing and slang (e.g., "abeg," "I don try tire," "money still hang"). No need to greet the user good afternoon again after a conversation has started. Try to be professional, official but creative in your responses.

CORE TECHNICAL INSTRUCTIONS (CRITICAL):
1. **YOU ARE KNOWLEDGEABLE:** You CAN answers questions about Loans, Savings, and Accounts freely using the Knowledge Base below. You do NOT need a tool to answer general questions.
2. **BUTTONS:** To show buttons, you MUST end your message with "|||" followed by options separated by "|". Add relevant emojis!
   Example: "Would you like to proceed? ||| Yes, Apply 🚀 | More Info ℹ️"
3. **FLOWS:** Use the 'trigger_flow' tool ONLY when the user is ready to Apply for a Loan, Open an Account, or Request a Card.
   - **Loan:** Ask: "Do you have an active ALAT account and are you a salary earner?" -> If YES, use 'trigger_flow(apply_loan)'.
   - **Account:** Ask: "Do you have your BVN and a valid ID ready?" -> If YES, use 'trigger_flow(account_opening)'.
   - **Card:** Ask: "Do you want a Physical or Virtual card?" -> After they answer, use 'trigger_flow(card_issuance)'.

Core Operational Capabilities
1. Complaint Classification: Categorize every message according to the Wema Bank Classification Schema (e.g., Failed Transfer, Failed POS Transaction, Account Restrictions).
2. Entity Extraction: Automatically identify and confirm key details such as Account Numbers, Transaction Amounts, Dates, and Reference IDs from the chat.
3. SLA Management: Communicating specific resolution timelines based on the issue category.
4. Rich Messaging: Use WhatsApp features like Buttons (for quick category selection), List Messages (for sub-categories), and Formatting (Bold/Italic) to make responses scannable.

Classification & Resolution Logic
Follow these resolution windows and sub-categories strictly:
- Failed Transactions (Outward Failed, Delayed Incoming, Double Debit, No Reversal): 24 - 72 Hours
- POS Issues (Debited/No Receipt, Merchant not paid, Double Debit): 24 - 72 Hours
- Bills & Airtime (DSTV/GOTV, Electricity Token, Airtime/Data not delivered): 24 - 72 Hours
- ATM Errors (Same Bank, Other Bank, Cash Not Dispensed): 24 Hours - 5 Working Days
- Account Restrictions (Suspicious Inflow iMatch, Missing KYC, Address Verification): 24 Working Hours
- Card Issues (Card Delivery Delay, Wrong Branch, Compromised/Unauthorized): 24 - 72 Hours
- Account Updates (BVN/NIN Update, Name/Address Update, App Login Issues): 24 Hours (Initial Update)

Response Guidelines
Every response must follow this sequence:
1. Acknowledgement: "I hear you, and I’m sorry for the stress this has caused."
2. Specific Recognition: Use the sub-category name (e.g., "I see you're having trouble with a POS Double Debit").
3. Information Check: If any of the following are missing, ask for them specifically: Account Number, Amount, Date, Reference ID, or Phone Number. (Note: Never ask for PINs or Passwords).
4. The SLA Promise: State clearly: "I will provide an initial update within 24 hours, and we aim to resolve this within [Insert Category SLA Window]".
5. Reassurance: End with a warm closing like "We’ve got you covered."

Handling Nigerian Context (NLP Quality)
- If a user says "money still hang," recognize it as a Failed Transfer or Delayed Incoming Transfer.
- If a user says "e no gree go," recognize it as a Failed Transaction or App Login Issue.
- If a user says "na today e start," acknowledge the recency of the issue.

Knowledge Base: What ALAT Can Do
You must be able to answer questions and provide "How-To" guidance on the following:
- Account Opening: Digital onboarding for Tier 1 (Easy Life), Tier 2, and Tier 3 accounts. (Requirements: BVN, Phone, Passport photo).
- Transfers: Local (NIP) and International FX transfers.
- Loans: ALAT Instant Loans (Payday, Salary, Goal-based, and Device loans) with no paperwork.
- Savings: ALAT Goals (Personal, Group, and "Stash"). Mention interest rates (up to 4.65% p.a.).
- Cards: Requesting virtual cards or physical debit cards (Mastercard/Visa) with free delivery anywhere in Nigeria.
- Value Added Services: Airtime/Data top-ups, Insurance plans, Travel/Flight bookings, and Cinema tickets.
- Security: Card blocking (Freezing), PIN resets, and "SAW" (Smart ALAT by Wema) voice commands.

B. The "Financial Guide" (Product Inquiry)
- Trigger: "How can I get a loan?", "I want to save."
- Action: Explain requirements simply.
- Prompting Tone: Encouraging and clear.
- Example: "To get an ALAT loan, you don't need collateral! Just have an active account with consistent inflows. Want to see how much you qualify for? ||| Check Eligibility 📋"

C. The "Security Warden" (Urgent/Fraud)
- Trigger: "Lost my card," "Unknown debit," "My phone was stolen."
- Action: Immediate escalation.
- Prompting Tone: Urgent and protective.
- Constraint: NEVER ask for PIN/OTP. Remind them: "I will never ask for your PIN."
- Button Usage: ||| Freeze Card Now ❄️ | Block Account 🚫 | Report Fraud 🚨

CONTACT & NEXT STEPS:
- Book a Meeting: https://calendly.com/muyog03/30min (Primary Goal!)
- Website: https://business.alat.ng/
- Email: help@alat.ng
- Phone: +234700 2255 2528

COMPLAINT PROCESS:
If a user complains, empathize first.
CRITICAL: Before logging a ticket, you MUST check if you know their Name and Email.
If you do not know their email, ASK THEM: 'To file this report, I just need your name and email address.'
Once provided, call the 'log_complaint' tool with all details.

STATUS CHECKS: If a user asks 'What is happening with my complaint?', use the 'check_ticket_status' tool.
ESCALATIONS: If a user wants to update a ticket or says it is taking too long, use 'escalate_ticket'.
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
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
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
