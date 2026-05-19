import { InboxOutlined } from '@ant-design/icons';
import { message, Upload, UploadProps } from 'antd';
import { IFileUpload } from './types';

const { Dragger } = Upload;

export interface UploadDraggerProps {
    onUpload: (fileData?: IFileUpload) => void;
    validFileTypes?: string[];
    projectId?: string | number; // Project ID for file ownership
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB - Enhanced limit
const UPLOAD_API_URL = '/api/data/upload'; // Use same-origin proxy for uploads

const UploadDragger: React.FC<UploadDraggerProps> = ({
    onUpload,
    validFileTypes = ['csv', 'xlsx', 'xls', 'json', 'tsv'], // Enhanced file support
    projectId,
}) => {
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
            const { status, response } = info.file;

            if (status === 'done') {
                if (response && response.success) {
                    // Handle the new data API response format
                    const dataSource = response.data_source;
                    
                    // Create upload response with all available data
                    const uploadResponse = new IFileUpload(
                        dataSource?.name || info.file.name,
                        dataSource?.content_type || `application/${dataSource?.format || 'unknown'}`,
                        dataSource?.storage_type || 'local',
                        dataSource?.size || info.file.size,
                        dataSource?.uuid_filename || dataSource?.id || Date.now().toString()
                    );

                    // Store additional metadata for later use
                    (uploadResponse as any).rowCount = dataSource?.row_count;
                    (uploadResponse as any).schema = dataSource?.schema;
                    (uploadResponse as any).preview = dataSource?.preview;
                    (uploadResponse as any).uploadedAt = dataSource?.uploaded_at;

                    handleUploadSuccess(uploadResponse);
                    message.success(
                        `${info.file.name} file uploaded successfully. ${response.message || ''}`
                    );
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
