import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const TEMPLATE_NAME = "test_bamisoro"; // Your static template

  const { toolName, parameters } = req.body;

  if (toolName === "send_whatsapp") {
    try {
      // We ONLY need the phone number now
      const { target_phone } = parameters;

      console.log(`Sending static template to: ${target_phone}`);

      // Payload for Static Template (No 'components' block needed)
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

  return res.status(404).json({ error: "Tool not found" });
}
