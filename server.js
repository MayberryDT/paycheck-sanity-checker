import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// --- CONFIGURATION ---
dotenv.config();
export const app = express();
const port = 3000;

// ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname)); // Serve client files

// --- AI SETUP (NEW SDK) ---
console.log("Loading API Key...", process.env.GEMINI_API_KEY ? "Found" : "MISSING");

// Initialize Client (New Pattern)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- ROUTES ---



app.post('/api/analyze', async (req, res) => {
    console.log("--- New Analysis Request ---");
    try {
        const { prompt, image, mimeType: clientMimeType } = req.body;


        let requestContents;
        if (image) {
            const base64Data = image.split(',')[1] || image;

            // Detect MIME type 
            let detectedMimeType = clientMimeType || 'image/jpeg';

            if (image.startsWith('JVBERi')) {
                detectedMimeType = 'application/pdf';
            } else if (image.startsWith('data:image/png')) {
                detectedMimeType = 'image/png';
            } else if (image.startsWith('data:image/jpeg') || image.startsWith('data:image/jpg')) {
                detectedMimeType = 'image/jpeg';
            }

            console.log(`Using MIME type: ${detectedMimeType}`);

            requestContents = [
                { text: prompt },
                { inlineData: { mimeType: detectedMimeType, data: base64Data } }
            ];
        } else {
            requestContents = [{ text: prompt }];
        }

        // Using stable Gemini model
        const modelName = "gemini-2.0-flash";

        console.log(`Calling Gemini (${modelName})...`);

        const response = await ai.models.generateContent({
            model: modelName,
            contents: [{ parts: requestContents }]
        });

        // Parse Response - handle different SDK response structures
        let rawText;
        try {
            // Try property access first (newer SDK pattern)
            if (typeof response.text === 'string') {
                rawText = response.text;
            } else if (typeof response.text === 'function') {
                rawText = response.text();
            } else if (response.candidates && response.candidates[0]) {
                // Fallback to raw response structure
                rawText = response.candidates[0].content.parts[0].text;
            } else {
                throw new Error("Unable to extract text from response");
            }
        } catch (extractError) {
            console.error("Text extraction error:", extractError.message);
            console.error("Response object keys:", Object.keys(response));
            console.error("Response structure:", JSON.stringify(response, null, 2).substring(0, 500));
            throw new Error("Failed to extract text from AI response: " + extractError.message);
        }

        console.log("Gemini Raw Response Length:", rawText.length);
        console.log("Gemini Raw Response Preview:", rawText.substring(0, 200));

        // Clean JSON - remove markdown fences and trim
        let cleanJson = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        // Attempt to parse JSON
        let parsedResult;
        try {
            parsedResult = JSON.parse(cleanJson);
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError.message);
            console.error("Failed to parse:", cleanJson.substring(0, 500));

            // Return a fallback structured response
            parsedResult = {
                status: "Unclear",
                confidence: "Low",
                coverage: { fields_found: 0, fields_expected: 1, checks_run: 0, checks_possible: 1 },
                estimated_discrepancy: { value: 0.00, currency: "USD", note: "Error", basis: "Parsing failure" },
                tolerance_policy: { gross_tolerance_usd: 1, net_tolerance_usd: 1, note: "Fallback defaults" },
                summary: "AI could not parse the output. Manual review required.",
                extraction: {},
                checks_performed: [{ name: "System Error", result: "Unclear" }],
                earnings_analysis: { status: "Unclear", detail: "Could not verify earnings due to parse error." },
                withholding_analysis: { status: "Unclear", detail: "Could not verify taxes due to parse error." },
                net_analysis: { status: "Unclear", detail: "Could not verify net pay due to parse error." },
                flags: [{ title: "Analysis Error", severity: "High", evidence: "System Error", why_it_matters: "AI response was invalid or missing.", what_to_ask_payroll: "N/A" }],
                action_plan: ["Retry analysis", "Check document quality", "Contact support"],
                payroll_questions: ["Why did the audit fail?", "Is my paystub format standard?", "Can I get a cleaner copy?"],
                watch_next_time: ["Verify document clarity", "Check file format", "Retry upload"],
                limits: ["AI Error"]
            };
        }

        // Validate and ensure required fields exist

        const validatedResult = {
            record_id: parsedResult.record_id || `PSC-${Date.now()}`,

            generated_at: new Date().toISOString(), // Always overwrite AI time with Server time
            status: parsedResult.status || "Unclear",
            confidence: parsedResult.confidence || "Low",
            coverage: parsedResult.coverage || { fields_found: 0, fields_expected: 10, checks_run: 0, checks_possible: 5 },
            estimated_discrepancy: parsedResult.estimated_discrepancy || { value: 0.00, currency: "USD", basis: "N/A", note: "N/A" },
            tolerance_policy: parsedResult.tolerance_policy || { gross_tolerance_usd: 1.00, net_tolerance_usd: 1.00, note: "Standard rounding" },
            summary: parsedResult.summary || "No summary provided.",
            extraction: parsedResult.extraction || {},
            checks_performed: Array.isArray(parsedResult.checks_performed) ? parsedResult.checks_performed : [],
            earnings_analysis: parsedResult.earnings_analysis || { status: "Unclear", detail: "N/A" },
            withholding_analysis: parsedResult.withholding_analysis || { status: "Unclear", detail: "N/A" },
            net_analysis: parsedResult.net_analysis || { status: "Unclear", detail: "N/A" },
            flags: Array.isArray(parsedResult.flags) ? parsedResult.flags : [],
            action_plan: Array.isArray(parsedResult.action_plan) ? parsedResult.action_plan : ["Review findings", "Check limits", "Verify data"],
            payroll_questions: Array.isArray(parsedResult.payroll_questions) ? parsedResult.payroll_questions : ["Is this accurate?", "Please explain calculations", "Any updates?"],
            watch_next_time: Array.isArray(parsedResult.watch_next_time) ? parsedResult.watch_next_time : ["Check next paystub", "Monitor hours", "Verify rates"],
            limits: Array.isArray(parsedResult.limits) ? parsedResult.limits : []
        };

        console.log("Sending validated result:", JSON.stringify(validatedResult).substring(0, 200));
        res.json(validatedResult);

    } catch (error) {
        console.error("Error analyzing paystub:", error);

        // Log to file for debugging
        const logMessage = `[${new Date().toISOString()}] Error: ${error.message}\nStack: ${error.stack}\n\n`;
        fs.appendFileSync('server_error.log', logMessage);

        if (error.response) {
            try {
                const body = await error.response.text();
                console.error("API Response Body:", body);
            } catch (e) {
                console.error("Could not read API error body");
            }
        }

        // Return a structured error response instead of crashing the client
        res.status(500).json({
            status: "Unclear",
            summary: "Unable to complete analysis due to a server error.",
            payroll_questions: ["Please try again later."],
            error: error.message
        });
    }
});

// --- START ---
// Only listen if run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('server.js')) {
    app.listen(port, () => {
        console.log(`\n--- PAYCHECK SANITY CHECKER ---`);
        console.log(`Server running at http://localhost:${port}`);
        console.log(`-------------------------------------------\n`);
    });
}
