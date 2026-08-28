'use client';

import { InboxOutlined } from '@ant-design/icons';
import { message, Upload, UploadProps } from 'antd';
import { useRouter } from 'next/navigation';
import { IFileUpload } from './types';

const { Dragger } = Upload;

export interface UploadDraggerProps {
    onUpload: (fileData?: IFileUpload) => void;
    validFileTypes?: string[];
    projectId?: string | number; // Project ID for file ownership
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB - Enhanced limit
const UPLOAD_API_URL = '/api/data/upload'; // Use same-origin proxy for uploads

type UploadDataSource = {
    id?: string;
    name?: string;
    content_type?: string;
    format?: string;
    storage_type?: string;
    size?: number;
    uuid_filename?: string;
    row_count?: number | null;
    schema?: {
        storage?: {
            onboarding?: {
                onboarding_session_id?: string;
            };
        };
    } & Record<string, unknown>;
    preview?: unknown;
    uploaded_at?: string | null;
};

type UploadApiResponse = {
    success?: boolean;
    message?: string;
    error?: string;
    data_source?: UploadDataSource;
};

function onboardingSessionId(dataSource?: UploadDataSource): string | null {
    return dataSource?.schema?.storage?.onboarding?.onboarding_session_id ?? null;
}

const UploadDragger: React.FC<UploadDraggerProps> = ({
    onUpload,
    validFileTypes = ['csv', 'xlsx', 'xls', 'json', 'tsv'], // Enhanced file support
    projectId,
}) => {
    const router = useRouter();

    const handleFileSizeValidation = (file: File): boolean => {
        if (file.size > MAX_FILE_SIZE) {
            message.error('File must be smaller than 50MB!');
            return false;
        }
        return true;
    };

    const handleFileTypeValidation = (file: File): boolean => {
        if (validFileTypes.length === 0) return true;

        const fileExtension = file.name.toLowerCase().split('.').pop();
        const isValidExtension = validFileTypes.includes(fileExtension || '');

        if (!isValidExtension) {
            message.error(
                `You can only upload ${validFileTypes.join(' or ')} files!`
            );
            return false;
        }
        return true;
    };

    const handleUploadSuccess = (response: IFileUpload): void => {
        onUpload(response);
    };

    const uploadProps: UploadProps = {
        name: 'file',
        action: UPLOAD_API_URL,
        method: 'POST',
        showUploadList: false,
        accept: validFileTypes.map((type) => `.${type}`).join(','),
        data: projectId ? { project_id: projectId.toString() } : undefined, // Send project_id if provided

        openFileDialogOnClick: true,

        onDrop: (event) => {
            const files = event.dataTransfer.files;
            if (files.length > 1) {
                message.error('You can only upload one file at a time!');
                return Upload.LIST_IGNORE;
            }
            return validateFile(files[0]);
        },

        beforeUpload: async (file) => {
            return validateFile(file);
        },

        onChange: (info) => {
            const { status } = info.file;
            const response = info.file.response as UploadApiResponse | undefined;

            if (status === 'done') {
                if (response && response.success) {
                    // Handle the new data API response format
                    const dataSource = response.data_source;
                    const sessionId = onboardingSessionId(dataSource);
                    
                    // Create upload response with all available data
                    const uploadResponse = new IFileUpload(
                        dataSource?.name || info.file.name,
                        dataSource?.content_type || `application/${dataSource?.format || 'unknown'}`,
                        dataSource?.storage_type || 'local',
                        dataSource?.size ?? info.file.size ?? 0,
                        dataSource?.uuid_filename || dataSource?.id || Date.now().toString()
                    );

                    // Store additional metadata for later use
                    uploadResponse.rowCount = dataSource?.row_count;
                    uploadResponse.schema = dataSource?.schema;
                    uploadResponse.preview = dataSource?.preview;
                    uploadResponse.uploadedAt = dataSource?.uploaded_at;
                    uploadResponse.onboardingSessionId = sessionId;

                    handleUploadSuccess(uploadResponse);
                    message.success(
                        `${info.file.name} file uploaded successfully. ${response.message || ''}`
                    );
                    if (sessionId) {
                        router.push(`/data/onboarding/${sessionId}`);
                    }
                } else {
                    message.error(`Upload failed: ${response?.error || 'Unknown error'}`);
                }
            } else if (status === 'error') {
                message.error(`${info.file.name} file upload failed.`);
            }
        },
    };

    const validateFile = (file: File): boolean => {
        return handleFileSizeValidation(file) && handleFileTypeValidation(file);
    };

    return (
        <Dragger {...uploadProps}>
            <p className="ant-upload-drag-icon">
                <InboxOutlined />
            </p>
            <p className="ant-upload-text">
                Click or drag file to this area to upload
            </p>
            <p className="ant-upload-hint">
                {validFileTypes.length > 0
                    ? `Support for ${validFileTypes.join(', ')} files only.`
                    : 'Upload any file type'}
            </p>
        </Dragger>
    );
};

export default UploadDragger;
