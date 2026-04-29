"""
Cassandra Connector - Natural language to CQL (Cassandra Query Language)
Supports: Cassandra 3.0+, partition key awareness, materialized views
"""
from typing import Dict, List, Any, Optional, Tuple
import re

try:
    from cassandra.cluster import Cluster
    from cassandra.auth import PlainTextAuthProvider
    from cassandra.query import SimpleStatement
    CASSANDRA_AVAILABLE = True
except ImportError:
    CASSANDRA_AVAILABLE = False
    print("Warning: cassandra-driver not installed. Cassandra support disabled.")


class CassandraConnector:
    """
    Cassandra connector with NL2CQL (Natural Language to CQL).
    Handles Cassandra-specific constraints (partition keys, no JOINs, etc.)
    """
    
    def __init__(self, contact_points: List[str], keyspace: str, username: Optional[str] = None, password: Optional[str] = None):
        if not CASSANDRA_AVAILABLE:
            raise ImportError("cassandra-driver is required for Cassandra support")
        
        self.contact_points = contact_points
        self.keyspace = keyspace
        self.username = username
        self.password = password
        self.cluster = None
        self.session = None
    
    def connect(self) -> bool:
        """Establish connection to Cassandra cluster"""
        try:
            if self.username and self.password:
                auth_provider = PlainTextAuthProvider(username=self.username, password=self.password)
                self.cluster = Cluster(self.contact_points, auth_provider=auth_provider)
            else:
                self.cluster = Cluster(self.contact_points)
            
            self.session = self.cluster.connect(self.keyspace)
            return True
        except Exception as e:
            print(f"Cassandra connection failed: {e}")
            return False
    
    def disconnect(self) -> None:
        """Close Cassandra connection"""
        if self.cluster:
            self.cluster.shutdown()
    
    async def get_schema(self) -> Dict[str, Any]:
        """
        Extract schema from Cassandra keyspace.
        Includes partition keys, clustering keys, and column types.
        """
        if not self.session:
            self.connect()
        
        schema = {}
        
        # Query system schema tables
        tables_query = f"SELECT table_name FROM system_schema.tables WHERE keyspace_name = '{self.keyspace}'"
        tables = self.session.execute(tables_query)
        
        for table_row in tables:
            table_name = table_row.table_name
            
            # Get columns
            columns_query = f"""
                SELECT column_name, type, kind 
                FROM system_schema.columns 
                WHERE keyspace_name = '{self.keyspace}' AND table_name = '{table_name}'
            """
            columns = self.session.execute(columns_query)
            
            partition_keys = []
            clustering_keys = []
            regular_columns = []
            
            for col in columns:
                col_info = {
                    'name': col.column_name,
                    'type': col.type,
                    'kind': col.kind
                }
                
                if col.kind == 'partition_key':
                    partition_keys.append(col_info)
                elif col.kind == 'clustering':
                    clustering_keys.append(col_info)
                else:
                    regular_columns.append(col_info)
            
            schema[table_name] = {
                'partition_keys': partition_keys,
                'clustering_keys': clustering_keys,
                'columns': regular_columns,
                'all_columns': partition_keys + clustering_keys + regular_columns
            }
        
        return schema
    
    def nl_to_cql(
        self,
        query: str,
        table: str,
        schema: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Convert natural language query to CQL.
        
        Cassandra constraints:
        - Must include partition key in WHERE clause
        - No JOINs (denormalized data model)
        - Limited aggregations
        - ALLOW FILTERING for non-key queries (slow)
        """
        query_lower = query.lower()
        
        # Get table schema
        table_schema = schema.get(table, {}) if schema else {}
        partition_keys = [pk['name'] for pk in table_schema.get('partition_keys', [])]
        all_columns = [col['name'] for col in table_schema.get('all_columns', [])]
        
        # Build SELECT clause
        select_clause = self._extract_select_clause(query_lower, all_columns)
        
        # Build WHERE clause (must include partition key)
        where_clause, needs_filtering = self._extract_where_clause(query_lower, partition_keys, all_columns)
        
        # Build ORDER BY clause (only on clustering keys)
        order_clause = self._extract_order_clause(query_lower, table_schema.get('clustering_keys', []))
        
        # Build LIMIT clause
        limit_clause = self._extract_limit_clause(query_lower)
        
        # Construct CQL
        cql = f"SELECT {select_clause} FROM {table}"
        
        if where_clause:
            cql += f" WHERE {where_clause}"
        
        if order_clause:
            cql += f" ORDER BY {order_clause}"
        
        if limit_clause:
            cql += f" LIMIT {limit_clause}"
        
        # Add ALLOW FILTERING if needed (warn: performance impact)
        if needs_filtering:
            cql += " ALLOW FILTERING"
        
        return cql


    
    def _extract_select_clause(self, query: str, columns: List[str]) -> str:
        """Extract SELECT fields"""
        # Check for aggregations
        if 'count' in query:
            return 'COUNT(*)'
        
        # Check for specific columns
        select_pattern = r'select\s+([\w,\s]+?)(?:\s+from|\s+where|$)'
        match = re.search(select_pattern, query)
        
        if match:
            fields = match.group(1).strip()
            if fields == '*' or 'all' in fields:
                return '*'
            return fields
        
        return '*'
    
    def _extract_where_clause(self, query: str, partition_keys: List[str], all_columns: List[str]) -> Tuple[str, bool]:
        """
        Extract WHERE clause.
        Returns: (where_clause, needs_allow_filtering)
        """
        conditions = []
        has_partition_key = False
        needs_filtering = False
        
        # Equal conditions
        eq_pattern = r'where\s+(\w+)\s*=\s*["\']([^"\']+)["\']'
        for match in re.finditer(eq_pattern, query):
            field, value = match.groups()
            if field in all_columns:
                conditions.append(f"{field} = '{value}'")
                if field in partition_keys:
                    has_partition_key = True
        
        # Numeric conditions
        num_pattern = r'where\s+(\w+)\s*([><=]+)\s*(\d+)'
        for match in re.finditer(num_pattern, query):
            field, op, value = match.groups()
            if field in all_columns:
                conditions.append(f"{field} {op} {value}")
                if field in partition_keys:
                    has_partition_key = True
        
        # If no partition key in WHERE, need ALLOW FILTERING
        if conditions and not has_partition_key:
            needs_filtering = True
        
        where_clause = ' AND '.join(conditions) if conditions else ''
        return where_clause, needs_filtering
    
    def _extract_order_clause(self, query: str, clustering_keys: List[Dict]) -> str:
        """Extract ORDER BY (only valid on clustering keys in Cassandra)"""
        order_pattern = r'order by\s+(\w+)(?:\s+(asc|desc))?'
        match = re.search(order_pattern, query)
        
        if match:
            field = match.group(1)
            direction = match.group(2) if match.group(2) else 'ASC'
            
            # Check if field is a clustering key
            clustering_key_names = [ck['name'] for ck in clustering_keys]
            if field in clustering_key_names:
                return f"{field} {direction.upper()}"
        
        return ''
    
    def _extract_limit_clause(self, query: str) -> str:
        """Extract LIMIT"""
        limit_pattern = r'(?:limit|top)\s+(\d+)'
        match = re.search(limit_pattern, query)
        return match.group(1) if match else ''
    
    async def execute_query(self, cql: str, limit: int = 1000) -> List[Dict[str, Any]]:
        """Execute CQL query"""
        if not self.session:
            self.connect()
        
        try:
            # Add limit if not present
            if 'LIMIT' not in cql.upper():
                cql += f" LIMIT {limit}"
            
            statement = SimpleStatement(cql, fetch_size=limit)
            rows = self.session.execute(statement)
            
            # Convert to list of dicts
            results = []
            for row in rows:
                results.append(dict(row._asdict()))
            
            return results
        except Exception as e:
            print(f"CQL execution failed: {e}")
            return []
    
    async def execute_nl_query(
        self,
        query: str,
        table: str,
        schema: Optional[Dict[str, Any]] = None,
        limit: int = 1000
    ) -> Dict[str, Any]:
        """Execute natural language query against Cassandra"""
        # Generate CQL
        cql = self.nl_to_cql(query, table, schema)
        
        # Execute
        results = await self.execute_query(cql, limit)
        
        return {
            'data': results,
            'cql': cql,
            'table': table,
            'count': len(results)
        }


def create_cassandra_connector(
    contact_points: List[str],
    keyspace: str,
    username: Optional[str] = None,
    password: Optional[str] = None
) -> CassandraConnector:
    """Factory function to create Cassandra connector"""
    return CassandraConnector(contact_points, keyspace, username, password)
