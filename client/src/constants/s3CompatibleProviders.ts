/** S3-compatible object storage presets (workspace storage, pipeline lake buckets). */

export type S3CompatibleProviderId =
  | 'aws'
  | 'azure'
  | 'gcp'
  | 'railway'
  | 'minio'
  | 'r2'
  | 'digitalocean'
  | 'wasabi';

export type S3ProviderPreset = {
  id: S3CompatibleProviderId;
  label: string;
  defaultRegion: string;
  endpointPlaceholder: string;
  /** When set, applied when user picks this provider (unless they already typed an endpoint). */
  defaultEndpoint?: string;
  pathStyle: boolean;
  help?: string;
};

export const S3_COMPATIBLE_PROVIDER_PRESETS: S3ProviderPreset[] = [
  {
    id: 'aws',
    label: 'AWS S3',
    defaultRegion: 'us-east-1',
    endpointPlaceholder: 'https://s3.amazonaws.com (optional — leave empty for AWS)',
    pathStyle: false,
  },
  {
    id: 'azure',
    label: 'Azure Blob (S3 API)',
    defaultRegion: 'us-east-1',
    endpointPlaceholder: 'https://<account>.blob.core.windows.net',
    pathStyle: true,
    help: 'Enable S3-compatible API on the storage account and use its access keys.',
  },
  {
    id: 'gcp',
    label: 'Google Cloud Storage (S3 interop)',
    defaultRegion: 'auto',
    endpointPlaceholder: 'https://storage.googleapis.com',
    defaultEndpoint: 'https://storage.googleapis.com',
    pathStyle: true,
    help: 'Use HMAC access keys (Cloud Storage → Interoperability), not JSON service account keys, for pipeline lake writes.',
  },
  {
    id: 'railway',
    label: 'Railway',
    defaultRegion: 'auto',
    endpointPlaceholder: 'https://storage.railway.app',
    pathStyle: true,
  },
  {
    id: 'minio',
    label: 'MinIO',
    defaultRegion: 'us-east-1',
    endpointPlaceholder: 'http://localhost:9000',
    pathStyle: true,
  },
  {
    id: 'r2',
    label: 'Cloudflare R2',
    defaultRegion: 'auto',
    endpointPlaceholder: 'https://<account_id>.r2.cloudflarestorage.com',
    pathStyle: true,
  },
  {
    id: 'digitalocean',
    label: 'DigitalOcean Spaces',
    defaultRegion: 'us-east-1',
    endpointPlaceholder: 'https://<region>.digitaloceanspaces.com',
    pathStyle: true,
  },
  {
    id: 'wasabi',
    label: 'Wasabi',
    defaultRegion: 'us-east-1',
    endpointPlaceholder: 'https://s3.wasabisys.com',
    pathStyle: true,
  },
];

export function s3ProviderPreset(id: string | null | undefined): S3ProviderPreset | undefined {
  const key = (id || 'aws').toLowerCase() as S3CompatibleProviderId;
  return S3_COMPATIBLE_PROVIDER_PRESETS.find((p) => p.id === key);
}

export function s3ProviderSelectOptions() {
  return S3_COMPATIBLE_PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label }));
}
