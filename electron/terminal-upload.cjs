const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./core.cjs');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_PATH_TTL_MS = 2 * 60 * 1000;
const UPLOAD_PATH_LIMIT = 64;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function fileNameFor(source, platform = process.platform) {
  if (typeof source !== 'string' || !path.isAbsolute(source))
    throw new Error('Choose one regular file to upload.');
  const name = platform === 'win32' ? path.win32.basename(source) : path.basename(source);
  if (!name || name === '.' || name === '..' || /[\x00-\x1f\x7f-\x9f\u2028\u2029\p{Cf}\uD800-\uDFFF]/u.test(name) || Buffer.byteLength(name, 'utf8') > 200)
    throw new Error('The file name cannot be safely uploaded.');
  return name;
}

function uploadDestination(name, uuid = crypto.randomUUID()) {
  if (!UUID.test(uuid)) throw new Error('Invalid upload identifier.');
  const safeName = fileNameFor('/' + name, 'posix');
  if (safeName !== name) throw new Error('The file name cannot be safely uploaded.');
  return path.posix.join('/tmp', `hrig-upload-${uuid}`, safeName);
}

async function readUploadFile(source, io = fs) {
  fileNameFor(source);
  let before;
  try { before = await io.lstat(source); }
  catch { throw new Error('The dropped file is no longer available.'); }
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('Only a regular file can be uploaded.');
  if (before.size > MAX_UPLOAD_BYTES)
    throw new Error('Files larger than 10 MiB cannot be uploaded. Nothing was sent.');
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const nonblock = fsConstants.O_NONBLOCK || 0;
  let handle;
  try {
    handle = await io.open(source, fsConstants.O_RDONLY | noFollow | nonblock);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs)
      throw new Error('The dropped file changed before it could be read.');
    if (opened.size > MAX_UPLOAD_BYTES)
      throw new Error('Files larger than 10 MiB cannot be uploaded. Nothing was sent.');
    const chunks = [];
    let total = 0;
    while (total <= MAX_UPLOAD_BYTES) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_UPLOAD_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > MAX_UPLOAD_BYTES)
      throw new Error('Files larger than 10 MiB cannot be uploaded. Nothing was sent.');
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== total || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
      throw new Error('The dropped file changed while it was being read. Try again.');
    return { name: fileNameFor(source), data: Buffer.concat(chunks, total) };
  } finally {
    await handle?.close();
  }
}

function middleTruncate(value, max = 180) {
  if (value.length <= max) return value;
  const marker = '...';
  const remaining = Math.max(2, max - marker.length);
  const head = Math.ceil(remaining / 2);
  const tail = remaining - head;
  return value.slice(0, head) + marker + value.slice(-tail);
}

const saveProgram = `import os,sys,shutil
target=sys.argv[1]
expected=int(sys.argv[2])
root=os.path.dirname(target)
os.mkdir(root,0o700)
try:
 data=sys.stdin.buffer.read(expected+1)
 if expected<0 or expected>${MAX_UPLOAD_BYTES} or len(data)!=expected: raise ValueError('Upload length mismatch')
 fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as out: out.write(data)
except:
 shutil.rmtree(root)
 raise
`;

function validateRemoteTarget(target) {
  const match = typeof target === 'string' && /^\/tmp\/hrig-upload-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/([^/]+)$/.exec(target);
  if (!match || match[2] === '.' || match[2] === '..' || fileNameFor('/' + match[2], 'posix') !== match[2])
    throw new Error('Invalid temporary upload path.');
}

async function saveRemote(connection, target, data, remote = core.remote) {
  if (!connection || connection.kind !== 'ssh') throw new Error('Remote file upload requires an SSH terminal.');
  validateRemoteTarget(target);
  if (!Buffer.isBuffer(data) || data.length > MAX_UPLOAD_BYTES)
    throw new Error('Files must be no larger than 10 MiB.');
  const timeout = 25_000 + Math.ceil(data.length / (200 * 1024)) * 1_000;
  try {
    await remote(connection, `python3 -c ${core.quote(saveProgram)} ${core.quote(target)} ${data.length}`, { input: data, timeout });
  } catch (error) {
    await removeRemote(connection, target, remote).catch(() => {});
    throw error;
  }
}

