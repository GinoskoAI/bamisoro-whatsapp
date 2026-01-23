// api/webhook.js
export default async function handler(req, res) {
  // ============================================================
  // CONFIGURATION: Define Bamisoro's Personality Here
  // ============================================================
  const SYSTEM_PROMPT = `
  You are Bamisoro, an advanced AI assistant for Nigerian businesses.
  
  Your Guidelines:
  1. Be helpful, professional, and concise (this is WhatsApp).
  2. If the user greets you, introduce yourself as Bamisoro.
  3. Use clear formatting (bullet points, bold text) for readability.
  4. Context: You are helpful with business automation, tech support, and general inquiries.
  5. Tone: Friendly but professional. You can use widely understood Nigerian English terms if appropriate, but keep it formal.
  `;

  // ============================================================
  // PART 1: Meta Webhook Verification (GET)
  // ============================================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // ============================================================
  // PART 2: Handle Messages (POST)
  // ============================================================
  if (req.method === 'POST') {
    const body = req.body;

    // Check if it's a valid message
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const senderPhone = message.from;
      const messageText = message.text ? message.text.body : "";

      console.log(`📩 Received from ${senderPhone}: ${messageText}`);

      if (messageText) {
        try {
          // A. ASK GEMINI (The "Brain")
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [{ text: messageText }]
              }],
              system_instruction: {
                parts: [{ text: SYSTEM_PROMPT }]
              }
            })
          });

          const geminiData = await geminiResponse.json();
          
          // Extract the AI's reply safely
          let aiReply = "I'm having trouble thinking right now. Please try again.";
          if (geminiData.candidates && geminiData.candidates[0].content) {
            aiReply = geminiData.candidates[0].content.parts[0].text;
          } else {
            console.error("Gemini Error:", JSON.stringify(geminiData));
          }

          // B. SEND REPLY TO WHATSAPP (The "Mouth")
          await fetch(
            `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: senderPhone,
                text: { body: aiReply }
              })
            }
          );
          
          console.log("✅ AI Reply sent!");

        } catch (error) {
          console.error("Error in AI Flow:", error);
        }
      }
    }

    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
