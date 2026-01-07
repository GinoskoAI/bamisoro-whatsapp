import axios from 'axios';

export default async function handler(req, res) {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. Load Credentials from Vercel Environment Variables
  const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  
  // UPDATE THIS to the exact name of the template that worked for you
  const TEMPLATE_NAME = "test_bamisoro"; 

  const { toolName, parameters } = req.body;

  if (toolName === "send_whatsapp") {
    try {
      // 3. Extract parameters from Ultravox
      const { customer_name, call_summary, target_phone } = parameters;

      console.log(`Sending WhatsApp to ${target_phone}`);

      // 4. Construct the Payload (Text Only - No Image)
      const payload = {
        messaging_product: "whatsapp",
        to: target_phone,
        type: "template",
        template: {
          name: TEMPLATE_NAME,
          language: { code: "en" },
          components: [
            {
              type: "header",
              parameters: [
                { type: "text", text: customer_name || "Valued Customer" }
              ]
            },
            {
              type: "body",
              parameters: [
                { type: "text", text: call_summary || "Here is your summary." }
              ]
            }
          ]
        }
      };

      // 5. Send to Meta
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
