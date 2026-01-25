// api/schedule-drip.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { phone, delay_hours, context } = req.body;

  // 1. Calculate the Target Time
  const scheduledAt = new Date();
  scheduledAt.setHours(scheduledAt.getHours() + (parseFloat(delay_hours) || 1));

  // 2. Save to Supabase
  const { error } = await supabase
    .from('drip_queue')
    .insert({
      user_phone: phone,
      scheduled_at: scheduledAt.toISOString(),
      context: context, // e.g., "Nudge about completing account tier upgrade"
      status: 'pending'
    });

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ status: "Scheduled", target_time: scheduledAt });
}
