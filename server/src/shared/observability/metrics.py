"""
Metrics Collection and Monitoring
Tracks: Query latency, cache hit rates, LLM token usage, error rates
"""
from typing import Dict, List, Any, Optional
from collections import defaultdict, deque
from datetime import datetime, timedelta
import statistics
import threading


class MetricsCollector:
    """
    Collects and aggregates metrics for monitoring and alerting.
    Thread-safe for concurrent access.
    """
    
    def __init__(self, retention_minutes: int = 60):
        self.retention = timedelta(minutes=retention_minutes)
        self.lock = threading.Lock()
        
        # Time-series metrics (timestamp, value)
        self.latencies: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))
        self.counters: Dict[str, int] = defaultdict(int)
        self.gauges: Dict[str, float] = {}
        self.histograms: Dict[str, List[float]] = defaultdict(list)
        
        # Error tracking
        self.errors: deque = deque(maxlen=100)
        
        # LLM usage tracking
        self.llm_calls: deque = deque(maxlen=1000)
    
    def record_latency(self, metric_name: str, duration_ms: float) -> None:
        """Record latency metric"""
        with self.lock:
            self.latencies[metric_name].append((datetime.now(), duration_ms))
    
    def increment_counter(self, metric_name: str, value: int = 1) -> None:
        """Increment counter metric"""
        with self.lock:
            self.counters[metric_name] += value
    
    def set_gauge(self, metric_name: str, value: float) -> None:
        """Set gauge metric (current value)"""
        with self.lock:
            self.gauges[metric_name] = value
    
    def record_histogram(self, metric_name: str, value: float) -> None:
        """Record value for histogram"""
        with self.lock:
            self.histograms[metric_name].append(value)
            # Keep only recent values
            if len(self.histograms[metric_name]) > 1000:
                self.histograms[metric_name] = self.histograms[metric_name][-1000:]
    
    def record_error(self, error_type: str, error_message: str, context: Optional[Dict] = None) -> None:
        """Record error occurrence"""
        with self.lock:
            self.errors.append({
                'timestamp': datetime.now(),
                'type': error_type,
                'message': error_message,
                'context': context or {}
            })
            self.increment_counter(f"errors.{error_type}")
    
    def record_llm_call(
        self,
        model: str,
        tokens_prompt: int,
        tokens_completion: int,
        duration_ms: float,
        success: bool = True
    ) -> None:
        """Record LLM API call metrics"""
        with self.lock:
            self.llm_calls.append({
                'timestamp': datetime.now(),
                'model': model,
                'tokens_prompt': tokens_prompt,
                'tokens_completion': tokens_completion,
                'tokens_total': tokens_prompt + tokens_completion,
                'duration_ms': duration_ms,
                'success': success
            })
            
            self.increment_counter(f"llm.calls.{model}")
            self.increment_counter(f"llm.tokens.{model}", tokens_prompt + tokens_completion)
            self.record_latency(f"llm.latency.{model}", duration_ms)
    
    def get_latency_stats(self, metric_name: str) -> Dict[str, float]:
        """Get latency statistics (p50, p95, p99)"""
        with self.lock:
            if metric_name not in self.latencies or not self.latencies[metric_name]:
                return {'p50': 0, 'p95': 0, 'p99': 0, 'avg': 0, 'count': 0}
            
            # Filter recent values
            cutoff = datetime.now() - self.retention
            recent_values = [
                value for timestamp, value in self.latencies[metric_name]
                if timestamp > cutoff
            ]
            
            if not recent_values:
                return {'p50': 0, 'p95': 0, 'p99': 0, 'avg': 0, 'count': 0}
            
            sorted_values = sorted(recent_values)
            count = len(sorted_values)
            
            return {
                'p50': sorted_values[int(count * 0.50)] if count > 0 else 0,
                'p95': sorted_values[int(count * 0.95)] if count > 0 else 0,
                'p99': sorted_values[int(count * 0.99)] if count > 0 else 0,
                'avg': statistics.mean(sorted_values) if count > 0 else 0,
                'count': count
            }
    
    def get_counter(self, metric_name: str) -> int:
        """Get counter value"""
        with self.lock:
            return self.counters.get(metric_name, 0)
    
    def get_gauge(self, metric_name: str) -> Optional[float]:
        """Get gauge value"""
        with self.lock:
            return self.gauges.get(metric_name)
    
    def get_histogram_stats(self, metric_name: str) -> Dict[str, float]:
        """Get histogram statistics"""
        with self.lock:
            if metric_name not in self.histograms or not self.histograms[metric_name]:
                return {'min': 0, 'max': 0, 'avg': 0, 'count': 0}
            
            values = self.histograms[metric_name]
            return {
                'min': min(values),
                'max': max(values),
                'avg': statistics.mean(values),
                'count': len(values)
            }
    
    def get_error_rate(self, error_type: Optional[str] = None, window_minutes: int = 5) -> float:
        """Calculate error rate (errors per minute)"""
        with self.lock:
            cutoff = datetime.now() - timedelta(minutes=window_minutes)
            
            if error_type:
                recent_errors = [
                    e for e in self.errors
                    if e['timestamp'] > cutoff and e['type'] == error_type
                ]
            else:
                recent_errors = [e for e in self.errors if e['timestamp'] > cutoff]
            
            return len(recent_errors) / window_minutes if window_minutes > 0 else 0
    
    def get_llm_usage_stats(self, window_minutes: int = 60) -> Dict[str, Any]:
        """Get LLM usage statistics"""
        with self.lock:
            cutoff = datetime.now() - timedelta(minutes=window_minutes)
            recent_calls = [c for c in self.llm_calls if c['timestamp'] > cutoff]
            
            if not recent_calls:
                return {
                    'total_calls': 0,
                    'total_tokens': 0,
                    'avg_tokens_per_call': 0,
                    'success_rate': 0,
                    'by_model': {}
                }
            
            total_tokens = sum(c['tokens_total'] for c in recent_calls)
            successful_calls = sum(1 for c in recent_calls if c['success'])
            
            # Group by model
            by_model = defaultdict(lambda: {'calls': 0, 'tokens': 0})
            for call in recent_calls:
                by_model[call['model']]['calls'] += 1
                by_model[call['model']]['tokens'] += call['tokens_total']
            
            return {
                'total_calls': len(recent_calls),
                'total_tokens': total_tokens,
                'avg_tokens_per_call': total_tokens / len(recent_calls),
                'success_rate': successful_calls / len(recent_calls),
                'by_model': dict(by_model)
            }
    
    def get_dashboard_metrics(self) -> Dict[str, Any]:
        """Get all metrics for monitoring dashboard"""
        return {
            'query_latency': self.get_latency_stats('query.total'),
            'nl2sql_latency': self.get_latency_stats('nl2sql.generation'),
            'chart_latency': self.get_latency_stats('chart.generation'),
            'insight_latency': self.get_latency_stats('insight.generation'),
            'error_rate': self.get_error_rate(),
            'llm_usage': self.get_llm_usage_stats(),
            'cache_hit_rate': self.get_gauge('cache.hit_rate'),
            'active_queries': self.get_gauge('queries.active'),
            'total_queries': self.get_counter('queries.total'),
            'total_errors': self.get_counter('errors.total')
        }
    
    def reset(self) -> None:
        """Reset all metrics (for testing)"""
        with self.lock:
            self.latencies.clear()
            self.counters.clear()
            self.gauges.clear()
            self.histograms.clear()
            self.errors.clear()
            self.llm_calls.clear()


# Global metrics collector
_metrics_collector = None

def get_metrics_collector() -> MetricsCollector:
    """Get or create global metrics collector"""
    global _metrics_collector
    if _metrics_collector is None:
        _metrics_collector = MetricsCollector()
    return _metrics_collector
