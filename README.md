# 🔒 VaultCloset

> **Zero-Knowledge, AI-Filtered, Hardware-Shredded Private Image Vault**  
> Built with React (Vite) + Express (Node 20+) + MySQL 8+. Encrypted with **AES-256-GCM**, checked by Vision AI models, protected by **DoD 5220.22-M 3-Pass Secure Shredding**, and stored strictly on **your own private disk**.

---

## 🌟 Key Features

### 🛡️ 1. Cryptographic Security & Envelope Encryption
- **AES-256-GCM Envelope Encryption**: Every uploaded photo and thumbnail receives its own unique 256-bit Data Encryption Key (DEK). The DEK is encrypted ("wrapped") with the server `MASTER_KEY`.
- **Zero-Knowledge File Storage**: Images are stored on disk as opaque `.enc` files named with random UUIDs. Original filenames, extensions, and metadata are **never** written to disk unencrypted.
- **Expiring Single-Use View Tokens**: Images are decrypted strictly in memory and streamed via 60-second, single-use signed tokens (`/api/media/:token`). No raw keys or physical paths ever reach the browser.
- **Anti-Sharing Isolation**: Strict user-boundary enforcement. Image tokens are bound to the user's authenticated ID; cross-user viewing or URL sharing is strictly blocked.

### 🔥 2. Military-Grade Secure Shredding (DoD 5220.22-M)
- **Zero Forensic Recovery**: Standard file deletion leaves magnetic/flash sector traces readable by tools like Recuva, photorec, TestDisk, or Autopsy. VaultCloset eliminates this completely:
  - **Pass 1**: Overwrite entire file with cryptographically secure random bytes (`crypto.randomBytes`).
  - **Pass 2**: Overwrite entire file with inverted binary pattern (`0xAA`).
  - **Pass 3**: Overwrite entire file with fresh cryptographic random bytes.
  - **Hardware Sync**: Calls `handle.sync()` to force write flushes directly to physical storage.
  - **Metadata Obfuscation & Wipe**: File is truncated to 0 bytes, renamed to a random UUID to wipe filesystem directory entries (MFT/inodes), and unlinked.
- Applied automatically to single deletes, bulk deletes, folder removals, rejected image discards, and expired image purges.

### 🚫 3. Anti-Hacker & Enterprise Attack Defenses
- **Anti-Brute-Force & Credential Stuffing Lockout**: 5 failed login attempts trigger an immediate 15-minute IP & account lockout.
- **Constant-Time Verification (Anti-Timing Attacks)**: Compares passwords against a pre-computed `DUMMY_HASH` when an account does not exist, eliminating timing discrepancies that allow hackers to enumerate registered email addresses.
- **Strong Password Policy**: Requires 10+ characters with mixed case, numbers, and symbols; rejects common dictionary passwords.
- **Hardened HTTP Headers (Helmet)**:
  - `Strict-Transport-Security (HSTS)`: `max-age=31536000; includeSubDomains; preload`
  - `Cross-Origin-Opener-Policy (COOP)`: `same-origin`
  - `Cross-Origin-Resource-Policy (CORP)`: `same-origin`
  - `X-Frame-Options: DENY` & CSP `frame-ancestors 'none'` (Anti-Clickjacking)
  - `Permissions-Policy`: Blocks camera, microphone, geolocation, payment, USB, and screen capture.
- **Zero-Cache RAM Shielding**: All `/api/*` endpoints serve `Cache-Control: no-store, no-cache, must-revalidate, private` to prevent private images or tokens from being saved in browser disk caches or proxy servers.
- **Decompression Bomb (Pixel Flood) Guard**: Input limited to `100e6` pixels to prevent memory exhaustion DoS attacks.
- **Universal Input Sanitizer**: Blocks null bytes (`\0`), directory traversal (`..`), and prototype pollution (`__proto__`, `constructor`, `prototype`).
- **Metadata Scrubbing**: Re-encodes all uploads to strip GPS coordinates, camera serials, and device fingerprints.

### 📁 4. User-Owned Folders & 2-Factor Folder Security
- **Zero-Knowledge Category Name Encryption**: Category names are encrypted in MySQL using user-bound AES-256-GCM. An attacker with database access or a username cannot discover or enumerate what categories/folders the user owns.
- **Fully Customizable Categories**: Clean, per-user owned categories. Rename, delete, and organize folders freely without global restrictions.
- **Category PIN / Password Lock**: Lock sensitive folders with a separate password. Includes folder-level brute-force lockout (5 attempts -> 10-minute folder lock).
- **2-Factor Category Deletion**: Deleting a protected folder requires **both** the User Account Password **and** the Category Password to prevent accidental or unauthorized loss. Images inside are automatically transferred to a safe fallback folder.

### 📱 5. Mobile Sensitivity & Local Wi-Fi QR Access
- **Instant Wi-Fi Mobile Connect**: Scan a dynamic QR code on the desktop screen to instantly open the vault on any mobile phone on the same Wi-Fi network without typing IP addresses.
- **Universal Mobile Media Support**: Full support for native iPhone camera formats (`image/heic`, `image/heif`), modern Android formats (`image/avif`, `image/webp`), and standard formats (`image/jpeg`, `image/png`).
- **Mobile Touch Optimization**: Anti-touch-callout controls, responsive grid layouts, and smooth mobile gallery navigation.

