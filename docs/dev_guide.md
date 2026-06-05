# Developer Guide: LlamaParse Webhook Intake Service

This guide explains how the service works end-to-end: from file upload, to LlamaParse job creation, to webhook event handling, and status tracking.

## 1) What this service does

This app is a small Express service that:

- accepts file uploads from a client,
- forwards files to LlamaParse,
- registers webhook callbacks with LlamaParse,
- receives parse lifecycle events from LlamaParse,
- stores job/event state in memory,
- exposes APIs to inspect job status and parsed output.

Core file: `src/index.js`

## 2) Architecture overview

The flow is:

1. Client uploads a file to `POST /upload`.
2. Service validates env vars and file presence.
3. Service sends the file to `https://api.cloud.llamaindex.ai/api/v1/parsing/upload`.
4. Service includes webhook configuration with callback URL: `${PUBLIC_BASE_URL}/webhook`.
5. LlamaParse starts processing and emits events (e.g., `parse.pending`, `parse.success`, `parse.error`).
6. LlamaParse calls `POST /webhook` with event payloads.
7. Service deduplicates events by `event_id`, updates in-memory job state, and stores event history.
8. Client polls `GET /jobs/:id` or `GET /jobs` for status and results.

## 3) Project setup (local)

### Prerequisites

- Node.js 18+
- npm
- LlamaCloud API key (`LLAMA_CLOUD_API_KEY`)
- Public callback URL (`PUBLIC_BASE_URL`) reachable by LlamaParse
  - For local development, use ngrok or cloud deployment.

### Install

```bash
cd your-project-directory
npm install
```

### Configure environment

```bash
cp .env.example .env
```

Set values in `.env`:

```env
LLAMA_CLOUD_API_KEY=your_api_key
PUBLIC_BASE_URL=https://your-public-url.example
PORT=3000
```

### Start the service

```bash
npm start
```

Health check:

```bash
curl http://localhost:3000/
```

Expected response:

```text
LlamaParse Webhook Test Server is Running!
```

## 4) API reference

### `POST /upload`

Uploads one file and creates a LlamaParse job.

- Content type: `multipart/form-data`
- Field name: `file`

Example:

```bash
curl -X POST http://localhost:3000/upload \
  -F "file=@/absolute/path/to/sample.pdf"
```

Success response (200):

```json
{
  "internalJobId": "...",
  "llamaJobId": "...",
  "status": "PROCESSING"
}
```

Possible failures:

- `400`: no file uploaded
- `500`: missing env vars (`LLAMA_CLOUD_API_KEY` or `PUBLIC_BASE_URL`)
- `500`: upstream upload failure to LlamaParse

### `POST /webhook`

Receives LlamaParse webhook events.

Behavior:

- Treats the webhook request body as `payload` (top-level object). It reads `event_id`, `event_type`, and `data` from that object and also uses `payload.result` when present.
- Determines LlamaParse job ID from `data.job_id` or `data.id`.
- Skips duplicate webhook events by checking `event_id` in `receivedEvents` set.
- Finds matching local job by `llamaJobId`.
- Appends event payload to `job.webhookEvents`.
- Maps event type to local status:
  - `parse.pending` -> `PENDING`
  - `parse.success` -> `SUCCESS`
  - `parse.error` -> `ERROR`
  - `parse.partial_success` -> `PARTIAL_SUCCESS`
  - `parse.cancelled` -> `CANCELLED`
- Stores parsed data in `job.parsedContent` when `event_type` is `parse.success` and `payload.result` exists.

Response is always `200` with `{ "received": true }` to avoid repeated webhook retries caused by non-2xx responses.

### `GET /jobs`

Returns all tracked jobs from in-memory storage.

### `GET /jobs/:id`

Returns one job with:

- `internalJobId`
- `llamaJobId`
- `status`
- `events`
- `parsedContent`
- `webhookReceived`
- `createdAt`

`404` if job ID is unknown.

## 5) In-memory data model

### `jobs` object

`jobs` is a key-value map:

- key: `internalJobId`
- value: job record (`llamaJobId`, `status`, `webhookEvents`, `parsedContent`, etc.)

This is process memory only:

- restarting the server clears all jobs,
- this is useful for testing but not production persistence.

### `receivedEvents` set

Stores processed `event_id` values to reduce duplicate event processing.

## 6) Event lifecycle details

Typical path:

1. Upload request accepted -> local status `PROCESSING`.
2. LlamaParse sends `parse.pending` -> local status `PENDING`.
3. LlamaParse sends final event:
   - `parse.success` -> `SUCCESS`
   - after `parse.success`, parsed output is stored in `parsedContent` from `payload.result` when provided
   - `parse.partial_success` -> `PARTIAL_SUCCESS`, or
   - `parse.error` -> `ERROR`, or
   - `parse.cancelled` -> `CANCELLED`.

## 7) Testing webhook flow manually

1. Start server.
2. Upload file using Postman/curl.
3. Capture `internalJobId` from response.
4. Poll job status:

```bash
curl http://localhost:3000/jobs/<internalJobId>
```

5. Check server logs for:
   - `Upload received`
   - `Sending file to LlamaParse`
   - `LlamaParse job created: ...`
   - `Webhook received: ...`

## 8) Deployment notes (Vercel)

- `vercel.json` routes all traffic to `src/index.js`.
- Keep environment variables configured in the Vercel project settings:
  - `LLAMA_CLOUD_API_KEY`
  - `PUBLIC_BASE_URL` (must match deployed public URL)

## 9) Troubleshooting

### No webhook events received

- Verify `PUBLIC_BASE_URL` is public and correct.
- Confirm webhook endpoint is reachable: `POST <PUBLIC_BASE_URL>/webhook`.
- Check that deployment URL has HTTPS and no auth wall.

### `Failed to upload to LlamaParse`

- Validate API key.
- Confirm file is supported and not empty.
- Inspect `llamaResponse` in error payload for upstream details.

### Job stays in `PROCESSING`/`PENDING`

- LlamaParse may still be processing.
- Check logs for webhook delivery.
- Ensure app instance that receives `/upload` is the same runtime receiving `/webhook` (important for in-memory state).

## 10) Current limitations and future hardening ideas

Current implementation is intentionally minimal.

For production-grade usage consider:

- persistent storage (DB/Redis) instead of in-memory state,
- webhook signature validation/authentication,
- TTL cleanup for old jobs/events,
- retry monitoring and observability dashboards,
- idempotency strategy beyond process-local memory.
