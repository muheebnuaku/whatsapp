const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const leadService = require("./services/leadService");
const propertyService = require("./services/propertyService");
const { syncLeadToDynamics } = require("./services/crmClient");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "myverifytoken";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const PORT = process.env.PORT || 3000;

const REQUIRED_ENV_VARS = ["ACCESS_TOKEN", "PHONE_NUMBER_ID", "OPENAI_API_KEY"]; 
REQUIRED_ENV_VARS.forEach(name => {
  if (!process.env[name]) {
    console.warn(`⚠️ Missing ${name} environment variable. Certain features may not function as expected.`);
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory conversation storage
const userConversations = {};

// In-memory lead storage (temporary until DB integration)
const qualifiedLeads = {};

function generateLeadId(phone) {
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${phone}-${Date.now()}-${suffix}`;
}

function requireAdminAuth(req, res) {
  if (!ADMIN_API_TOKEN) {
    res.status(503).json({ error: "Admin API disabled. Configure ADMIN_API_TOKEN." });
    return false;
  }

  const providedToken = req.headers["x-admin-token"];
  if (providedToken !== ADMIN_API_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

function normalizeListInput(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

const DEFAULT_LOCATION_KEYWORDS = [
  "airport",
  "accra",
  "tema",
  "legon",
  "east legon",
  "cantonments",
  "osu",
  "spintex",
  "community 12"
];

const BASE_PROPERTY_TYPE_KEYWORDS = {
  apartment: ["apartment", "flat", "condo"],
  townhouse: ["townhouse", "town home"],
  house: ["house", "home", "villa"],
  commercial: ["commercial", "office", "workspace", "shop"],
  land: ["land", "plot", "site"],
  studio: ["studio", "bedsit"]
};

function formatCurrency(value) {
  if (!value) return "On request";
  return `GHS ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function collectLocationKeywords(propertyInventory = []) {
  const dynamic = new Set(DEFAULT_LOCATION_KEYWORDS);
  propertyInventory.forEach(property => {
    property.location
      ?.split(/[,-]/)
      .map(segment => segment.trim().toLowerCase())
      .filter(Boolean)
      .forEach(token => dynamic.add(token));
  });
  return Array.from(dynamic);
}

function collectPropertyTypeKeywords(propertyInventory = []) {
  const map = JSON.parse(JSON.stringify(BASE_PROPERTY_TYPE_KEYWORDS));
  propertyInventory.forEach(property => {
    const type = property.type?.toLowerCase();
    if (!type) return;
    if (!map[type]) {
      map[type] = [type];
    } else if (!map[type].includes(type)) {
      map[type].push(type);
    }
  });
  return map;
}

function extractPreferences(message = "", propertyInventory = []) {
  const lower = message.toLowerCase();
  const intents = new Set();

  const propertyKeywords = [
    "property",
    "properties",
    "apartment",
    "house",
    "townhouse",
    "rent",
    "buy",
    "purchase",
    "lease",
    "office",
    "commercial",
    "virtual tour",
    "listing"
  ];

  if (propertyKeywords.some(keyword => lower.includes(keyword))) {
    intents.add("property_search");
  }

  if (lower.includes("price") || lower.includes("cost") || lower.includes("budget")) {
    intents.add("pricing");
  }

  if (lower.includes("available") || lower.includes("availability")) {
    intents.add("availability");
  }

  if (lower.includes("virtual tour") || lower.includes("3d tour") || lower.includes("video tour")) {
    intents.add("virtual_tour");
  }

  if (
    lower.includes("viewing") ||
    lower.includes("inspection") ||
    lower.includes("schedule") ||
    lower.includes("book a visit")
  ) {
    intents.add("viewing_request");
  }

  const wantsImage = /(image|photo|picture|show me|send.*photo)/i.test(lower);
  const urgentRequest = /(urgent|asap|fast|quick|immediately|need this fast)/i.test(lower);

  const locationKeywords = collectLocationKeywords(propertyInventory);
  let location = null;
  for (const keyword of locationKeywords) {
    if (lower.includes(keyword)) {
      location = keyword;
      break;
    }
  }

  const propertyTypeKeywords = collectPropertyTypeKeywords(propertyInventory);
  let propertyType = null;
  for (const [type, aliases] of Object.entries(propertyTypeKeywords)) {
    if (aliases.some(alias => lower.includes(alias))) {
      propertyType = type;
      break;
    }
  }

  const budgetMatch = lower.match(/(\d+[\d,\.]*)(\s*)(k|m|million|thousand)?/i);
  let budgetMax = null;
  if (budgetMatch) {
    const rawValue = parseFloat(budgetMatch[1].replace(/,/g, ""));
    const unit = budgetMatch[3]?.toLowerCase();
    let multiplier = 1;
    if (unit === "k" || unit === "thousand") multiplier = 1_000;
    if (unit === "m" || unit === "million") multiplier = 1_000_000;
    budgetMax = rawValue * multiplier;
  }

  let timeline = null;
  if (lower.includes("immediately") || lower.includes("asap")) timeline = "immediate";
  if (lower.includes("next month")) timeline = "next month";
  if (lower.includes("next week")) timeline = "next week";

  const escalateRequest = /human|agent|representative|person|staff|ceo/i.test(lower);

  return {
    intents: Array.from(intents),
    location,
    propertyType,
    budgetMax,
    timeline,
    wantsVirtualTour: intents.has("virtual_tour"),
    wantsViewing: intents.has("viewing_request"),
    wantsImage,
    urgentRequest,
    escalateRequest
  };
}

function isPropertyActive(property) {
  return (property.status || "active").toLowerCase() === "active";
}

function getPropertyMatches(propertyInventory = [], preferences = {}) {
  return propertyInventory.filter(property => {
    if (!isPropertyActive(property)) return false;
    if (preferences.location && !property.location?.toLowerCase().includes(preferences.location)) {
      return false;
    }
    if (preferences.propertyType && property.type?.toLowerCase() !== preferences.propertyType) {
      return false;
    }
    if (preferences.budgetMax) {
      const priceReference = property.tenure === "rent" ? property.rent : property.price;
      if (priceReference && priceReference > preferences.budgetMax) {
        return false;
      }
    }
    return true;
  });
}

function buildInventoryContext(propertyInventory = [], preferences = {}) {
  const potentialMatches = getPropertyMatches(propertyInventory, preferences);
  const baseList = propertyInventory.filter(isPropertyActive);
  const featured = (potentialMatches.length ? potentialMatches : baseList).slice(0, 5);

  if (!featured.length) {
    return "Current Ghana portfolio is being refreshed. Let the client know you will confirm availability with the MLS team before promising specifics.";
  }

  const snapshot = featured
    .map(property => {
      const headlinePrice =
        property.tenure === "rent"
          ? `${formatCurrency(property.rent)} per ${property.rentalFrequency || "month"}`
          : formatCurrency(property.price);
      return `${property.id}: ${property.name} (${property.location}) | ${property.type} | ${headlinePrice}`;
    })
    .join("\n");

  return `Current Ghana portfolio (quote only facts below unless explicitly stated otherwise):\n${snapshot}\nIf details are missing, promise to confirm with the MLS team rather than guessing.`;
}

async function sendWhatsAppMessage(payload = {}) {
  if (!payload.to) throw new Error("Missing WhatsApp recipient number");

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      ...payload
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

async function sendPropertySuggestions({ to, matches = [], preferences = {} }) {
  if (!matches.length) return;

  const shortlist = matches.slice(0, 3);
  const body = shortlist
    .map(property => {
      const priceLabel =
        property.tenure === "rent"
          ? `${formatCurrency(property.rent)} / ${property.rentalFrequency || "month"}`
          : formatCurrency(property.price);
      const beds = property.bedrooms ? `${property.bedrooms} bed | ${property.bathrooms} bath` : `${property.bathrooms} bath`;
      return `🏘️ ${property.name} (${property.location})\nType: ${property.type}\n${beds}\nPrice: ${priceLabel}\nRef: ${property.id}\nKey: ${property.amenities.slice(0, 3).join(", ")}`;
    })
    .join("\n\n");

  try {
    await sendWhatsAppMessage({
      to,
      text: {
        body: `Here are options that match what you described:\n\n${body}\n\nReply with a reference ID for full details or to arrange a viewing.`
      }
    });

    const primaryProperty = shortlist[0];
    const primaryImage = primaryProperty?.images?.[0] || primaryProperty?.image;
    if (primaryImage) {
      await sendWhatsAppMessage({
        to,
        type: "image",
        image: {
          link: primaryImage,
          caption: `${primaryProperty.name} – ${primaryProperty.location}`
        }
      });
    }

    if (preferences.intents?.includes("virtual_tour") && primaryProperty?.virtualTour) {
      await sendWhatsAppMessage({
        to,
        text: {
          body: `Virtual tour for ${primaryProperty.name}: ${primaryProperty.virtualTour}`
        }
      });
    }
  } catch (error) {
    console.log("Property suggestion send error:", error.response?.data || error.message);
  }
}

async function sendNoInventoryMessage(to) {
  try {
    await sendWhatsAppMessage({
      to,
      text: {
        body:
          "I don’t have that exact inventory available yet, but I’ve flagged it for our brokerage team. Can I note your ideal specs so we alert you first?"
      }
    });
  } catch (error) {
    console.log("No inventory message error:", error.response?.data || error.message);
  }
}

async function sendViewingScheduler(to) {
  try {
    await sendWhatsAppMessage({
      to,
      text: {
        body:
          "Happy to line up a viewing. Please share two preferred dates/times and the property reference, or use our instant calendar: https://cal.knowledge-innovations.com/viewings"
      }
    });
  } catch (error) {
    console.log("Viewing scheduler message error:", error.response?.data || error.message);
  }
}

async function handleEscalationRequest(to) {
  try {
    await sendWhatsAppMessage({
      to,
      text: {
        body:
          "I’ve looped in a licensed agent. Expect a WhatsApp or phone follow-up within the hour. Anything else I should relay to them?"
      }
    });
    console.log("Escalation flagged for:", to);
  } catch (error) {
    console.log("Escalation message error:", error.response?.data || error.message);
  }
}

// --------------------
// Webhook verification
// --------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// --------------------
// Receive messages
// --------------------
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    let propertyInventory = [];
    try {
      propertyInventory = await propertyService.listProperties({ status: "active" });
    } catch (propertyError) {
      console.log("Property inventory load error:", propertyError.message);
    }

    const preferences = extractPreferences(text || "", propertyInventory);

    console.log("User said:", text);
    console.log("Detected preferences:", preferences);

    // Initialize conversation memory
    if (!userConversations[from]) {
      userConversations[from] = [
        {
          role: "system",
          content: `
You are Knowledge Innovations’ WhatsApp concierge for Ghana real estate.

Core duties:
1. Greet professionally and confirm what the client is searching for (buy/rent, property type, preferred locations).
2. Collect and remember: full name, phone/email if offered, budget (currency + ceiling), location, property type, purpose (buy/rent/invest), timeline, must-have features.
3. Reference the provided portfolio snapshot. Only quote facts that exist in that inventory unless you clearly state you will confirm availability.
4. Answer pricing, availability, and amenity questions in crisp sentences (max 80 words) plus short bullet lists when sharing multiple options.
5. Offer virtual tours or in-person viewings proactively once location, budget, and property type are known. Provide booking instructions when they ask.
6. Escalate to a human agent immediately if the user requests it or seems dissatisfied. Let them know an agent will call/WhatsApp shortly.

Guidelines:
- Be concise, friendly, and consultative.
- Never repeat a question if the answer is already in the conversation history—summarize what you’ve captured instead.
- Close every interaction by confirming next steps (e.g., “I’ll line up two viewings for Thursday—shall I lock in 10am?”).
`
        }
      ];
    }

    // Add user message
    userConversations[from].push({
      role: "user",
      content: text
    });

    // Call OpenAI with full conversation memory + inventory context
    const inventoryContext = buildInventoryContext(propertyInventory, preferences);
    const messagesForOpenAI = [...userConversations[from]];
    messagesForOpenAI.splice(1, 0, {
      role: "system",
      content: inventoryContext
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesForOpenAI
    });

    const aiReply = completion.choices[0].message.content;

    // Save assistant reply
    userConversations[from].push({
      role: "assistant",
      content: aiReply
    });

    // -------------------------
    // Lead Detection & Scoring
    // -------------------------

    const conversationHistory = userConversations[from]
      .map(msg => msg.content)
      .join(" ");

    const conversationText = conversationHistory.toLowerCase();

// -------------------------
// Structured Lead Extraction
// -------------------------

const structuredExtraction = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: `
Extract the following details from the conversation.
Return ONLY valid JSON with these keys:
name, budget, location, type, timeline.

If a field is missing, return null for that field.
Do not explain anything.
`
    },
    {
      role: "user",
      content: conversationText
    }
  ],
  response_format: { type: "json_object" }
});

const structuredLead = JSON.parse(
  structuredExtraction.choices[0].message.content
);

console.log("📦 Structured Lead:", structuredLead);

if (!structuredLead.location && preferences.location) {
  structuredLead.location = preferences.location;
}
if (!structuredLead.type && preferences.propertyType) {
  structuredLead.type = preferences.propertyType;
}
if (!structuredLead.budget && preferences.budgetMax) {
  structuredLead.budget = formatCurrency(preferences.budgetMax);
}
if (!structuredLead.timeline && preferences.timeline) {
  structuredLead.timeline = preferences.timeline;
}
    let leadScore = 0;
    if (structuredLead.name) leadScore += 20;
    if (structuredLead.budget) leadScore += 20;
    if (structuredLead.location) leadScore += 20;
    if (structuredLead.type) leadScore += 20;
    if (structuredLead.timeline) leadScore += 20;

    if (leadScore >= 80) {
      const timestamp = new Date().toISOString();
      const leadRecord = {
        id: generateLeadId(from),
        phone: from,
        details: structuredLead,
        score: leadScore,
        summary: conversationHistory,
        source: "whatsapp",
        status: "pending_sync",
        createdAt: timestamp,
        updatedAt: timestamp
      };

      qualifiedLeads[from] = leadRecord;
      console.log("🔥 QUALIFIED LEAD (pending persistence):", leadRecord);

      let leadPersisted = false;
      try {
        await leadService.addLead(leadRecord);
        leadPersisted = true;
        console.log("✅ Lead persisted to datastore", leadRecord.id);
      } catch (storageError) {
        console.log("Lead persistence error:", storageError.message);
      }

      try {
        await syncLeadToDynamics(leadRecord);
        if (leadPersisted) {
          await leadService.updateLeadStatus(leadRecord.id, "synced");
        }
      } catch (crmError) {
        console.log("CRM sync error:", crmError.response?.data || crmError.message);
        if (leadPersisted) {
          await leadService.updateLeadStatus(leadRecord.id, "sync_failed", {
            lastSyncError: crmError.message
          });
        }
      }
    }



    // -------------------------
    // Send WhatsApp Reply
    // -------------------------

    await sendWhatsAppMessage({
      to: from,
      text: { body: aiReply }
    });

    const propertyMatches = getPropertyMatches(propertyInventory, preferences);
    const propertyIntentTriggered = [
      "property_search",
      "pricing",
      "availability"
    ].some(intent => preferences.intents?.includes(intent)) || preferences.wantsImage;

    if (propertyIntentTriggered) {
      if (propertyMatches.length) {
        await sendPropertySuggestions({ to: from, matches: propertyMatches, preferences });
      } else {
        await sendNoInventoryMessage(from);
      }
    }

    if (preferences.wantsViewing) {
      await sendViewingScheduler(from);
    }

    if (preferences.escalateRequest) {
      await handleEscalationRequest(from);
    }

    res.sendStatus(200);

  } catch (error) {
    console.log("Webhook error:", error.response?.data || error.message);
    res.sendStatus(200);
  }
});

