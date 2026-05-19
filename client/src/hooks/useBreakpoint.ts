import { useState, useEffect } from 'react';

type Breakpoints = {
    xs?: boolean;
    sm?: boolean;
    md?: boolean;
    lg?: boolean;
    xl?: boolean;
    xxl?: boolean;
};

const breakpoints = {
    xs: '(max-width: 575px)',
    sm: '(min-width: 576px)',
    md: '(min-width: 768px)',
    lg: '(min-width: 992px)',
    xl: '(min-width: 1200px)',
    xxl: '(min-width: 1600px)',
};

const useBreakpoint = (): Breakpoints => {
    const [screens, setScreens] = useState<Breakpoints>({});

    useEffect(() => {
        const mediaQueryLists: { [key: string]: MediaQueryList } = {};
        const listeners: { [key: string]: (e: MediaQueryListEvent) => void } =
            {};

        Object.entries(breakpoints).forEach(([key, query]) => {
            mediaQueryLists[key] = window.matchMedia(query);
            listeners[key] = (e: MediaQueryListEvent) => {
                setScreens((prev) => ({
                    ...prev,
                    [key]: e.matches,
                }));
            };
            mediaQueryLists[key].addListener(listeners[key]);
            setScreens((prev) => ({
                ...prev,
                [key]: mediaQueryLists[key].matches,
            }));
        });

        return () => {
            Object.entries(mediaQueryLists).forEach(([key, mql]) => {
                mql.removeListener(listeners[key]);
            });
        };
    }, []);

    return screens;
};

export default useBreakpoint;
