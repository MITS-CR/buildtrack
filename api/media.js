/**
 * BuildTrack Media API
 * Handles upload, retrieval, filtering, and deletion of media files.
 * Storage: Azure Blob Storage (binaries) + Azure Cosmos DB (metadata)
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

// ── Azure clients (lazy-init to avoid crash when env vars are missing) ────────
let blobServiceClient, containerClient, cosmosClient, database, cosmosContainer;

function initAzureClients() {
  if (!process.env.STORAGE_CONNECTION_STRING) {
    throw new Error('STORAGE_CONNECTION_STRING is not configured. Add it in Azure App Service → Environment variables.');
  }
  if (!blobServiceClient) {
    blobServiceClient = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING);
    containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER_NAME || 'media');
  }
  if (!cosmosClient) {
    cosmosClient = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
    database = cosmosClient.database(process.env.COSMOS_DATABASE || 'buildtrack');
    cosmosContainer = database.container(process.env.COSMOS_CONTAINER || 'media');
  }
}

// ── Multer — memory storage (stream directly to Blob) ─────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
  fileFilter: (req, file, cb) => {
    const allowed = /^(image|video)\//;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image and video files are allowed'));
  },
});

// ── Helper: ensure Blob container exists ─────────────────────────────────────
async function ensureContainer() {
  initAzureClients();
  await containerClient.createIfNotExists({ access: 'blob' });
}

// ── Helper: ensure Cosmos container exists ───────────────────────────────────
async function ensureCosmosContainer() {
  initAzureClients();
  await database.containers.createIfNotExists({
    id: process.env.COSMOS_CONTAINER || 'media',
    partitionKey: { paths: ['/projectId'] },
  });
}

// ── POST /api/media/upload ────────────────────────────────────────────────────
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    await ensureContainer();
    await ensureCosmosContainer();

    const {
      projectId = 'MITS-2026-041',
      week = 'Week 12',
      category = 'photo', // drone | interior | exterior | mep | photo
      uploadedBy = 'Unknown',
      notes = '',
    } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const results = [];

    for (const file of req.files) {
      const id = uuidv4();
      const ext = file.originalname.split('.').pop().toLowerCase();
      const blobName = `${projectId}/${week.replace(/\s/g, '-')}/${id}.${ext}`;
      const isVideo = file.mimetype.startsWith('video/');

      // Upload to Azure Blob
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype },
      });

      const url = blockBlobClient.url;

      // Save metadata to Cosmos DB
      const metadata = {
        id,
        projectId,
        week,
        category: isVideo ? (category === 'drone' ? 'drone' : 'video') : category,
        type: isVideo ? 'video' : 'photo',
        originalName: file.originalname,
        blobName,
        url,
        size: file.size,
        mimetype: file.mimetype,
        uploadedBy,
        notes,
        uploadedAt: new Date().toISOString(),
        featured: false,
      };

      await cosmosContainer.items.create(metadata);
      results.push({ id, url, originalName: file.originalname, type: metadata.type });
    }

    res.status(201).json({ uploaded: results.length, files: results });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/media ─────────────────────────────────────────────────────────────
// Query params: projectId, week, category, type, limit, offset
router.get('/', async (req, res) => {
  try {
    await ensureCosmosContainer();

    const {
      projectId = 'MITS-2026-041',
      week,
      category,
      type,
      limit = 100,
      offset = 0,
    } = req.query;

    let query = 'SELECT * FROM c WHERE c.projectId = @projectId';
    const parameters = [{ name: '@projectId', value: projectId }];

    if (week) {
      query += ' AND c.week = @week';
      parameters.push({ name: '@week', value: week });
    }
    if (category && category !== 'all') {
      query += ' AND c.category = @category';
      parameters.push({ name: '@category', value: category });
    }
    if (type) {
      query += ' AND c.type = @type';
      parameters.push({ name: '@type', value: type });
    }

    query += ' ORDER BY c.uploadedAt DESC';
    query += ` OFFSET ${parseInt(offset)} LIMIT ${parseInt(limit)}`;

    const { resources: items } = await cosmosContainer.items
      .query({ query, parameters })
      .fetchAll();

    res.json({ total: items.length, items });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/media/stats ───────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    await ensureCosmosContainer();

    const { projectId = 'MITS-2026-041' } = req.query;

    const { resources: allItems } = await cosmosContainer.items
      .query({
        query: 'SELECT c.category, c.type, c.size, c.week FROM c WHERE c.projectId = @projectId',
        parameters: [{ name: '@projectId', value: projectId }],
      })
      .fetchAll();

    const totalFiles = allItems.length;
    const totalSize = allItems.reduce((sum, i) => sum + (i.size || 0), 0);
    const droneFlights = allItems.filter(i => i.category === 'drone' && i.type === 'video').length;
    const albums = new Set(allItems.map(i => i.week)).size;
    const byCategory = allItems.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {});
    const byWeek = allItems.reduce((acc, i) => {
      acc[i.week] = (acc[i.week] || 0) + 1;
      return acc;
    }, {});

    res.json({
      totalFiles,
      totalSizeBytes: totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      droneFlights,
      albums,
      byCategory,
      byWeek,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/media/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    await ensureCosmosContainer();
    const { resources } = await cosmosContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: req.params.id }],
      })
      .fetchAll();

    if (!resources.length) return res.status(404).json({ error: 'Not found' });
    res.json(resources[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/media/:id ───────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    await ensureCosmosContainer();
    const { resources } = await cosmosContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: req.params.id }],
      })
      .fetchAll();

    if (!resources.length) return res.status(404).json({ error: 'Not found' });

    const updated = { ...resources[0], ...req.body, id: resources[0].id };
    const { resource } = await cosmosContainer.items.upsert(updated);
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/media/:id ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await ensureCosmosContainer();

    const { resources } = await cosmosContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: req.params.id }],
      })
      .fetchAll();

    if (!resources.length) return res.status(404).json({ error: 'Not found' });

    const item = resources[0];

    // Delete from Blob Storage
    initAzureClients();
    const blockBlobClient = containerClient.getBlockBlobClient(item.blobName);
    await blockBlobClient.deleteIfExists();

    // Delete from Cosmos
    await cosmosContainer.item(item.id, item.projectId).delete();

    res.json({ deleted: true, id: item.id });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Utility ───────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

module.exports = router;
