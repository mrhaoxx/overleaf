// @ts-check
import Events from 'node:events'
import fs from 'node:fs'
import Stream from 'node:stream'
import { ObjectId } from 'mongodb'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import {
  BlobStore,
  getStringLengthOfFile,
  GLOBAL_BLOBS,
  makeBlobForFile,
} from '../lib/blob_store/index.js'
import { db } from '../lib/mongodb.js'
import commandLineArgs from 'command-line-args'
import readline from 'node:readline'
import { _blobIsBackedUp, backupBlob } from '../lib/backupBlob.mjs'
import { NotFoundError } from '@overleaf/object-persistor/src/Errors.js'
import filestorePersistor from '../lib/persistor.js'

// Silence warning.
Events.setMaxListeners(20)

// Enable caching for ObjectId.toString()
ObjectId.cacheHexString = true

/**
 * @typedef {import("overleaf-editor-core").Blob} Blob
 * @typedef {import("mongodb").Collection} Collection
 * @typedef {import("mongodb").Collection<Project>} ProjectsCollection
 * @typedef {import("mongodb").Collection<{project: Project}>} DeletedProjectsCollection
 */

/**
 * @typedef {Object} FileRef
 * @property {ObjectId} _id
 * @property {string} hash
 */

/**
 * @typedef {Object} Folder
 * @property {Array<Folder>} folders
 * @property {Array<FileRef>} fileRefs
 */

/**
 * @typedef {Object} Project
 * @property {ObjectId} _id
 * @property {Array<Folder>} rootFolder
 * @property {{history: {id: (number|string)}}} overleaf
 */

/**
 * @return {{FIX_NOT_FOUND: boolean, FIX_HASH_MISMATCH: boolean, FIX_DELETE_PERMISSION: boolean, LOGS: string}}
 */
function parseArgs() {
  const args = commandLineArgs([
    { name: 'fixNotFound', type: String, defaultValue: 'true' },
    { name: 'fixDeletePermission', type: String, defaultValue: 'true' },
    { name: 'fixHashMismatch', type: String, defaultValue: 'true' },
    { name: 'logs', type: String, defaultValue: '' },
  ])
  /**
   * commandLineArgs cannot handle --foo=false, so go the long way
   * @param {string} name
   * @return {boolean}
   */
  function boolVal(name) {
    const v = args[name]
    if (['true', 'false'].includes(v)) return v === 'true'
    throw new Error(`expected "true" or "false" for boolean option ${name}`)
  }
  return {
    FIX_HASH_MISMATCH: boolVal('fixNotFound'),
    FIX_DELETE_PERMISSION: boolVal('fixDeletePermission'),
    FIX_NOT_FOUND: boolVal('fixHashMismatch'),
    LOGS: args.logs,
  }
}

const { FIX_HASH_MISMATCH, FIX_DELETE_PERMISSION, FIX_NOT_FOUND, LOGS } =
  parseArgs()
if (!LOGS) {
  throw new Error('--logs parameter missing')
}
const BUFFER_DIR = fs.mkdtempSync(
  process.env.BUFFER_DIR_PREFIX || '/tmp/back_fill_file_hash-'
)
const USER_FILES_BUCKET_NAME = process.env.USER_FILES_BUCKET_NAME || ''
if (!USER_FILES_BUCKET_NAME) {
  throw new Error('env var USER_FILES_BUCKET_NAME is missing')
}
// https://nodejs.org/api/stream.html#streamgetdefaulthighwatermarkobjectmode
const STREAM_HIGH_WATER_MARK = parseInt(
  process.env.STREAM_HIGH_WATER_MARK || (64 * 1024).toString(),
  10
)

/** @type {ProjectsCollection} */
const projectsCollection = db.collection('projects')
/** @type {DeletedProjectsCollection} */
const deletedProjectsCollection = db.collection('deletedProjects')

let gracefulShutdownInitiated = false

process.on('SIGINT', handleSignal)
process.on('SIGTERM', handleSignal)

function handleSignal() {
  gracefulShutdownInitiated = true
  console.warn('graceful shutdown initiated, draining queue')
}

class FileDeletedError extends OError {}

/** @type {Map<string,{project: Project, projectSoftDeleted: boolean}>} */
const PROJECT_CACHE = new Map()

