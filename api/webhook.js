// api/webhook.js
export default async function handler(req, res) {
  // ============================================================
  // CONFIGURATION: The "Brain" Instructions (JSON Mode)
  // ============================================================
  const SYSTEM_PROMPT = `
  You are Bamisoro, an intelligent AI assistant for Nigerian businesses.
  
  CRITICAL: You must ALWAYS reply in strict JSON format. Do not add markdown.
  
  Your goal is to choose the best way to reply to the user.
  
  1. FOR SIMPLE MESSAGES:
     Reply: { "type": "text", "body": "Your text here" }
     
  2. FOR CHOICES (Use this when asking the user to pick something):
     Reply: { "type": "button", "body": "Please make a selection:", "options": ["Option 1", "Option 2", "Option 3"] }
     (Max 3 options. Keep titles under 20 chars).

  3. FOR LISTS (Use this for 4+ options):
     Reply: { "type": "list", "body": "Select an item:", "button_text": "Menu", "sections": [{"title": "Items", "rows": [{"id": "1", "title": "Item A"}]}] }

  Context: User is talking to Bamisoro AI. Be helpful, professional, and concise.
  `;

  // 1. Verify Webhook (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 2. Handle Messages (POST)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const senderPhone = message.from;
      const msgType = message.type;

      console.log(`📩 New Message Type: ${msgType}`);

      let userInput = "";

      // --- HANDLE INPUT TYPES ---
      if (msgType === "text") {
        userInput = message.text.body;
      } else if (msgType === "audio") {
        // Voice Note Logic (Placeholder for next step)
        userInput = "[USER SENT A VOICE NOTE - PLEASE ASK THEM TO TYPE FOR NOW]";
      } else if (msgType === "interactive") {
        // User clicked a button
        userInput = message.interactive.button_reply ? message.interactive.button_reply.title : message.interactive.list_reply.title;
      } else {
        userInput = "[Unsupported message type]";
      }

      if (userInput) {
        try {
          // --- ASK GEMINI (Request JSON) ---
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: userInput }] }],
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: { responseMimeType: "application/json" } // FORCE JSON
            })
          });

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          
          // Clean up formatting just in case
          aiRawText = aiRawText.replace(/```json|```/g, "").trim();
          
          console.log("🤖 AI Instructions:", aiRawText);

          const aiInstruction = JSON.parse(aiRawText);

          // --- EXECUTE WHATSAPP ACTIONS ---
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          };

          let payload = {};

          // A. SEND TEXT
          if (aiInstruction.type === "text") {
            payload = {
              messaging_product: "whatsapp",
              to: senderPhone,
              text: { body: aiInstruction.body }
            };
          } 
          
          // B. SEND BUTTONS (Dynamic!)
          else if (aiInstruction.type === "button") {
            const buttons = aiInstruction.options.map((opt, i) => ({
              type: "reply",
              reply: { id: `btn_${i}`, title: opt }
            }));

            payload = {
              messaging_product: "whatsapp",
              to: senderPhone,
              type: "interactive",
              interactive: {
                type: "button",
                body: { text: aiInstruction.body },
                action: { buttons: buttons }
              }
            };
          }

          // Send to Meta
          await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });

        } catch (error) {
          console.error("Handler Error:", error);
        }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
