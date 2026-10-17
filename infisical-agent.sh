#!/usr/bin/env bash
# ==============================================================================
# Infisical Agent Vault Proxy & Zero-Plaintext Runner for Splits Web App
# Connects to https://app.infisical.com using your enrollment token to inject
# MONGODB_URI, JWT_SECRET, GOOGLE_CLIENT_ID, and deployment credentials in RAM.
# ==============================================================================
set -euo pipefail

ENROLLMENT_TOKEN="${INFISICAL_ENROLLMENT_TOKEN:-avp_XMX7kOJX_sGpRChlDz5bHwHjRHsWb0z80tap-ojRGf8}"
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://app.infisical.com}"
ACTION="${1:-proxy}"

case "$ACTION" in
  proxy)
    echo "[*] Starting Infisical Agent-Vault Proxy against ${INFISICAL_DOMAIN}..."
    exec infisical agent-vault proxy \
      --enrollment-token "${ENROLLMENT_TOKEN}" \
      --domain "${INFISICAL_DOMAIN}"
    ;;
  dev)
    echo "[*] Starting Splits Web App (dev) with secrets injected from Infisical..."
    exec infisical run --domain "${INFISICAL_DOMAIN}" --env=dev -- npm run dev
    ;;
  prod)
    echo "[*] Starting Splits Web App (prod) with secrets injected from Infisical..."
    exec infisical run --domain "${INFISICAL_DOMAIN}" --env=prod -- npm start
    ;;
  deploy-vercel)
    echo "[*] Deploying to Vercel using Infisical-injected credentials..."
    exec infisical run --domain "${INFISICAL_DOMAIN}" --env=prod -- npx vercel --prod
    ;;
  sync-wydia)
    echo "[*] Syncing vasool to Wydia Shared Drive (depot13:Runtime/active_workspaces/vasool)..."
    rclone sync . "depot13:Runtime/active_workspaces/vasool" \
      --exclude "node_modules/**" \
      --exclude ".git/**" \
      --fast-list --transfers 8 -P
    ;;
  *)
    echo "Usage: ./infisical-agent.sh [proxy|dev|prod|deploy-vercel|sync-wydia]"
    exit 1
    ;;
esac
