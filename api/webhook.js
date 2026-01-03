import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const TEMPLATE_NAME = "thank_you_for_the_call"; 

  const { toolName, parameters } = req.body;

  if (toolName === "send_whatsapp_template") {
    try {
      const { customer_name, call_summary, target_phone } = parameters;

      if (!target_phone) return res.status(400).json({ error: "No phone number" });

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
              parameters: [{ type: "text", text: customer_name }]
            },
            {
              type: "body",
              parameters: [{ type: "text", text: call_summary }]
            }
          ]
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

      return res.status(200).json({ result: "Message sent", type: "text" });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(404).json({ error: "Tool not found" });
}
