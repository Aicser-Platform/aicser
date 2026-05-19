export const useCssVar = (variable: string, theme?: 'dark' | 'light') => {
    if (typeof window !== 'undefined') {
        // Create temporary element with data-theme
        const tempElement = document.createElement('div');
        if (theme) {
            tempElement.setAttribute('data-theme', theme);
            document.body.appendChild(tempElement);
        }

        // Get computed value based on theme
        const value = theme
            ? getComputedStyle(tempElement).getPropertyValue(variable).trim()
            : getComputedStyle(document.documentElement)
                  .getPropertyValue(variable)
                  .trim();

        // Cleanup
        if (theme) {
            document.body.removeChild(tempElement);
        }

        return value;
    }
    return '';
};
