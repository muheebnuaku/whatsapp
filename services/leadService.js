const fs = require("fs/promises");
const path = require("path");

const LEAD_DB_PATH = path.join(__dirname, "..", "data", "leads.json");

async function ensureLeadStore() {
  try {
    await fs.access(LEAD_DB_PATH);
  } catch (_) {
    await fs.mkdir(path.dirname(LEAD_DB_PATH), { recursive: true });
    await fs.writeFile(LEAD_DB_PATH, "[]", "utf-8");
  }
}

async function readLeads() {
  await ensureLeadStore();
  const raw = await fs.readFile(LEAD_DB_PATH, "utf-8");
  try {
    return JSON.parse(raw) || [];
  } catch (error) {
    console.warn("Lead store corrupted, reinitializing", error.message);
    await fs.writeFile(LEAD_DB_PATH, "[]", "utf-8");
    return [];
  }
}

async function writeLeads(leads = []) {
  await fs.writeFile(LEAD_DB_PATH, JSON.stringify(leads, null, 2), "utf-8");
}

async function addLead(lead) {
  const leads = await readLeads();
  leads.push(lead);
  await writeLeads(leads);
  return lead;
}

async function updateLeadStatus(id, status, extra = {}) {
  const leads = await readLeads();
  const idx = leads.findIndex(lead => lead.id === id);
  if (idx === -1) return null;

  leads[idx] = {
    ...leads[idx],
    status,
    ...extra,
    updatedAt: new Date().toISOString()
  };

  await writeLeads(leads);
  return leads[idx];
}

async function listLeads(filters = {}) {
  const leads = await readLeads();
  return leads.filter(lead => {
    if (filters.status && lead.status !== filters.status) {
      return false;
    }
    if (typeof filters.minScore === "number" && lead.score < filters.minScore) {
      return false;
    }
    if (filters.startDate) {
      const leadDate = new Date(lead.createdAt).getTime();
      if (leadDate < new Date(filters.startDate).getTime()) {
        return false;
      }
    }
    if (filters.endDate) {
      const leadDate = new Date(lead.createdAt).getTime();
      if (leadDate > new Date(filters.endDate).getTime()) {
        return false;
      }
    }
    return true;
  });
}

module.exports = {
  addLead,
  listLeads,
  updateLeadStatus
};
