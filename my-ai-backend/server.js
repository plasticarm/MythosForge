// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors()); // Allows your website to talk to this backend
app.use(express.json());

// 1. Setup Gemini with your hidden key
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

app.post('/chat', async (req, res) => {
    try {
        // 2. Select the model (Use the one from your AI Studio export)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            // Paste your 'systemInstruction' from AI Studio here if you have one
            systemInstruction: "You are a helpful assistant..." 
        });

        const { message } = req.body;

        // 3. Generate Content
        const result = await model.generateContent(message);
        const response = await result.response;
        const text = response.text();

        res.json({ reply: text });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Something went wrong" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));