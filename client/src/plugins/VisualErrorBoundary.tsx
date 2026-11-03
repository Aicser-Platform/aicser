'use client';

import React from 'react';
import { Button } from 'antd';
import { WarningOutlined } from '@ant-design/icons';

interface VisualErrorBoundaryProps {
  chartType: string;
  children: React.ReactNode;
}

interface VisualErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class VisualErrorBoundary extends React.Component<
  VisualErrorBoundaryProps,
  VisualErrorBoundaryState
> {
  constructor(props: VisualErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): VisualErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected error rendering visual plug-in',
    };
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="visual-error-boundary"
          className="flex h-full w-full flex-col items-center justify-center rounded-lg border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)] px-4 py-6 text-center"
        >
          <WarningOutlined className="mb-2 text-xl text-[var(--ant-color-error)]" />
          <div className="text-xs font-semibold text-[var(--ant-color-text)]">
            Failed to render {this.props.chartType} visual
          </div>
          {this.state.errorMessage && (
            <div className="mt-1 max-w-sm text-[11px] text-[var(--ant-color-text-secondary)]">
              {this.state.errorMessage}
            </div>
          )}
          <Button size="small" className="mt-3" onClick={this.handleRetry}>
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

