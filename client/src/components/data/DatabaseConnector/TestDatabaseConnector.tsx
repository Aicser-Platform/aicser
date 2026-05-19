'use client';

import React from 'react';
import DatabaseConnector from './DatabaseConnector';

const TestDatabaseConnector: React.FC = () => {
    const handleConnect = (connection: any) => {
        console.log('Connect:', connection);
    };

    const handleTest = async (connection: any) => {
        console.log('Test:', connection);
        return true;
    };

    return (
        <div>
            <h3>Database Connector Test</h3>
            <DatabaseConnector
                onConnect={handleConnect}
                onTest={handleTest}
                loading={false}
            />
        </div>
    );
};

export default TestDatabaseConnector;