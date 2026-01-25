// api/send-message.js
// VERSION: Multi-Variable Support (Name + Summary)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. UNIVERSAL PARSER
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  const { phone, name, message } = payloadData;

  console.log(`👉 Sending Personalized Follow-up to: ${name} (${phone})`);

  if (!phone || !message || !name) {
    return res.status(400).json({ error: 'Missing phone, name, or message', received: payloadData });
  }

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    const TEMPLATE_NAME = "call_follow_up_v3"; // Ensure this matches Meta exactly

    const metaPayload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: TEMPLATE_NAME, 
        language: { code: "en" }, 
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },    // This maps to {{1}} (Customer Name)
              { type: "text", text: message } // This maps to {{2}} (Summary/Link)
            ]
          }
        ]
      }
    };

    const metaResponse = await fetch(WHATSAPP_URL, { 
      method: 'POST', headers: HEADERS, body: JSON.stringify(metaPayload) 
    });

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("❌ Meta Error:", JSON.stringify(metaData));
      return res.status(500).json({ error: 'Meta Rejected Request', details: metaData });
    }

    // --- LOG TO SUPABASE ---
    const supabaseUrl = `${process.env.SUPABASE_URL}/rest/v1/messages`;
    const supabaseHeaders = {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    await fetch(supabaseUrl, {
      method: 'POST', headers: supabaseHeaders,
      body: JSON.stringify({
        user_phone: phone,
        role: 'assistant',
        content: `[Voice Follow-up Sent to ${name}]: ${message}`
      })
    });

    return res.status(200).json({ status: 'Personalized message sent' });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
