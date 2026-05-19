/**
 * Service for managing saved assets (Asset Library)
 */

import { fetchApi } from '@/utils/api';
import { message } from 'antd';

export interface SavedAsset {
  id: string;
  conversation_id: string;
  message_id?: string;
  asset_type: 'chart' | 'insight' | 'recommendation' | 'query' | 'export';
  title: string;
  content: any;
  thumbnail?: string;
  data_source_id?: string;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

export interface SaveAssetRequest {
  conversation_id: string;
  message_id?: string;
  asset_type: 'chart' | 'insight' | 'recommendation' | 'query' | 'export';
  title: string;
  content: any;
  thumbnail?: string;
  data_source_id?: string;
  metadata?: any;
}

export interface AssetListResponse {
  items: SavedAsset[];
  total: number;
  offset: number;
  limit: number;
}

class AssetService {
  /**
   * Save an asset to the library
   */
  async saveAsset(asset: SaveAssetRequest): Promise<SavedAsset> {
    try {
      const response = await fetchApi('assets', {
        method: 'POST',
        body: JSON.stringify(asset),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to save asset' }));
        throw new Error(errorData.error || 'Failed to save asset');
      }

      const data = await response.json();
      message.success('Asset saved to library');
      return data;
    } catch (error: any) {
      console.error('Failed to save asset:', error);
      message.error(error.message || 'Failed to save asset');
      throw error;
    }
  }

  /**
   * Get all assets with optional filters
   */
  async getAssets(filters?: {
    conversation_id?: string;
    asset_type?: string;
    data_source_id?: string;
    offset?: number;
    limit?: number;
  }): Promise<AssetListResponse> {
    try {
      const params = new URLSearchParams();
      if (filters?.conversation_id) params.append('conversation_id', filters.conversation_id);
      if (filters?.asset_type) params.append('asset_type', filters.asset_type);
      if (filters?.data_source_id) params.append('data_source_id', filters.data_source_id);
      if (filters?.offset !== undefined) params.append('offset', filters.offset.toString());
      if (filters?.limit !== undefined) params.append('limit', filters.limit.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `assets?${queryString}` : 'assets';

      const response = await fetchApi(endpoint, {
        method: 'GET',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to get assets' }));
        throw new Error(errorData.error || 'Failed to get assets');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Failed to get assets:', error);
      throw error;
    }
  }

  /**
   * Get a specific asset by ID
   */
  async getAsset(assetId: string): Promise<SavedAsset> {
    try {
      const response = await fetchApi(`assets/${assetId}`, {
        method: 'GET',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Asset not found' }));
        throw new Error(errorData.error || 'Asset not found');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Failed to get asset:', error);
      throw error;
    }
  }

  /**
   * Delete an asset
   */
  async deleteAsset(assetId: string): Promise<void> {
    try {
      const response = await fetchApi(`assets/${assetId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete asset' }));
        throw new Error(errorData.error || 'Failed to delete asset');
      }

      message.success('Asset deleted');
    } catch (error: any) {
      console.error('Failed to delete asset:', error);
      message.error(error.message || 'Failed to delete asset');
      throw error;
    }
  }

  /**
   * Generate a thumbnail from chart config (base64)
   */
  async generateChartThumbnail(chartConfig: any): Promise<string | null> {
    try {
      // This would use a chart rendering service or canvas to generate thumbnail
      // For now, return null - can be implemented later
      return null;
    } catch (error) {
      console.error('Failed to generate thumbnail:', error);
      return null;
    }
  }
}

export const assetService = new AssetService();


