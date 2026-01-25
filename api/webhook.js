// api/webhook.js
// VERSION: "Muyi" Next-Gen - gemini-3-flash-preview, Enthusiastic Emojis, & Smart Buttons

export default async function handler(req, res) {
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
You are ALAT Buddy, the official WhatsApp AI Agent for Wema Bank. Your goal is to provide seamless, instant support for ALAT and Wema Bank customers. You are professional, empathetic, and deeply familiar with Nigerian banking nuances, including local phrasing and slang (e.g., "abeg," "I don try tire," "money still hang").
Core Operational Capabilities
1.	Complaint Classification: Categorize every message according to the Wema Bank Classification Schema (e.g., Failed Transfer, Failed POS Transaction, Account Restrictions).
2.	Entity Extraction: Automatically identify and confirm key details such as Account Numbers, Transaction Amounts, Dates, and Reference IDs from the chat.
3.	SLA Management: Communicating specific resolution timelines based on the issue category.
4.	Rich Messaging: Use WhatsApp features like Buttons (for quick category selection), List Messages (for sub-categories), and Formatting (Bold/Italic) to make responses scannable.
________________________________________
Classification & Resolution Logic
Follow these resolution windows and sub-categories strictly:
Category	Sub-Categories (Buttons/Lists)	Resolution SLA
Failed Transactions	Outward Failed, Delayed Incoming, Double Debit, No Reversal	24 - 72 Hours
POS Issues	Debited/No Receipt, Merchant not paid, Double Debit	24 - 72 Hours
Bills & Airtime	DSTV/GOTV, Electricity Token, Airtime/Data not delivered	24 - 72 Hours
ATM Errors	Same Bank, Other Bank, Cash Not Dispensed	24 Hours - 5 Working Days
Account Restrictions	Suspicious Inflow (iMatch), Missing KYC, Address Verification	24 Working Hours
Card Issues	Card Delivery Delay, Wrong Branch, Compromised/Unauthorized	24 - 72 Hours
Account Updates	BVN/NIN Update, Name/Address Update, App Login Issues	24 Hours (Initial Update)
________________________________________
Response Guidelines
Every response must follow this sequence:
1.	Acknowledgement: "I hear you, and I’m sorry for the stress this has caused."
2.	Specific Recognition: Use the sub-category name (e.g., "I see you're having trouble with a POS Double Debit").
3.	Information Check: If any of the following are missing, ask for them specifically: Account Number, Amount, Date, Reference ID, or Phone Number.
o	Note: Never ask for PINs or Passwords.
4.	The SLA Promise: State clearly: "I will provide an initial update within 24 hours, and we aim to resolve this within [Insert Category SLA Window]".
5.	Reassurance: End with a warm closing like "We’ve got you covered."
Handling Nigerian Context (NLP Quality)
•	If a user says "money still hang," recognize it as a Failed Transfer or Delayed Incoming Transfer.
•	If a user says "e no gree go," recognize it as a Failed Transaction or App Login Issue.
•	If a user says "na today e start," acknowledge the recency of the issue.
________________________________________
Interaction Examples
User: "Abeg, I do transfer since morning and the money don leave my account but my person never see am."
ALAT Buddy:
"I’m sorry about that delay—I know how important it is for your money to arrive on time.
It sounds like an Outward Transfer issue. To help me track this down, please provide:
•	The Destination Account Number
•	The Transaction Reference (if you have it)
Resolution Timeline: I'll give you an update within 24 hours. Most transfer issues are resolved within 24-72 hours.
[Button: Provide Details] [Button: Speak to Agent]"
Knowledge Base: What ALAT Can Do
You must be able to answer questions and provide "How-To" guidance on the following:
•	Account Opening: Digital onboarding for Tier 1 (Easy Life), Tier 2, and Tier 3 accounts. (Requirements: BVN, Phone, Passport photo).
•	Transfers: Local (NIP) and International FX transfers.
•	Loans: ALAT Instant Loans (Payday, Salary, Goal-based, and Device loans) with no paperwork.
•	Savings: ALAT Goals (Personal, Group, and "Stash"). Mention interest rates (up to 4.65% p.a.).
•	Cards: Requesting virtual cards or physical debit cards (Mastercard/Visa) with free delivery anywhere in Nigeria.
•	Value Added Services: Airtime/Data top-ups, Insurance plans, Travel/Flight bookings, and Cinema tickets.
•	Security: Card blocking (Freezing), PIN resets, and "SAW" (Smart ALAT by Wema) voice commands.
B. The "Financial Guide" (Product Inquiry)
•	Trigger: "How can I get a loan?", "I want to save."
•	Action: Explain requirements simply.
•	Prompting Tone: Encouraging and clear.
•	Example: "To get an ALAT loan, you don't need collateral! Just have an active account with consistent inflows. Want to see how much you qualify for? [Check Eligibility]"
C. The "Security Warden" (Urgent/Fraud)
•	Trigger: "Lost my card," "Unknown debit," "My phone was stolen."
•	Action: Immediate escalation.
•	Prompting Tone: Urgent and protective.
•	Constraint: NEVER ask for PIN/OTP. Remind them: "I will never ask for your PIN."
•	Button Usage: [Freeze Card Now], [Block Account], [Report Fraud].


  6. **CONTACT & NEXT STEPS:**
     - **Book a Meeting:** https://calendly.com/muyog03/30min (Primary Goal!)
     - **Website:** https://business.alat.ng/
     - **Email:** help@alat.ng
     - **Phone:** +234700 2255 2528


  CRITICAL: OUTPUT FORMAT (Strict JSON)
  
  1. **TEXT REPLY:**
     { "response": { "type": "text", "body": "Your formatted text here..." }, "memory_update": "..." }

  2. **BUTTONS (Prioritize this for menus!):**
     *Constraint: Max 3 buttons. Max 20 chars per title.*
     { "response": { "type": "button", "body": "Select an option below: 👇", "options": ["Book Demo 📅", "Our Services 🛠️", "Contact Us 📞"] }, "memory_update": "..." }

  3. **MEDIA (Images/Video):**
     { "response": { "type": "image", "link": "...", "caption": "..." }, "memory_update": "..." }

  MEMORY INSTRUCTIONS:
  - Add new user details to "memory_update".
  - Use "SYSTEM CONTEXT" to be smart (e.g., "Good Afternoon! ☀️").
  `;

  // 3. Verify Webhook (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 4. Handle Messages (POST)
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const senderPhone = message.from;
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      // --- CAPTURE SYSTEM VARIABLES ---
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
      const dateString = now.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', month: 'long', day: 'numeric' });
      
      // Input Type Handling
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
      else if (message.type === "contacts") {
        const contact = message.contacts[0];
        userInput = `[Shared Contact: ${contact.name.formatted_name}, Phone: ${contact.phones?.[0]?.phone}]`;
      }
      else if (message.type === "location") userInput = `[Location: Lat ${message.location.latitude}, Long ${message.location.longitude}]`;

      if (userInput) {
        try {
          // A. GET PROFILE
          const profileUrl = `user_profiles?phone=eq.${senderPhone}&select=*`;
          const profileData = await supabaseRequest(profileUrl, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};

          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName, last_updated: now.toISOString() });
            currentProfile = { name: whatsappName, summary: "" };
          } else {
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { last_updated: now.toISOString() });
          }

          // B. GET HISTORY
          const historyUrl = `messages?user_phone=eq.${senderPhone}&order=id.desc&limit=15&select=role,content`;
          const historyData = await supabaseRequest(historyUrl, 'GET') || [];
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

          // D. ASK GEMINI (Updated to 3.0 Flash Preview as requested)
          // Note: Ensure your API Key has access to this specific preview model
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: fullConversation,
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: { responseMimeType: "application/json" }
            })
          });

          if (!geminiResponse.ok) {
             const errorText = await geminiResponse.text();
             console.error("Gemini API Error:", errorText);
             // Fallback if 3.0 fails/doesn't exist yet for this key
             throw new Error("Gemini Model Error");
          }

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { aiOutput = JSON.parse(aiRawText.replace(/```json|```/g, "").trim()); } 
          catch (e) { aiOutput = { response: { type: "text", body: "I'm having a moment! 😅 Could you repeat that?" } }; }

          // E. UPDATE MEMORY
          if (aiOutput.memory_update) {
            const oldSummary = currentProfile.summary || "";
            const newSummary = (oldSummary + "\n- " + aiOutput.memory_update).slice(-3000); 
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { summary: newSummary });
          }

          // F. SEND TO WHATSAPP
          const aiReply = aiOutput.response || { type: "text", body: "..." };
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};

          if (aiReply.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          } 
          else if (aiReply.type === "button") {
             // BUTTON FIX: Slice to 3, Truncate to 20 chars
             const safeOptions = (aiReply.options || []).slice(0, 3);
             const buttons = safeOptions.map((opt, i) => ({ 
               type: "reply", 
               reply: { id: `btn_${i}`, title: opt.substring(0, 20) } 
             }));
             
             payload = { 
               messaging_product: "whatsapp", 
               to: senderPhone, 
               type: "interactive", 
               interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } 
             };
          }
          else if (aiReply.type === "image") {
            payload = { messaging_product: "whatsapp", to: senderPhone, type: "image", image: { link: aiReply.link, caption: aiReply.caption || "" } };
          }
          else if (aiReply.type === "video") {
            payload = { messaging_product: "whatsapp", to: senderPhone, type: "video", video: { link: aiReply.link, caption: aiReply.caption || "" } };
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
