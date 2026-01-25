// api/send-message.js
// VERSION: Split Variables (Fixes Newline Error #132018)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. UNIVERSAL PARSER
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  const { phone, name, summary, link } = payloadData;

  const TEMPLATE_NAME = "call_follow_up_final"; // ⚠️ Match this to your new template

  console.log(`👉 Sending Split Template to ${name} (${phone})`);

  if (!phone || !name || !summary) {
    return res.status(400).json({ error: 'Missing phone, name, or summary', received: payloadData });
  }

  // 2. SAFETY CLEANER (The Anti-Error Shield)
  // We remove newlines from variables because Meta forbids them.
  const cleanSummary = summary.replace(/[\r\n]+/g, ' ').trim();
  const cleanLink = link ? link.replace(/[\r\n]+/g, '').trim() : "https://ginosko.ai";

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

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
              { type: "text", text: name },          // {{1}}
              { type: "text", text: cleanSummary },  // {{2}}
              { type: "text", text: cleanLink }      // {{3}}
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
      console.error("❌ Meta Error:", JSON.stringify(metaData));
      return res.status(500).json({ error: 'Meta Error', details: metaData });
    }

    // 3. LOG TO SUPABASE
    // We combine them back together for the Chatbot's memory
    const fullContent = `Summary: ${cleanSummary}\nLink: ${cleanLink}`;
    
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST', 
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_phone: phone,
        role: 'assistant',
        content: `[Voice Handoff]: ${fullContent}`
      })
    });

    return res.status(200).json({ status: 'Success' });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
