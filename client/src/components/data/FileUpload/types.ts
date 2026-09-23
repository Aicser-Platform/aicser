export class IFileUpload {
    filename: string;
    content_type: string;
    storage_type: string;
    file_size: number;
    uuid_filename: string;
    rowCount?: number | null;
    schema?: unknown;
    preview?: unknown;
    uploadedAt?: string | null;
    onboardingSessionId?: string | null;

    constructor(
        filename: string,
        content_type: string,
        storage_type: string,
        file_size: number,
        uuid_filename: string
    ) {
        this.filename = filename;
        this.content_type = content_type;
        this.storage_type = storage_type;
        this.file_size = file_size;
        this.uuid_filename = uuid_filename;
    }
}
