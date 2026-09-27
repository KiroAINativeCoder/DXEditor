// y-leveldb's package.json "exports" doesn't expose its bundled .d.ts, so TS
// can't resolve types the normal way. Declare the minimal surface we use.
declare module 'y-leveldb' {
  import type * as Y from 'yjs'

  export class LeveldbPersistence {
    constructor(location: string, opts?: Record<string, unknown>)
    getYDoc(docName: string): Promise<Y.Doc>
    storeUpdate(docName: string, update: Uint8Array): Promise<void>
    clearDocument(docName: string): Promise<void>
  }
}