### 🤖 6. AI Safety Moderation & Token Tracking
- **Automated Safety Screening**: Uploaded photos are verified by Vision AI models (DeepSeek, OpenAI, or Mock).
- **Fail-Closed Architecture**: If the AI inspection service is unreachable, uploads fail safely without leaking uninspected content into the vault.
- **Rejected Quarantine**: Flagged images are held in a separate temporary quarantine area with an auto-expiry timer (`REJECTED_TTL_HOURS`) or manual review.
- **Token Usage Dashboard**: Live telemetry tracking AI scans, input tokens, output tokens, and per-model consumption in Settings.

### 🔒 7. Privacy Shield & Inactivity Lock
- **Idle Inactivity Auto-Lock**: Configurable auto-lock timer (2, 5, 10, 15, 30 mins) with a blurred privacy screen requiring the account password to unlock.
- **Anti-Screenshot Deterrence**: Disables right-click context menus and image dragging.

---

## 🚀 Quick Start Guide

### System Requirements
- **Node.js**: v20.0.0 or higher
- **MySQL**: 8.0 or higher

### 1. Installation
Clone the repository and install all dependencies:
```bash
npm run install:all
```

### 2. Configure Environment Secrets
Copy the template configuration file:
```bash
cp server/.env.example server/.env
```

Generate two secure 256-bit cryptographic keys:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run the command twice and paste the outputs into `server/.env`:
- `JWT_SECRET` — Used for signing secure session cookies and media tokens.
- `MASTER_KEY` — Master Key used to wrap per-image AES-256 keys. *(⚠️ Back this up securely; if lost, files cannot be decrypted).*

Set your Vision AI Provider credentials in `server/.env`:
```env
AI_PROVIDER=deepseek           # Options: deepseek | openai | mock
DEEPSEEK_API_KEY=your_api_key_here
```
*(For testing without an API key, set `AI_PROVIDER=mock`, which approves all non-explicit test files).*

### 3. Initialize Database
Create your MySQL database user and initialize tables:
```sql
CREATE DATABASE IF NOT EXISTS vaultcloset CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vault'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL ON vaultcloset.* TO 'vault'@'localhost';
```
Run the migration script:
```bash
npm run db:init
```

### 4. Run Development Servers
Start both backend API and frontend client with hot reload:
```bash
# Terminal 1: Backend API (port 5000)
npm run dev:server

# Terminal 2: React Frontend (port 5173)
npm run dev:client
```
Open **`http://localhost:5173`** in your browser.

---

## 🏭 Production Deployment

Build the optimized React production bundle:
```bash
npm run build
npm start
```
When `NODE_ENV=production`, Express automatically serves the built frontend from `client/dist`.

### Production Security Checklist:
1. **HTTPS / Reverse Proxy**: Place VaultCloset behind Nginx, Caddy, or Cloudflare with SSL/TLS. Session cookies will automatically enable the `Secure` attribute.
2. **Master Key Backup**: Store a copy of `MASTER_KEY` in an encrypted password manager or offline hardware vault.
3. **Encrypted Storage Volume**: Point `VAULT_DIR` to an encrypted disk (BitLocker / LUKS) for complete at-rest hardware protection.

---

## 📡 API Endpoint Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register new user with unique username (no email required) & seeded categories |
| `POST` | `/api/auth/login` | Sign in with username + password (includes brute-force lockout) |
| `POST` | `/api/auth/logout` | Clear session cookie |
| `GET`  | `/api/auth/me` | Fetch currently authenticated user profile |
| `POST` | `/api/auth/change-password` | Change account password (requires current password verification) |
| `POST` | `/api/auth/username` | Update unique username (3–30 characters, no @) |
| `GET`  | `/api/network-info` | Get local network IPv4 address for QR mobile access |
| `GET`  | `/api/images` | List approved images with category filtering & pagination |
| `POST` | `/api/images/upload` | Upload & inspect image (single/batch) |
| `POST` | `/api/images/:id/view-token` | Generate single-use 60s media decryption token |
| `DELETE` | `/api/images/:id` | **DoD 5220.22-M 3-Pass Secure Shred** of image and thumbnail |
| `POST` | `/api/images/bulk-delete` | Batch secure shredding of multiple images |
| `GET`  | `/api/media/:token` | Zero-knowledge decryption stream (no disk traces, zero-cache) |
| `GET`  | `/api/categories` | List user categories with password protection status |
| `POST` | `/api/categories` | Create custom user category |
| `DELETE` | `/api/categories/:id` | 2-Factor category deletion (Account Password + Category Password) |
| `POST` | `/api/categories/:id/pin` | Set/update category password |
| `POST` | `/api/categories/:id/pin/verify` | Verify category password with brute-force lockout |
| `GET`  | `/api/rejected` | List quarantined rejected images |
| `POST` | `/api/rejected/:id/approve` | Override AI verdict and move to approved vault |
| `GET`  | `/api/ai/usage` | AI token consumption telemetry |

---

## ⚖️ License & Disclaimer

VaultCloset is designed for personal privacy and security. While advanced friction is implemented (right-click blocking, expiring media tokens, zero-cache headers, and window blur), no web technology can prevent external screen recording devices or physical camera photography. Use strong master keys and enjoy complete control over your private photos.
