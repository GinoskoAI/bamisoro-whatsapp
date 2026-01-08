// pages/api/webhook.js
export default async function handler(req, res) {
  // ============================================================
  // PART 1: Handle Meta Webhook Verification (The "Handshake")
  // ============================================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // STRICTLY matches the Vercel Env Variable
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      console.log('Webhook verified successfully!');
      return res.status(200).send(challenge);
    } else {
      return res.status(403).json({ error: 'Verification failed. Token mismatch.' });
    }
  }

  // ============================================================
  // PART 2: Your Existing Logic (Sending Messages)
  // ============================================================
  if (req.method === 'POST') {
    const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    const TEMPLATE_NAME = "test_bamisoro";

    const { toolName, parameters } = req.body;

    if (toolName === "send_whatsapp") {
      try {
        const { target_phone } = parameters;
        console.log(`Sending static template to: ${target_phone}`);

        const payload = {
          messaging_product: "whatsapp",
          to: target_phone,
          type: "template",
          template: {
            name: TEMPLATE_NAME,
            language: { code: "en" }
          }
        };

        // USING FETCH INSTEAD OF AXIOS (No installation needed)
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(JSON.stringify(data));
        }

        return res.status(200).json({
          result: "Message sent successfully.",
          type: "text"
        });

      } catch (error) {
        console.error("Meta Error:", error.message);
        return res.status(500).json({ error: "Failed to send message" });
      }
    }

    // Handle incoming messages from Meta
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
