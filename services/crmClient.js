const axios = require("axios");

const CRM_SYNC_URL = process.env.CRM_SYNC_URL;
const CRM_API_KEY = process.env.CRM_API_KEY;
const MAX_RETRIES = 3;

function hasCrmConfig() {
  return Boolean(CRM_SYNC_URL);
}

async function syncLeadToDynamics(lead, attempt = 1) {
  if (!hasCrmConfig()) {
    console.log("CRM sync skipped: CRM_SYNC_URL not configured");
    return { status: "skipped" };
  }

  try {
    const payload = {
      source: "WhatsApp",
      externalId: lead.id,
      fullName: lead.details?.name || "WhatsApp Prospect",
      phone: lead.phone,
      email: lead.details?.email || null,
      budget: lead.details?.budget || null,
      preferredLocation: lead.details?.location || null,
      propertyType: lead.details?.type || null,
      timeline: lead.details?.timeline || null,
      score: lead.score,
      conversationSummary: lead.summary,
      metadata: {
        status: lead.status,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        notes: lead.notes || null
      }
    };

    const headers = {
      "Content-Type": "application/json"
    };

    if (CRM_API_KEY) {
      headers.Authorization = `Bearer ${CRM_API_KEY}`;
    }

    await axios.post(CRM_SYNC_URL, payload, { headers, timeout: 5000 });
    console.log("CRM sync successful for lead", lead.id);
    return { status: "ok" };
  } catch (error) {
    const shouldRetry = attempt < MAX_RETRIES;
    console.log(
      `CRM sync attempt ${attempt} failed for lead ${lead.id}:`,
      error.response?.data || error.message
    );

    if (shouldRetry) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      return syncLeadToDynamics(lead, attempt + 1);
    }

    throw error;
  }
}

module.exports = {
  syncLeadToDynamics,
  hasCrmConfig
};
