import { promises as fs } from 'node:fs';

/** Constant-size reads into a bounded allocation; detects ordinary concurrent changes. */
export async function readBoundedReviewFile(file:string,maximumBytes:number,description='Review source'):Promise<Buffer>{
  const initial=await fs.stat(file);
  if(!initial.isFile()||initial.size>maximumBytes)throw new Error(`${description} requires a regular file within ${maximumBytes} bytes`);
  const handle=await fs.open(file,'r');
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.size>maximumBytes)throw new Error(`${description} requires a regular file within ${maximumBytes} bytes`);
    if(before.ino!==initial.ino||before.dev!==initial.dev||before.size!==initial.size||before.mtimeMs!==initial.mtimeMs)throw new Error(`${description} changed before reading; retry a stable snapshot`);
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const result=await handle.read(bytes,offset,Math.min(64*1024,bytes.length-offset),offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
    const extra=await handle.read(Buffer.alloc(1),0,1,offset),after=await handle.stat(),current=await fs.stat(file);
    if(offset!==before.size||extra.bytesRead||after.size!==before.size||after.ino!==before.ino||after.dev!==before.dev||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev||current.size!==before.size||current.mtimeMs!==before.mtimeMs)throw new Error(`${description} changed while reading; retry a stable snapshot`);
    return bytes;
  }finally{await handle.close();}
}
