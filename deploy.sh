#!/bin/bash
set -e

echo "Deploying Unified UI to Cloud Run..."
gcloud run deploy unified-ui \
  --source ui \
  --project thunderdeployone \
  --region us-central1 \
  --allow-unauthenticated
