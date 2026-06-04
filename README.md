# LlamaParse Webhook Test App

A minimal standalone Node.js application to verify LlamaParse webhooks end-to-end.

## Features

- Upload PDF/DOCX/TXT files to LlamaParse.
- Configure real webhooks for LlamaParse events.
- Receive and log actual webhook payloads.
- Track job status and events in-memory.
- Vercel-ready.

## Prerequisites

- Node.js installed.
- LlamaCloud API Key.
- A public URL (e.g., via Vercel or ngrok) for LlamaParse to send webhooks to.

## Local Setup

1. Clone or download this project.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Fill in your `LLAMA_CLOUD_API_KEY`.
5. If testing locally, use `ngrok` to expose your port and set `PUBLIC_BASE_URL`:
   ```bash
   ngrok http 3000
   ```
   Example: `PUBLIC_BASE_URL=https://lllama-webhook-intake.vercel.app`
6. Start the server:
   ```bash
   npm start
   ```

## Vercel Deployment

1. Install Vercel CLI: `npm i -g vercel`.
2. Run `vercel` in the project root.
3. Add environment variables in the Vercel dashboard:
   - `LLAMA_CLOUD_API_KEY`
   - `PUBLIC_BASE_URL` (the URL of your Vercel deployment)
4. Deploy again if needed: `vercel --prod`.

## Postman Testing Instructions

### 1. Upload a File
- **Method:** `POST`
- **URL:** `{{PUBLIC_BASE_URL}}/upload`
- **Body:** `form-data`
  - `file`: (Select a PDF, DOCX, or TXT file)
- **Response:**
  ```json
  {
    "internalJobId": "...",
    "llamaJobId": "...",
    "status": "PROCESSING"
  }
  ```

### 2. Check Job Status
- **Method:** `GET`
- **URL:** `{{PUBLIC_BASE_URL}}/jobs/:internalJobId`
- **Description:** Poll this endpoint to see when `webhookReceived` becomes `true` and the status changes to `SUCCESS`.

### 3. List All Jobs
- **Method:** `GET`
- **URL:** `{{PUBLIC_BASE_URL}}/jobs`

## Endpoints Summary

- `POST /upload`: Uploads file to LlamaParse with webhook config.
- `POST /webhook`: Receives LlamaParse events.
- `GET /jobs`: Lists all jobs and their event history.
- `GET /jobs/:id`: Detailed status of a single job.

## Success Criteria

1. Upload a file.
2. Observe `Upload received` and `Llama job created` in logs.
3. Wait for LlamaParse to process.
4. Observe `Webhook received: parse.success` in logs.
5. Verify job status via `GET /jobs/:id`.
