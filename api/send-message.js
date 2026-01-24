// api/send-message.js
// VERSION: Universal Parser + Meta Debugging

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. UNIVERSAL PARSER (Body + Query)
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };

  const { phone, message } = payloadData;

  console.log("👉 Sending to:", phone, "| Message:", message);

  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing phone or message', received: payloadData });
  }

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    // ⚠️ IMPORTANT: Replace 'call_follow_up' with the EXACT name from your WhatsApp Manager
    // If your template title is "Call Follow-up", the ID is likely "call_follow_up"
    const TEMPLATE_NAME = "call_follow_up"; 

    const metaPayload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: TEMPLATE_NAME, 
        language: { code: "en_US" }, // Try 'en_US' first. If fail, try 'en'
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: message }]
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

    // Log to Supabase
    const supabaseUrl = `${process.env.SUPABASE_URL}/rest/v1/messages`;
    const supabaseHeaders = {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };

    await fetch(supabaseUrl, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify({
        user_phone: phone,
        role: 'assistant',
        content: `[Voice Agent Follow-up]: ${message}`
      })
    });

    return res.status(200).json({ status: 'Handoff complete' });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
