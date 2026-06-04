import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const port = process.env.PORT || 3000;

// In-memory storage
const jobs = {};
const receivedEvents = new Set();

app.use(express.json());

// Multer config for file uploads
const upload = multer({ dest: 'uploads/' });

// Helper to log with timestamp
const log = (msg) => {
  console.log(`[${new Date().toISOString()}] ${msg}`);
};

// GET / - Health check
app.get('/', (req, res) => {
  res.send('LlamaParse Webhook Test Server is Running!');
});

// GET /jobs - List all jobs
app.get('/jobs', (req, res) => {
  res.json(Object.values(jobs));
});

// GET /jobs/:id - Get specific job status
app.get('/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    internalJobId: job.internalJobId,
    llamaJobId: job.llamaJobId,
    status: job.status,
    events: job.webhookEvents,
    parsedContent: job.parsedContent,
    webhookReceived: job.webhookEvents.length > 0
  });
});

// POST /upload - Upload file to LlamaParse
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    log('Upload received');
    const internalJobId = uuidv4();
    const fileName = req.file.originalname;

    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path), {
      filename: fileName,
      contentType: req.file.mimetype,
    });

    const webhookConfig = [
      {
        webhook_url: `${process.env.PUBLIC_BASE_URL}/webhook`,
        webhook_events: [
          'parse.pending',
          'parse.success',
          'parse.error',
          'parse.partial_success',
          'parse.cancelled'
        ],
        webhook_output_format: 'json'
      }
    ];

    form.append('webhook_configurations', JSON.stringify(webhookConfig));

    log('File sent to LlamaParse');
    const response = await axios.post('https://api.cloud.llamaindex.ai/api/v1/parsing/upload', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`
      }
    });

    const llamaJobId = response.data.id;
    log(`Llama job created: ${llamaJobId}`);

    // Initialize job in memory
    jobs[internalJobId] = {
      internalJobId,
      llamaJobId,
      fileName,
      status: 'PROCESSING',
      webhookEvents: [],
      parsedContent: null,
      createdAt: new Date().toISOString()
    };

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      internalJobId,
      llamaJobId,
      status: 'PROCESSING'
    });
  } catch (error) {
    log(`Error during upload: ${error.message}`);
    if (error.response) {
      console.error(error.response.data);
    }
    res.status(500).json({ error: 'Failed to upload to LlamaParse', details: error.message });
  }
});

// POST /webhook - Receive LlamaParse webhooks
app.post('/webhook', (req, res) => {
  const payload = req.body;
  const { event_id, event_type, data } = payload;
  const llamaJobId = data?.job_id || data?.id;

  log(`Webhook received: ${event_type} for job ${llamaJobId}`);
  
  // Prevent duplicate processing
  if (receivedEvents.has(event_id)) {
    log(`Duplicate event detected: ${event_id}`);
    return res.status(200).send('Duplicate');
  }
  receivedEvents.add(event_id);

  // Find job by llamaJobId
  const internalJobId = Object.keys(jobs).find(id => jobs[id].llamaJobId === llamaJobId);
  
  if (internalJobId) {
    const job = jobs[internalJobId];
    job.webhookEvents.push(payload);
    
    log(`Job status updated for ${llamaJobId}: ${event_type}`);

    if (event_type === 'parse.success') {
      job.status = 'SUCCESS';
      // If result is included in payload (LlamaParse sometimes sends result in success webhook)
      if (payload.result) {
        job.parsedContent = payload.result;
      }
    } else if (event_type === 'parse.error') {
      job.status = 'ERROR';
    } else if (event_type === 'parse.cancelled') {
      job.status = 'CANCELLED';
    }
  } else {
    log(`Warning: Received webhook for unknown job ID ${llamaJobId}`);
  }

  // Return 200 quickly
  res.status(200).json({ received: true });
});

app.listen(port, () => {
  log(`Server running on port ${port}`);
  log(`Public base URL: ${process.env.PUBLIC_BASE_URL}`);
});
