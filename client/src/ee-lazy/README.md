One tiny module per `@/ee` export that is loaded dynamically. `import('@/ee')` itself pulls every
Enterprise page into the chunk: webpack only skips a barrel for static imports. Add a file here for
each new lazy import: `export { Name } from '@/ee';`, then `import('@/ee-lazy/Name')`.
