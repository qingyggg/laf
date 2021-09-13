/*
 * @Author: Maslow<wangfugen@126.com>
 * @Date: 2021-07-30 10:30:29
 * @LastEditTime: 2021-09-10 22:19:43
 * @Description: 
 */

import { Constants } from "../constants"
import { DatabaseAgent } from "../lib/db-agent"
import { compileTs2js } from 'cloud-function-engine/dist/utils'
import { CloudFunctionStruct } from "cloud-function-engine"
import { ClientSession } from 'mongodb'
import * as assert from 'assert'
import { logger } from "../lib/logger"
import { ApplicationStruct, getApplicationDbAccessor } from "./application"

export enum FunctionStatus {
  DISABLED = 0,
  ENABLED = 1
}

/**
 * Extended function struct
 */
export interface FunctionStruct extends CloudFunctionStruct {
  description: string
  tags: string[]
  label: string
  triggers: any[]
  status: FunctionStatus
  version: number
  hash: string
  created_at: number
  updated_at: number
  created_by: any
  appid: string
  debugParams: string
}


/**
 * Load function data by its name
 * @param func_name 
 * @returns 
 */
export async function getFunctionByName(appid: string, func_name: string) {
  const db = DatabaseAgent.sys_db
  const r = await db.collection(Constants.cn.functions)
    .where({ name: func_name, appid })
    .getOne<FunctionStruct>()

  return r.data
}


/**
  * Publish functions
  * Means that copying sys db functions to app db
  */
export async function publishFunctions(app: ApplicationStruct) {

  // read functions from sys db
  const ret = await DatabaseAgent.sys_accessor.db
    .collection(Constants.cn.functions)
    .find({
      appid: app.appid
    })
    .toArray()

  // compile functions
  const data = ret.map(fn => compileFunction(fn))

  // write functions to app db
  const app_accessor = await getApplicationDbAccessor(app)
  const session = app_accessor.conn.startSession()

  try {
    await session.withTransaction(async () => {
      const _db = app_accessor.db
      const app_coll = _db.collection(Constants.function_collection)
      await app_coll.deleteMany({}, { session })
      await app_coll.insertMany(data, { session })
    })
  } catch (error) {
    logger.error(error)
  } finally {
    await session.endSession()
  }
}

/**
 * Compile function codes (from typescript to javascript)
 * @param func 
 */
function compileFunction(func: any) {
  func.compiledCode = compileTs2js(func.code)
  return func
}

/**
  * Deploy functions which pushed from remote environment
  */
export async function deployFunctions(appid: string, functions: FunctionStruct[]) {
  assert.ok(functions)
  assert.ok(functions instanceof Array)

  const accessor = DatabaseAgent.sys_accessor

  const data = functions
  const session = accessor.conn.startSession()

  try {
    await session.withTransaction(async () => {
      for (const func of data) {
        func['appid'] = appid
        await _deployOneFunction(func, session)
      }
    })
  } finally {
    await session.endSession()
  }
}

/**
 * Deploy a function, use in `deployFunctions()`
 * @param func the cloud function to be deployed
 * @param session mongodb session for transaction operations
 * @private
 * @see deployFunctions()
 * @returns 
 */
async function _deployOneFunction(func: FunctionStruct, session: ClientSession) {
  const db = DatabaseAgent.sys_accessor.db
  const data = {
    ...func,
  }
  delete data['_id']
  const r = await db.collection(Constants.cn.functions)
    .updateOne({
      appid: func.appid,
      name: func.name
    }, {
      $set: data
    }, { session })

  // return if exists & updated 
  if (r.matchedCount) {
    logger.debug(`deploy function: found an exists function ${func.name} & updated it, matchedCount ${r.matchedCount}`)
    return
  }

  // if new function
  const ret = await db.collection(Constants.cn.functions)
    .insertOne(data as any, { session })

  assert(ret.insertedId, `deploy: add function ${func.name} occurred error`)
  logger.debug(`deploy function: inserted a function (${func.name}),  insertedId ${ret.insertedId}`)
}