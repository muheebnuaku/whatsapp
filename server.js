const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "myverifytoken";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory conversation storage
const userConversations = {};

// In-memory lead storage (temporary until DB integration)
const qualifiedLeads = {};

// Lightweight property catalog for conversational flows
const propertyCatalog = [
  {
    id: "ACC-APT-01",
    name: "Skyline Residences",
    location: "Airport Residential, Accra",
    city: "accra",
    type: "apartment",
    tenure: "purchase",
    price: 380000,
    rent: null,
    bedrooms: 3,
    bathrooms: 3,
    amenities: ["Infinity pool", "Gym", "24/7 security"],
    availability: "Immediate",
    virtualTour: "https://example.com/virtual/skyline-residences",
    image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
    description: "Luxury 3-bed apartment minutes from Kotoka International Airport."
  },
  {
    id: "ACC-TH-04",
    name: "Meridian Townhomes",
    location: "East Legon, Accra",
    city: "accra",
    type: "townhouse",
    tenure: "purchase",
    price: 520000,
    rent: null,
    bedrooms: 4,
    bathrooms: 4,
    amenities: ["Private garden", "Solar backup", "Two-car garage"],
    availability: "30 days",
    virtualTour: "https://example.com/virtual/meridian-townhomes",
    image: "https://images.unsplash.com/photo-1501183638710-841dd1904471?auto=format&fit=crop&w=1200&q=80",
    description: "Modern family townhomes near top-rated schools and cafes."
  },
  {
    id: "TEM-APT-11",
    name: "Atlantic View Apartments",
    location: "Community 12, Tema",
    city: "tema",
    type: "apartment",
    tenure: "rent",
    price: null,
    rent: 2800,
    rentalFrequency: "month",
    bedrooms: 2,
    bathrooms: 2,
    amenities: ["Ocean view", "Backup power", "Concierge"],
    availability: "Immediate",
    virtualTour: "https://example.com/virtual/atlantic-view",
    image: "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1200&q=80",
    description: "Fully serviced 2-bed rentals ideal for corporates in Tema harbour zone."
  },
  {
    id: "ACC-COM-07",
    name: "Osu Creative Lofts",
    location: "Osu Oxford Street, Accra",
    city: "accra",
    type: "commercial",
    tenure: "rent",
    price: null,
    rent: 3500,
    rentalFrequency: "month",
    bedrooms: null,
    bathrooms: 2,
    amenities: ["Open-plan", "Meeting pods", "High-speed fiber"],
    availability: "Immediate",
    virtualTour: "https://example.com/virtual/osu-lofts",
    image: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80",
    description: "Flexible commercial lofts for creative teams with branding-friendly frontage."
  },
  {
    id: "ACC-APT-15",
    name: "Lakeside Terraces",
    location: "Cantonments, Accra",
    city: "accra",
    type: "apartment",
    tenure: "purchase",
    price: 450000,
    rent: null,
    bedrooms: 3,
    bathrooms: 3,
    amenities: ["Lake view", "Smart home", "Residents lounge"],
    availability: "60 days",
    virtualTour: "https://example.com/virtual/lakeside-terraces",
    image: "https://images.unsplash.com/photo-1499914485622-a88fac536970?auto=format&fit=crop&w=1200&q=80",
    description: "Boutique residences overlooking the Marina Park lagoon."
  }
];

const LOCATION_KEYWORDS = [
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

const PROPERTY_TYPE_KEYWORDS = {
  apartment: ["apartment", "flat", "condo"],
  townhouse: ["townhouse", "town home"],
  house: ["house", "home", "villa"],
  commercial: ["commercial", "office", "workspace", "shop"],
  land: ["land", "plot", "site"]
};

function formatCurrency(value) {
  if (!value) return "On request";
  return `GHS ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function extractPreferences(message = "") {
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
    "virtual tour"
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

  let location = null;
  for (const keyword of LOCATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      location = keyword;
      break;
    }
  }

  let propertyType = null;
  for (const [type, aliases] of Object.entries(PROPERTY_TYPE_KEYWORDS)) {
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

  const escalateRequest = /human|agent|representative|person|staff/i.test(lower);

  return {
    intents: Array.from(intents),
    location,
    propertyType,
    budgetMax,
    timeline,
    wantsVirtualTour: intents.has("virtual_tour"),
    wantsViewing: intents.has("viewing_request"),
    escalateRequest
  };
}

function getPropertyMatches(preferences = {}) {
  return propertyCatalog.filter(property => {
    if (preferences.location && !property.location.toLowerCase().includes(preferences.location)) {
      return false;
    }
    if (preferences.propertyType && property.type !== preferences.propertyType) {
      return false;
    }
    if (preferences.budgetMax) {
      const priceReference = property.tenure === "rent" ? property.rent : property.price;
      if (priceReference && priceReference > preferences.budgetMax) {
        return false;
      }
    }
    return property.availability !== "Sold";
  });
}

function buildInventoryContext(preferences = {}) {
  const potentialMatches = getPropertyMatches(preferences);
  const featured = (potentialMatches.length ? potentialMatches : propertyCatalog).slice(0, 5);
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
    if (primaryProperty?.image) {
      await sendWhatsAppMessage({
        to,
        type: "image",
        image: {
          link: primaryProperty.image,
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
    const preferences = extractPreferences(text || "");

    if (!text) return res.sendStatus(200);

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
    const inventoryContext = buildInventoryContext(preferences);
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

    const conversationText = userConversations[from]
      .map(msg => msg.content)
      .join(" ")
      .toLowerCase();

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
      if (!qualifiedLeads[from]) {
        qualifiedLeads[from] = {
          phone: from,
          ...structuredLead,
          score: leadScore,
          timestamp: new Date()
        };
        console.log("🔥 QUALIFIED LEAD STORED:", qualifiedLeads[from]);
      }
    }



    // -------------------------
    // Send WhatsApp Reply
    // -------------------------

    await sendWhatsAppMessage({
      to: from,
      text: { body: aiReply }
    });

    const propertyMatches = getPropertyMatches(preferences);
    const propertyIntentTriggered = [
      "property_search",
      "pricing",
      "availability"
    ].some(intent => preferences.intents?.includes(intent));

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
