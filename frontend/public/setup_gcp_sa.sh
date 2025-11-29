#!/bin/bash
set -e

# Prompt the user to enter their GCP Project ID
read -p "Enter your GCP Project ID: " PROJECT_ID

SERVICE_ACCOUNT_NAME="thunder-deploy-sa"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_FILE="service_account.json"

echo "Using project: ${PROJECT_ID}"
echo "Service Account: ${SERVICE_ACCOUNT_EMAIL}"

# List of required services to enable based on the roles:
# - Artifact Registry Reader -> artifactregistry.googleapis.com
# - Cloud Build Editor       -> cloudbuild.googleapis.com
# - Cloud Run Admin          -> run.googleapis.com
# - Cloud SQL Admin          -> sqladmin.googleapis.com
# - Container Registry Agent -> containerregistry.googleapis.com
# - Storage roles            -> storage.googleapis.com
declare -a SERVICES=(
  "artifactregistry.googleapis.com"
  "cloudbuild.googleapis.com"
  "run.googleapis.com"
  "sqladmin.googleapis.com"
  "containerregistry.googleapis.com"
  "storage.googleapis.com"
  "iam.googleapis.com" # Added for service account creation and key management
)

echo "Enabling required services..."
for service in "${SERVICES[@]}"; do
  echo "Enabling ${service}..."
  gcloud services enable ${service} --project ${PROJECT_ID}
done

# Function to check if the service account exists
function check_sa_exists() {
  gcloud iam service-accounts describe ${SERVICE_ACCOUNT_EMAIL} --project ${PROJECT_ID} >/dev/null 2>&1
}

# Check if the service account already exists; if not, create it
if check_sa_exists; then
  echo "Service account ${SERVICE_ACCOUNT_EMAIL} already exists. Skipping creation."
else
  echo "Creating service account ${SERVICE_ACCOUNT_EMAIL}..."
  gcloud iam service-accounts create ${SERVICE_ACCOUNT_NAME} \
    --display-name="Deployment Service Account" \
    --project ${PROJECT_ID}

  # Wait until the service account is available
  echo "Waiting for the service account to propagate..."
  for i in {1..10}; do
    if check_sa_exists; then
      echo "Service account is now available."
      break
    fi
    sleep 3
  done

  # Final check
  if ! check_sa_exists; then
    echo "ERROR: Service account ${SERVICE_ACCOUNT_EMAIL} not found after creation."
    exit 1
  fi
fi

# Define the roles to be granted
declare -a ROLES=(
  "roles/artifactregistry.reader"         # Artifact Registry Reader
  "roles/cloudbuild.builds.editor"          # Cloud Build Editor
  "roles/run.admin"                         # Cloud Run Admin
  "roles/cloudsql.admin"                    # Cloud SQL Admin
  "roles/containerregistry.ServiceAgent"    # Container Registry Service Agent (often assigned automatically, but good to ensure)
  "roles/iam.serviceAccountUser"            # Service Account User (allows impersonation if needed, and to link SA to other resources)
  "roles/iam.serviceAccountKeyAdmin"      # Required to create keys for the service account
  "roles/storage.admin"                     # Storage Admin (broad, consider more granular if possible)
  # "roles/storage.objectAdmin"             # Storage Object Admin - Covered by storage.admin
  # "roles/storage.objectViewer"            # Storage Object Viewer - Covered by storage.admin
)

# Grant each role to the service account at the project level
for role in "${ROLES[@]}"; do
  echo "Granting ${role} to ${SERVICE_ACCOUNT_EMAIL}..."
  gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="${role}" \
    --quiet
done

# Create a new key for the service account (output as JSON)
echo "Creating key file ${KEY_FILE} for ${SERVICE_ACCOUNT_EMAIL}..."
gcloud iam service-accounts keys create ${KEY_FILE} \
  --iam-account=${SERVICE_ACCOUNT_EMAIL} \
  --project ${PROJECT_ID}

echo "Service account key created successfully: ${KEY_FILE}"
echo "IMPORTANT: Secure this key file. It provides administrative access to your GCP resources."
echo "You will typically upload this ${KEY_FILE} as the 'Target Project SA' in the Thunder Deploy UI."
