import { useEffect, useRef } from 'react';

interface UseReverseInfiniteScrollProps<T> {
    loading: boolean;
    hasMore: boolean;
    onFetch: (offset: number) => void;
    currentItems: T[];
}

export const useReverseInfiniteScroll = <T>({
    loading,
    hasMore,
    onFetch,
    currentItems,
}: UseReverseInfiniteScrollProps<T>) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, offsetHeight } = e.currentTarget;

        const scrollPosition = Math.abs(scrollTop);
        // const scrollPercentage = (scrollPosition + offsetHeight) / scrollHeight;
        // const SCROLL_THRESHOLD = 0.8;

        const remainingScroll = scrollHeight - offsetHeight - scrollPosition;

        if (remainingScroll < 100)
            if (!loading && hasMore) {
                onFetch(currentItems.length);
            }
    };

    useEffect(() => {
        if (containerRef.current) {
            const { scrollHeight, clientHeight } = containerRef.current;
            const scrollPosition = Math.abs(scrollHeight);
            if (!loading && hasMore && scrollPosition <= clientHeight) {
                onFetch(currentItems.length);
            }
        }
    }, [currentItems, loading, hasMore, onFetch]);

    return { containerRef, handleScroll };
};
