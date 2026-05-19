import { useEffect, useRef } from 'react';

interface UseInfiniteScrollProps<T> {
    loading: boolean;
    hasMore: boolean;
    onFetch: (offset: number) => void;
    currentItems: T[];
}

export const useInfiniteScroll = <T>({
    loading,
    hasMore,
    onFetch,
    currentItems,
}: UseInfiniteScrollProps<T>) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        if (
            !loading &&
            hasMore &&
            (scrollTop + clientHeight) / scrollHeight > 0.8
        ) {
            onFetch(currentItems.length);
        }
    };

    useEffect(() => {
        // Only fetch if hasMore and we are not loading AND currentItems is empty
        // This prevents immediate re-fetching if the initial load already populated some items
        if (!loading && hasMore && currentItems.length === 0) {
            onFetch(0); // Fetch from the beginning if no items are loaded yet
        }
    }, [loading, hasMore, onFetch, currentItems.length]); // Depend on currentItems.length

    return { containerRef, handleScroll };
};