const removeProgram = `import os,sys,stat
p=sys.argv[1]
root=os.path.dirname(p)
name=os.path.basename(p)
try:
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 r=os.fstat(fd); f=os.stat(name,dir_fd=fd,follow_symlinks=False)
 if stat.S_ISDIR(r.st_mode) and r.st_uid==os.getuid() and stat.S_ISREG(f.st_mode) and f.st_uid==os.getuid(): os.unlink(name,dir_fd=fd)
 os.close(fd); os.rmdir(root)
except OSError: pass
`;

async function removeRemote(connection, target, remote = core.remote) {
  if (!connection || connection.kind !== 'ssh') return;
  validateRemoteTarget(target);
  await remote(connection, `python3 -c ${core.quote(removeProgram)} ${core.quote(target)}`);
}

function registerTerminalUpload({ handle, ipcMain, trusted, dialog, getWindow, getTerminal, remote = core.remote }) {
  const cleanup = new Map();
  const registered = new Map();
  ipcMain?.on('terminal:register-upload-path', (event, source) => {
    event.returnValue = '';
    try {
      trusted(event);
      if (typeof source !== 'string' || source.length > 32768) return;
      fileNameFor(source);
      const now = Date.now();
      for (const [token, entry] of registered) if (entry.expires < now) registered.delete(token);
      if (registered.size >= UPLOAD_PATH_LIMIT) registered.delete(registered.keys().next().value);
      const token = crypto.randomUUID();
      registered.set(token, { source, sender: event.sender, expires: now + UPLOAD_PATH_TTL_MS });
      event.returnValue = token;
    } catch {}
  });
  handle('terminal:upload-file', async (event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).sort().join(',') !== 'id,token' ||
        typeof request.id !== 'string' || !request.id || typeof request.token !== 'string')
      throw new Error('Invalid file upload request.');
    const registeredPath = registered.get(request.token);
    registered.delete(request.token);
    if (!registeredPath || registeredPath.expires < Date.now() || registeredPath.sender !== event.sender)
      throw new Error('The dropped file was not registered by this window. Drop it again.');
    const terminal = getTerminal(request.id);
    if (!terminal || terminal.sender !== event.sender || terminal.connection?.kind !== 'ssh')
      throw new Error('Connect an SSH terminal before uploading a file.');
    const file = await readUploadFile(registeredPath.source);
    const target = uploadDestination(file.name);
    const host = [terminal.connection.name, terminal.connection.host].filter(Boolean).join(' (') + (terminal.connection.name && terminal.connection.host ? ')' : '');
    const choice = await dialog.showMessageBox(getWindow(), {
      type: 'question', title: 'Upload file to terminal host',
      message: `Upload ${file.name} to ${host || 'the SSH host'}?`,
      detail: `Local source: ${middleTruncate(registeredPath.source)}\n${target}\n${file.data.length} bytes. The quoted path will be inserted without Enter. Temporary file; remove it when finished.`,
      buttons: ['Cancel', 'Upload file'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice.response !== 1) return null;
    if (getTerminal(request.id) !== terminal)
      throw new Error('Terminal changed while confirming upload. Nothing was sent.');
    await saveRemote(terminal.connection, target, file.data, remote);
    if (getTerminal(request.id) !== terminal) {
      const removed = await removeRemote(terminal.connection, target, remote).then(() => true, () => false);
      throw new Error(removed
        ? 'Terminal disconnected during upload; the temporary file was removed.'
        : `Terminal disconnected during upload. No path was inserted; remove ${target} on the host if it exists.`);
    }
    cleanup.set(request.id + '\0' + target, { connection: terminal.connection, target });
    return { target, quotedPath: quotedRemotePath(target) };
  });
  handle('terminal:cleanup-upload', async (_event, request) => {
    if (!request || typeof request.id !== 'string' || typeof request.target !== 'string') return;
    const key = request.id + '\0' + request.target, saved = cleanup.get(key);
    if (!saved) return;
    cleanup.delete(key);
    await removeRemote(saved.connection, saved.target, remote);
  });
  handle('terminal:keep-upload', (_event, request) => {
    if (request && typeof request.id === 'string' && typeof request.target === 'string')
      cleanup.delete(request.id + '\0' + request.target);
  });
}

function quotedRemotePath(target) {
  validateRemoteTarget(target);
  return core.quote(target);
}

module.exports = {
  MAX_UPLOAD_BYTES,
  fileNameFor,
  uploadDestination,
  readUploadFile,
  saveRemote,
  removeRemote,
  quotedRemotePath,
  middleTruncate,
  saveProgram,
  registerTerminalUpload,
};
