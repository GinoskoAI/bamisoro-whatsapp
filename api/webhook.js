// api/webhook.js
export default async function handler(req, res) {
  // 1. Meta Webhook Verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 2. Handle Incoming Messages (POST)
  if (req.method === 'POST') {
    const body = req.body;

    // Check if it's a valid message
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const senderPhone = message.from; // The user's phone number
      const messageText = message.text ? message.text.body : "";

      console.log(`📩 Received from ${senderPhone}: ${messageText}`);

      // ONLY reply if there is text (avoid infinite loops with status updates)
      if (messageText) {
        try {
          // Send a reply back to WhatsApp
          const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
          const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

          const response = await fetch(
            `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: senderPhone,
                text: { body: `Bamisoro heard you say: "${messageText}"` }
              })
            }
          );
          
          if (!response.ok) {
            const errData = await response.json();
            console.error("Meta API Error:", errData);
          } else {
            console.log("✅ Reply sent successfully!");
          }

        } catch (error) {
          console.error("Fetch Error:", error);
        }
      }
    }

    // Always return 200 OK to Meta immediately
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