app.get("/admin/properties", async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  const filters = {
    status: req.query.status,
    city: req.query.city,
    type: req.query.type
  };

  try {
    const properties = await propertyService.listProperties(filters);
    res.json({ data: properties, count: properties.length });
  } catch (error) {
    console.log("Admin property fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch properties" });
  }
});

app.post("/admin/properties", async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  const payload = req.body || {};
  const requiredFields = ["name", "location", "city", "type", "tenure"];
  const missing = requiredFields.filter(field => !payload[field]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
  }

  const normalizedPayload = {
    ...payload,
    price: toOptionalNumber(payload.price),
    rent: toOptionalNumber(payload.rent),
    bedrooms: toOptionalNumber(payload.bedrooms),
    bathrooms: toOptionalNumber(payload.bathrooms),
    amenities: normalizeListInput(payload.amenities),
    images: normalizeListInput(payload.images)
  };

  try {
    const property = await propertyService.addProperty(normalizedPayload);
    res.status(201).json({ data: property });
  } catch (error) {
    console.log("Admin property create error:", error.message);
    res.status(500).json({ error: "Failed to create property" });
  }
});

app.patch("/admin/properties/:id", async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  const payload = {
    ...req.body,
    price: req.body?.price !== undefined ? toOptionalNumber(req.body.price) : undefined,
    rent: req.body?.rent !== undefined ? toOptionalNumber(req.body.rent) : undefined,
    bedrooms: req.body?.bedrooms !== undefined ? toOptionalNumber(req.body.bedrooms) : undefined,
    bathrooms: req.body?.bathrooms !== undefined ? toOptionalNumber(req.body.bathrooms) : undefined
  };

  if (req.body?.amenities !== undefined) {
    payload.amenities = normalizeListInput(req.body.amenities);
  }

  if (req.body?.images !== undefined) {
    payload.images = normalizeListInput(req.body.images);
  }

  try {
    const updated = await propertyService.updateProperty(req.params.id, payload);
    if (!updated) {
      return res.status(404).json({ error: "Property not found" });
    }
    res.json({ data: updated });
  } catch (error) {
    console.log("Admin property update error:", error.message);
    res.status(500).json({ error: "Failed to update property" });
  }
});

app.delete("/admin/properties/:id", async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  try {
    const archived = await propertyService.archiveProperty(req.params.id);
    if (!archived) {
      return res.status(404).json({ error: "Property not found" });
    }
    res.json({ data: archived });
  } catch (error) {
    console.log("Admin property archive error:", error.message);
    res.status(500).json({ error: "Failed to archive property" });
  }
});

app.get("/admin/leads", async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  const filters = {
    status: req.query.status,
    minScore: req.query.minScore ? Number(req.query.minScore) : undefined,
    startDate: req.query.startDate,
    endDate: req.query.endDate
  };

  if (Number.isNaN(filters.minScore)) {
    delete filters.minScore;
  }

  try {
    const leads = await leadService.listLeads(filters);
    res.json({ data: leads, count: leads.length });
  } catch (error) {
    console.log("Admin lead fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
