const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN;
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

// Helper for Auth Headers
const getHeaders = () => ({
  'Authorization': `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')}`,
  'Content-Type': 'application/json'
});

// 1. MANAGE CRM CONTACT (Internal Helper)
// Finds a user by phone. If they exist, updates them. If not, creates them.
export async function createOrUpdateContact(phone, name, email) {
  if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
      console.error("Missing Freshdesk Config");
      return null;
  }

  // A. Search for existing contact by Phone
  const searchUrl = `https://${FRESHDESK_DOMAIN}/api/v2/contacts?phone=${encodeURIComponent(phone)}`;
  
  try {
    const searchRes = await fetch(searchUrl, { headers: getHeaders() });
    const searchData = await searchRes.json();

    if (searchData.length > 0) {
      // --- CONTACT EXISTS: UPDATE ---
      const contact = searchData[0];
      const contactId = contact.id;
      
      // Update only if we have new info
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
      // --- NEW CONTACT: CREATE ---
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

// 2. CREATE TICKET
export async function createTicket(userPhone, subject, description, email, name) {
  // Ensure CRM record is ready first
  const contactId = await createOrUpdateContact(userPhone, name, email);
  if (!contactId) return null;

  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets`;
  const ticketData = {
    description: `${description} \n\n[Source: WhatsApp Bot]`,
    subject: subject,
    priority: 2, // Medium
    status: 2,   // Open
    source: 7,   // Chat
    requester_id: contactId 
  };

  try {
      const response = await fetch(url, { method: 'POST', headers: getHeaders(), body: JSON.stringify(ticketData) });
      if (response.ok) {
          const data = await response.json();
          return data.id;
      }
      return null;
  } catch (e) { return null; }
}

// 3. CHECK TICKET STATUS
export async function getTicketStatus(userPhone) {
  const contactId = await createOrUpdateContact(userPhone);
  if (!contactId) return "I couldn't find a support profile for your phone number.";

  const url = `https://${FRESHDESK_DOMAIN}/api/v2/tickets?requester_id=${contactId}&include=stats&order_by=created_at&order_type=desc`;
  
  try {
      const response = await fetch(url, { headers: getHeaders() });
      const tickets = await response.json();

      if (!tickets || tickets.length === 0) return "You have no open support tickets at the moment.";

      // Format the last 3 tickets nicely
      return tickets.slice(0, 3).map(t => 
        `🎫 *Ticket #${
