export const getPageTitle = (pathname: string | null, baseTitle = '') => {
    const basePath = baseTitle;

    if (!pathname) return basePath;

    const path = pathname.split('/').pop();
    if (!path) return basePath;

    return `${path.charAt(0).toUpperCase()}${path.slice(1)}${
        basePath ? ` - ${basePath}` : ''
    }`;
};
