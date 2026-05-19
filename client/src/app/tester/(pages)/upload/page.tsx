'use client';

// Simple dynamic configuration that actually works

import React, { useState } from 'react';
import { Upload, Button, Card, message, Space, Typography } from 'antd';
import { UploadOutlined, DeleteOutlined, FileTextOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface UploadedFile {
    name: string;
    size: number;
    type: string;
}

export default function TestUpload() {
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

    const handleUpload = (info: any) => {
        if (info.file.status === 'done') {
            message.success(`${info.file.name} file uploaded successfully`);
            setUploadedFiles(prev => [...prev, {
                name: info.file.name,
                size: info.file.size,
                type: info.file.type
            }]);
        } else if (info.file.status === 'error') {
            message.error(`${info.file.name} file upload failed.`);
        }
    };

    const handleDelete = (index: number) => {
        setUploadedFiles(prev => prev.filter((_, i) => i !== index));
        message.success('File removed');
    };

    const uploadProps = {
        name: 'file',
        multiple: true,
        action: '/api/upload', // This would need to be implemented
        onChange: handleUpload,
        onDrop(e: any) {
            console.log('Dropped files', e.dataTransfer.files);
        },
    };

    return (
        <div style={{ padding: '24px' }}>
            <Title level={2}>File Upload Test</Title>
            
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card title="Upload Files">
                    <Dragger {...uploadProps}>
                        <p className="ant-upload-drag-icon">
                            <UploadOutlined />
                        </p>
                        <p className="ant-upload-text">Click or drag file to this area to upload</p>
                        <p className="ant-upload-hint">
                            Support for a single or bulk upload. Strictly prohibited from uploading company data or other
                            banned files.
                        </p>
                    </Dragger>
                </Card>

                {uploadedFiles.length > 0 && (
                    <Card title="Uploaded Files">
                        <Space direction="vertical" style={{ width: '100%' }}>
                            {uploadedFiles.map((file, index) => (
                                <Card 
                                    key={index} 
                                    size="small" 
                                    title={
                                        <Space>
                                            <FileTextOutlined />
                                            {file.name}
                                        </Space>
                                    }
                                    extra={
                                        <Button
                                            type="text"
                                            danger
                                            icon={<DeleteOutlined />}
                                            onClick={() => handleDelete(index)}
                                        />
                                    }
                                >
                                    <Text>Size: {(file.size / 1024).toFixed(2)} KB</Text><br />
                                    <Text>Type: {file.type}</Text>
                                </Card>
                            ))}
                        </Space>
                    </Card>
                )}
            </Space>
        </div>
    );
}
