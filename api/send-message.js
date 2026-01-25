// api/send-message.js
// VERSION: Debug Mode (Tells you exactly what is missing)

export default async function handler(req, res) {
  // 1. Parse Data safely
  let data = req.body;
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    if (typeof req.body === 'string') try { data = JSON.parse(req.body); } catch(e) {}
  }
  const payloadData = { ...data, ...req.query };
  let { phone, name, summary, link } = payloadData;

  // 2. CRITICAL DEBUG LOG
  // This will show up in your Vercel Logs. Look for this line!
  console.log("🔍 DIAGNOSTIC REPORT:");
  console.log(`- Phone Provided? [${phone ? "YES" : "NO"}] -> Value: ${phone}`);
  console.log(`- Name Provided?  [${name ? "YES" : "NO"}] -> Value: ${name}`);
  console.log(`- Summary Provided? [${summary ? "YES" : "NO"}] -> Value: ${summary}`);
  console.log(`- Link Provided?    [${link ? "YES" : "NO"}] -> Value: ${link}`);

  // 3. Fallbacks (To prevent crashing)
  if (!name) name = "Valued Customer"; // Fallback if AI forgets name
  if (!summary) summary = "Here are the details from our call."; // Fallback if AI forgets summary
  if (!link) link = "https://alat.ng"; // Fallback link

  // 4. Phone Fixer
  if (phone) {
    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '234' + phone.substring(1);
  }

  // 5. Final Gatekeeper
  if (!phone) {
    console.error("❌ FAILURE: Phone number is completely missing.");
    return res.status(400).json({ error: 'Phone is missing', debug: payloadData });
  }

  // 6. Send to Meta
  try {
    const TEMPLATE_NAME = "call_follow_up_final"; // Check this name!
    const cleanSummary = summary.replace(/[\r\n]+/g, ' ').trim();
    const cleanLink = link.replace(/[\r\n]+/g, '').trim();

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
              { type: "text", text: name },
              { type: "text", text: cleanSummary },
              { type: "text", text: cleanLink }
            ]
          }
        ]
      }
    };

    const response = await fetch(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`, { 
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, 
      body: JSON.stringify(metaPayload) 
    });

    const metaData = await response.json();

    if (!response.ok) {
      console.error("❌ Meta Error:", JSON.stringify(metaData));
      return res.status(500).json({ error: 'Meta Error', details: metaData });
    }

    return res.status(200).json({ status: 'Success' });

  } catch (error) {
    console.error("System Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
