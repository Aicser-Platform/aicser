'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Result, Button, Card, Typography, Space, Alert } from 'antd';
import { ReloadOutlined, BugOutlined, HomeOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: ''
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Log error to external service in production
    if (process.env.NODE_ENV === 'production') {
      this.logErrorToService(error, errorInfo);
    }

    this.setState({
      error,
      errorInfo
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  logErrorToService = (error: Error, errorInfo: ErrorInfo) => {
    // In a real application, you would send this to your error tracking service
    // For now, we'll just log it to the console
    console.error('Error logged to service:', {
      errorId: this.state.errorId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  handleReportBug = () => {
    // In a real application, you would open a bug report form or redirect to a support page
    const errorDetails = {
      errorId: this.state.errorId,
      message: this.state.error?.message,
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      url: window.location.href
    };

    // Copy error details to clipboard
    navigator.clipboard.writeText(JSON.stringify(errorDetails, null, 2))
      .then(() => {
        alert('Error details copied to clipboard. Please paste them in your bug report.');
      })
      .catch(() => {
        // Fallback: show error details in a modal
        const errorText = JSON.stringify(errorDetails, null, 2);
        const newWindow = window.open('', '_blank');
        if (newWindow) {
          // Avoid writing raw <html> tags which can confuse Next.js prerender.
          newWindow.document.body.innerHTML = `
            <div>
              <h1>Error Report</h1>
              <pre>${errorText}</pre>
              <p>Please copy this information and send it to our support team.</p>
            </div>
          `;
        }
      });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI - Render without layout/header
      return (
        <div 
          data-error-boundary="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            minHeight: '100vh', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '20px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            zIndex: 10000, // Above header
          }}
        >
        <Card 
            style={{ 
              maxWidth: '600px', 
              width: '100%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
            }}
          >
            <Result
              status="error"
              icon={<BugOutlined style={{ color: '#ff4d4f' }} />}
              title="Something went wrong"
              subTitle={
                <Space direction="vertical" size="small">
                  <Text type="secondary">
                    We're sorry, but something unexpected happened. Our team has been notified.
                  </Text>
                  {process.env.NODE_ENV === 'development' && (
                    <Alert
                      message="Development Error Details"
                      description={
                        <div>
                          <Text code>{this.state.error?.message}</Text>
                          <details style={{ marginTop: '10px' }}>
                            <summary>Stack Trace</summary>
                            <pre className="data-content" style={{ 
                              fontSize: '12px', 
                              background: '#f5f5f5', 
                              padding: '10px',
                              borderRadius: '4px',
                              overflow: 'auto',
                              maxHeight: '200px'
                            }}>
                              {this.state.error?.stack}
                            </pre>
                          </details>
                        </div>
                      }
                      type="warning"
                      showIcon
                    />
                  )}
                </Space>
              }
              extra={[
                <Button 
                  key="reload" 
                  type="primary" 
                  icon={<ReloadOutlined />} 
                  onClick={this.handleReload}
                >
                  Reload Page
                </Button>,
                <Button 
                  key="home" 
                  icon={<HomeOutlined />} 
                  onClick={this.handleGoHome}
                >
                  Go Home
                </Button>,
                <Button 
                  key="report" 
                  onClick={this.handleReportBug}
                >
                  Report Bug
                </Button>
              ]}
            />
            
            {this.state.errorId && (
              <div style={{ 
                marginTop: '20px', 
                padding: '10px', 
                background: '#f5f5f5', 
                borderRadius: '4px',
                textAlign: 'center'
              }}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Error ID: {this.state.errorId}
                </Text>
              </div>
            )}
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
