"""
MongoDB Connector - Natural language to MongoDB aggregation pipeline
Supports: MongoDB 4.0+, aggregation framework, complex queries
"""
from typing import Dict, List, Any, Optional
import re
from datetime import datetime

try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, OperationFailure
    MONGODB_AVAILABLE = True
except ImportError:
    MONGODB_AVAILABLE = False
    print("Warning: pymongo not installed. MongoDB support disabled.")


class MongoDBConnector:
    """
    MongoDB connector with NL2MQL (Natural Language to MongoDB Query Language).
    Generates aggregation pipelines from natural language queries.
    """
    
    def __init__(self, connection_string: str, database: str):
        if not MONGODB_AVAILABLE:
            raise ImportError("pymongo is required for MongoDB support")
        
        self.connection_string = connection_string
        self.database_name = database
        self.client = None
        self.db = None
    
    def connect(self) -> bool:
        """Establish connection to MongoDB"""
        try:
            self.client = MongoClient(self.connection_string, serverSelectionTimeoutMS=5000)
            # Test connection
            self.client.admin.command('ping')
            self.db = self.client[self.database_name]
            return True
        except ConnectionFailure as e:
            print(f"MongoDB connection failed: {e}")
            return False
    
    def disconnect(self) -> None:
        """Close MongoDB connection"""
        if self.client:
            self.client.close()
    
    async def get_schema(self) -> Dict[str, Any]:
        """
        Extract schema from MongoDB collections.
        Samples documents to infer field types.
        """
        if not self.db:
            self.connect()
        
        schema = {}
        
        for collection_name in self.db.list_collection_names():
            collection = self.db[collection_name]
            
            # Sample documents to infer schema
            sample_docs = list(collection.find().limit(100))
            
            if not sample_docs:
                schema[collection_name] = {'fields': [], 'sample_count': 0}
                continue
            
            # Infer fields from samples
            fields = {}
            for doc in sample_docs:
                for key, value in doc.items():
                    if key not in fields:
                        fields[key] = {
                            'name': key,
                            'type': self._infer_type(value),
                            'nullable': False
                        }
            
            schema[collection_name] = {
                'fields': list(fields.values()),
                'sample_count': len(sample_docs),
                'total_count': collection.count_documents({})
            }
        
        return schema


    
    def _infer_type(self, value: Any) -> str:
        """Infer MongoDB field type from value"""
        if isinstance(value, bool):
            return 'boolean'
        elif isinstance(value, int):
            return 'integer'
        elif isinstance(value, float):
            return 'double'
        elif isinstance(value, str):
            return 'string'
        elif isinstance(value, datetime):
            return 'date'
        elif isinstance(value, list):
            return 'array'
        elif isinstance(value, dict):
            return 'object'
        else:
            return 'mixed'
    
    def nl_to_aggregation_pipeline(
        self,
        query: str,
        collection: str,
        schema: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Convert natural language query to MongoDB aggregation pipeline.
        
        Args:
            query: Natural language query
            collection: Target collection name
            schema: Optional schema for field validation
        
        Returns:
            MongoDB aggregation pipeline (list of stages)
        """
        pipeline = []
        query_lower = query.lower()
        
        # Extract filters (WHERE equivalent)
        filters = self._extract_filters(query_lower, schema)
        if filters:
            pipeline.append({'$match': filters})
        
        # Extract grouping (GROUP BY equivalent)
        group_stage = self._extract_grouping(query_lower, schema)
        if group_stage:
            pipeline.append(group_stage)
        
        # Extract sorting (ORDER BY equivalent)
        sort_stage = self._extract_sorting(query_lower)
        if sort_stage:
            pipeline.append(sort_stage)
        
        # Extract limit
        limit = self._extract_limit(query_lower)
        if limit:
            pipeline.append({'$limit': limit})
        
        # Extract projection (SELECT equivalent)
        project_stage = self._extract_projection(query_lower, schema)
        if project_stage:
            pipeline.append(project_stage)
        
        return pipeline
    
    def _extract_filters(self, query: str, schema: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Extract filter conditions from query"""
        filters = {}
        
        # Simple pattern matching for common filters
        # "where status = 'active'" -> {'status': 'active'}
        # "where age > 25" -> {'age': {'$gt': 25}}
        
        # Equal conditions
        eq_pattern = r'where\s+(\w+)\s*=\s*["\']([^"\']+)["\']'
        for match in re.finditer(eq_pattern, query):
            field, value = match.groups()
            filters[field] = value
        
        # Greater than
        gt_pattern = r'where\s+(\w+)\s*>\s*(\d+)'
        for match in re.finditer(gt_pattern, query):
            field, value = match.groups()
            filters[field] = {'$gt': int(value)}
        
        # Less than
        lt_pattern = r'where\s+(\w+)\s*<\s*(\d+)'
        for match in re.finditer(lt_pattern, query):
            field, value = match.groups()
            filters[field] = {'$lt': int(value)}
        
        # Date ranges
        if 'last 30 days' in query or 'past month' in query:
            # Assume there's a date field
            date_fields = ['created_at', 'date', 'timestamp', 'created']
            for field in date_fields:
                if schema and field in str(schema):
                    from datetime import timedelta
                    thirty_days_ago = datetime.now() - timedelta(days=30)
                    filters[field] = {'$gte': thirty_days_ago}
                    break
        
        return filters
    
    def _extract_grouping(self, query: str, schema: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Extract GROUP BY equivalent"""
        # "group by category" -> {'$group': {'_id': '$category', ...}}
        # "count by status" -> {'$group': {'_id': '$status', 'count': {'$sum': 1}}}
        
        group_pattern = r'(?:group by|count by|sum by)\s+(\w+)'
        match = re.search(group_pattern, query)
        
        if not match:
            return None
        
        group_field = match.group(1)
        
        # Determine aggregation type
        if 'count' in query:
            return {
                '$group': {
                    '_id': f'${group_field}',
                    'count': {'$sum': 1}
                }
            }
        elif 'sum' in query:
            # Try to find the field to sum
            sum_pattern = r'sum\s+(\w+)'
            sum_match = re.search(sum_pattern, query)
            sum_field = sum_match.group(1) if sum_match else 'value'
            
            return {
                '$group': {
                    '_id': f'${group_field}',
                    'total': {'$sum': f'${sum_field}'}
                }
            }
        elif 'average' in query or 'avg' in query:
            avg_pattern = r'(?:average|avg)\s+(\w+)'
            avg_match = re.search(avg_pattern, query)
            avg_field = avg_match.group(1) if avg_match else 'value'
            
            return {
                '$group': {
                    '_id': f'${group_field}',
                    'average': {'$avg': f'${avg_field}'}
                }
            }
        
        return None


    
    def _extract_sorting(self, query: str) -> Optional[Dict[str, Any]]:
        """Extract ORDER BY equivalent"""
        # "order by date desc" -> {'$sort': {'date': -1}}
        sort_pattern = r'order by\s+(\w+)(?:\s+(asc|desc))?'
        match = re.search(sort_pattern, query)
        
        if not match:
            return None
        
        field = match.group(1)
        direction = match.group(2) if match.group(2) else 'asc'
        
        return {
            '$sort': {
                field: -1 if direction == 'desc' else 1
            }
        }
    
    def _extract_limit(self, query: str) -> Optional[int]:
        """Extract LIMIT equivalent"""
        # "limit 10" or "top 10"
        limit_pattern = r'(?:limit|top)\s+(\d+)'
        match = re.search(limit_pattern, query)
        
        if match:
            return int(match.group(1))
        
        return None
    
    def _extract_projection(self, query: str, schema: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Extract SELECT fields equivalent"""
        # "select name, email" -> {'$project': {'name': 1, 'email': 1}}
        select_pattern = r'select\s+([\w,\s]+?)(?:\s+from|\s+where|$)'
        match = re.search(select_pattern, query)
        
        if not match:
            return None
        
        fields_str = match.group(1)
        fields = [f.strip() for f in fields_str.split(',')]
        
        if 'all' in fields or '*' in fields:
            return None  # Return all fields
        
        projection = {field: 1 for field in fields if field}
        if projection:
            return {'$project': projection}
        
        return None
    
    async def execute_query(
        self,
        collection: str,
        pipeline: List[Dict[str, Any]],
        limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        Execute MongoDB aggregation pipeline.
        
        Args:
            collection: Collection name
            pipeline: Aggregation pipeline
            limit: Maximum documents to return
        
        Returns:
            List of documents
        """
        if not self.db:
            self.connect()
        
        try:
            coll = self.db[collection]
            
            # Add limit if not in pipeline
            if not any('$limit' in stage for stage in pipeline):
                pipeline.append({'$limit': limit})
            
            # Execute aggregation
            cursor = coll.aggregate(pipeline)
            results = list(cursor)
            
            # Convert ObjectId to string for JSON serialization
            for doc in results:
                if '_id' in doc and hasattr(doc['_id'], '__str__'):
                    doc['_id'] = str(doc['_id'])
            
            return results
        
        except OperationFailure as e:
            print(f"MongoDB query execution failed: {e}")
            return []
    
    async def execute_nl_query(
        self,
        query: str,
        collection: str,
        schema: Optional[Dict[str, Any]] = None,
        limit: int = 1000
    ) -> Dict[str, Any]:
        """
        Execute natural language query against MongoDB.
        
        Args:
            query: Natural language query
            collection: Target collection
            schema: Optional schema for validation
            limit: Maximum documents to return
        
        Returns:
            Query results with metadata
        """
        # Generate aggregation pipeline
        pipeline = self.nl_to_aggregation_pipeline(query, collection, schema)
        
        # Execute query
        results = await self.execute_query(collection, pipeline, limit)
        
        return {
            'data': results,
            'pipeline': pipeline,
            'collection': collection,
            'count': len(results)
        }


def create_mongodb_connector(connection_string: str, database: str) -> MongoDBConnector:
    """Factory function to create MongoDB connector"""
    return MongoDBConnector(connection_string, database)
