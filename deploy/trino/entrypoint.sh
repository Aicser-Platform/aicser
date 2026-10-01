#!/bin/bash
# Writes Trino's Iceberg catalog for the Aicser Gold tables from the container environment,
# then starts Trino. S3 settings are included only when a key is configured (Trino refuses
# blank ones); tables on the local lake folder are read through the local file system.
set -euo pipefail
mkdir -p /etc/trino/catalog
{
  echo "connector.name=iceberg"
  echo "iceberg.catalog.type=jdbc"
  echo "iceberg.jdbc-catalog.catalog-name=aiser"
  echo "iceberg.jdbc-catalog.driver-class=org.postgresql.Driver"
  echo "iceberg.jdbc-catalog.connection-url=${AICSER_CATALOG_JDBC_URL}"
  echo "iceberg.jdbc-catalog.connection-user=${AICSER_CATALOG_USER}"
  echo "iceberg.jdbc-catalog.connection-password=${AICSER_CATALOG_PASSWORD}"
  echo "iceberg.jdbc-catalog.default-warehouse-dir=${AICSER_LAKE_DIR:-/app/uploads/lake/warehouse}"
  # Aicser only reads.
  echo "iceberg.security=read_only"
  # Local lake folders are written as file:// paths, which the Hadoop file system reads.
  echo "fs.hadoop.enabled=true"
  if [ -n "${AICSER_S3_KEY:-}" ]; then
    echo "fs.native-s3.enabled=true"
    echo "s3.region=${AICSER_S3_REGION:-us-east-1}"
    echo "s3.aws-access-key=${AICSER_S3_KEY}"
    echo "s3.aws-secret-key=${AICSER_S3_SECRET}"
    echo "s3.path-style-access=true"
    if [ -n "${AICSER_S3_ENDPOINT:-}" ]; then echo "s3.endpoint=${AICSER_S3_ENDPOINT}"; fi
  fi
} > /etc/trino/catalog/iceberg.properties
chmod 600 /etc/trino/catalog/iceberg.properties
exec /usr/lib/trino/bin/run-trino
