import "dotenv/config";
import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";

const app = express();

// In-memory storage
const jobs = {};
const receivedEvents = new Set();

app.use(express.json());

// Multer config for file uploads (memory storage for Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
});

// Helper to log with timestamp
const log = (msg) => {
  console.log(`[${new Date().toISOString()}] ${msg}`);
};

// GET / - Health check
app.get("/", (req, res) => {
  res.send("LlamaParse Webhook Test Server is Running!");
});

// GET /jobs - List all jobs
app.get("/jobs", (req, res) => {
  res.json(Object.values(jobs));
});

// GET /jobs/:id - Get specific job status
app.get("/jobs/:id", (req, res) => {
  const job = jobs[req.params.id];

  if (!job) {
    return res.status(404).json({
      error: "Job not found",
    });
  }

  res.json({
    internalJobId: job.internalJobId,
    llamaJobId: job.llamaJobId,
    status: job.status,
    events: job.webhookEvents,
    parsedContent: job.parsedContent,
    webhookReceived: job.webhookEvents.length > 0,
    createdAt: job.createdAt,
  });
});

// POST /upload - Upload file to LlamaParse
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded",
      });
    }

    if (!process.env.LLAMA_CLOUD_API_KEY) {
      return res.status(500).json({
        error: "LLAMA_CLOUD_API_KEY is not configured",
      });
    }

    if (!process.env.PUBLIC_BASE_URL) {
      return res.status(500).json({
        error: "PUBLIC_BASE_URL is not configured",
      });
    }

    log("Upload received");

    const internalJobId = uuidv4();

    const form = new FormData();

    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const webhookConfig = [
      {
        webhook_url: `${process.env.PUBLIC_BASE_URL}/webhook`,
        webhook_events: [
          "parse.pending",
          "parse.success",
          "parse.error",
          "parse.partial_success",
          "parse.cancelled",
        ],
        webhook_output_format: "json",
      },
    ];

    form.append(
      "webhook_configurations",
      JSON.stringify(webhookConfig)
    );

    log("Sending file to LlamaParse");

    const response = await axios.post(
      "https://api.cloud.llamaindex.ai/api/v1/parsing/upload",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
        },
      }
    );

    const llamaJobId = response.data.id;

    jobs[internalJobId] = {
      internalJobId,
      llamaJobId,
      fileName: req.file.originalname,
      status: "PROCESSING",
      webhookEvents: [],
      parsedContent: null,
      createdAt: new Date().toISOString(),
    };

    log(`LlamaParse job created: ${llamaJobId}`);

    return res.status(200).json({
      internalJobId,
      llamaJobId,
      status: "PROCESSING",
    });
  } catch (error) {
    log(`Upload failed: ${error.message}`);

    if (error.response) {
      console.error("LlamaParse Error:", error.response.data);
    }

    return res.status(500).json({
      error: "Failed to upload to LlamaParse",
      details: error.message,
      llamaResponse: error.response?.data ?? null,
    });
  }
});

// POST /webhook - Receive LlamaParse webhook events
app.post("/webhook", (req, res) => {
  try {
    const payload = req.body;

    const { event_id, event_type, data } = payload;

    const llamaJobId = data?.job_id || data?.id;

    log(
      `Webhook received: ${event_type || "unknown"} for job ${
        llamaJobId || "unknown"
      }`
    );

    // Prevent duplicate processing
    if (event_id && receivedEvents.has(event_id)) {
      log(`Duplicate webhook ignored: ${event_id}`);

      return res.status(200).json({
        received: true,
        duplicate: true,
      });
    }

    if (event_id) {
      receivedEvents.add(event_id);
    }

    const internalJobId = Object.keys(jobs).find(
      (id) => jobs[id].llamaJobId === llamaJobId
    );

    if (internalJobId) {
      const job = jobs[internalJobId];

      job.webhookEvents.push(payload);

      switch (event_type) {
        case "parse.success":
          job.status = "SUCCESS";

          if (payload.result) {
            job.parsedContent = payload.result;
          }
          break;

        case "parse.error":
          job.status = "ERROR";
          break;

        case "parse.cancelled":
          job.status = "CANCELLED";
          break;

        case "parse.partial_success":
          job.status = "PARTIAL_SUCCESS";
          break;

        case "parse.pending":
          job.status = "PENDING";
          break;

        default:
          break;
      }

      log(`Job ${llamaJobId} updated -> ${job.status}`);
    } else {
      log(`Webhook received for unknown job: ${llamaJobId}`);
    }

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    log(`Webhook processing error: ${error.message}`);

    return res.status(200).json({
      received: true,
    });
  }
});

// Export app for Vercel Serverless Functions
export default app;