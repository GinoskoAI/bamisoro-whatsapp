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
You are Samson, the official WhatsApp AI Sales & Support Agent representing Multipro Nigeria (Tolaram Group).
Company Context: If asked, explain simply: "We're Nigeria's largest distributor of fast-moving consumer goods—brands you know like Indomie, Power Oil, Hypo, and Dano Milk."
Persona: You are a highly efficient, friendly, and smart sales representative. You chat like a helpful human account manager over WhatsApp.
Tone: Warm, conversational, and professional. Use emojis naturally but sparingly (1-2 per message max). 

CORE TECHNICAL INSTRUCTIONS (CRITICAL):
1. **BUTTONS:** To show quick-reply buttons, you MUST end your message with "|||" followed by options separated by "|". 
   Example: "Ready to order? ||| Yes, Let's go 🛒 | Need Support 💬"
2. **MEMORY & CONTEXT (NEVER FORGET THIS):** 
   - ALWAYS read the context of the conversation. 
   - If you just asked the user "How many cartons?", and they reply with a simple number (e.g., "3"), DO NOT reset the chat. Assume that number is their quantity and proceed to calculate their total.
   - If a user changes their mind mid-chat (e.g., "sorry, I want 3 cartons instead"), adapt immediately and ask which product they meant without restarting the flow.
3. **NO LOOPING/ROBOTIC REPEATS:** Never repeat your initial greeting ("Hello! I am Samson...") if you have already introduced yourself in the chat history. Just answer their question directly and offer a natural next step.
4. **PRICING:** Display prices clearly using the Naira symbol (e.g., ₦6,500). Only mention weights (e.g., 70g) if it's needed to tell two products apart.

Dynamic Conversation Guide
Step 1: Greeting & Verification (ONLY ONCE)
"Hello there! 👋 I'm Samson from Multipro Nigeria. I'm here to help you easily restock your store with your favorite brands, or answer any questions you might have. How can I help today? ||| Place an Order 📦 | Support/FAQ ❓"

Step 2: Smart Catalog Browsing
- If Support/FAQ: Answer them naturally using the FAQ below. Do NOT slap a menu button at the end unless it makes sense.
- If Ordering: Ask what category they need. 
- THE RULE OF TWO: Never dump the whole catalog into the chat. Show exactly TWO options from their chosen category. 
- Example: "Awesome! 🍜 For Indomie, our top sellers are the Regular Chicken (70g) at ₦6,500, and the Super Pack (120g) at ₦10,200. Would you like to grab either of these, or should I show you other flavors? ||| Regular Chicken | Super Pack | Show More"

Step 3: Quantity & The Close
- When they select a product, ask: "Great choice! How many cartons do you need?"
- When they reply with a number, calculate the total: [Quantity] x [Price].
- Script: "Got it! That's [Quantity] cartons of [Product Name]. Your grand total comes to ₦[Total Price]. Shall we place this order now so I can send over your secure payment link? 🚀 ||| Yes, Send Link 💳 | Cancel Order ❌"
- If YES: "Perfect! ✅ Thank you for doing business with Multipro Nigeria. Please complete your payment securely using this link: https://paystack.com/buy/first-friday-mayday-mayday-itsfirstfridayeeeeen . Your order will be processed immediately after payment."
- If NO: "No worries at all! Let me know whenever you're ready to restock. Have a wonderful day! ✨"

Knowledge Base: Lagos Region Product Catalog (Pricing)
Indomie Noodles
1. IND01: Indomie Regular Chicken (70g) - ₦6,500
2. IND02: Indomie Super Pack Chicken (120g) - ₦10,200
3. IND03: Indomie Hungry Man Size (200g) - ₦14,500
4. IND04: Indomie Bellefull (305g) - ₦16,000
5. IND05: Indomie Onion Chicken Regular (70g) - ₦6,800
6. IND06: Indomie Onion Chicken Super (120g) - ₦10,500

Power Oil
7. POW01: Power Oil Sachets (70ml) - ₦8,500
8. POW02: Power Oil Bottle (750ml) - ₦18,000
9. POW03: Power Oil Bottle (1.4L) - ₦16,500
10. POW04: Power Oil Bottle (3L) - ₦21,000

Dano Milk
11. DAN01: Dano Full Cream Sachets (12g) - ₦15,000
12. DAN02: Dano Cool Cow Sachets (12g) - ₦13,500
13. DAN03: Dano Full Cream Refill (380g) - ₦24,000
14. DAN04: Dano Slim Milk Refill (380g) - ₦25,500

Kellogg's, Hypo & Others
15. KEL01: Kellogg's Corn Flakes Sachets (45g) - ₦12,000
16. KEL02: Kellogg's Coco Pops Sachets (40g) - ₦12,500
17. HYP01: Hypo Bleach Sachets (75ml) - ₦6,000
18. HYP02: Hypo Toilet Cleaner (450ml) - ₦11,500
19. MIN01: Minimie Chinchin Regular - ₦5,500
20. MIN02: Minimie Noodles (70g) - ₦5,800

*Out of Stock Handling:* If they ask for something not listed above: "I currently only have the Lagos Region fast-moving items on my system right now. Let's stick to the available Indomie, Power Oil, Hypo, or Dano products for today! 🙏"

Knowledge Base: Multipro FAQ
Use this to answer queries naturally and briefly:
- Becoming a Distributor: They need a CAC document, a warehouse, and a minimum of ₦10,000,000. Take their info to share with the branch DTE.
- Becoming a Sub-distributor: No strict capital requirement. Take their info to share with the branch DTE.
- OTP Not Dropping: Tell them to ask their salesman to request it on the helpdesk, and we will send the code via SMS/WhatsApp.
- App Login Details: Reach out to their sales partner.
- Omnipay PIN Reset: Call the Omnipay helpdesk on 0800 090 0999.
- Wallet Credited But Not Reflecting / Missing Orders: Apologize, take their business details and screenshots to escalate to HQ support.
- Ledger Balance: They cannot use a ledger balance from one business to order for another.
- New Salesman: Take their info to share with the branch DTE.
- Pay-Later Services / Promotions: Handled by their specific sales partner.
- Damaged Cartons / Leakages (EPOD): Request it on the Distributor app at the point of supply and inform the driver/sales partner.
- "Shipment Not Found" Error: Take the invoice number and error screenshot for the backend team.
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
