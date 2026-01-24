// api/send-message.js
// VERSION: Smart Retry (Auto-detects Language: en_US, en, or en_GB)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1. UNIVERSAL PARSER
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  const { phone, message } = payloadData;

  console.log(`👉 Smart Retry sending to: ${phone}`);

  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing phone or message', received: payloadData });
  }

  // ⚠️ CRITICAL: PUT YOUR EXACT TEMPLATE NAME HERE
  // Check WhatsApp Manager. Is it "call_follow_up"? Or "bamisoro_voice_handoff"?
  const TEMPLATE_NAME = "call_follow_up"; 

  const LANGUAGES_TO_TRY = ["en_US", "en", "en_GB"];
  let lastError = null;

  try {
    const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const HEADERS = { 
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 
      'Content-Type': 'application/json' 
    };

    // LOOP THROUGH LANGUAGES
    for (const langCode of LANGUAGES_TO_TRY) {
      console.log(`🔄 Trying language: ${langCode}...`);

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
              parameters: [{ type: "text", text: message }]
            }
          ]
        }
      };

      const response = await fetch(WHATSAPP_URL, { 
        method: 'POST', headers: HEADERS, body: JSON.stringify(metaPayload) 
      });

      const metaData = await response.json();

      if (response.ok) {
        console.log(`✅ SUCCESS! Template found in language: ${langCode}`);
        
        // Log to Supabase and exit
        const supabaseUrl = `${process.env.SUPABASE_URL}/rest/v1/messages`;
        const supabaseHeaders = {
          'apikey': process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        };

        await fetch(supabaseUrl, {
          method: 'POST', headers: supabaseHeaders,
          body: JSON.stringify({
            user_phone: phone,
            role: 'assistant',
            content: `[Voice Agent Follow-up]: ${message}`
          })
        });

        return res.status(200).json({ status: 'Sent', language: langCode });
      }

      // If error is "Template does not exist", continue loop.
      // If error is anything else (like #100 Invalid Parameter), STOP loop (because template exists, but data is wrong).
      lastError = metaData;
      const errorMsg = metaData.error?.message || "";
      if (!errorMsg.includes("does not exist")) {
        console.error("❌ Template exists but data is invalid:", JSON.stringify(metaData));
        break; // Stop trying other languages, the issue is the parameters.
      }
    }

    // If we get here, all languages failed
    console.error("❌ All languages failed. Last error:", JSON.stringify(lastError));
    return res.status(500).json({ error: 'Failed to send template', details: lastError });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
