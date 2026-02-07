import { createTicket, getTicketStatus, updateTicket } from './utils/freshdesk.mjs';

/* =========================
   SUPABASE HELPER
========================= */
async function supabaseRequest(endpoint, method, body = null) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${endpoint}`;

  const headers = {
    apikey: process.env.SUPABASE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: method === 'GET' ? 'return=representation' : 'return=minimal'
  };

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetch(url, options);
    if (response.status === 204) return null;

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    console.error('Supabase error:', err);
    return null;
  }
}

/* =========================
   SYSTEM PROMPT
========================= */
const SYSTEM_PROMPT = `
Role: ALAT Buddy (Wema Bank AI)
Goal: Provide seamless customer support with Nigerian banking context.

Capabilities:
- Complaint classification
- Entity extraction
- SLA awareness

Process:
1. Empathize with the user
2. If complaint: check for Name and Email, ask if missing
3. Log complaints using "log_complaint"
4. For status checks: use "check_ticket_status"
5. For escalations: use "escalate_ticket"

Output strictly in JSON:
{
  "response": { "type": "text", "body": "..." },
  "memory_update": "..."
}
`;

/* =========================
   GEMINI TOOLS
========================= */
const GEMINI_TOOLS = [
  {
    function_declarations: [
      {
        name: 'log_complaint',
        description: 'Log a complaint ticket. Ask for Name and Email if missing.',
        parameters: {
          type: 'OBJECT',
          properties: {
            subject: { type: 'STRING' },
            details: { type: 'STRING' },
            user_email: { type: 'STRING' },
            user_name: { type: 'STRING' }
          },
          required: ['subject', 'details']
        }
      },
      {
        name: 'check_ticket_status',
        description: 'Check ticket status',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'escalate_ticket',
        description: 'Escalate an existing ticket',
        parameters: {
          type: 'OBJECT',
          properties: {
            ticket_id: { type: 'NUMBER' },
            update_text: { type: 'STRING' },
            is_urgent: { type: 'BOOLEAN' }
          },
          required: ['ticket_id', 'update_text']
        }
      }
    ]
  }
];

/* =========================
   MAIN HANDLER
========================= */
export default async function handler(req, res) {
  /* ---- Webhook verification ---- */
  if (req.method === 'GET') {
    if (
      req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN
    ) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  /* ---- Incoming messages ---- */
  if (req.method === 'POST') {
    try {
      const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
      const message = entry?.messages?.[0];
      if (!message) return res.status(200).json({ status: 'ignored' });

      const senderPhone = message.from;
      const whatsappName = entry?.contacts?.[0]?.profile?.name || 'Unknown';

      let userInput = '[Unsupported message]';
      if (message.type === 'text') {
        userInput = message.text.body;
      } else if (message.type === 'interactive') {
        userInput =
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          userInput;
      }

      /* ---- Load user profile ---- */
      const profileRows = await supabaseRequest(
        `user_profiles?phone=eq.${senderPhone}&select=*`,
        'GET'
      );

      let profile = profileRows?.[0];
      if (!profile) {
        await supabaseRequest('user_profiles', 'POST', {
          phone: senderPhone,
          name: whatsappName,
          summary: ''
        });
        profile = { name: whatsappName, summary: '' };
      }

      /* ---- Conversation history ---- */
      const history =
        (await supabaseRequest(
          `messages?user_phone=eq.${senderPhone}&order=id.desc&limit=10&select=role,content`,
          'GET'
        )) || [];

      const chatHistory = history.reverse().map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      /* ---- Gemini call ---- */
      const context = `USER: ${profile.name} (${senderPhone})
FACTS: ${profile.summary || 'None'}
INPUT: "${userInput}"`;

      const contents = [
        ...chatHistory,
        { role: 'user', parts: [{ text: context }] }
      ];

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

      let geminiPayload = {
        contents,
        tools: GEMINI_TOOLS,
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { responseMimeType: 'application/json' }
      };

      let geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      });

      let geminiData = await geminiRes.json();
      let candidate = geminiData?.candidates?.[0]?.content?.parts?.[0];

      /* ---- Tool execution ---- */
      if (candidate?.functionCall) {
        const { name, args } = candidate.functionCall;
        let result = 'Failed';

        if (name === 'log_complaint') {
          const id = await createTicket(
            senderPhone,
            args.subject,
            args.details,
            args.user_email,
            args.user_name
          );
          result = id ? `Ticket #${id} created` : 'Ticket creation failed';
        }

        if (name === 'check_ticket_status') {
          result = await getTicketStatus(senderPhone);
        }

        if (name === 'escalate_ticket') {
          result = await updateTicket(
            args.ticket_id,
            args.update_text,
            args.is_urgent
          );
        }

        geminiPayload.contents = [
          ...contents,
          { role: 'model', parts: [{ functionCall: candidate.functionCall }] },
          {
            role: 'function',
            parts: [{ functionResponse: { name, response: { result } } }]
          }
        ];

        geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        });

        geminiData = await geminiRes.json();
      }

      /* ---- Parse final AI output ---- */
      const rawText =
        geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

      let aiOutput;
      try {
        aiOutput = JSON.parse(rawText.replace(/```json|```/g, '').trim());
      } catch {
        aiOutput = { response: { type: 'text', body: rawText } };
      }

      /* ---- Memory update ---- */
      if (aiOutput.memory_update) {
        const updated = (
          (profile.summary || '') +
          '\n' +
          aiOutput.memory_update
        ).slice(-2000);

        await supabaseRequest(
          `user_profiles?phone=eq.${senderPhone}`,
          'PATCH',
          { summary: updated }
        );
      }

      /* ---- Send WhatsApp reply ---- */
      const reply = aiOutput.response || {
        type: 'text',
        body: 'Sorry, something went wrong.'
      };

      const whatsappPayload =
        reply.type === 'button'
          ? {
              messaging_product: 'whatsapp',
              to: senderPhone,
              type: 'interactive',
              interactive: {
                type: 'button',
                body: { text: reply.body },
                action: {
                  buttons: (reply.options || []).slice(0, 3).map((o, i) => ({
                    type: 'reply',
                    reply: { id: `btn_${i}`, title: o.slice(0, 20) }
                  }))
                }
              }
            }
          : {
              messaging_product: 'whatsapp',
              to: senderPhone,
              text: { body: reply.body }
            };

      await fetch(
        `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(whatsappPayload)
        }
      );

      /* ---- Store messages ---- */
      await supabaseRequest('messages', 'POST', {
        user_phone: senderPhone,
        role: 'user',
        content: userInput
      });

      await supabaseRequest('messages', 'POST', {
        user_phone: senderPhone,
        role: 'assistant',
        content:
          reply.type === 'text' ? reply.body : `[Sent ${reply.type} message]`
      });

      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('CRITICAL ERROR:', err);
      return res.status(200).json({ status: 'error' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
