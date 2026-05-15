# ANIMEX — Self-Hosted Anime Platform

## Stack
- **Frontend**: Vanilla HTML/CSS/JS (served by nginx)
- **Backend**: Node.js + Express + TypeScript
- **DB**: PostgreSQL 16 + Prisma ORM
- **Cache**: Redis 7
- **Email**: Resend (3,000 free/month)
- **Proxy**: nginx (reverse proxy + static files + SSL)
- **Deploy**: Docker Compose

## VPS Requirements
- Ubuntu 22.04 or 24.04
- 1GB RAM minimum (2GB recommended)
- 20GB disk
- Any provider: Hetzner (cheapest), DigitalOcean, Linode, Vultr

## Deploy (5 minutes)

```bash
# 1. SSH into your VPS
ssh root@YOUR_SERVER_IP

# 2. Clone / upload this folder to VPS
git clone https://github.com/YOU/animex.git
cd animex

# 3. Run deploy script — auto-installs Docker, generates secrets, starts all services
./deploy.sh

# (Script will prompt you to edit .env — set your domain + Resend API key)

# 4. Point your domain DNS A record → your server IP
# Wait 5-60 minutes for DNS propagation, then:

# 5. Get free SSL certificate
./deploy.sh ssl
```

## After Deploy

| URL | What |
|-----|------|
| `https://yourdomain.com` | Frontend |
| `https://yourdomain.com/api/health` | API health check |
| `https://yourdomain.com/login.html` | Login/signup |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/signup | No | Create account |
| POST | /api/auth/login | No | Get JWT token |
| POST | /api/auth/logout | Yes | Invalidate session |
| GET | /api/auth/verify-email?token= | No | Verify email |
| POST | /api/auth/forgot-password | No | Send reset email |
| POST | /api/auth/reset-password | No | Reset with token |
| GET | /api/auth/me | Yes | Current user |
| GET | /api/anime | No | Browse/search anime |
| GET | /api/anime/:slug | No | Anime detail + episodes |
| GET | /api/anime/:slug/episodes/:n/mirrors | Yes | Get episode mirrors |
| GET | /api/stream/resolve/:episodeId | Yes | Get stream token |
| GET | /api/stream/proxy?token= | Yes | Proxy video stream |
| POST | /api/progress | Yes | Save watch position |
| GET | /api/progress | Yes | Watch history |
| GET | /api/user/me | Yes | Profile + stats |
| PATCH | /api/user/me | Yes | Update profile |
| GET | /api/user/bookmarks | Yes | Get lists |
| PUT | /api/user/bookmarks/:animeId | Yes | Add/update bookmark |
| DELETE | /api/user/bookmarks/:animeId | Yes | Remove bookmark |

## Useful Commands

```bash
# Logs
docker compose logs -f backend
docker compose logs -f nginx

# Restart services
docker compose restart backend
docker compose restart nginx

# DB shell
docker compose exec postgres psql -U animex animex

# Redis shell
docker compose exec redis redis-cli -a YOUR_REDIS_PASSWORD

# Stop everything
docker compose down

# Update after code changes
docker compose build backend && docker compose up -d backend
```

## Populating Anime Data

The DB starts empty. Two ways to add anime:

**Option A — Run the crawler** (fetches from AniList):
```bash
# Edit backend/src/crawler/crawler.ts to scheduleCrawl([...anilist IDs])
docker compose exec backend node -e "
const { scheduleCrawl } = require('./dist/crawler/crawler');
scheduleCrawl([21, 11061, 9253, 16498, 1535, 20, 101922, 113415]);
"
```

**Option B — The frontend already works without the DB**  
All browse/search/anime detail pages use the AniList public GraphQL API directly.  
The backend DB is only needed for: watch progress, bookmarks, auth, and stream token issuance.

## Adding Video Sources (Mirrors)

The stream system is ready but needs real mirror URLs populated.  
Use the admin API to insert mirrors per episode:

```bash
curl -X POST https://yourdomain.com/api/anime \
  -H "Authorization: Bearer ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "slug": "one-piece", "anilistId": 21, "title": {"romaji": "One Piece"}, ... }'
```

Then use Prisma Studio to add mirrors:
```bash
docker compose exec backend npx prisma studio
```
Open `http://localhost:5555`, go to `EpisodeMirror`, add rows with encrypted URLs.

## Email Setup

1. Sign up at [resend.com](https://resend.com) (free: 3,000 emails/month)
2. Add and verify your domain in Resend dashboard
3. Get your API key → paste into `.env` as `RESEND_API_KEY`
4. Emails send from `noreply@yourdomain.com`
