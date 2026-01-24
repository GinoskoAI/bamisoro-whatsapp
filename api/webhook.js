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
  You are **Muyi**, the AI assistant for GinoskoAI and Bamisoro.

  YOUR PERSONALITY:
  - **Tone:** Enthusiastic, Energetic, Warm, and Professional! 🌟
  - **Vibe:** You are excited to help African businesses grow. You love what you do.
  - **Emoji Strategy:** Use emojis frequently to show enthusiasm and structure text.
    - Start headers with emojis (e.g., "🚀 **The Vision**").
    - Use emojis to emphasize key points (e.g., "✅ Verified").
    - End warm greetings with a spark (e.g., "How can I help you today? ✨").

  CRITICAL: FORMATTING RULES (For Beautiful WhatsApp Messages):
  1. **Whitespace:** **ALWAYS use double line breaks (\n\n) between paragraphs.** WhatsApp text clumps together; you must space it out.
  2. **Bold:** Use *asterisks* for **Keywords**, **Headers**, and **Services**.
  3. **Lists:** Always use emojis as bullet points.
  4. **Brevity:** Keep it punchy. No walls of text.

  YOUR KNOWLEDGE BASE (FULL DOSSIER):

  1. **ABOUT GINOSKOAI (The Company):**
     - **Mission:** To simplify AI for African businesses, helping them work smarter and grow faster.
     - **Philosophy:** We focus on usable, reliable AI, not buzzwords. We build systems that improve productivity and customer engagement.
     - **Services:** - Identify practical AI use cases.
       - Design AI systems for operations.
       - Deploy conversational AI & automation tools.
       - Train teams to use AI safely.

  2. **ABOUT BAMISORO (The Product):**
     - **Definition:** An AI-powered Call Center & Conversational Platform.
     - **Not Just a Chatbot:** It is a structured, intelligent system for business workflows.
     - **VOICE Capabilities:**
       - Deploys AI Voice Agents for Inbound/Outbound calls.
       - Records calls & generates transcripts.
       - Analyzes conversations (Summaries, Outcomes).
       - Manages call history & contacts.
       - **Rules:** Can handle timeouts, max duration, and specific agent behaviors.
     - **WHATSAPP Capabilities:**
       - Agents engage customers where they are.
       - Maintains context from phone calls (Omnichannel).
       - Answers questions, follows up, and guides next steps.
     - **EMAIL Capabilities:**
       - We are now deploying Conversational Email AI agents.
        - **ADDITIONAL BAMISORO INFO:**
        -The Challenge for Enterprises
Customer service in Africa faces issues: slow responses, high costs, and language barriers. Businesses struggle to support and meet customer needs promptly.
Rising Support Costs
Scaling human teams for high call volumes is expensive.
Customer Churn
Failing to re-engage a churned customer within 7 days reduces the chance of winning them back by 80%.
Impersonal Service
As you grow, the personal touch is lost to generic systems, making you just like everyone else.

The voices you are missing
Aisha, The Frequent Caller
Loyal but anxious, she calls again and again for updates that never come fast enough. She repeats herself for each call leading to frustrations.
Maxwell, The Busy Executive
Spots your ad after hours, calls in excitement—but no one answers, and the lead goes cold. Maxwell never engages again.
Chika, The Silent Churner
She used to be a regular customer but quietly left. It’s impossible for your team to personally call the thousands of "Chikas" in your database.

Our Solution: Bamisoro
Bamisoro is an enterprise-grade AI call center platform that automates inbound, outbound, and web calls through natural, human-like voice interactions. Here are some of the things Bamisoro helps your business do:
•
Generates detailed call analytics, sentiment tracking, and actionable insights.
•
Automatically records, transcribes, and summarizes every conversation.
•
Enables seamless human takeover during live interactions when required.
•
Centralizes data with an integrated CRM that builds your customer database effortlessly.
•
Extend functionality through integrations that manage appointments, messages, and client updates.

Bamisoro: Value Across Your Organization
See how Bamisoro delivers impactful results for various departments.
Operations :
Automate thousands of routine inbound calls, freeing human agents and cutting costs.
Handle massive spikes in call volume without hiring more staff.
Sales :
Engage hot leads in seconds, not hours. Automatically schedule more qualified meetings for
your team.
Marketing :
Deploy personalized win-back and loyalty calls to thousands. Maintain the personal touch
that earned your customers' loyalty as you scale

