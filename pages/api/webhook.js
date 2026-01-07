import axios from 'axios';

export default async function handler(req, res) {
  // ============================================================
  // PART 1: Handle Meta Webhook Verification (The "Handshake")
  // ============================================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // STRICTLY matches the Vercel Env Variable: WEBHOOK_VERIFY_TOKEN
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
    // STRICTLY matches your Vercel Env Variables
    const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN; 
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    
    // Note: You listed WHATSAPP_BUSINESS_ACCOUNT_ID, but we don't strictly need it 
    // for sending simple messages yet. It is good to have for future features.
    
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
              'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
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
    
    // Handle incoming messages from Meta (Webhooks)
    // We respond 200 OK immediately so Meta doesn't keep retrying
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}