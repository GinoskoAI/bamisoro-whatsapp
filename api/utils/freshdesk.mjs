const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN;
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

// Helper for Auth Headers
const getHeaders = () => ({
  'Authorization': `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')}`,
  'Content-Type': 'application/json'
});

async function createOrUpdateContact(phone, name, email) {
  const searchUrl = `https://${FRESHDESK_DOMAIN}/api/v2/contacts?phone=${encodeURIComponent(phone)}`;
  
  try {
    const searchRes = await fetch(searchUrl, { headers: getHeaders() });
    const searchData = await searchRes.json();

    if (searchData.length > 0) {
      const contact = searchData[0];
      const contactId = contact.id;
      
      let updateData = {};
      if (name && (!contact.name || contact.name === "WhatsApp User")) updateData.name = name;
      if (email && (!contact.email || contact.email !== email)) updateData.email = email;

      if (Object.keys(updateData).length > 0) {
        await fetch(`https://${FRESHDESK_DOMAIN}/api/v2/contacts/${contactId}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify(updateData)
        });
      }
      return contactId;

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
  } catch (e) {
    console.error("Freshdesk Contact Error:", e);
    return null;
  }
}

async function createTicket(userPhone, subject, description, email, name) {
  const contactId = await createOrUpdateContact(userPhone, name, email);
  if (!contactId) return null;

  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets`;
  const ticketData = {
    description: `${description} \n\n[Source: WhatsApp]`,
    subject: subject,
    priority: 2,
    status: 2,
    source: 7,
    requester_id: contactId
  };

  const response = await fetch(url, { method: 'POST', headers: getHeaders(), body: JSON.stringify(ticketData) });
  if (response.ok) {
      const data = await response.json();
      return data.id;
  }
  return null;
}

async function getTicketStatus(userPhone) {
  const contactId = await createOrUpdateContact(userPhone);
  if (!contactId) return "I couldn't find a profile for your phone number.";

  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets?requester_id=${contactId}&include=stats&order_by=created_at&order_type=desc`;
  const response = await fetch(url, { headers: getHeaders() });
  const tickets = await response.json();

  if (!tickets || tickets.length === 0) return "You have no open support tickets.";

  return tickets.slice(0, 3).map(t => 
    `🎫 *Ticket #${t.id}*: ${t.subject} (Status: ${getStatusName(t.status)})`
  ).join("\n");
}

async function updateTicket(ticketId, noteText, escalate = false) {
  const noteUrl = `https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}/notes`;
  await fetch(noteUrl, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ body: `[User Update]: ${noteText}`, private: false })
  });

  if (escalate) {
     const updateUrl = `https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}`;
     await fetch(updateUrl, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ priority: 4 })
     });
     return `Ticket #${ticketId} has been escalated.`;
  }
  return `Update added to Ticket #${ticketId}.`;
}

function getStatusName(code) {
    const statuses = { 2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed" };
    return statuses[code] || "Processing";
}

// ⚠️ THIS IS THE KEY CHANGE FOR COMMONJS
module.exports = { createOrUpdateContact, createTicket, getTicketStatus, updateTicket };
