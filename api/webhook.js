// api/webhook.js
export default async function handler(req, res) {
  // 1. Meta Webhook Verification (Keep this!)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed.' });
  }

  // 2. Handle Incoming Messages (POST)
  if (req.method === 'POST') {
    // Log the entire package from Meta so we can see it in Vercel
    console.log("⬇️ INCOMING WEBHOOK:", JSON.stringify(req.body, null, 2));

    const body = req.body;

    // Check if this is a message from a user
    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const message = body.entry[0].changes[0].value.messages[0];
        const senderPhone = message.from;
        const messageText = message.text ? message.text.body : "No text (Media/Status)";

        console.log(`📩 MESSAGE RECEIVED!`);
        console.log(`From: ${senderPhone}`);
        console.log(`Text: ${messageText}`);
        
        // TODO: This is where we will add the AI logic later
      }
    }

    // Always return 200 OK immediately
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
