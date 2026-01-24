// api/send-message.js
// VERSION: Compliance-Ready (Uses Templates for guaranteed delivery)

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

    // --- LOGIC SWITCH: TEMPLATE VS FREE-FORM ---
    // Since we don't know if the window is open, we play it safe and ALWAYS use the template.
    // Ensure you created a template named "voice_follow_up" with one variable {{1}}
    
    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: "voice_follow_up", // <--- MUST MATCH YOUR META TEMPLATE NAME
        language: { code: "en_US" }, // or "en_GB" depending on what you chose
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: message } // This inserts your message into {{1}}
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
      return res.status(500).json({ error: 'Failed to send WhatsApp Template' });
    }

    // 2. Log to Supabase (So the Chatbot remembers this context!)
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
        content: `[Voice Agent Sent Template]: ${message}`
      })
    });

    return res.status(200).json({ status: 'Template sent & logged' });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
