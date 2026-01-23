// api/webhook.js
import { createClient } from '@supabase/supabase-js';

// Initialize the Database Connection
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  // ============================================================
  // CONFIGURATION: System Prompt
  // ============================================================
  const SYSTEM_PROMPT = `
  You are Bamisoro, a smart AI assistant for Nigerian businesses.
  
  CRITICAL: You must ALWAYS reply in strict JSON format.
  
  1. FOR TEXT REPLIES:
     Reply: { "type": "text", "body": "Your answer here" }
     
  2. FOR BUTTON CHOICES:
     Reply: { "type": "button", "body": "Choose:", "options": ["A", "B"] }

  Context: You have access to the user's past conversation history. Use it to be personal and helpful.
  `;

  // 1. Verify Webhook (GET)
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 2. Handle Messages (POST)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const senderPhone = message.from;
      
      // Get User Input
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "audio") userInput = "[User sent a voice note]"; 
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;

      if (userInput) {
        try {
          // --- STEP A: RETRIEVE MEMORY FROM SUPABASE ---
          // Fetch last 10 messages for this phone number
          const { data: historyData, error } = await supabase
            .from('messages')
            .select('role, content')
            .eq('user_phone', senderPhone)
            .order('id', { ascending: false })
            .limit(10);

          // Format history for Gemini (Oldest first)
          // Map 'assistant' role to 'model' for Gemini API
          const chatHistory = (historyData || []).reverse().map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          // Add the NEW message to the conversation
          const currentTurn = { role: "user", parts: [{ text: userInput }] };
          const fullConversation = [...chatHistory, currentTurn];

          // --- STEP B: ASK GEMINI (With History) ---
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: fullConversation, // Send the whole history!
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              generationConfig: { responseMimeType: "application/json" }
            })
          });

          const geminiData = await geminiResponse.json();
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          aiRawText = aiRawText.replace(/```json|```/g, "").trim();
          const aiInstruction = JSON.parse(aiRawText);

          // --- STEP C: SAVE TO DATABASE (Write Memory) ---
          // 1. Save User Message
          await supabase.from('messages').insert({ user_phone: senderPhone, role: 'user', content: userInput });
          
          // 2. Save AI Reply (The body text)
          if (aiInstruction.body) {
             await supabase.from('messages').insert({ user_phone: senderPhone, role: 'assistant', content: aiInstruction.body });
          }

          // --- STEP D: SEND TO WHATSAPP ---
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          let payload = {};

          if (aiInstruction.type === "text") {
            payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiInstruction.body } };
          } else if (aiInstruction.type === "button") {
             const buttons = aiInstruction.options.map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: aiInstruction.body }, action: { buttons: buttons } } };
          }

          if (payload.messaging_product) await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });

        } catch (error) { console.error("Agent Error:", error); }
      }
    }
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
