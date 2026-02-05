// api/utils/freshdesk.js
const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN;
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

// Helper for Auth Headers
const getHeaders = () => ({
  'Authorization': `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')}`,
  'Content-Type': 'application/json'
});

// 1. MANAGE CONTACT (CRM)
export async function createOrUpdateContact(phone, name, email) {
  // First, try to find the user by Phone
  const searchUrl = `https://${FRESHDESK_DOMAIN}/api/v2/contacts?phone=${phone}`;
  
  try {
    const searchRes = await fetch(searchUrl, { headers: getHeaders() });
    const searchData = await searchRes.json();

    if (searchData.length > 0) {
      // Contact Exists -> Update their info if provided
      const contactId = searchData[0].id;
      if (name || email) {
        await fetch(`https://${FRESHDESK_DOMAIN}/api/v2/contacts/${contactId}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({ name, email })
        });
      }
      return contactId;
    } else {
      // Contact Does Not Exist -> Create New
      const createRes = await fetch(`https://${FRESHDESK_DOMAIN}/api/v2/contacts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ 
          name: name || "WhatsApp User", 
          phone: phone, 
          email: email, // Email is often required by Freshdesk
          unique_external_id: phone 
        })
      });
      const createData = await createRes.json();
      return createData.id;
    }
  } catch (e) {
    console.error("Freshdesk Contact Error:", e);
    return null;
  }
}

// 2. CREATE TICKET (Linked to Contact)
export async function createTicket(userPhone, subject, description, email, name) {
  // Ensure Contact Exists First
  const contactId = await createOrUpdateContact(userPhone, name, email);
  
  if (!contactId) return null;

  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets`;
  const ticketData = {
    description: `${description} \n\n[Source: WhatsApp]`,
    subject: subject,
    priority: 2,
    status: 2,
    source: 7, // Chat
    requester_id: contactId // Link to the specific CRM record
  };

  const response = await fetch(url, { method: 'POST', headers: getHeaders(), body: JSON.stringify(ticketData) });
  if (response.ok) {
      const data = await response.json();
      return data.id;
  }
  return null;
}

// 3. CHECK STATUS
export async function getTicketStatus(userPhone) {
  // Find contact ID first
  const contactId = await createOrUpdateContact(userPhone);
  if (!contactId) return "No profile found.";

  // Get tickets for this requester
  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets?requester_id=${contactId}&include=stats`;
  const response = await fetch(url, { headers: getHeaders() });
  const tickets = await response.json();

  if (!tickets || tickets.length === 0) return "You have no open tickets.";

  // Return a summary of the last 3 tickets
  return tickets.slice(0, 3).map(t => 
    `Ticket #${t.id}: ${t.subject} (Status: ${getStatusName(t.status)})`
  ).join("\n");
}

// 4. ESCALATE / UPDATE TICKET
export async function updateTicket(ticketId, noteText, escalate = false) {
  // Add a note
  const noteUrl = `https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}/notes`;
  await fetch(noteUrl, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ body: noteText, private: false })
  });

  // If escalation requested, update priority to High (3) or Urgent (4)
  if (escalate) {
     const updateUrl = `https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}`;
     await fetch(updateUrl, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ priority: 4 })
     });
  }
  return true;
}

// Helper: Freshdesk Status Codes
function getStatusName(code) {
    const statuses = { 2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed" };
    return statuses[code] || "Processing";
}
