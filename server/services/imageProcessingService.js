const sharp = require('sharp');
const { AppError } = require('../utils/errors');

// Formats sharp can read natively (covers HEIC/HEIF from iPhone, AVIF, GIF, TIFF, BMP)
const ALLOWED_INPUT = ['jpeg', 'png', 'webp', 'heif', 'avif', 'gif', 'tiff', 'bmp'];
// Canonical output formats we store as
const STORE_FORMATS = ['jpeg', 'png', 'webp'];

// We trust decoded bytes, never file extensions or browser-supplied MIME types.
async function inspect(buf) {
  let m;
  try {
    m = await sharp(buf, { limitInputPixels: 300e6 }).metadata();
    await sharp(buf, { limitInputPixels: 300e6 }).resize(16).toBuffer(); // full decode catches corrupt files
  } catch {
    throw new AppError(422, 'This file is corrupted or not a real image', 'CORRUPT');
  }
  if (!ALLOWED_INPUT.includes(m.format)) {
    throw new AppError(415, 'Unsupported image format. Please use JPG, PNG, WEBP, or HEIC.', 'FORMAT');
  }
  return { mime: `image/${m.format === 'heif' ? 'heic' : m.format}`, format: m.format, width: m.width, height: m.height };
}

// Strips sensitive EXIF metadata (GPS latitude/longitude, camera serials, device fingerprints)
// while keeping true orientation and maximum image fidelity.
// HEIC/HEIF/AVIF/GIF/TIFF/BMP are all re-encoded to JPEG for universal compatibility.
async function sanitizeImageBuffer(buf, format) {
  try {
    const pipeline = sharp(buf, { limitInputPixels: 100e6 }).rotate();
    if (format === 'jpeg') {
      return await pipeline.jpeg({ quality: 95, keepMetadata: false }).toBuffer();
    } else if (format === 'png') {
      return await pipeline.png({ compressionLevel: 7 }).toBuffer();
    } else if (format === 'webp') {
      return await pipeline.webp({ quality: 92 }).toBuffer();
    } else {
      // HEIC, HEIF, AVIF, GIF, TIFF, BMP → convert to high-quality JPEG
      return await pipeline.jpeg({ quality: 92, keepMetadata: false }).toBuffer();
    }
  } catch (err) {
    throw new AppError(422, 'Failed to sanitize image structure. Corrupted or invalid payload.', 'UNSAFE_IMAGE');
  }
}

// Return the store format name: HEIC/AVIF/GIF etc all become 'jpeg' after sanitize
function storeFormat(format) {
  return STORE_FORMATS.includes(format) ? format : 'jpeg';
}

const makeThumb = (b) =>
  sharp(b, { limitInputPixels: 300e6 }).rotate().resize(480, 480, { fit: 'inside' }).webp({ quality: 78 }).toBuffer();

// Smaller JPEG sent to AI: cheaper, faster, and EXIF/GPS metadata is completely stripped.
const makeAiSample = (b) =>
  sharp(b, { limitInputPixels: 300e6 }).rotate().resize(768, 768, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();

module.exports = { inspect, sanitizeImageBuffer, storeFormat, makeThumb, makeAiSample };
