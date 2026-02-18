const fs = require("fs/promises");
const path = require("path");

const PROPERTY_DB_PATH = path.join(__dirname, "..", "data", "properties.json");

async function ensurePropertyStore() {
  try {
    await fs.access(PROPERTY_DB_PATH);
  } catch (_) {
    await fs.mkdir(path.dirname(PROPERTY_DB_PATH), { recursive: true });
    await fs.writeFile(PROPERTY_DB_PATH, "[]", "utf-8");
  }
}

async function readProperties() {
  await ensurePropertyStore();
  const raw = await fs.readFile(PROPERTY_DB_PATH, "utf-8");
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch (error) {
    console.warn("Property store corrupted, reinitializing", error.message);
    await fs.writeFile(PROPERTY_DB_PATH, "[]", "utf-8");
    return [];
  }
}

async function writeProperties(properties = []) {
  await fs.writeFile(PROPERTY_DB_PATH, JSON.stringify(properties, null, 2), "utf-8");
}

function generatePropertyId(property = {}) {
  const cityCode = (property.city || "PRP").toUpperCase().slice(0, 3);
  const typeCode = (property.type || "GEN").toUpperCase().slice(0, 3);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${cityCode}-${typeCode}-${Date.now().toString().slice(-4)}-${random}`;
}

function normalizeStatus(status) {
  return (status || "active").toLowerCase();
}

async function listProperties(filters = {}) {
  const properties = await readProperties();
  return properties.filter(property => {
    if (filters.status && normalizeStatus(property.status) !== normalizeStatus(filters.status)) {
      return false;
    }
    if (filters.city && property.city?.toLowerCase() !== filters.city.toLowerCase()) {
      return false;
    }
    if (filters.type && property.type?.toLowerCase() !== filters.type.toLowerCase()) {
      return false;
    }
    return true;
  });
}

async function getPropertyById(id) {
  const properties = await readProperties();
  return properties.find(property => property.id === id) || null;
}

async function addProperty(payload) {
  const properties = await readProperties();
  const timestamp = new Date().toISOString();

  const newProperty = {
    id: payload.id || generatePropertyId(payload),
    name: payload.name,
    location: payload.location,
    city: payload.city,
    type: payload.type,
    tenure: payload.tenure,
    price: payload.price || null,
    rent: payload.rent || null,
    rentalFrequency: payload.rentalFrequency || null,
    bedrooms: payload.bedrooms ?? null,
    bathrooms: payload.bathrooms ?? null,
    amenities: payload.amenities || [],
    availability: payload.availability || "TBD",
    virtualTour: payload.virtualTour || null,
    images: payload.images || [],
    description: payload.description || "",
    status: normalizeStatus(payload.status),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  properties.push(newProperty);
  await writeProperties(properties);
  return newProperty;
}

async function updateProperty(id, updates = {}) {
  const properties = await readProperties();
  const idx = properties.findIndex(property => property.id === id);
  if (idx === -1) return null;

  const next = {
    ...properties[idx],
    ...updates,
    status: updates.status ? normalizeStatus(updates.status) : properties[idx].status,
    updatedAt: new Date().toISOString()
  };

  if (updates.images) {
    next.images = updates.images;
  }

  if (updates.amenities) {
    next.amenities = updates.amenities;
  }

  properties[idx] = next;
  await writeProperties(properties);
  return next;
}

async function archiveProperty(id) {
  return updateProperty(id, { status: "archived" });
}

module.exports = {
  listProperties,
  getPropertyById,
  addProperty,
  updateProperty,
  archiveProperty
};
