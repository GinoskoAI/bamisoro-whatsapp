// api/send-message.js
// VERSION: Hardened Body Parsing + Template Support

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // DEFENSIVE PARSING
  let body = req.body;
  try {
    if (!body) return res.status(400).json({ error: 'Request body is empty' });
    if (typeof body === 'string') body = JSON.parse(body);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON', details: e.message });
  }

  const { phone, message } = body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing phone or message', received: body });
  }

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: "bamisoro_voice_handoff", // Ensure this matches Meta exactly
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: message }]
          }
        ]
      }
    };

    const metaResponse = await fetch(WHATSAPP_URL, { 
      method: 'POST', headers: HEADERS, body: JSON.stringify(payload) 
    });

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("Meta Error:", metaData);
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
