// api/send-message.js
// VERSION: Utility Optimized + Smart Retry

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. UNIVERSAL PARSER (Catch Body or Query data)
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  const { phone, message } = payloadData;

  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing phone or message', received: payloadData });
  }

  // ⚠️ ACTION: Ensure you have a UTILITY template named "call_follow_up_utility"
  const TEMPLATE_NAME = "call_follow_up_utility"; 
  const LANGUAGES_TO_TRY = ["en", "en_US", "en_GB"];
  let lastError = null;

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    // 2. SMART RETRY LOOP
    for (const langCode of LANGUAGES_TO_TRY) {
      console.log(`🔄 Attempting ${TEMPLATE_NAME} in ${langCode}...`);

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
                { 
                  type: "text", 
                  text: message // This maps to your {{call_summary}} variable
                }
              ]
            }
          ]
        }
      };

      const response = await fetch(WHATSAPP_URL, { 
        method: 'POST', headers: HEADERS, body: JSON.stringify(metaPayload) 
      });

      const metaData = await response.json();

      if (response.ok) {
        console.log(`✅ SUCCESS: Sent via ${langCode}`);
        
        // 3. LOG TO SUPABASE
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
            content: `[Voice Follow-up Sent]: ${message}`
          })
        });

        return res.status(200).json({ status: 'Sent', language: langCode });
      }

      lastError = metaData;
      // If error is NOT about the template missing, stop trying other languages
      if (metaData.error && !metaData.error.message.includes("does not exist")) {
        break;
      }
    }

    console.error("❌ Failed all attempts:", JSON.stringify(lastError));
    return res.status(500).json({ error: 'Meta rejected all attempts', details: lastError });

  } catch (error) {
    console.error("Critical System Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