/**
 * @param {string} projectId
 * @return {Promise<{project: Project, projectSoftDeleted: boolean}>}
 */
async function getProject(projectId) {
  const cached = PROJECT_CACHE.get(projectId)
  if (cached) return cached

  let projectSoftDeleted
  let project = await projectsCollection.findOne({
    _id: new ObjectId(projectId),
  })
  if (project) {
    projectSoftDeleted = false
  } else {
    const softDeleted = await deletedProjectsCollection.findOne({
      'deleterData.deletedProjectId': new ObjectId(projectId),
      project: { $exists: true },
    })
    if (!softDeleted) {
      throw new OError('project hard-deleted')
    }
    project = softDeleted.project
    projectSoftDeleted = true
  }
  PROJECT_CACHE.set(projectId, { projectSoftDeleted, project })
  return { projectSoftDeleted, project }
}

/**
 * @param {Folder} folder
 * @param {string} fileId
 * @return {{path: string, fileRef: FileRef, folder: Folder}|null}
 */
function getFileTreePath(folder, fileId) {
  if (!folder) return null
  let idx = 0
  if (Array.isArray(folder.fileRefs)) {
    for (const fileRef of folder.fileRefs) {
      if (fileRef?._id.toString() === fileId) {
        return {
          fileRef,
          path: `.fileRefs.${idx}`,
          folder,
        }
      }
      idx++
    }
  }
  idx = 0
  if (Array.isArray(folder.folders)) {
    for (const child of folder.folders) {
      const match = getFileTreePath(child, fileId)
      if (match) {
        return {
          fileRef: match.fileRef,
          folder: match.folder,
          path: `.folders.${idx}${match.path}`,
        }
      }
      idx++
    }
  }
  return null
}

/**
 * @param {string} projectId
 * @param {string} fileId
 * @return {Promise<{fileRef: FileRef, folder: Folder, fullPath: string, query: Object, projectSoftDeleted: boolean}>}
 */
async function findFile(projectId, fileId) {
  const { projectSoftDeleted, project } = await getProject(projectId)
  const match = getFileTreePath(project.rootFolder[0], fileId)
  if (!match) {
    throw new FileDeletedError('file not found in file-tree', {
      projectSoftDeleted,
    })
  }
  const { path, fileRef, folder } = match
  let fullPath
  let query
  if (projectSoftDeleted) {
    fullPath = `project.rootFolder.0${path}`
    query = {
      'deleterData.deletedProjectId': new ObjectId(projectId),
      [`${fullPath}._id`]: new ObjectId(fileId),
    }
  } else {
    fullPath = `rootFolder.0${path}`
    query = {
      _id: new ObjectId(projectId),
      [`${fullPath}._id`]: new ObjectId(fileId),
    }
  }
  return {
    projectSoftDeleted,
    query,
    fullPath,
    fileRef,
    folder,
  }
}

/**
 * @param {string} line
 * @return {Promise<boolean>}
 */
async function fixNotFound(line) {
  const { projectId, fileId, bucketName } = JSON.parse(line)
  if (bucketName !== USER_FILES_BUCKET_NAME) {
    throw new OError('not found case for another bucket')
  }

  const { projectSoftDeleted, query, fullPath, fileRef, folder } =
    await findFile(projectId, fileId)
  logger.info({ projectId, fileId, fileRef }, 'removing fileRef')
  // Copied from _removeElementFromMongoArray (https://github.com/overleaf/internal/blob/11e09528c153de6b7766d18c3c90d94962190371/services/web/app/src/Features/Project/ProjectEntityMongoUpdateHandler.js)
  const nonArrayPath = fullPath.slice(0, fullPath.lastIndexOf('.'))
  let result
  if (projectSoftDeleted) {
    result = await deletedProjectsCollection.updateOne(query, {
      $pull: { [nonArrayPath]: { _id: new ObjectId(fileId) } },
      $inc: { 'project.version': 1 },
    })
  } else {
    result = await projectsCollection.updateOne(query, {
      $pull: { [nonArrayPath]: { _id: new ObjectId(fileId) } },
      $inc: { version: 1 },
    })
  }
  if (result.matchedCount !== 1) {
    throw new OError('file-tree write did not match', { result })
  }
  // Update the cache. The mongo-path of the next file will be off otherwise.
  folder.fileRefs = folder.fileRefs.filter(f => !f._id.equals(fileId))
  return true
}

