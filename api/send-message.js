// api/send-message.js
// VERSION: Two-Variable Support (1: Name, 2: Message)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. UNIVERSAL PARSER
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  const { phone, name, message } = payloadData;

  console.log(`👉 Attempting to send to ${name} at ${phone}`);

  if (!phone || !name || !message) {
    return res.status(400).json({ error: 'Missing phone, name, or message', received: payloadData });
  }

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    // ⚠️ CRITICAL: Ensure this matches the ID in your Meta Dashboard exactly.
    const TEMPLATE_NAME = "call_follow_up_v3"; 

    const metaPayload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: TEMPLATE_NAME, 
        language: { code: "en" }, // Forced to 'en' based on previous successful detection
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },    // This fills {{1}}
              { type: "text", text: message }  // This fills {{2}}
            ]
          }
        ]
      }
    };

    const metaResponse = await fetch(WHATSAPP_URL, { 
      method: 'POST', 
      headers: HEADERS, 
      body: JSON.stringify(metaPayload) 
    });

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("❌ Meta Rejected Request:", JSON.stringify(metaData));
      return res.status(500).json({ error: 'Meta Error', details: metaData });
    }

    console.log("✅ Message Sent Successfully!");

    // Log to Supabase for the Chatbot's Unified Memory
    const supabaseHeaders = {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST', 
      headers: supabaseHeaders,
      body: JSON.stringify({
        user_phone: phone,
        role: 'assistant',
        content: `[Voice Handoff to ${name}]: ${message}`
      })
    });

    return res.status(200).json({ status: 'Success' });

  } catch (error) {
    console.error("Critical System Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
