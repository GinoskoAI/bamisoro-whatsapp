import axios from 'axios';

export default async function handler(req, res) {
  // ============================================================
  // PART 1: Handle Meta Webhook Verification (The "Handshake")
  // ============================================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Matches the "WEBHOOK_VERIFY_TOKEN" you set in Vercel
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
    const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN; // Make sure this matches your env var name
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    const TEMPLATE_NAME = "test_bamisoro"; 

    const { toolName, parameters } = req.body;

    // Check if this is your internal tool calling the API
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

        await axios.post(
          `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
          payload,
          {
            headers: {
              'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        return res.status(200).json({ 
          result: "Message sent successfully.", 
          type: "text" 
        });

      } catch (error) {
        console.error("Meta Error:", error.response?.data || error.message);
        return res.status(500).json({ error: "Failed to send message" });
      }
    }
    
    // Note: Eventually you will need code here to handle INCOMING messages from Meta
    // For now, we just return 200 to keep Meta happy if they send a notification
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
