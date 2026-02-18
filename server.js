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

    console.log("User said:", text);

    // Initialize conversation memory
    if (!userConversations[from]) {
      userConversations[from] = [
        {
          role: "system",
          content: `
You are a professional real estate assistant for Knowledge Innovations.

Your responsibilities:
- Help users search for properties.
- Collect and REMEMBER:
  • Name
  • Budget
  • Location
  • Purchase or Rent
  • Timeline
- DO NOT ask again for information already provided.
- Be short, clear, and professional.
- Once all details are collected, suggest booking a viewing.
`
        }
      ];
    }

    // Add user message
    userConversations[from].push({
      role: "user",
      content: text
    });

    // Call OpenAI with full conversation memory
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: userConversations[from]
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






    const hasLocation =
      conversationText.includes("legon") ||
      conversationText.includes("accra") ||
      conversationText.includes("tema");
    const hasTimeline =
      conversationText.includes("month") ||
      conversationText.includes("week");
    const hasPurchaseType =
      conversationText.includes("purchase") ||
      conversationText.includes("rent");

    let leadScore = 0;
    if (hasBudget) leadScore += 25;
    if (hasLocation) leadScore += 25;
    if (hasTimeline) leadScore += 25;
    if (hasPurchaseType) leadScore += 25;

    if (leadScore >= 75) {
      if (!qualifiedLeads[from]) {
        qualifiedLeads[from] = {
          phone: from,
          score: leadScore,
          summary: conversationText,
          timestamp: new Date()
        };

        console.log("🔥 QUALIFIED LEAD STORED:", qualifiedLeads[from]);
      }
    }

let leadScore = 0;

if (structuredLead.name) leadScore += 20;
if (structuredLead.budget) leadScore += 20;
if (structuredLead.location) leadScore += 20;
if (structuredLead.type) leadScore += 20;
if (structuredLead.timeline) leadScore += 20;

if (leadScore >= 80) {
  console.log("🔥 QUALIFIED LEAD:", {
    phone: from,
    ...structuredLead,
    score: leadScore
  });
}



    // -------------------------
    // Send WhatsApp Reply
    // -------------------------

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: aiReply }
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.sendStatus(200);

  } catch (error) {
    console.log("Webhook error:", error.response?.data || error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
