import { useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQuery } from '@/hooks/useAuthenticatedQuery'
import { useAuthenticatedMutation } from '@/hooks/useAuthenticatedMutation'

// Data Sources queries
export const useDataSources = () => {
  return useAuthenticatedQuery(
    ['dataSources'],
    async (token) => {
      const response = await fetch('/api/data/sources', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (!response.ok) throw new Error('Failed to fetch data sources')
      return response.json()
    },
    {
      staleTime: 5 * 60 * 1000,
    }
  )
}

export const useDataSourcesByProject = (projectId: string) => {
  return useAuthenticatedQuery(
    ['dataSources', projectId],
    async (token) => {
      const response = await fetch(`/api/data/sources?project_id=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (!response.ok) throw new Error('Failed to fetch data sources')
      return response.json()
    },
    {
      enabled: !!projectId,
      staleTime: 5 * 60 * 1000,
    }
  )
}

export const useCreateDataSource = () => {
  const queryClient = useQueryClient()
  
  return useAuthenticatedMutation(
    async (token, dataSourceData: any) => {
      const response = await fetch('/api/data/sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(dataSourceData),
      })
      if (!response.ok) throw new Error('Failed to create data source')
      return response.json()
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dataSources'] })
      },
    }
  )
}

export const useUpdateDataSource = () => {
  const queryClient = useQueryClient()
  
  return useAuthenticatedMutation(
    async (token, { id, data }: { id: string; data: any }) => {
      const response = await fetch(`/api/data/sources/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      })
      if (!response.ok) throw new Error('Failed to update data source')
      return response.json()
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dataSources'] })
      },
    }
  )
}

export const useDeleteDataSource = () => {
  const queryClient = useQueryClient()
  
  return useAuthenticatedMutation(
    async (token, id: string) => {
      const response = await fetch(`/api/data/sources/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (!response.ok) throw new Error('Failed to delete data source')
      return response.json()
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dataSources'] })
      },
    }
  )
}

// Projects queries
export const useProjects = () => {
  return useAuthenticatedQuery(
    ['projects'],
    async (token) => {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (!response.ok) throw new Error('Failed to fetch projects')
      return response.json()
    },
    {
      staleTime: 5 * 60 * 1000,
    }
  )
}

// useOrganizations hook removed - organizations no longer supported
