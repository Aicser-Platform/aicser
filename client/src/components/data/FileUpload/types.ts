export class IFileUpload {
    filename: string;
    content_type: string;
    storage_type: string;
    file_size: number;
    uuid_filename: string;

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
