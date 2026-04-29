from dataclasses import dataclass

from src.shared.schemas import PaginationSchema


@dataclass
class PaginationParams:
    offset: int
    limit: int
    total_count: int


class PaginationCalculator:
    def __init__(self, offset: int = 0, limit: int = 100, total_count: int = 0):
        self.params = PaginationParams(
            offset=max(0, offset),  # Ensure offset is not negative
            limit=max(1, min(limit, 1000)),  # Limit between 1 and 1000
            total_count=max(0, total_count),  # Ensure count is not negative
        )

    def calculate(self) -> PaginationSchema:
        """Calculate pagination details."""
        return PaginationSchema(
            page=self._calculate_current_page(),
            size=self.params.limit,
            total=self.params.total_count,
            pages=self._calculate_total_pages(),
        )

    def _calculate_current_page(self) -> int:
        """Calculate the current page number."""
        return (self.params.offset // self.params.limit) + 1

    def _calculate_total_pages(self) -> int:
        """Calculate total number of pages."""
        return max(
            1, (self.params.total_count + self.params.limit - 1) // self.params.limit
        )


def paginate(offset: int = 0, limit: int = 100, count: int = 0) -> PaginationSchema:
    """Convenience function for pagination calculation."""
    calculator = PaginationCalculator(offset, limit, count)
    return calculator.calculate()
