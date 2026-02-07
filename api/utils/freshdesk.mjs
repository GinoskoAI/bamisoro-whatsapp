const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN;
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

/* =========================
   HELPERS
========================= */
function authHeader() {
  return {
    Authorization:
      'Basic ' +
      Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64'),
    'Content-Type': 'application/json'
  };
}

/* =========================
   CREATE TICKET
========================= */
export async function createTicket(
  phone,
  subject,
  description,
  email,
  name
) {
  try {
    const payload = {
      subject,
      description,
      email: email || `whatsapp_${phone}@example.com`,
      priority: 1,
      status: 2,
      custom_fields: {
        cf_whatsapp_number: phone
      }
    };

    if (name) payload.name = name;

    const res = await fetch(
      `https://${FRESHDESK_DOMAIN}/api/v2/tickets`,
      {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify(payload)
      }
    );

    if (!res.ok) {
      console.error('Freshdesk createTicket failed:', await res.text());
      return null;
    }

    const data = await res.json();
    return data.id;
  } catch (err) {
    console.error('createTicket error:', err);
    return null;
  }
}

/* =========================
   GET TICKET STATUS
========================= */
export async function getTicketStatus(phone) {
  try {
    const searchUrl = `https://${FRESHDESK_DOMAIN}/api/v2/search/tickets?query="cf_whatsapp_number:'${phone}'"`;

    const res = await fetch(searchUrl, {
      method: 'GET',
      headers: authHeader()
    });

    if (!res.ok) {
      console.error('Freshdesk getTicketStatus failed:', await res.text());
      return 'Unable to fetch ticket status at the moment.';
    }

    const data = await res.json();
    const ticket = data?.results?.[0];

    if (!ticket) return 'No active ticket found for your number.';

    return `Your ticket (#${ticket.id}) is currently ${ticket.status}.`;
  } catch (err) {
    console.error('getTicketStatus error:', err);
    return 'Error retrieving ticket status.';
  }
}

/* =========================
   UPDATE / ESCALATE TICKET
========================= */
export async function updateTicket(ticketId, note, urgent = false) {
  try {
    const payload = {
      note,
      private: false
    };

    if (urgent) {
      payload.priority = 4;
    }

    const res = await fetch(
      `https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}/notes`,
      {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify(payload)
      }
    );

    if (!res.ok) {
      console.error('Freshdesk updateTicket failed:', await res.text());
      return 'Failed to update ticket.';
    }

    return 'Ticket updated successfully.';
  } catch (err) {
    console.error('updateTicket error:', err);
    return 'Error updating ticket.';
  }
}