/**
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} hash
 * @return {Promise<void>}
 */
async function setHashInMongo(projectId, fileId, hash) {
  const { projectSoftDeleted, query, fullPath, fileRef } = await findFile(
    projectId,
    fileId
  )
  if (fileRef.hash === hash) return
  logger.info({ projectId, fileId, fileRef, hash }, 'setting fileRef hash')
  let result
  if (projectSoftDeleted) {
    result = await deletedProjectsCollection.updateOne(query, {
      $set: { [`${fullPath}.hash`]: hash },
      $inc: { 'project.version': 1 },
    })
  } else {
    result = await projectsCollection.updateOne(query, {
      $set: { [`${fullPath}.hash`]: hash },
      $inc: { version: 1 },
    })
  }
  if (result.matchedCount !== 1) {
    throw new OError('file-tree write did not match', { result })
  }
  fileRef.hash = hash // Update cache for completeness.
}

/**
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} historyId
 * @return {Promise<void>}
 */
async function importRestoredFilestoreFile(projectId, fileId, historyId) {
  const filestoreKey = `${projectId}/${fileId}`
  const path = `${BUFFER_DIR}/${projectId}_${fileId}`
  try {
    let s
    try {
      s = await filestorePersistor.getObjectStream(
        USER_FILES_BUCKET_NAME,
        filestoreKey
      )
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new OError('missing blob, need to restore filestore file', {
          filestoreKey,
        })
      }
      throw err
    }
    await Stream.promises.pipeline(
      s,
      fs.createWriteStream(path, { highWaterMark: STREAM_HIGH_WATER_MARK })
    )
    const blobStore = new BlobStore(historyId)
    const blob = await blobStore.putFile(path)
    await backupBlob(historyId, blob, path)
    await setHashInMongo(projectId, fileId, blob.getHash())
  } finally {
    await fs.promises.rm(path, { force: true })
  }
}

/**
 * @param {string} projectId
 * @param {string} fileId
 * @return {Promise<string>}
 */
async function computeFilestoreFileHash(projectId, fileId) {
  const filestoreKey = `${projectId}/${fileId}`
  const path = `${BUFFER_DIR}/${projectId}_${fileId}`
  try {
    let s
    try {
      s = await filestorePersistor.getObjectStream(
        USER_FILES_BUCKET_NAME,
        filestoreKey
      )
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new OError('missing blob, need to restore filestore file', {
          filestoreKey,
        })
      }
      throw err
    }
    await Stream.promises.pipeline(
      s,
      fs.createWriteStream(path, { highWaterMark: STREAM_HIGH_WATER_MARK })
    )
    const blob = await makeBlobForFile(path)
    return blob.getHash()
  } finally {
    await fs.promises.rm(path, { force: true })
  }
}

/**
 * @param {string} line
 * @return {Promise<boolean>}
 */
async function fixHashMismatch(line) {
  const {
    projectId,
    fileId,
    hash: computedHash,
    entry: {
      hash: fileTreeHash,
      ctx: { historyId },
    },
  } = JSON.parse(line)
  const blobStore = new BlobStore(historyId)
  if (await blobStore.getBlob(fileTreeHash)) {
    throw new OError('found blob with computed filestore object hash')
  }
  if (!(await blobStore.getBlob(computedHash))) {
    await importRestoredFilestoreFile(projectId, fileId, historyId)
    return true
  }
  return await ensureBlobExistsForFileAndUploadToAWS(
    projectId,
    fileId,
    computedHash
  )
}

/**
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} hash
 * @return {Promise<boolean>}
 */
async function hashAlreadyUpdatedInFileTree(projectId, fileId, hash) {
  const { fileRef } = await findFile(projectId, fileId)
  return fileRef.hash === hash
}

/**
 * @param {string} projectId
 * @param {string} hash
 * @return {Promise<boolean>}
 */
async function needsBackingUpToAWS(projectId, hash) {
  if (GLOBAL_BLOBS.has(hash)) return false
  return !(await _blobIsBackedUp(projectId, hash))
}

/**
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} hash
 * @return {Promise<boolean>}
 */
