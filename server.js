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

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// Receive messages
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("User said:", text);

    // 🔹 Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are a professional real estate assistant for Knowledge Innovations.
You help users find properties.
Always ask:
- Budget
- Location
- Purchase or Rent
- Timeline
Capture their name politely.
Keep responses short and professional.
Guide conversation toward booking a viewing.
`
        },
        {
          role: "user",
          content: text
        }
      ]
    });

    const aiReply = completion.choices[0].message.content;

    // 🔹 Send response back to WhatsApp
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
    console.log("Webhook error:", error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
