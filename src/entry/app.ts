import { Router } from 'express'
import { Entry, MongoAccessor } from 'less-api'
import Config from '../config'
import { getLogger } from '../lib/logger'
import { getAccessRules } from '../lib/rules'

const router = Router()

router.all('*', function (_req, _res, next) {
  next()
})

const accessor = new MongoAccessor(Config.db.database, Config.db.uri, {
  poolSize: Config.db.poolSize,
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
export const entry = new Entry(accessor)
entry.setLogger(getLogger('app:less-api'))
entry.init()
  .then(() => {
    return getAccessRules('app', accessor)
  })
  .then(rules => {
    entry.loadRules(rules)
  })

router.post('/entry', async (req, res) => {
  const requestId = req['requestId']

  const auth = req['auth'] ?? {}

  // parse params
  const params = entry.parseParams({ ...req.body, requestId })

  const injections = {
    $uid: auth.uid
  }
  // validate query
  const result = await entry.validate(params, injections)
  if (result.errors) {
    return res.send({
      code: 1,
      error: result.errors,
      injections
    })
  }

  // execute query
  try {
    const data = await entry.execute(params)
    return res.send({
      code: 0,
      data
    })
  } catch (error) {
    return res.send({
      code: 2,
      error: error,
      injections
    })
  }
})

export default router