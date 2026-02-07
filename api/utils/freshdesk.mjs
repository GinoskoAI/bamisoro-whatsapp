const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN;
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

const getHeaders = () => ({
  'Authorization': `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')}`,
  'Content-Type': 'application/json'
});

// 1. MANAGE CONTACT
export async function createOrUpdateContact(phone, name, email) {
  if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) return null;
  const searchUrl = `https://${FRESHDESK_DOMAIN}/api/v2/contacts?phone=${encodeURIComponent(phone)}`;
  
  try {
    const searchRes = await fetch(searchUrl, { headers: getHeaders() });
    const searchData = await searchRes.json();

    if (searchData.length > 0) {
      const contact = searchData[0];
      return contact.id; // Return existing ID
    } else {
      const createRes = await fetch(`https://${FRESHDESK_DOMAIN}/api/v2/contacts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ 
          name: name || "WhatsApp User", 
          phone: phone, 
          email: email, 
          unique_external_id: phone 
        })
      });
      if (!createRes.ok) return null;
      const createData = await createRes.json();
      return createData.id;
    }
  } catch (e) { return null; }
}

// 2. CREATE TICKET (FIXED: Removed 'cf_whatsapp_number')
export async function createTicket(userPhone, subject, description, email, name) {
  const contactId = await createOrUpdateContact(userPhone, name, email);
  if (!contactId) return null;

  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets`;
  const ticketData = {
    description: `${description} \n\n[Source: WhatsApp Bot]`,
    subject: subject,
    priority: 2,
    status: 2,
    source: 7,
    requester_id: contactId
    // REMOVED: custom_fields: { cf_whatsapp_number: userPhone } <-- CAUSING ERROR
  };

  try {
      const response = await fetch(url, { method: 'POST', headers: getHeaders(), body: JSON.stringify(ticketData) });
      if (response.ok) {
          const data = await response.json();
          return data.id;
      }
      const errText = await response.text();
      console.error("Freshdesk Create Error:", errText); // Log actual error
      return null;
  } catch (e) { return null; }
}

// 3. CHECK STATUS
export async function getTicketStatus(userPhone) {
  const contactId = await createOrUpdateContact(userPhone);
  if (!contactId) return "No profile found.";

  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets?requester_id=${contactId}&include=stats&order_by=created_at&order_type=desc`;
  try {
      const response = await fetch(url, { headers: getHeaders() });
      const tickets = await response.json();
      if (!tickets || tickets.length === 0) return "You have no open tickets.";
      return tickets.slice(0, 3).map(t => `🎫 *#${t.id}*: ${t.subject} (${t.status === 2 ? 'Open' : 'Resolved'})`).join("\n");
  } catch (e) { return "Error checking status."; }
}

// 4. UPDATE TICKET
export async function updateTicket(ticketId, noteText, escalate = false) {
  try {
      const noteUrl = `https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}/notes`;
      await fetch(noteUrl, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ body: noteText, private: false }) });
      if (escalate) {
         await fetch(`https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify({ priority: 4 }) });
      }
      return `Ticket #${ticketId} updated.`;
  } catch (e) { return "Update failed."; }
}
