// api/send-message.js
// VERSION: "Hello World" Test (To verify connection)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // Universal Parser
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  const { phone, message } = payloadData;

  console.log("👉 Testing Hello World to:", phone);

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    // --- TEST PAYLOAD: HELLO WORLD ---
    // This template ALWAYS exists. It requires no parameters.
    const metaPayload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: "hello_world", 
        language: { code: "en_US" } // hello_world is almost always en_US
      }
    };

    const metaResponse = await fetch(WHATSAPP_URL, { 
      method: 'POST', headers: HEADERS, body: JSON.stringify(metaPayload) 
    });

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("❌ Hello World Failed:", JSON.stringify(metaData));
      return res.status(500).json({ error: 'Meta Rejected Hello World', details: metaData });
    }

    console.log("✅ Hello World Sent! Connection is Good.");

    // Log to Supabase (just so we know it worked)
    const supabaseUrl = `${process.env.SUPABASE_URL}/rest/v1/messages`;
    const supabaseHeaders = {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };
    await fetch(supabaseUrl, {
      method: 'POST', headers: supabaseHeaders,
      body: JSON.stringify({ user_phone: phone, role: 'assistant', content: `[System Test]: Hello World Sent` })
    });

    return res.status(200).json({ status: 'Hello World Sent' });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
