import { Modal } from 'antd';
import React from 'react';
import { useTranslations } from 'next-intl';
import UploadDragger from './Dragger';
import { IFileUpload } from './types';

interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUpload: (fileData?: IFileUpload) => void;
    validFileTypes?: string[];
    projectId?: string | number;
}

const UploadModal: React.FC<UploadModalProps> = ({
    isOpen,
    onClose,
    onUpload,
    validFileTypes = [],
    projectId,
}) => {
    const t = useTranslations('file_upload');

    const handleUploadSuccess = (response?: IFileUpload): void => {
        onUpload(response);
        onClose();
    };

    return (
        <Modal
            title={t('modal_title')}
            open={isOpen}
            onCancel={onClose}
            footer={null}
            destroyOnHidden
        >
            <UploadDragger
                onUpload={handleUploadSuccess}
                validFileTypes={validFileTypes}
                projectId={projectId}
            />
        </Modal>
    );
};

export default UploadModal;
