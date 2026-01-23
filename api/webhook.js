// api/webhook.js
export default async function handler(req, res) {
  // ============================================================
  // CONFIGURATION: System Prompt (JSON Mode)
  // ============================================================
  const SYSTEM_PROMPT = `
  You are Bamisoro, an AI assistant for Nigerian businesses.
  
  CRITICAL: You must ALWAYS reply in strict JSON format.
  
  Your goal is to choose the best way to reply to the user.
  
  1. FOR SIMPLE MESSAGES:
     Reply: { "type": "text", "body": "Your text here" }
     
  2. FOR CHOICES (Use this when asking the user to pick something):
     Reply: { "type": "button", "body": "Please make a selection:", "options": ["Option 1", "Option 2", "Option 3"] }

  3. FOR LISTS (Use this for 4+ options):
     Reply: { "type": "list", "body": "Select an item:", "button_text": "Menu", "sections": [{"title": "Items", "rows": [{"id": "1", "title": "Item A"}]}] }

  If the user sends AUDIO: Listen to it, understand the intent, and reply as if they typed it.
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

      // Prepare Gemini Payload
      let geminiParts = [];

      try {
        // --- HANDLE AUDIO ---
        if (msgType === "audio") {
          const mediaId = message.audio.id;
          const headers = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` };

          // A. Get the Media URL from Meta
          const urlRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers });
          const urlJson = await urlRes.json();
          const mediaUrl = urlJson.url;

          // B. Download the Binary Data
          const binaryRes = await fetch(mediaUrl, { headers });
          const arrayBuffer = await binaryRes.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString('base64');

          // C. Add to Gemini Payload (Multimodal)
          geminiParts.push({
            inline_data: {
              mime_type: "audio/ogg", 
              data: base64Audio
            }
          });
          geminiParts.push({ text: "The user sent this voice note. Reply to it directly." });
          
          console.log("🎤 Audio downloaded and attached.");
        } 
        
        // --- HANDLE TEXT ---
        else if (msgType === "text") {
          geminiParts.push({ text: message.text.body });
        } 
        
        // --- HANDLE INTERACTIVE (Buttons) ---
        else if (msgType === "interactive") {
          const selection = message.interactive.button_reply ? message.interactive.button_reply.title : message.interactive.list_reply.title;
          geminiParts.push({ text: `User selected button: ${selection}` });
        }

        // --- SEND TO GEMINI ---
        if (geminiParts.length > 0) {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: "user", parts: geminiParts }],
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: { responseMimeType: "application/json" }
            })
          });

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          aiRawText = aiRawText.replace(/```json|```/g, "").trim();

          console.log("🤖 AI Response:", aiRawText);
          const aiInstruction = JSON.parse(aiRawText);

          // --- EXECUTE WHATSAPP ACTIONS ---
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          };

          let payload = {};

          if (aiInstruction.type === "text") {
            payload = {
              messaging_product: "whatsapp",
              to: senderPhone,
              text: { body: aiInstruction.body }
            };
          } else if (aiInstruction.type === "button") {
            const buttons = aiInstruction.options.map((opt, i) => ({
              type: "reply",
              reply: { id: `btn_${i}`, title: opt.substring(0, 20) } // Max 20 chars
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
          } else if (aiInstruction.type === "list") {
             // Basic list support
             payload = {
              messaging_product: "whatsapp",
              to: senderPhone,
              type: "interactive",
              interactive: {
                type: "list",
                body: { text: aiInstruction.body },
                action: {
                  button: aiInstruction.button_text || "Menu",
                  sections: aiInstruction.sections
                }
              }
            };
          }

          if (payload.messaging_product) {
            await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });
          }
        }
      } catch (error) {
        console.error("Handler Error:", error);
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
