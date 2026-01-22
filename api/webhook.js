// Copy this into api/webhook.js
export default async function handler(req, res) {
  // 1. Handle Meta Verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // STRICTLY matches the Vercel Env Variable: WEBHOOK_VERIFY_TOKEN
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).json({ error: 'Verification failed. Token mismatch.' });
    }
  }

  // 2. Handle Incoming Messages (POST)
  if (req.method === 'POST') {
    // We just return 200 OK for now to keep Meta happy
    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
