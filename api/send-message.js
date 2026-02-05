// api/send-message.js
// FIXED VERSION: 3-Variable Template Support

export default async function handler(req, res) {
  // 1. Allow only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 2. UNIVERSAL PARSER (Handles JSON or String body)
    let data = req.body;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { console.error("Parse error:", e); }
    }
    
    // Combine body and query params to be safe
    const payloadData = { ...data, ...req.query };

    // 3. EXTRACT VARIABLES (Log them to see what arrives)
    console.log("👉 Incoming Payload:", JSON.stringify(payloadData, null, 2));

    const { phone, name, message, summary, link } = payloadData;

    // 4. VALIDATION
    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    // 5. PREPARE DATA (Fallback logic to prevent crashes)
    // Accept either 'summary' OR 'message' from the tool
    const rawSummary = summary || message || "No summary provided.";
    const cleanSummary = String(rawSummary).replace(/[\r\n]+/g, ' ').trim().substring(0, 1000);
    
    const cleanName = name || "Valued Customer";
    const cleanLink = link || "https://www.alat.ng";
    const templateName = "call_follow_up_final"; // Ensure this matches your Meta Template Name exactly

    // 6. SEND TO META
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
        name: templateName,
        language: { code: "en_US" }, // Change to "en_GB" if your template is UK English
        components: [
          {
            type: "body",
            parameters: [
              // {{1}} Name
              { type: "text", text: cleanName },
              
              // {{2}} Summary
              { type: "text", text: cleanSummary },
              
              // {{3}} Link
              { type: "text", text: cleanLink }
            ]
          }
        ]
      }
    };

    console.log("📤 Sending to Meta:", JSON.stringify(metaPayload, null, 2));

    const response = await fetch(WHATSAPP_URL, { 
      method: 'POST', 
      headers: HEADERS, 
      body: JSON.stringify(metaPayload) 
    });

    const metaData = await response.json();

    if (!response.ok) {
      console.error("❌ Meta API Error:", JSON.stringify(metaData));
      return res.status(500).json({ error: 'Meta API Failed', details: metaData });
    }

    console.log("✅ Success:", metaData);
    return res.status(200).json({ status: 'Sent', id: metaData.messages?.[0]?.id });

  } catch (error) {
    console.error("🔥 CRITICAL SERVER ERROR:", error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
