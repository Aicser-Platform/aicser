'use client';

import React, { useState } from 'react';
import { Button, Card, Layout, Space, Typography, ConfigProvider, theme } from 'antd';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function DarkModeValidationPage() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#00c2cb',
        },
      }}
    >
      <Layout style={{ height: '100vh' }}>
        <Header style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '0 24px'
        }}>
          <Title level={3} style={{ margin: 0, color: 'inherit' }}>
            Dark Mode Validation Test
          </Title>
          <Button 
            type="primary" 
            onClick={() => setIsDarkMode(!isDarkMode)}
            size="large"
          >
            Toggle Dark Mode
          </Button>
        </Header>
        
        <Layout>
          <Sider width={200} style={{ padding: '16px' }}>
            <Card title="Sidebar Test" size="small">
              <Text>This should be dark in dark mode</Text>
            </Card>
          </Sider>
          
          <Content style={{ padding: '24px' }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Card title="Main Content Test">
                <Text>This should be dark in dark mode</Text>
                <br />
                <Text type="secondary">Secondary text should also be themed</Text>
              </Card>
              
              <Card title="CSS Variables Test">
                <div style={{ 
                  padding: '16px', 
                  background: 'var(--ant-color-bg-container)',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: '6px',
                  marginBottom: '16px'
                }}>
                  <Text>Container Background: var(--ant-color-bg-container)</Text>
                </div>
                
                <div style={{ 
                  padding: '16px', 
                  background: 'var(--ant-color-bg-layout)',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: '6px',
                  marginBottom: '16px'
                }}>
                  <Text>Layout Background: var(--ant-color-bg-layout)</Text>
                </div>
                
                <div style={{ 
                  padding: '16px', 
                  background: 'var(--ant-color-bg-elevated)',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: '6px'
                }}>
                  <Text>Elevated Background: var(--ant-color-bg-elevated)</Text>
                </div>
              </Card>
              
              <Card title="Debug Information">
                <Text strong>Current Mode: </Text>
                <Text code>{isDarkMode ? 'Dark' : 'Light'}</Text>
                <br />
                <Text strong>Algorithm: </Text>
                <Text code>{isDarkMode ? 'darkAlgorithm' : 'defaultAlgorithm'}</Text>
                <br />
                <Text strong>CSS Variables (check browser console):</Text>
                <br />
                <Text code>
                  --ant-color-bg-container: {typeof window !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--ant-color-bg-container') : 'N/A'}
                </Text>
                <br />
                <Text code>
                  --ant-color-bg-layout: {typeof window !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--ant-color-bg-layout') : 'N/A'}
                </Text>
                <br />
                <Text code>
                  --ant-color-text: {typeof window !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--ant-color-text') : 'N/A'}
                </Text>
              </Card>
            </Space>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
