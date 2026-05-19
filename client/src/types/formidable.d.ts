declare module 'formidable' {
  import { IncomingMessage } from 'http';
  
  export interface File {
    size: number;
    path: string;
    name: string;
    type: string;
    hash?: string;
    lastModifiedDate?: Date;
  }
  
  export interface Fields {
    [key: string]: string | string[] | undefined;
  }
  
  export interface Files {
    [key: string]: File | File[] | undefined;
  }
  
  export interface ParsedFormData {
    fields: Fields;
    files: Files;
  }
  
  export interface Options {
    encoding?: string;
    uploadDir?: string;
    keepExtensions?: boolean;
    maxFileSize?: number;
    maxFields?: number;
    maxFieldsSize?: number;
    hash?: string | boolean;
    multiples?: boolean;
  }
  
  export default function formidable(
    options?: Options
  ): {
    parse: (req: IncomingMessage) => Promise<[Fields, Files]>;
  };
}
