// api/utils/freshdesk.mjs
// VERSION: WITH WHATSAPP TAGS

const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN;
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

// Auth Helper
const getHeaders = () => ({
  'Authorization': `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')}`,
  'Content-Type': 'application/json'
});

// URL Helper (Handles myfreshworks.com vs freshdesk.com)
const getBaseUrl = () => {
  if (FRESHDESK_DOMAIN.includes('myfreshworks.com')) {
      return `https://${FRESHDESK_DOMAIN}/helpdesk/api/v2`;
  }
  return `https://${FRESHDESK_DOMAIN}/api/v2`;
};

// 1. CREATE/UPDATE CONTACT
export async function createOrUpdateContact(phone, name, email) {
  if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) return null;
  const baseUrl = getBaseUrl();
  
  try {
    // Search
    const searchRes = await fetch(`${baseUrl}/contacts?phone=${encodeURIComponent(phone)}`, { headers: getHeaders() });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();

    if (searchData.length > 0) {
      // Update
      const contactId = searchData[0].id;
      if (name || email) {
        await fetch(`${baseUrl}/contacts/${contactId}`, {
          method: 'PUT', headers: getHeaders(), 
          body: JSON.stringify({ name, email }) 
        });
      }
      return contactId;
    } else {
      // Create
      const createRes = await fetch(`${baseUrl}/contacts`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ name: name || "WhatsApp User", phone, email, unique_external_id: phone })
      });
      return createRes.ok ? (await createRes.json()).id : null;
    }
  } catch (e) { return null; }
}

// 2. CREATE TICKET (Now with Tags)
export async function createTicket(userPhone, subject, description, email, name) {
  const contactId = await createOrUpdateContact(userPhone, name, email);
  if (!contactId) return null;

  const baseUrl = getBaseUrl();
  const ticketData = {
    description: `${description} \n\n[Source: WhatsApp Bot]`,
    subject: subject,
    priority: 2, 
    status: 2,   
    source: 7,   
    requester_id: contactId,
    tags: ['WhatsApp', 'AI_Bot'] // <--- TAG ADDED HERE
  };

  try {
      const response = await fetch(`${baseUrl}/tickets`, { 
          method: 'POST', headers: getHeaders(), body: JSON.stringify(ticketData) 
      });
      if (response.ok) {
          const data = await response.json();
          return data.id;
      }
      return null;
  } catch (e) { return null; }
}

// 3. CHECK STATUS
export async function getTicketStatus(userPhone) {
  const contactId = await createOrUpdateContact(userPhone);
  if (!contactId) return "I couldn't find a support profile for your phone number.";
  const baseUrl = getBaseUrl();
  
  try {
      const response = await fetch(`${baseUrl}/tickets?requester_id=${contactId}&include=stats&order_by=created_at&order_type=desc`, { headers: getHeaders() });
      const tickets = await response.json();
      if (!tickets || tickets.length === 0) return "You have no open support tickets.";

      return tickets.slice(0, 3).map(t => 
        `🎫 *Ticket #${t.id}*: ${t.subject}\n   • Status: ${getStatusName(t.status)}\n   • Date: ${new Date(t.created_at).toLocaleDateString()}`
      ).join("\n\n");
  } catch (e) { return "I'm having trouble connecting to the ticket system."; }
}

// 4. UPDATE TICKET
export async function updateTicket(ticketId, noteText, escalate = false) {
  const baseUrl = getBaseUrl();
  try {
      await fetch(`${baseUrl}/tickets/${ticketId}/notes`, {
        method: 'POST', headers: getHeaders(), 
        body: JSON.stringify({ body: `[User Update]: ${noteText}`, private: false })
      });
      if (escalate) {
         await fetch(`${baseUrl}/tickets/${ticketId}`, {
            method: 'PUT', headers: getHeaders(), body: JSON.stringify({ priority: 4 })
         });
      }
      return `Update added to Ticket #${ticketId}.`;
  } catch (e) { return "Failed to update ticket."; }
}

function getStatusName(code) {
    const statuses = { 2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed" };
    return statuses[code] || "Processing";
}
