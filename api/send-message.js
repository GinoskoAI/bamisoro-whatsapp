// api/send-message.js
// VERSION: Debug Mode (Returns exact Meta error)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing phone or message' });
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
        name: "bamisoro_voice_handoff", // <--- CHECK THIS IN META MANAGER
        language: { code: "en_US" },     // <--- CHECK THIS (Is it en_US, en_GB, or en?)
        components: [
          {
            type: "body",
            parameters: [
              { 
                type: "text", 
                text: message 
              } 
            ]
          }
        ]
      }
    };

    const metaResponse = await fetch(WHATSAPP_URL, { 
      method: 'POST', 
      headers: HEADERS, 
      body: JSON.stringify(payload) 
    });

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("Meta Error:", metaData);
      // RETURN THE ACTUAL ERROR TO ULTRAVOX SO YOU CAN SEE IT
      return res.status(500).json({ error: 'Meta Rejected Request', details: metaData });
    }

    // ... (Logging to Supabase logic remains here) ...
    // LOG TO SUPABASE
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
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
