import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  // Security: Check for a secret key (add this to your Vercel Env Variables)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date().toISOString();

  // 1. Find messages that are DUE and PENDING
  const { data: tasks } = await supabase
    .from('drip_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now) // "Less than or equal to Now"
    .limit(10); // Batch size to prevent timeouts

  if (!tasks || tasks.length === 0) return res.json({ status: "No tasks due" });

  const results = [];

  // 2. Process Each Task
  for (const task of tasks) {
    try {
      // A. DYNAMIC GENERATION: Ask Gemini what to say NOW.
      // This is the "Adaptive" part.
      const prompt = `
        You are the Wema Bank ALAT Agent. 
        CONTEXT: The user (${task.user_phone}) stopped responding earlier.
        YOUR GOAL: ${task.context}
        
        Write a short, friendly, WhatsApp message to re-engage them.
        Keep it under 1 sentence. Be helpful, not annoying.
      `;
      
      // (Assume you have a helper function 'askGemini' similar to your webhook)
      const aiMessage = await askGemini(prompt); 

      // B. Send the Message (Reuse your send-message logic)
      // Call your existing send-message API or function here
      await sendWhatsAppMessage(task.user_phone, aiMessage);

      // C. Mark as Sent
      await supabase
        .from('drip_queue')
        .update({ status: 'sent' })
        .eq('id', task.id);
        
      results.push({ phone: task.user_phone, status: "Sent" });

    } catch (err) {
      console.error("Drip Failed:", err);
      // Mark as failed so we don't retry forever
      await supabase.from('drip_queue').update({ status: 'failed' }).eq('id', task.id);
    }
  }

  return res.json({ processed: results });
}