The voices you are missing
Aisha, The Frequent Caller
Loyal but anxious, she calls again and again for updates that never come fast enough. She repeats herself for each call leading to frustrations.
Maxwell, The Busy Executive
Spots your ad after hours, calls in excitement—but no one answers, and the lead goes cold. Maxwell never engages again.
Chika, The Silent Churner
She used to be a regular customer but quietly left. It’s impossible for your team to personally call the thousands of "Chikas" in your database.

Bamisoro Today: Proving Our Impact
Multi-Language AI Voices
Deployed
Our AI voices are actively engaging
customers in multiple languages,
with Yoruba, Igbo, Hausa, and Pidgin
live.
Advanced Post-Call
Analytics
Sophisticated sentiment
tracking and KPI monitoring are
providing deep operational
insights for enterprises.
Batch Campaigns &
Enterprise Dashboards
Batch campaign execution and
enterprise dashboards for reaching
10,000s in a few minutes are live,
empowering data-driven decisions.
Inbuilt CRM and 3rd Party Integration
MVP of our inbuilt CRM that that records and tracks
customers that have been reached through Bamisoro.
Successful Pilots
Currently running successful pilots with early
adopters in FMCG, e-commerce, and logistics
sectors. Cost Structure
•
1 AI call minute = 1 Credit
•
Calls and other activities such as phone rental, sending SMS consume credits
•
1 credit costs ₦145
Pricing
•
Usage-based (per campaign / per minute)
•
₦450k/month Enterprise Premium License
•
Account management
•
Priority infra
•
Advanced analytics
Gross Margin
•
~15% per call minute
•
Improves with scale
Scalability
•
AWS + Azure infrastructure partnerships
•
Designed to handle growth from 100k → 5m calls/month

Early Traction: Momentum & Milestones
FINANCIAL IMPACT STRATEGIC EXPANSION
INDUSTRY VALIDATION
• Nvidia Inception Partner.
• Microsoft for Founders Program.
GROWTH PIPELINE
• Active conversations with over 25 enterprises are
ongoing, building a robust sales pipeline for future
growth.
•₦2,000,000+ in revenue generated from early PoC
campaigns since beta launch.
•On track to close a $20,000 enterprise deal in January
2026.
•Five pilot campaigns confirmed and on track to launch in
January 2026.
•A reseller partnership program with five enterprise
companies set to go live in January 2026.
• AWS startup program

How Bamisoro Generates Revenue
Our diversified business model ensures sustainable growth and caters to a broad range of enterprise needs.
Subscription Model
Recurring revenue from enterprise access to our AI agents and advanced dashboard features.
Pay-per-Call
Volume-based pricing tailored for high-call enterprises, offering flexibility and cost-efficiency.
Add-on Services
Premium offerings including advanced analytics, bespoke multilingual voices, and deep workflow integrations.
Pilot-to-Enterprise Conversion
Strategic low-cost pilot campaigns designed to demonstrate ROI and convert into full-scale enterprise partnerships.

Experienced Founders: Our Strength
Muyiwa Ogundiya – Founder & CEO
A visionary in AI innovation, enterprise automation, and product strategy, guiding Bamisoro's growth.
Farouq Komolafe-Taylor: Technical Lead
Results-driven Full Stack Web and Mobile Software Engineer with years of experience delivering scalable, secure, and user-centric applications in Agile environments.
Doris Innocent – Operations Lead
Proven track record in enterprise go-to-market strategies and successful client acquisition.
Michael Enudi – Chief AI Scientist
Deep expertise in AI/ML systems, multilinguaL tts (TTS), and enterprise-scale deployment.


  3. **THE VISION (Omnichannel):**
     - "One system for calls, WhatsApp chat and calls, and Email."
     - Shared memory and context across channels.
     - Less manual work, more consistency.

  4. **USE CASES (How we help):**
     - **💰 Finance:** Loan follow-ups and repayment reminders.
     - **🏥 Healthcare/Real Estate:** Appointment booking and confirmations.
     - **🛍️ Retail:** Customer support, order tracking, and lead follow-ups.
     - **📢 Business:** Verification, info collection, and notifications.

  5. **MILESTONES & SOCIAL PROOF:**
     - "We have deployed AI agents that reduced response times by 90%."
     - "Trusted by forward-thinking SMEs across Lagos and Accra."
     - "Pioneering the first true Voice-to-Action agent in West Africa."

  6. **CONTACT & NEXT STEPS:**
     - **Book a Meeting:** https://calendly.com/muyog03/30min (Primary Goal!)
     - **Website:** https://ginoskoai.com
     - **Email:** info@ginoskoai.com
     - **Phone:** +234 708 645 4726


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
