const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "myverifytoken";
const ACCESS_TOKEN = "EAFrjr5JZALmEBQiq6AJTo0RbKaPKNJYPC1WmShzjAZC66ZA34GDzWMhwX9xLQfZAjHabf3X4fdUcBN6wGs5b6MsuMRWvnmknbhl7xAq7npe0o8nV0JOy8nZBq9nZCKixW1LsQRZCfg7ZCQtiA5f6o2jtQEZCalWkUYu0RqcD4g3PLqB1LsWuaT7hprYcP9SQYAF5lO1m1tbsoR0LADwYNhNvR7FpTFhjWQzz70HaGkUwr0aEpQaGW2K2LMwNY2XRgcuvpZAEevVRnudgY6Wx3rvUtbfXM6";
const PHONE_NUMBER_ID = "957859254083216";

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive messages
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry[0].changes[0].value.messages[0];
    const from = message.from;
    const text = message.text.body;

    console.log("User said:", text);

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: "Hello 👋 Welcome to Knowledge Innovations Real Estate. How can I help you today?" }
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
    console.log("Error:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
