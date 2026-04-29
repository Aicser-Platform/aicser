"""
SQL Dialect Translation Service
Standardizes SQL queries across different database and warehouse types
to reduce user errors and knowledge requirements.

Uses sqlglot for robust SQL parsing and translation.
"""

import logging
from typing import Dict, Any, Optional, List
import re

logger = logging.getLogger(__name__)

# Try to import sqlglot, fallback to basic translation if not available
SQLGLOT_AVAILABLE = False
try:
    import sqlglot
    from sqlglot import exp, parse_one, transpile
    from sqlglot.dialects import Dialect
    SQLGLOT_AVAILABLE = True
    logger.info("✅ sqlglot imported successfully - using advanced SQL translation")
except ImportError as e:
    SQLGLOT_AVAILABLE = False
    # Log once at module load with installation instruction
    logger.warning(f"⚠️ sqlglot not available - using basic SQL translation. Install for better quality: pip install sqlglot. Import error: {str(e)}")
except Exception as e:
    SQLGLOT_AVAILABLE = False
    logger.warning(f"⚠️ sqlglot import failed - using basic SQL translation. Install for better quality: pip install sqlglot. Error: {str(e)}")


class SQLDialectTranslator:
    """
    Translates SQL queries between different database dialects.
    
    Supports:
    - Standard SQL (ANSI) → PostgreSQL, MySQL, ClickHouse, Snowflake, BigQuery, Redshift, etc.
    - Automatic dialect detection
    - Query validation and error handling
    - Common SQL pattern normalization
    """
    
    # Dialect mapping for sqlglot
    DIALECT_MAP = {
        'postgresql': 'postgres',
        'postgres': 'postgres',
        'mysql': 'mysql',
        'mariadb': 'mysql',
        'clickhouse': 'clickhouse',
        'snowflake': 'snowflake',
        'bigquery': 'bigquery',
        'redshift': 'redshift',
        'sqlserver': 'tsql',
        'mssql': 'tsql',
        'sqlite': 'sqlite',
        'duckdb': 'duckdb',
        'oracle': 'oracle',
        'databricks': 'spark',  # Databricks uses Spark SQL
    }
    
    # Standard SQL subset that works across most databases
    STANDARD_SQL_PATTERNS = {
        # Date functions
        'DATE_TRUNC': {
            'postgres': 'DATE_TRUNC',
            'mysql': 'DATE_FORMAT',  # Different syntax
            'clickhouse': 'toStartOf',
            'snowflake': 'DATE_TRUNC',
            'bigquery': 'DATE_TRUNC',
        },
        # String concatenation
        'CONCAT': {
            'postgres': '||',
            'mysql': 'CONCAT',
            'clickhouse': 'concat',
            'snowflake': '||',
            'bigquery': '||',
        },
        # Limit syntax
        'LIMIT': {
            'postgres': 'LIMIT',
            'mysql': 'LIMIT',
            'clickhouse': 'LIMIT',
            'snowflake': 'LIMIT',
            'bigquery': 'LIMIT',
        },
    }
    
    def __init__(self):
        self.translation_cache = {}
        self.error_log = []
    
    def translate_query(
        self,
        query: str,
        target_dialect: str,
        source_dialect: Optional[str] = None,
        data_source_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Translate SQL query from source dialect to target dialect.
        
        Args:
            query: SQL query string
            source_dialect: Source dialect (auto-detected if None)
            target_dialect: Target dialect (e.g., 'postgresql', 'clickhouse')
            data_source_type: Data source type for context
            
        Returns:
            Dict with translated query, warnings, and metadata
        """
        try:
            # Normalize target dialect
            target_dialect_normalized = self._normalize_dialect(target_dialect, data_source_type)
            
            # Auto-detect source dialect if not provided
            if not source_dialect:
                source_dialect = self._detect_dialect(query)
            
            source_dialect_normalized = self._normalize_dialect(source_dialect, data_source_type)
            
            # If source and target are the same, return as-is
            if source_dialect_normalized == target_dialect_normalized:
                return {
                    'success': True,
                    'translated_query': query,
                    'source_dialect': source_dialect_normalized,
                    'target_dialect': target_dialect_normalized,
                    'warnings': [],
                    'translation_applied': False
                }
            
            # Use sqlglot if available (silently fallback if not)
            if SQLGLOT_AVAILABLE:
                return self._translate_with_sqlglot(
                    query, source_dialect_normalized, target_dialect_normalized
                )
            else:
                # Fallback to basic pattern-based translation
                return self._translate_basic(
                    query, source_dialect_normalized, target_dialect_normalized
                )
                
        except Exception as e:
            logger.error(f"❌ SQL translation failed: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'translated_query': query,  # Return original on error
                'source_dialect': source_dialect,
                'target_dialect': target_dialect,
                'warnings': [f'Translation failed, using original query: {str(e)}']
            }
    
    @staticmethod
    def _looks_truncated(query: str) -> bool:
        """Return True if SQL likely truncated (unclosed string/paren or ends mid-token). Avoid passing to sqlglot."""
        if not query or not query.strip():
            return True
        q = query.strip()
        # Unclosed single-quoted string (odd number of single quotes outside comments)
        if q.count("'") % 2 != 0:
            return True
        # Ends with backslash or open paren/comma (incomplete)
        if q.endswith(("\\", "(", ",")):
            return True
        # Ends mid-word (e.g. date_trunc('mont') -> last char before end is inside a string)
        # Simple heuristic: ends with ' and then non-space (incomplete literal like 'mont)
        if len(q) >= 2 and q[-1] != "'" and q[-2] == "'":
            return True
        # Incomplete literal at end: e.g. date_trunc('wee' or date_trunc('da (no closing quote)
        if re.search(r"'[a-zA-Z]*$", q):
            return True
        # Unclosed bracket (e.g. SQL Server [catalog].[table] truncated to [abaicser_bank_)
        if q.endswith("["):
            return True
        if re.search(r"\[\w*$", q):
            return True
        return False

    def _translate_with_sqlglot(
        self, query: str, source_dialect: str, target_dialect: str
    ) -> Dict[str, Any]:
        """Translate using sqlglot library. Skips sqlglot for truncated SQL to avoid tokenization errors."""
        try:
            if self._looks_truncated(query):
                logger.debug("Skipping sqlglot for likely truncated SQL, using basic translation")
                return self._translate_basic(query, source_dialect, target_dialect)
            # Parse and transpile
            warnings = []
            
            # Try to parse the query. For T-SQL target or T-SQL-looking query, try tsql first so CONVERT/brackets parse.
            parsed = None
            query_upper = query.upper()
            looks_tsql = (
                target_dialect == 'tsql' or
                bool(re.search(r'\bSELECT\s+TOP\s+\d+', query_upper)) or
                'DATEPART(' in query_upper or 'DATEADD(' in query_upper or 'GETDATE()' in query_upper or
                bool(re.search(r'\bCONVERT\s*\(', query_upper)) or
                bool(re.search(r'\[\w+\]', query))
            )
            try:
                # Prefer tsql when query looks T-SQL so CONVERT(VARCHAR(n), col, 120) parses correctly
                if looks_tsql and source_dialect != 'tsql':
                    try:
                        parsed = parse_one(query, dialect='tsql')
                        source_dialect = 'tsql'
                        warnings.append('Parsed as T-SQL')
                    except Exception:
                        pass
                if parsed is None:
                    parsed = parse_one(query, dialect=source_dialect)
            except Exception as parse_error:
                if looks_tsql:
                    try:
                        parsed = parse_one(query, dialect='tsql')
                        source_dialect = 'tsql'
                        warnings.append('Parsed as T-SQL after retry')
                    except Exception:
                        pass
                if parsed is None:
                    try:
                        parsed = parse_one(query)
                        warnings.append('Source dialect detection failed, using generic parser')
                    except Exception:
                        pass
                if parsed is None:
                    raise Exception(f'Failed to parse SQL query: {parse_error}')
            
            # Transpile to target dialect
            try:
                translated = transpile(
                    query,
                    read=source_dialect,
                    write=target_dialect,
                    pretty=False
                )
                
                if translated and len(translated) > 0:
                    translated_query = translated[0]
                else:
                    translated_query = query
                    warnings.append('Translation returned empty result, using original')
                    
            except Exception as transpile_error:
                # If transpilation fails, try basic fixes
                translated_query = self._apply_basic_fixes(query, target_dialect)
                warnings.append(f'Full translation failed, applied basic fixes: {transpile_error}')
            
            # Validate translated query
            validation_result = self._validate_translated_query(translated_query, target_dialect)
            if not validation_result['valid']:
                warnings.extend(validation_result.get('warnings', []))
            
            return {
                'success': True,
                'translated_query': translated_query,
                'source_dialect': source_dialect,
                'target_dialect': target_dialect,
                'warnings': warnings,
                'translation_applied': True
            }
            
        except Exception as e:
            # Root cause: valid T-SQL (e.g. CONVERT) can fail sqlglot parse/transpile. Keep original and do not reject.
            if target_dialect == 'tsql':
                logger.debug("Keeping original T-SQL (sqlglot parse/transpile failed): %s", str(e)[:100])
                return {
                    'success': True,
                    'translated_query': query,
                    'source_dialect': source_dialect,
                    'target_dialect': target_dialect,
                    'warnings': ['Translation skipped; using original T-SQL'],
                    'translation_applied': False,
                }
            logger.warning(f"⚠️ sqlglot translation failed (likely truncated or malformed SQL): {str(e)}")
            return self._translate_basic(query, source_dialect, target_dialect)
    
    def _translate_basic(
        self, query: str, source_dialect: str, target_dialect: str
    ) -> Dict[str, Any]:
        """Basic pattern-based translation (fallback)"""
        warnings = []
        translated = query
        
        # ClickHouse-specific fixes (MINIMAL - trust LLM output)
        if target_dialect == 'clickhouse':
            # Only apply minimal, safe fixes
            # Remove trailing semicolons (safe)
            translated = translated.rstrip(';').strip()
            
            # Don't add FORMAT clause automatically - let ClickHouse use default or let LLM specify
            # Adding FORMAT can break queries that don't need it
        
        # MySQL-specific fixes
        if target_dialect == 'mysql':
            # Replace PostgreSQL-specific functions
            translated = re.sub(r'DATE_TRUNC\s*\(', 'DATE_FORMAT(', translated, flags=re.IGNORECASE)
            # Replace || with CONCAT
            translated = re.sub(r'\|\|', 'CONCAT', translated)
        
        # BigQuery-specific fixes
        if target_dialect == 'bigquery':
            # Replace standard SQL functions with BigQuery equivalents
            # (BigQuery is mostly standard SQL compatible)
            pass
        
        # Snowflake-specific fixes
        if target_dialect == 'snowflake':
            # Snowflake is mostly standard SQL compatible
            pass
        
        # Only add warning once per session to reduce log noise
        if not hasattr(self, '_sqlglot_warning_logged'):
            warnings.append('Used basic translation (sqlglot not available)')
            self._sqlglot_warning_logged = True
            logger.warning("⚠️ sqlglot not available - using basic SQL translation. Install sqlglot for better translation quality: pip install sqlglot")
        
        return {
            'success': True,
            'translated_query': translated,
            'source_dialect': source_dialect,
            'target_dialect': target_dialect,
            'warnings': warnings,
            'translation_applied': True
        }
    
    def _apply_basic_fixes(self, query: str, target_dialect: str) -> str:
        """Apply basic SQL fixes for target dialect"""
        fixed = query
        
        # ClickHouse: Remove semicolons before FORMAT, ensure FORMAT
        if target_dialect == 'clickhouse':
            fixed = re.sub(r';\s*(FORMAT\s+)', ' \1', fixed, flags=re.IGNORECASE)
            if not re.search(r'\bFORMAT\s+\w+', fixed, re.IGNORECASE):
                if re.search(r'^\s*SELECT', fixed, re.IGNORECASE):
                    fixed = fixed.rstrip(';').strip() + ' FORMAT JSONEachRow'
            else:
                fixed = fixed.rstrip(';').strip() # Ensure no trailing semicolon even if format is present
        
        return fixed
    
    def _normalize_dialect(self, dialect: str, data_source_type: Optional[str] = None) -> str:
        """Normalize dialect name to sqlglot format"""
        if not dialect:
            return 'postgres'  # Default to PostgreSQL
        
        dialect_lower = dialect.lower()
        
        # Use mapping if available
        if dialect_lower in self.DIALECT_MAP:
            return self.DIALECT_MAP[dialect_lower]
        
        # Try direct match (include tsql so detected T-SQL is preserved and source==target for SQL Server)
        if dialect_lower in ['postgres', 'mysql', 'clickhouse', 'snowflake', 'bigquery', 'redshift', 'sqlite', 'duckdb', 'tsql']:
            return dialect_lower
        
        # Fallback based on data source type
        if data_source_type:
            type_lower = data_source_type.lower()
            if type_lower in self.DIALECT_MAP:
                return self.DIALECT_MAP[type_lower]
        
        # Default to postgres
        return 'postgres'
    
    def _detect_dialect(self, query: str) -> str:
        """Auto-detect SQL dialect from query patterns. T-SQL first so CONVERT/brackets parse correctly."""
        query_upper = query.upper()
        # T-SQL / SQL Server patterns (detect before postgres so CONVERT/brackets don't fail as postgres)
        if re.search(r'\bSELECT\s+TOP\s+\d+', query_upper):
            return 'tsql'
        if 'DATEPART(' in query_upper or 'DATEADD(' in query_upper or 'GETDATE()' in query_upper:
            return 'tsql'
        if re.search(r'\bCONVERT\s*\(', query_upper):  # CONVERT(VARCHAR(n), col, style) is T-SQL
            return 'tsql'
        if re.search(r'\[\w+\]\.\[\w+\]', query):  # [schema].[table] brackets
            return 'tsql'
        if re.search(r'\[\w+\]', query):  # single [identifier] is T-SQL
            return 'tsql'
        
        # ClickHouse patterns
        if 'FORMAT JSONEACHROW' in query_upper or 'FORMAT JSON' in query_upper:
            return 'clickhouse'
        
        # MySQL patterns
        if 'DATE_FORMAT' in query_upper or 'CONCAT(' in query_upper:
            return 'mysql'
        
        # PostgreSQL patterns
        if 'DATE_TRUNC' in query_upper or '||' in query:
            return 'postgres'
        
        # Default to standard SQL (will be treated as PostgreSQL)
        return 'postgres'
    
    def _validate_translated_query(self, query: str, dialect: str) -> Dict[str, Any]:
        """Validate translated query syntax"""
        warnings = []
        
        # Basic validation
        if not query or not query.strip():
            return {'valid': False, 'warnings': ['Query is empty']}
        
        # Check for common issues
        if dialect == 'clickhouse':
            # ClickHouse requires FORMAT clause for SELECT
            if re.search(r'^\s*SELECT', query, re.IGNORECASE):
                if not re.search(r'\bFORMAT\s+\w+', query, re.IGNORECASE):
                    warnings.append('ClickHouse SELECT queries should include FORMAT clause')
            # ClickHouse does not like semicolons right before FORMAT or at the very end if FORMAT is present
            if re.search(r';\s*FORMAT', query, re.IGNORECASE) or (re.search(r'FORMAT\s+\w+$', query, re.IGNORECASE) and query.strip().endswith(';')):
                warnings.append('ClickHouse queries should not have semicolons before FORMAT clause or at the very end if FORMAT is present.')
        
        return {
            'valid': True,
            'warnings': warnings
        }
    
    def standardize_query(
        self,
        query: str,
        target_dialect: str,
        data_source_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Standardize SQL query to target dialect.
        This is the main entry point for users - they write "standard" SQL,
        and it gets translated to the target database.
        """
        # Assume input is "standard" SQL (PostgreSQL-like)
        return self.translate_query(
            query=query,
            target_dialect=target_dialect,
            source_dialect='postgres',  # Treat input as standard SQL
            data_source_type=data_source_type
        )
    
    def get_supported_dialects(self) -> List[str]:
        """Get list of supported SQL dialects"""
        return list(set(self.DIALECT_MAP.values()))


# Global instance
_sql_translator = None

def get_sql_translator() -> SQLDialectTranslator:
    """Get singleton SQL translator instance"""
    global _sql_translator
    if _sql_translator is None:
        _sql_translator = SQLDialectTranslator()
    return _sql_translator

