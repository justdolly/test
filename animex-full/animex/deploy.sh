#!/bin/bash
# ANIMEX — VPS Deploy Script
# Tested: Ubuntu 22.04 / 24.04
# Usage:  ./deploy.sh
# After:  ./deploy.sh ssl   ← get SSL cert (needs domain pointing to this IP)
set -e

YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${YELLOW}▶ $1${NC}"; }
ok()    { echo -e "${GREEN}✓ $1${NC}"; }
error() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── SSL MODE ──────────────────────────────────────────────────────────────
if [ "$1" = "ssl" ]; then
  [ -f .env ] || error ".env not found. Run ./deploy.sh first."
  source .env
  [ -z "$APP_DOMAIN" ] && error "APP_DOMAIN not set in .env"
  info "Getting SSL certificate for $APP_DOMAIN..."
  docker compose --profile ssl run --rm certbot certonly \
    --webroot -w /var/www/certbot \
    --email "admin@${APP_DOMAIN}" \
    --agree-tos --no-eff-email \
    -d "${APP_DOMAIN}" -d "www.${APP_DOMAIN}"
  # Uncomment SSL lines in nginx.conf
  sed -i \
    -e "s|# listen 443 ssl;|listen 443 ssl;|" \
    -e "s|# ssl_certificate |ssl_certificate |" \
    -e "s|# ssl_certificate_key |ssl_certificate_key |" \
    -e "s|# ssl_protocols |ssl_protocols |" \
    -e "s|# ssl_ciphers |ssl_ciphers |" \
    -e "s|YOUR_DOMAIN|${APP_DOMAIN}|g" \
    -e "s|# server {|server {|" \
    -e "s|#   listen 80;|  listen 80;|" \
    -e "s|#   server_name YOUR_DOMAIN;|  server_name ${APP_DOMAIN};|" \
    -e "s|#   location /\\.well-known|  location /.well-known|" \
    -e "s|#   location / { return 301|  location / { return 301|" \
    -e "s|# }|}|" \
    nginx/nginx.conf
  docker compose restart nginx
  ok "SSL configured. Site now live at https://${APP_DOMAIN}"
  exit 0
fi

# ── FRESH INSTALL ─────────────────────────────────────────────────────────
info "Checking dependencies..."
command -v docker  &>/dev/null || { info "Installing Docker..."; curl -fsSL https://get.docker.com | sh; }
command -v docker  &>/dev/null && docker compose version &>/dev/null || { info "Installing Docker Compose plugin..."; apt-get install -y docker-compose-plugin 2>/dev/null || true; }
ok "Docker ready"

# ── GENERATE SECRETS ──────────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "Generating .env from template..."
  cp .env.example .env

  JWT_SECRET=$(openssl rand -hex 64)
  STREAM_SECRET=$(openssl rand -hex 64)
  MIRROR_ENC_KEY=$(openssl rand -hex 32)
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  REDIS_PASSWORD=$(openssl rand -hex 24)

  sed -i \
    -e "s|GENERATE_ME_32_bytes|${MIRROR_ENC_KEY}|" \
    -e "s|GENERATE_ME|${JWT_SECRET}|" \
    .env
  # Replace second GENERATE_ME (STREAM_SECRET)
  sed -i "0,/GENERATE_ME/!{0,/GENERATE_ME/s/GENERATE_ME/${STREAM_SECRET}/}" .env
  sed -i \
    -e "s|CHANGE_ME_strong_password_here|${POSTGRES_PASSWORD}|" \
    -e "s|CHANGE_ME_redis_password_here|${REDIS_PASSWORD}|" \
    .env

  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════════╗"
  echo -e "║         ACTION REQUIRED — Edit .env file         ║"
  echo -e "╚══════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  1. Set APP_URL=https://yourdomain.com"
  echo "  2. Set APP_DOMAIN=yourdomain.com"
  echo "  3. Set RESEND_API_KEY=re_... (get free key at resend.com)"
  echo ""
  read -p "Press ENTER when .env is configured..."
fi

source .env

# ── UPDATE NGINX DOMAIN ───────────────────────────────────────────────────
if [ -n "$APP_DOMAIN" ]; then
  sed -i "s/YOUR_DOMAIN/${APP_DOMAIN}/g" nginx/nginx.conf 2>/dev/null || true
fi

# ── MKDIR SSL ─────────────────────────────────────────────────────────────
mkdir -p nginx/ssl

# ── BUILD + START ─────────────────────────────────────────────────────────
info "Building and starting containers..."
docker compose pull
docker compose build --no-cache
docker compose up -d

# ── WAIT FOR DB ───────────────────────────────────────────────────────────
info "Waiting for database..."
for i in {1..30}; do
  docker compose exec -T postgres pg_isready -U animex &>/dev/null && break || sleep 2
done

# ── RUN MIGRATIONS ────────────────────────────────────────────────────────
info "Running database migrations..."
docker compose exec -T backend npx prisma migrate deploy

ok "ANIMEX deployed!"
echo ""
echo -e "  ${GREEN}Site:${NC}    http://${APP_DOMAIN:-your-server-ip}"
echo -e "  ${GREEN}API:${NC}     http://${APP_DOMAIN:-your-server-ip}/api/health"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo "  1. Point your domain DNS A record → $(curl -s ifconfig.me 2>/dev/null || echo 'this server IP')"
echo "  2. Run: ./deploy.sh ssl"
echo ""
echo -e "  ${YELLOW}Useful commands:${NC}"
echo "  docker compose logs -f backend    # view API logs"
echo "  docker compose logs -f nginx      # view nginx logs"
echo "  docker compose restart backend    # restart API"
echo "  docker compose down               # stop all"
