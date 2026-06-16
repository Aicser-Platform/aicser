export function getFriendlyWidgetError(error?: string | null): {
  title: string;
  detail: string;
  technicalDetail?: string;
} {
  const technicalDetail = typeof error === 'string' ? error.trim() : '';
  const lower = technicalDetail.toLowerCase();

  if (!technicalDetail) {
    return {
      title: 'Data unavailable',
      detail: 'This widget could not load data. Try refreshing the dashboard.',
    };
  }

  if (
    lower.includes('referenced column') ||
    lower.includes('binder error') ||
    lower.includes('not found in from clause') ||
    lower.includes('candidate bindings')
  ) {
    return {
      title: 'Field needs review',
      detail: 'This widget uses a field that is not available in the selected data source.',
      technicalDetail,
    };
  }

  if (lower.includes('query execution failed') || lower.includes('sql')) {
    return {
      title: 'Query needs review',
      detail: 'This widget query could not run. Adjust the fields or retry.',
      technicalDetail,
    };
  }

  return {
    title: 'Data unavailable',
    detail: 'This widget could not load data. Try refreshing the dashboard.',
    technicalDetail,
  };
}