async function ensureBlobExistsForFileAndUploadToAWS(projectId, fileId, hash) {
  const { project } = await getProject(projectId)
  const historyId = project.overleaf.history.id.toString()
  const blobStore = new BlobStore(historyId)
  if (
    (await hashAlreadyUpdatedInFileTree(projectId, fileId, hash)) &&
    (await blobStore.getBlob(hash)) &&
    !(await needsBackingUpToAWS(projectId, hash))
  ) {
    return false // already processed
  }

  const stream = await blobStore.getStream(hash)
  const path = `${BUFFER_DIR}/${historyId}_${hash}`
  try {
    await Stream.promises.pipeline(
      stream,
      fs.createWriteStream(path, {
        highWaterMark: STREAM_HIGH_WATER_MARK,
      })
    )

    const writtenBlob = await makeBlobForFile(path)
    writtenBlob.setStringLength(
      await getStringLengthOfFile(writtenBlob.getByteLength(), path)
    )
    if (writtenBlob.getHash() !== hash) {
      // Double check download, better safe than sorry.
      throw new OError('blob corrupted', { writtenBlob })
    }

    let blob = await blobStore.getBlob(hash)
    if (!blob) {
      // Calling blobStore.putBlob would result in the same error again.
      // HACK: Skip upload to GCS and finalize putBlob operation directly.
      await blobStore.backend.insertBlob(historyId, writtenBlob)
    }
    await backupBlob(historyId, writtenBlob, path)
  } finally {
    await fs.promises.rm(path, { force: true })
  }
  await setHashInMongo(projectId, fileId, hash)
  return true
}

/**
 * @param {string} line
 * @return {Promise<boolean>}
 */
async function fixDeletePermission(line) {
  let { projectId, fileId, hash } = JSON.parse(line)
  if (!hash) hash = await computeFilestoreFileHash(projectId, fileId)
  return await ensureBlobExistsForFileAndUploadToAWS(projectId, fileId, hash)
}

const CASES = {
  'not found': {
    match: 'NotFoundError',
    flag: FIX_NOT_FOUND,
    action: fixNotFound,
  },
  'hash mismatch': {
    match: 'OError: hash mismatch',
    flag: FIX_HASH_MISMATCH,
    action: fixHashMismatch,
  },
  'delete permission': {
    match: 'storage.objects.delete',
    flag: FIX_DELETE_PERMISSION,
    action: fixDeletePermission,
  },
}

const STATS = {
  processedLines: 0,
  success: 0,
  alreadyProcessed: 0,
  fileDeleted: 0,
  skipped: 0,
  failed: 0,
  unmatched: 0,
}
function logStats() {
  console.log(
    JSON.stringify({
      time: new Date(),
      gracefulShutdownInitiated,
      ...STATS,
    })
  )
}
setInterval(logStats, 10_000)

async function processLog() {
  const rl = readline.createInterface({
    input: fs.createReadStream(LOGS),
  })
  nextLine: for await (const line of rl) {
    if (gracefulShutdownInitiated) break
    STATS.processedLines++
    if (!line.includes('"failed to process file"')) continue

    for (const [name, { match, flag, action }] of Object.entries(CASES)) {
      if (!line.includes(match)) continue
      if (flag) {
        try {
          if (await action(line)) {
            STATS.success++
          } else {
            STATS.alreadyProcessed++
          }
        } catch (err) {
          if (err instanceof FileDeletedError) {
            STATS.fileDeleted++
            logger.info({ err, line }, 'file deleted, skipping')
          } else {
            STATS.failed++
            logger.error({ err, line }, `failed to fix ${name}`)
          }
        }
      } else {
        STATS.skipped++
      }
      continue nextLine
    }
    STATS.unmatched++
    logger.warn({ line }, 'unknown fatal error')
  }
}

async function main() {
  try {
    await processLog()
  } finally {
    logStats()
    try {
      await fs.promises.rm(BUFFER_DIR, { recursive: true, force: true })
    } catch (err) {
      console.error(`Cleanup of BUFFER_DIR=${BUFFER_DIR} failed`, err)
    }
  }
  const { skipped, failed, unmatched } = STATS
  if (failed > 0) {
    process.exit(Math.min(failed, 99))
  } else if (unmatched > 0) {
    process.exit(100)
  } else if (skipped > 0) {
    process.exit(101)
  } else {
    process.exit(0)
  }
}

await main()
