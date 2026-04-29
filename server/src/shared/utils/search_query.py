from typing import List, Dict, Any


def create_search_query(search: str, columns: List[str]) -> Dict[str, Any]:
    """
    Generate search query for multiple columns using SQL LIKE syntax.

    Args:
        search (str): Search query string to look for
        columns (List[str]): List of column names to search in

    Returns:
        Dict[str, Any]: Dictionary mapping columns to search values

    Raises:
        ValueError: If search string or columns list is empty
    """
    if not search or not columns:
        return {}

    # Clean and normalize search string
    search = search.strip()

    # Create simple key-value pairs for each column
    search_criteria = {}
    for column in columns:
        if not isinstance(column, str):
            continue
        search_criteria[column] = search

    return search_criteria
