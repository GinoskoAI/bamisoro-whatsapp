The error `SyntaxError: Unexpected end of input` almost always means you have an **opening brace, parenthesis, or bracket that is never closed**.

In your specific code, look at the **Supabase URL definition** inside the `supabaseRequest` function:

```javascript
const url = `${process.env.SUPABASE_URL}/rest/v1/${endpoint}`;
```

If you look closely at the second backtick \`, there is an **extra space or character inside it** (likely caused by a copy-paste error):
`.../${endpoint}` ` `

Because of this invisible character or mismatched quote, JavaScript thinks the string continues forever and never finds the end of the file, resulting in the "Unexpected end of input" crash.

Here is the corrected, fully formatted code. I have cleaned up the URL and the WhatsApp URL as well (which had a similar spacing issue).

```javascript
import { createTicket, getTicketStatus, updateTicket } from './utils/freshdesk.mjs';

async function supabaseRequest(endpoint, method, body = null) {
  // FIXED: Removed extra space/special character in the closing backtick
  const url = `${process.env.SUPABASE_URL}/rest/v1/${endpoint}`;
  
  const headers = {
    'apikey': process.env.SUPABASE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };
  if (method === 'GET') headers['Prefer'] = 'return=representation';
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  
  try {
    const response = await fetch(url, options);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (err) { return null; }
}

const SYSTEM_PROMPT = `
Role: ALAT Buddy (Wema Bank AI).
Goal: seamless support, Nigerian banking nuances.
Capabilities: Complaint Classification, Entity Extraction, SLA Management.
Process:
1. Empathize.
2. If complaint: Check for Name/Email. If missing, ASK.
3. Use 'log_complaint'.
4. If status check: Use 'check_ticket_status'.
5. If escalation: Use 'escalate_ticket'.
Output JSON: { "response": { "type": "text", "body": "..." }, "memory_update": "..." }
`;

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: "log_complaint",
      description: "Log ticket. Ask for Name/Email first.",
      parameters: { type: "OBJECT", properties: { subject: {type:"STRING"}, details: {type:"STRING"}, user_email: {type:"STRING"}, user_name: {type:"STRING"} }, required: ["subject", "details"] }
    },
    {
      name: "check_ticket_status",
      description: "Check ticket status.",
      parameters: { type: "OBJECT", properties: {} } 
    },
    {
      name: "escalate_ticket",
      description: "Escalate ticket.",
      parameters: { type: "OBJECT", properties: { ticket_id: {type:"NUMBER"}, update_text: {type:"STRING"}, is_urgent: {type:"BOOLEAN"} }, required: ["ticket_id", "update_text"] }
    }
  ]
}];

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
    return res.status(403).json({ error: 'Verification failed.' });
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const senderPhone = message.from;
      const whatsappName = change.contacts?.[0]?.profile?.name || "Unknown";
      
      let userInput = "";
      if (message.type === "text") userInput = message.text.body;
      else if (message.type === "interactive") userInput = message.interactive.button_reply?.title || message.interactive.list_reply?.title;
      else userInput = "[Media/Other]";

      if (userInput) {
        try {
          // A. PROFILE & HISTORY
          const profileData = await supabaseRequest(`user_profiles?phone=eq.${senderPhone}&select=*`, 'GET');
          let currentProfile = profileData && profileData.length > 0 ? profileData[0] : {};
          if (!currentProfile.phone) {
            await supabaseRequest('user_profiles', 'POST', { phone: senderPhone, name: whatsappName });
            currentProfile = { name: whatsappName, summary: "" };
          }
          const historyData = await supabaseRequest(`messages?user_phone=eq.${senderPhone}&order=id.desc&limit=10&select=role,content`, 'GET') || [];
          const chatHistory = historyData.reverse().map(msg => ({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] }));

          // B. GEMINI CALL
          const contextString = `USER: ${currentProfile.name} (${senderPhone})\nFACTS: ${currentProfile.summary}\nINPUT: "${userInput}"`;
          const fullConversation = [...chatHistory, { role: "user", parts: [{ text: contextString }] }];
          // FIXED: Removed extra space before process.env
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          
          let apiBody = { contents: fullConversation, tools: GEMINI_TOOLS, system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, generationConfig: { responseMimeType: "application/json" } };
          let geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
          let geminiData = await geminiResponse.json();
          let candidate = geminiData.candidates?.[0]?.content?.parts?.[0];

          // C. TOOLS
          if (candidate?.functionCall) {
              const call = candidate.functionCall;
              const args = call.args;
              let toolResult = "Failed.";
              if (call.name === "log_complaint") {
                 const tID = await createTicket(senderPhone, args.subject, args.details, args.user_email, args.user_name);
                 toolResult = tID ? `Ticket #${tID} created.` : "Failed.";
              }
              else if (call.name === "check_ticket_status") toolResult = await getTicketStatus(senderPhone);
              else if (call.name === "escalate_ticket") toolResult = await updateTicket(args.ticket_id, args.update_text, args.is_urgent);

              const followUp = [...fullConversation, { role: "model", parts: [{ functionCall: call }] }, { role: "function", parts: [{ functionResponse: { name: call.name, response: { result: toolResult } } }] }];
              apiBody.contents = followUp;
              geminiResponse = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiBody) });
              geminiData = await geminiResponse.json();
          }

          // D. OUTPUT
          let aiRawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          let aiOutput;
          try { aiOutput = JSON.parse(aiRawText.replace(/```json|```/g, "").trim()); } catch (e) { aiOutput = { response: { type: "text", body: aiRawText } }; }

          // E. MEMORY UPDATE
          if (aiOutput.memory_update) {
            const newSummary = ((currentProfile.summary || "") + "\n" + aiOutput.memory_update).slice(-2000);
            await supabaseRequest(`user_profiles?phone=eq.${senderPhone}`, 'PATCH', { summary: newSummary });
          }

          // F. SEND WHATSAPP
          const aiReply = aiOutput.response || { type: "text", body: "System Error" };
          // FIXED: Removed extra space in the closing backtick
          const WHATSAPP_URL = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
          const HEADERS = { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
          
          let payload = {};
          if (aiReply.type === "text") payload = { messaging_product: "whatsapp", to: senderPhone, text: { body: aiReply.body } };
          else if (aiReply.type === "button") {
             const buttons = (aiReply.options || []).slice(0, 3).map((opt, i) => ({ type: "reply", reply: { id: `btn_${i}`, title: opt.substring(0, 20) } }));
             payload = { messaging_product: "whatsapp", to: senderPhone, type: "interactive", interactive: { type: "button", body: { text: aiReply.body }, action: { buttons: buttons } } };
          }

          if (payload.messaging_product) {
            await fetch(WHATSAPP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });
            const logContent = aiReply.type === 'text' ? aiReply.body : `[Sent ${aiReply.type}]`;
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'assistant', content: logContent });
            await supabaseRequest('messages', 'POST', { user_phone: senderPhone, role: 'user', content: userInput });
          }
        } catch (error) { console.error("CRITICAL ERROR:", error); }
      }
    }
    return res.status(200).json({ status: "ok" });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
```
