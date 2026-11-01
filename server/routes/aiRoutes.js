// Analyse a single image WITHOUT saving it (useful for testing the AI step or a "check first" button).
const router = require('express').Router();
const upload = require('../middleware/uploadMiddleware');
const requireAuth = require('../middleware/authMiddleware');
const { inspect, makeAiSample } = require('../services/imageProcessingService');
const { getProvider, AiError } = require('../services/aiService');
const svc = require('../services/imageService');
const db = require('../config/db');
const { AppError, wrap } = require('../utils/errors');
router.use(requireAuth);

router.post('/analyze', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new AppError(400, 'No file received');
  await inspect(req.file.buffer);
  const cats = await svc.getCategories(req.user.id);
  try { res.json({ result: await getProvider().analyze(await makeAiSample(req.file.buffer), cats.map((c) => c.name)) }); }
  catch (e) { throw e instanceof AiError ? new AppError(502, e.message, 'AI_FAILED') : e; }
}));

// ---- AI usage statistics for the current user ----
router.get('/usage', wrap(async (req, res) => {
  const uid = req.user.id;

  // Lifetime totals
  const [[totals]] = await db.query(
    `SELECT
       COUNT(*)                          AS total_calls,
       COALESCE(SUM(input_tokens),  0)  AS total_input,
       COALESCE(SUM(output_tokens), 0)  AS total_output,
       COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens
     FROM ai_analysis a
     LEFT JOIN images         i  ON i.id  = a.image_id
     LEFT JOIN rejected_images r ON r.id  = a.rejected_image_id
     WHERE i.user_id = ? OR r.user_id = ?`, [uid, uid]);

  // Per-model breakdown
  const [byModel] = await db.query(
    `SELECT
       a.provider,
       COUNT(*)                          AS calls,
       COALESCE(SUM(a.input_tokens),  0) AS input_tokens,
       COALESCE(SUM(a.output_tokens), 0) AS output_tokens,
       COALESCE(SUM(a.input_tokens + a.output_tokens), 0) AS total_tokens
     FROM ai_analysis a
     LEFT JOIN images         i  ON i.id  = a.image_id
     LEFT JOIN rejected_images r ON r.id  = a.rejected_image_id
     WHERE i.user_id = ? OR r.user_id = ?
     GROUP BY a.provider ORDER BY calls DESC`, [uid, uid]);

  // Recent 10 calls
  const [recent] = await db.query(
    `SELECT
       a.provider, a.verdict, a.suggested_category AS category,
       a.input_tokens, a.output_tokens,
       COALESCE(i.original_filename, r.original_filename) AS filename,
       a.created_at
     FROM ai_analysis a
     LEFT JOIN images         i  ON i.id  = a.image_id
     LEFT JOIN rejected_images r ON r.id  = a.rejected_image_id
     WHERE i.user_id = ? OR r.user_id = ?
     ORDER BY a.id DESC LIMIT 10`, [uid, uid]);

  res.json({ totals, byModel, recent });
}));

module.exports = router;
