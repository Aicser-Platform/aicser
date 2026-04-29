"""
DynamoDB Connector - Natural language to PartiQL/SDK queries
Supports: DynamoDB with PartiQL, GSI/LSI awareness, efficient scans
"""
from typing import Dict, List, Any, Optional
import re

try:
    import boto3
    from boto3.dynamodb.conditions import Key, Attr
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    print("Warning: boto3 not installed. DynamoDB support disabled.")


class DynamoDBConnector:
    """
    DynamoDB connector with NL2PartiQL and SDK query generation.
    Handles DynamoDB-specific patterns (partition/sort keys, GSI, etc.)
    """
    
    def __init__(self, region: str = 'us-east-1', aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None):
        if not BOTO3_AVAILABLE:
            raise ImportError("boto3 is required for DynamoDB support")
        
        self.region = region
        
        # Initialize boto3 client
        if aws_access_key_id and aws_secret_access_key:
            self.dynamodb = boto3.resource(
                'dynamodb',
                region_name=region,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key
            )
            self.client = boto3.client(
                'dynamodb',
                region_name=region,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key
            )
        else:
            # Use default credentials
            self.dynamodb = boto3.resource('dynamodb', region_name=region)
            self.client = boto3.client('dynamodb', region_name=region)
    
    async def get_schema(self, table_name: str) -> Dict[str, Any]:
        """
        Extract schema from DynamoDB table.
        Includes partition key, sort key, GSI, LSI.
        """
        try:
            response = self.client.describe_table(TableName=table_name)
            table_desc = response['Table']
            
            # Extract key schema
            key_schema = {}
            for key in table_desc['KeySchema']:
                key_schema[key['AttributeName']] = key['KeyType']  # HASH or RANGE
            
            # Extract attribute definitions
            attributes = {}
            for attr in table_desc['AttributeDefinitions']:
                attributes[attr['AttributeName']] = attr['AttributeType']  # S, N, B
            
            # Extract GSI (Global Secondary Indexes)
            gsi = []
            if 'GlobalSecondaryIndexes' in table_desc:
                for index in table_desc['GlobalSecondaryIndexes']:
                    gsi.append({
                        'name': index['IndexName'],
                        'keys': {k['AttributeName']: k['KeyType'] for k in index['KeySchema']}
                    })
            
            # Extract LSI (Local Secondary Indexes)
            lsi = []
            if 'LocalSecondaryIndexes' in table_desc:
                for index in table_desc['LocalSecondaryIndexes']:
                    lsi.append({
                        'name': index['IndexName'],
                        'keys': {k['AttributeName']: k['KeyType'] for k in index['KeySchema']}
                    })
            
            return {
                'table_name': table_name,
                'key_schema': key_schema,
                'attributes': attributes,
                'gsi': gsi,
                'lsi': lsi,
                'item_count': table_desc.get('ItemCount', 0)
            }
        except Exception as e:
            print(f"Failed to get DynamoDB schema: {e}")
            return {}
    
    def nl_to_partiql(
        self,
        query: str,
        table_name: str,
        schema: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Convert natural language to PartiQL (SQL-like query for DynamoDB).
        
        PartiQL limitations:
        - Must use partition key in WHERE for efficient queries
        - Limited JOIN support
        - No complex aggregations
        """
        query_lower = query.lower()
        
        # Get partition key from schema
        partition_key = None
        if schema and 'key_schema' in schema:
            for key, key_type in schema['key_schema'].items():
                if key_type == 'HASH':
                    partition_key = key
                    break
        
        # Build SELECT clause
        select_clause = self._extract_select_clause(query_lower)
        
        # Build WHERE clause
        where_clause = self._extract_where_clause(query_lower, partition_key)
        
        # Build ORDER BY (limited in DynamoDB)
        order_clause = self._extract_order_clause(query_lower)
        
        # Construct PartiQL
        partiql = f"SELECT {select_clause} FROM \"{table_name}\""
        
        if where_clause:
            partiql += f" WHERE {where_clause}"
        
        if order_clause:
            partiql += f" ORDER BY {order_clause}"
        
        return partiql


    
    def _extract_select_clause(self, query: str) -> str:
        """Extract SELECT fields"""
        if 'count' in query:
            return 'COUNT(*)'
        
        select_pattern = r'select\s+([\w,\s]+?)(?:\s+from|\s+where|$)'
        match = re.search(select_pattern, query)
        
        if match:
            fields = match.group(1).strip()
            if fields == '*' or 'all' in fields:
                return '*'
            return fields
        
        return '*'
    
    def _extract_where_clause(self, query: str, partition_key: Optional[str]) -> str:
        """Extract WHERE clause"""
        conditions = []
        
        # Equal conditions
        eq_pattern = r'where\s+(\w+)\s*=\s*["\']([^"\']+)["\']'
        for match in re.finditer(eq_pattern, query):
            field, value = match.groups()
            conditions.append(f"{field} = '{value}'")
        
        # Numeric conditions
        num_pattern = r'where\s+(\w+)\s*([><=]+)\s*(\d+)'
        for match in re.finditer(num_pattern, query):
            field, op, value = match.groups()
            conditions.append(f"{field} {op} {value}")
        
        return ' AND '.join(conditions) if conditions else ''
    
    def _extract_order_clause(self, query: str) -> str:
        """Extract ORDER BY"""
        order_pattern = r'order by\s+(\w+)(?:\s+(asc|desc))?'
        match = re.search(order_pattern, query)
        
        if match:
            field = match.group(1)
            direction = match.group(2) if match.group(2) else 'ASC'
            return f"{field} {direction.upper()}"
        
        return ''
    
    def nl_to_sdk_query(
        self,
        query: str,
        table_name: str,
        schema: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Convert natural language to DynamoDB SDK query parameters.
        More efficient than PartiQL for simple queries.
        """
        query_lower = query.lower()
        
        # Get partition key
        partition_key = None
        sort_key = None
        if schema and 'key_schema' in schema:
            for key, key_type in schema['key_schema'].items():
                if key_type == 'HASH':
                    partition_key = key
                elif key_type == 'RANGE':
                    sort_key = key
        
        # Extract key conditions
        key_conditions = {}
        filter_conditions = []
        
        # Parse WHERE conditions
        eq_pattern = r'where\s+(\w+)\s*=\s*["\']([^"\']+)["\']'
        for match in re.finditer(eq_pattern, query_lower):
            field, value = match.groups()
            if field == partition_key:
                key_conditions[field] = value
            else:
                filter_conditions.append(Attr(field).eq(value))
        
        # Determine query type
        if partition_key and partition_key in key_conditions:
            # Use Query (efficient)
            query_params = {
                'TableName': table_name,
                'KeyConditionExpression': Key(partition_key).eq(key_conditions[partition_key])
            }
            
            if filter_conditions:
                filter_expr = filter_conditions[0]
                for cond in filter_conditions[1:]:
                    filter_expr = filter_expr & cond
                query_params['FilterExpression'] = filter_expr
            
            return {'type': 'query', 'params': query_params}
        else:
            # Use Scan (less efficient)
            scan_params = {'TableName': table_name}
            
            if filter_conditions:
                filter_expr = filter_conditions[0]
                for cond in filter_conditions[1:]:
                    filter_expr = filter_expr & cond
                scan_params['FilterExpression'] = filter_expr
            
            return {'type': 'scan', 'params': scan_params}
    
    async def execute_partiql(self, partiql: str, limit: int = 1000) -> List[Dict[str, Any]]:
        """Execute PartiQL query"""
        try:
            response = self.client.execute_statement(
                Statement=partiql,
                Limit=limit
            )
            
            # Convert DynamoDB format to regular dict
            items = []
            for item in response.get('Items', []):
                items.append(self._deserialize_item(item))
            
            return items
        except Exception as e:
            print(f"PartiQL execution failed: {e}")
            return []
    
    async def execute_sdk_query(self, query_spec: Dict[str, Any], limit: int = 1000) -> List[Dict[str, Any]]:
        """Execute SDK query (Query or Scan)"""
        try:
            query_spec['params']['Limit'] = limit
            
            if query_spec['type'] == 'query':
                response = self.client.query(**query_spec['params'])
            else:
                response = self.client.scan(**query_spec['params'])
            
            # Convert to regular dicts
            items = []
            for item in response.get('Items', []):
                items.append(self._deserialize_item(item))
            
            return items
        except Exception as e:
            print(f"SDK query execution failed: {e}")
            return []
    
    def _deserialize_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Convert DynamoDB item format to regular dict"""
        result = {}
        for key, value in item.items():
            if 'S' in value:
                result[key] = value['S']
            elif 'N' in value:
                result[key] = float(value['N'])
            elif 'BOOL' in value:
                result[key] = value['BOOL']
            elif 'NULL' in value:
                result[key] = None
            elif 'L' in value:
                result[key] = [self._deserialize_item({'item': v})['item'] for v in value['L']]
            elif 'M' in value:
                result[key] = self._deserialize_item(value['M'])
            else:
                result[key] = value
        return result
    
    async def execute_nl_query(
        self,
        query: str,
        table_name: str,
        schema: Optional[Dict[str, Any]] = None,
        limit: int = 1000,
        use_partiql: bool = False
    ) -> Dict[str, Any]:
        """
        Execute natural language query against DynamoDB.
        
        Args:
            use_partiql: If True, use PartiQL. If False, use SDK (more efficient)
        """
        if use_partiql:
            # Use PartiQL
            partiql = self.nl_to_partiql(query, table_name, schema)
            results = await self.execute_partiql(partiql, limit)
            
            return {
                'data': results,
                'query_type': 'partiql',
                'query': partiql,
                'table': table_name,
                'count': len(results)
            }
        else:
            # Use SDK (more efficient)
            query_spec = self.nl_to_sdk_query(query, table_name, schema)
            results = await self.execute_sdk_query(query_spec, limit)
            
            return {
                'data': results,
                'query_type': query_spec['type'],
                'query': query_spec['params'],
                'table': table_name,
                'count': len(results)
            }


def create_dynamodb_connector(
    region: str = 'us-east-1',
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None
) -> DynamoDBConnector:
    """Factory function to create DynamoDB connector"""
    return DynamoDBConnector(region, aws_access_key_id, aws_secret_access_key)
