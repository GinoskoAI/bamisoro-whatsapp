// api/queue/nudge.mjs
// Execution path triggered by QStash

import { supabaseRequest } from '../webhook.mjs';

const NUDGE_PROMPT = `
Role: Samson from Multipro Nigeria.
Context: You are completing a scheduled follow-up. 
The boolean 'was_explicit' tells you if the user explicitly asked you to remind them.

STRICT INSTRUCTIONS:
1. WAS EXPLICIT IS TRUE (User-requested):
   - Friendly ping. Say: "Hey there! I'm popping back in as you requested to remind you about completing your order. Let's finish up! 🛒"
2. WAS EXPLICIT IS FALSE (Implicit silent check-in):
   - Say: "Hey! Just checking in to see if we're still restocking today. Let me know what you need! 😊"

Output JSON format:
{
  "should_nudge": true,
  "nudge_body": "Your follow-up message..."
}
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { senderPhone, isExplicit } = req.body;
  if (!senderPhone) return res.status(400).json({ error: 'Missing phone number' });

  try {
    // 1. Skip if user has texted back within the interval
    const historyData = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=1&select=role`, 'GET') || [];
    if (historyData.length > 0 && historyData[0].role === 'user') {
      return res.status(200).json({ status: "skipped_user_replied_already" });
    }

    // 2. Fetch tone preference
    const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=tone_pref`, 'GET') || [];
    const tone = (profileData.length > 0 && profileData[0].tone_pref) ? profileData[0].tone_pref : 'casual';

    // 3. Build history payload
    const fullHistory = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=8&select=role,content`, 'GET') || [];
    const chatHistory = fullHistory.reverse().map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // 4. Generate reminder with Gemini adapting to user's tone_pref
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const payload = {
      contents: [...chatHistory, { role: "user", parts: [{ text: `Generate reminder message. was_explicit: ${isExplicit}` }] }],
      system_instruction: { 
        parts: [{ 
          text: `
            ${NUDGE_PROMPT}
            Adopt the customer's preferred tone: **${tone.toUpperCase()}**.
          ` 
        }] 
      },
      generationConfig: { responseMimeType: "application/json" }
    };

    const response = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    const aiOutput = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "{}");

    if (aiOutput.should_nudge && aiOutput.nudge_body) {
      const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
      
      await fetch(WHATSAPP_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: senderPhone,
          text: { body: aiOutput.nudge_body }
        })
      });

      await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: aiOutput.nudge_body });
    }

    return res.status(200).json({ status: "processed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
