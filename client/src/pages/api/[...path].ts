import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { File } from 'node-fetch'; // Re-import File from node-fetch
import { buildProxyAuthHeadersFromRaw } from '@/utils/proxyAuthHeaders';

const BACKEND =
  process.env.API_TARGET ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'http://localhost:8000';
const INTERNAL_BACKEND = BACKEND;

// Next.js config to disable body parser for this API route
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Basic CORS for dev (allow frontend origins)
    const origin = req.headers.origin || '';
    const allowed = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'];
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();

    const rawUrl = String(req.url || '');
    const pathSegment = rawUrl.replace(/^\/api\/?/, '').replace(/^\//, '');
    const targetBase = INTERNAL_BACKEND.replace(/\/$/, '');

    let target: string;
    if (!pathSegment) {
      target = `${targetBase}/api`;
    } else if (pathSegment === 'health') {
      target = `${targetBase}/health`;
    } else if (pathSegment.startsWith('data/')) {
      target = `${targetBase}/${pathSegment}`;
    } else if (pathSegment.startsWith('charts/')) {
      target = `${targetBase}/${pathSegment}`;
    } else if (pathSegment.startsWith('ai/')) {
      target = `${targetBase}/${pathSegment}`;
    } else if (pathSegment.startsWith('conversations') || pathSegment.startsWith('chats')) {
      target = `${targetBase}/${pathSegment}`;
    } else {
      target = `${targetBase}/api/${pathSegment}`;
    }

    const headers: Record<string, string> = buildProxyAuthHeadersFromRaw(
      req.headers.cookie ? String(req.headers.cookie) : undefined,
      req.headers.authorization ? String(req.headers.authorization) : undefined,
    );

    const fetchOptions: any = { method: req.method, headers, redirect: 'follow' };

    // Handle multipart/form-data specifically for /data/upload and /users/profile/avatar
    // Parse with formidable and reconstruct using form-data package with streams
    // FastAPI's File() dependency needs proper multipart/form-data format
    if ((pathSegment === 'data/upload' || pathSegment === 'users/profile/avatar' || pathSegment === 'organizations/me/logo' || pathSegment === 'media/feed-thumbnails') && req.method === 'POST') {
        const backendUrl = target;
        console.log('📤 Proxy: Handling file upload to backend:', backendUrl);

        try {
            // Parse multipart form data using formidable
            const form = formidable({
                keepExtensions: true,
                maxFileSize: 500 * 1024 * 1024, // 500MB max
            });

            const [fields, files] = await form.parse(req);
            
            console.log('📤 Proxy: Parsed fields:', Object.keys(fields));
            console.log('📤 Proxy: Parsed files:', files ? Object.keys(files) : 'none');
            
            // Check if file was parsed
            const fileArray = Array.isArray(files?.file) ? files.file : (files?.file ? [files.file] : []);
            if (!files || !fileArray || fileArray.length === 0) {
                console.error('❌ Proxy: No file found in parsed form data');
                return res.status(400).json({ 
                    error: 'No file provided',
                    detail: 'File field is missing from the upload request'
                });
            }
            
            const file = fileArray[0] as any;
            if (!file.filepath || !fs.existsSync(file.filepath)) {
                console.error('❌ Proxy: File path does not exist:', file.filepath);
                return res.status(400).json({ 
                    error: 'File not found',
                    detail: 'Uploaded file could not be located'
                });
            }
            
            // Use file stream for better compatibility with form-data and node-fetch
            const fileStream = fs.createReadStream(file.filepath);
            const fileName = file.originalFilename || file.newFilename || 'uploaded_file';
            const fileStats = fs.statSync(file.filepath);
            
            console.log('📤 Proxy: File ready for upload:', {
                filename: fileName,
                size: fileStats.size,
                filepath: file.filepath,
                mimetype: file.mimetype
            });

            // Reconstruct FormData using form-data package
            const FormDataModule = await import('form-data');
            const FormDataClass = FormDataModule.default || FormDataModule;
            const formData = new FormDataClass();

            // Append file as stream (form-data package works best with streams)
            // CRITICAL: Field name must be 'file' to match FastAPI's File(...) dependency
            formData.append('file', fileStream, {
                filename: fileName,
                contentType: file.mimetype || 'application/octet-stream',
                knownLength: fileStats.size, // Helps form-data calculate Content-Length
            });
            
            console.log('📤 Proxy: File appended to FormData:', {
                fieldName: 'file',
                filename: fileName,
                size: fileStats.size,
                contentType: file.mimetype || 'application/octet-stream'
            });

            // Add other form fields
            if (fields.name && fields.name.length > 0) {
                formData.append('name', fields.name[0]);
            }
            if (fields.include_preview && fields.include_preview.length > 0) {
                formData.append('include_preview', fields.include_preview[0]);
            }
            if (fields.sheet_name && fields.sheet_name.length > 0) {
                formData.append('sheet_name', fields.sheet_name[0]);
            }
            if (fields.delimiter && fields.delimiter.length > 0) {
                formData.append('delimiter', fields.delimiter[0]);
            }
            if (fields.preview_only && fields.preview_only.length > 0) {
                formData.append('preview_only', fields.preview_only[0]);
            }

            const forwardHeaders = buildProxyAuthHeadersFromRaw(
              req.headers.cookie ? String(req.headers.cookie) : undefined,
              req.headers.authorization ? String(req.headers.authorization) : undefined,
            );

            // Get FormData headers (includes Content-Type with boundary)
            const formDataHeaders = formData.getHeaders();
            // Get Content-Length if available (helps with some servers)
            const contentLength = formData.getLengthSync();
            
            console.log('📤 Proxy: FormData headers:', formDataHeaders);
            console.log('📤 Proxy: Content-Length:', contentLength);
            console.log('📤 Proxy: Forwarding to backend, file size:', fileStats.size, 'bytes');
            // Note: formidable FormData doesn't have .has() method, check via files object instead
            console.log('📤 Proxy: FormData has file field:', !!(files && files.file));

            // Build final headers - form-data headers take precedence for Content-Type
            const finalHeaders: Record<string, string> = {
                ...forwardHeaders,
            };
            
            // Use form-data's Content-Type (includes boundary)
            finalHeaders['content-type'] = formDataHeaders['content-type'];
            
            // Add Content-Length if available (some servers require it)
            if (contentLength) {
                finalHeaders['content-length'] = contentLength.toString();
            }

            // Collect multipart buffer from form-data
            // form-data emits 'data' events with chunks when piped
            const chunks: Buffer[] = [];
            
            const multipartBuffer = await new Promise<Buffer>((resolve, reject) => {
                // Create writable stream that collects chunks
                const writableStream = new Writable({
                    write(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void) {
                        chunks.push(chunk);
                        callback();
                    }
                });

                writableStream.on('finish', () => {
                    resolve(Buffer.concat(chunks));
                });

                writableStream.on('error', (err) => {
                    reject(err);
                });

                // Pipe formData to collect all chunks
                formData.pipe(writableStream);
            });

            console.log('📤 Proxy: Multipart buffer size:', multipartBuffer.length, 'bytes');
            console.log('📤 Proxy: Buffer contains "Content-Disposition: form-data":', multipartBuffer.toString().includes('Content-Disposition'));

            // Forward to backend with the raw multipart buffer
            // This ensures FastAPI receives the exact multipart structure it expects
            const nodeFetch = (await import('node-fetch')).default;
            const proxyRes = await nodeFetch(backendUrl, {
                method: 'POST',
                headers: finalHeaders,
                body: multipartBuffer,
            }).catch(async (fetchError) => {
                // Clean up temp file on error
                try {
                    if (file.filepath && fs.existsSync(file.filepath)) {
                        fs.unlinkSync(file.filepath);
                    }
                } catch (cleanupError) {
                    console.warn('Failed to clean up temp file on error:', cleanupError);
                }
                throw fetchError;
            });
            
            // Clean up temporary file after successful request
            const cleanupFile = () => {
                try {
                    if (file.filepath && fs.existsSync(file.filepath)) {
                        fs.unlinkSync(file.filepath);
                        console.log('✅ Cleaned up temp file:', file.filepath);
                    }
                } catch (cleanupError) {
                    console.warn('Failed to clean up temp file:', cleanupError);
                }
            };

            console.log('📤 Proxy: Backend response status:', proxyRes.status);

            // If error, log response body for debugging
            if (!proxyRes.ok) {
                const errorText = await proxyRes.text();
                console.error('❌ Proxy: Backend error response:', errorText);
                cleanupFile();
                try {
                    const errorJson = JSON.parse(errorText);
                    return res.status(proxyRes.status).json(errorJson);
                } catch {
                    return res.status(proxyRes.status).json({ error: errorText });
                }
            }

            // Forward response headers
            res.status(proxyRes.status);
            const headers = proxyRes.headers.raw();
            Object.keys(headers).forEach((key) => {
                const lk = key.toLowerCase();
                if (lk === 'transfer-encoding' || lk === 'connection' || lk === 'content-encoding' || lk === 'set-cookie') return;
                const value = headers[key];
                if (Array.isArray(value)) {
                    res.setHeader(key, value);
                } else {
                    res.setHeader(key, value as string);
                }
            });

            // Handle set-cookie separately to remove domain attribute
            const setCookieValues: string[] = [];
            const cookieHeaders = headers['set-cookie'];
            if (cookieHeaders) {
                const raw = Array.isArray(cookieHeaders) ? cookieHeaders : [cookieHeaders];
                for (const v of raw) {
                    const parts = (v as string).split(';').map((p: string) => p.trim()).filter(Boolean);
                    const filtered = parts.filter((p: string) => !/^domain=/i.test(p));
                    const rebuilt = filtered.join('; ');
                    setCookieValues.push(rebuilt);
                }
            }
            if (setCookieValues.length) {
                res.setHeader('set-cookie', setCookieValues);
            }

            // Stream the backend response directly to the client
            // node-fetch v3 returns a ReadableStream
            if (proxyRes.body) {
                try {
                    // node-fetch v3 body is a Node.js Readable stream
                    const bodyStream = proxyRes.body as NodeJS.ReadableStream;
                    bodyStream.on('data', (chunk: Buffer) => {
                        res.write(chunk);
                    });
                    bodyStream.on('end', () => {
                        res.end();
                        cleanupFile();
                    });
                    bodyStream.on('error', (err) => {
                        console.error('Error streaming upload response:', err);
                        cleanupFile();
                        if (!res.headersSent) {
                            res.status(500).json({ error: 'Failed to stream response' });
                        }
                    });
                } catch (err) {
                    console.error('Error setting up stream:', err);
                    cleanupFile();
                    res.status(500).json({ error: 'Failed to stream response' });
                }
            } else {
                res.end();
                cleanupFile();
            }
            return; // Important: terminate here for file uploads
        } catch (err) {
            console.error('Error handling file upload proxy:', err);
            res.status(500).json({ 
                error: 'File upload proxy failed', 
                detail: err instanceof Error ? err.message : String(err) 
            });
            return;
        }
    } else if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      // For non-file uploads, handle JSON body properly
      if (req.headers['content-type'] === 'application/json') {
        // Since bodyParser is disabled, we need to manually read the stream
        // Use a more reliable approach: read entire stream before processing
        if (req.body && typeof req.body !== 'object') {
          // If req.body is already a string or buffer, use it
          if (typeof req.body === 'string') {
            fetchOptions.body = req.body;
          } else if (Buffer.isBuffer(req.body)) {
            fetchOptions.body = req.body.toString('utf-8');
          } else {
            // If it's a stream, read it
            try {
              const stream = req.body as NodeJS.ReadableStream;
              const chunks: Buffer[] = [];
              for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk));
              }
              if (chunks.length > 0) {
                fetchOptions.body = Buffer.concat(chunks).toString('utf-8');
              }
            } catch (err) {
              console.error('Error reading request body stream:', err);
            }
          }
        } else {
          // Read the request body stream manually using event-based approach
          const chunks: Buffer[] = [];
          const bodyPromise = new Promise<string>((resolve, reject) => {
            req.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });
            req.on('end', () => {
              try {
                const bodyBuffer = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
                const bodyString = bodyBuffer.length > 0 ? bodyBuffer.toString('utf-8') : '';
                resolve(bodyString);
              } catch (err) {
                reject(err);
              }
            });
            req.on('error', reject);
          });
          
          // Wait for body to be read before proceeding
          const bodyString = await bodyPromise;
          if (bodyString) {
            fetchOptions.body = bodyString;
          }
        }
        headers['content-type'] = 'application/json';
      } else {
        // For non-JSON bodies, pass through as-is
        if (req.body) {
          if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
            fetchOptions.body = req.body;
          } else {
            // Try to read stream
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            await new Promise<void>((resolve, reject) => {
              req.on('end', resolve);
              req.on('error', reject);
            });
            if (chunks.length > 0) {
              fetchOptions.body = Buffer.concat(chunks);
            }
          }
        }
        if (req.headers['content-type']) {
          headers['content-type'] = String(req.headers['content-type']);
        }
      }
    }

    console.log('Proxying /api ->', target, 'method=', req.method, 'Content-Type:', headers['content-type']);
    let upstream: Response | null = null;
    const candidateTargets: string[] = [target];
    if (!candidateTargets.includes('http://localhost:8000')) candidateTargets.push('http://localhost:8000');
    if (!candidateTargets.includes('http://chat2chart-server:8000')) candidateTargets.push('http://chat2chart-server:8000');

    let lastError: any = null;
    for (const t of candidateTargets) {
      try {
        let trial: string;
        const normalizedT = t.replace(/\/$/, '');
        if (pathSegment && (normalizedT.endsWith(`/${pathSegment}`) || normalizedT === `${targetBase}` || normalizedT.endsWith(`/api/${pathSegment}`) || normalizedT.includes(`/${pathSegment}`))) {
          trial = normalizedT;
        } else {
          trial = pathSegment ? (normalizedT + '/' + pathSegment) : normalizedT;
        }
        console.log('Proxy trying target', trial);
        // Pass full fetchOptions here, including body and headers set for file upload
        upstream = await fetch(trial, fetchOptions);
        if (upstream) {
          console.log('Proxy succeeded to', trial, 'status=', upstream.status);
          break;
        }
      } catch (e) {
        lastError = e;
        console.warn('Proxy fetch to', t, 'failed:', String(e));
      }
    }

    if (!upstream) {
      console.error('Proxy failed to reach any upstream for', target, 'lastError=', String(lastError));
      return res.status(502).json({ error: 'Proxy failed', detail: String(lastError || 'Upstream unreachable') });
    }

    res.status(upstream.status);
    const setCookieValues: string[] = [];
    upstream.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (lk === 'transfer-encoding' || lk === 'connection') return;
      if (lk === 'set-cookie') {
        const raw = Array.isArray(value) ? value : [value as string];
        for (const v of raw) {
          const parts = (v as string).split(';').map((p: string) => p.trim()).filter(Boolean);
          const filtered = parts.filter((p: string) => !/^domain=/i.test(p));
          const rebuilt = filtered.join('; ');
          setCookieValues.push(rebuilt);
        }
        return;
      }
      if (lk === 'content-encoding') return;
      res.setHeader(key, value as string);
    });
    if (setCookieValues.length) {
      res.setHeader('set-cookie', setCookieValues);
      console.log('Proxy: forwarded sanitized set-cookie headers:', setCookieValues);
    }

    const buf = await upstream.arrayBuffer();
    if (buf && buf.byteLength > 0) res.send(Buffer.from(buf)); else res.end();
  } catch (err: any) {
    console.error('Proxy error', err?.stack || err);
    res.status(502).json({ error: 'Proxy failed', detail: String(err) });
  }
}
