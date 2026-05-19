import { getBackendUrl } from '@/utils/backendUrl';

// Secure environment configuration for Aiser World
export const environment = {
  // Cube.js Configuration
  cubejs: {
    token: process.env.NEXT_PUBLIC_CUBEJS_TOKEN || '',
    url: process.env.NEXT_PUBLIC_CUBEJS_URL || 'http://localhost:4000',
    apiVersion: 'v1'
  },
  
  // API Configuration
  api: {
    baseUrl: getBackendUrl(),
    timeout: parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '30000')
  }
};

// Helper function to get Cube.js authorization header
export const getCubeJsAuthHeader = (): string => {
  const token = environment.cubejs.token;
  if (!token) {
    console.warn('Cube.js token not configured. Please set NEXT_PUBLIC_CUBEJS_TOKEN in your environment.');
    return '';
  }
  return `Bearer ${token}`;
};

// Helper function to validate environment configuration
export const validateEnvironment = (): boolean => {
  const required = [
    'NEXT_PUBLIC_CUBEJS_TOKEN',
    'NEXT_PUBLIC_CUBEJS_URL'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing);
    return false;
  }
  
  return true;
};
