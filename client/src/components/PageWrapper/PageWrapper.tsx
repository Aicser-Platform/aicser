'use client';

import React from 'react';
import { Spin } from 'antd';

interface PageWrapperProps {
  children: React.ReactNode;
  loading?: boolean;
  className?: string;
  title?: string;
  description?: string;
}

const PageWrapper: React.FC<PageWrapperProps> = React.memo(({ 
  children, 
  loading = false, 
  className = '',
  title,
  description 
}) => {
  if (loading) {
    return (
      <div className="page-container">
        <div className="page-content flex items-center justify-center">
          <Spin size="large" />
        </div>
      </div>
    );
  }

  return (
    <div className={`page-container ${className}`}>
      <div className="page-content">
        {title && (
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-2">{title}</h1>
            {description && (
              <p className="text-gray-600 dark:text-gray-400">{description}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
});

PageWrapper.displayName = 'PageWrapper';

export default PageWrapper;
