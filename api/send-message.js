// api/send-message.js
// VERSION: Unified - Correct Template ID + Smart Language Retry

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. UNIVERSAL PARSER
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  const { phone, name, message } = payloadData;

  // ⚠️ CRITICAL: Name of the template in your Meta Dashboard
  const TEMPLATE_NAME = "call_follow_up_utility"; 

  console.log(`👉 Sending ${TEMPLATE_NAME} to ${name} (${phone})`);

  if (!phone || !name || !message) {
    return res.status(400).json({ error: 'Missing phone, name, or message', received: payloadData });
  }

  const LANGUAGES_TO_TRY = ["en", "en_US", "en_GB"];
  let lastError = null;

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    // 2. SMART RETRY LOOP (Finds the right language version)
    for (const langCode of LANGUAGES_TO_TRY) {
      console.log(`🔄 Attempting ${langCode}...`);

      const metaPayload = {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: TEMPLATE_NAME, 
          language: { code: langCode }, 
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: name },    // Variable {{1}}
                { type: "text", text: message }  // Variable {{2}}
              ]
            }
          ]
        }
      };

      const response = await fetch(WHATSAPP_URL, { 
        method: 'POST', 
        headers: HEADERS, 
        body: JSON.stringify(metaPayload) 
      });

      const metaData = await response.json();

      if (response.ok) {
        console.log(`✅ SUCCESS: Sent via ${langCode}`);
        
        // 3. LOG TO SUPABASE (Unified Memory)
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
            content: `[Voice Follow-up to ${name}]: ${message}`
          })
        });

        return res.status(200).json({ status: 'Success', language: langCode });
      }

      lastError = metaData;
      // If the error isn't about the name missing, the issue is likely the parameters.
      if (metaData.error && !metaData.error.message.includes("does not exist")) {
        console.error("❌ Template exists but parameters are wrong:", JSON.stringify(metaData));
        break; 
      }
    }

    return res.status(500).json({ error: 'Failed all attempts', details: lastError });

  } catch (error) {
    console.error("Critical System Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
