# MITS BuildTrack

Construction project management platform with a live media library backed by Azure Blob Storage and Azure Cosmos DB.

## Features

- **Media Library** — Upload, view, filter, and delete photos & videos per week/category
- **Dashboard** — Live media stats widget, milestones, budget overview, notifications
- **Azure Blob Storage** — All media files stored securely in `buildtrack` storage account
- **Azure Cosmos DB** — Metadata (uploader, date, category, week, size) stored for fast queries
- **REST API** — Express.js backend with upload, list, stats, and delete endpoints

## Quick Start

```bash
npm install
npm start          # production
npm run dev        # development with nodemon
```

Server runs on **port 3000** by default.

## Environment Variables

Copy `.env.example` to `.env` and fill in your Azure credentials:

```
COSMOS_ENDPOINT=https://...
COSMOS_KEY=...
COSMOS_DATABASE=buildtrack
COSMOS_CONTAINER=media

STORAGE_ACCOUNT_NAME=buildtrack
STORAGE_ACCOUNT_KEY=...
STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;...
STORAGE_CONTAINER_NAME=media

PORT=3000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/media/upload` | Upload files (multipart/form-data) |
| `GET` | `/api/media` | List media (filters: projectId, week, category) |
| `GET` | `/api/media/stats` | Aggregate stats (totals, size, by-week) |
| `GET` | `/api/media/:id` | Get single item |
| `PATCH` | `/api/media/:id` | Update metadata |
| `DELETE` | `/api/media/:id` | Delete file + blob |

## Azure Deployment

This app is configured to deploy to:

**Azure Web App:** `buildtrack-gxa3dyc0dkfth6b5.canadacentral-01.azurewebsites.net`

Set all environment variables in **Configuration → Application settings** in the Azure Portal.
