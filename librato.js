#!/usr/bin/env node
'use strict'

const _ = require('lodash/fp')
const co = require('co')
const fs = require('mz/fs')
const path = require('path')
const requireDir = require('require-dir')
const winston = require('winston')

const LibratoApi = require('./index').LibratoApi

const logger = new winston.Logger({
  level: process.env.LIBRATO_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      stderrLevels: _.keys(winston.levels),
      prettyPrint: true,
      align: true,
      colorize: true
    })
  ]
})
const libratoApi = new LibratoApi({ logger })

const jsonStringify = json => JSON.stringify(json, undefined, 2) + '\n'

function * writeFileOrFd (maybeSink, data) {
  return _.isString(maybeSink)
    ? yield fs.writeFile(maybeSink, data)
    : process.stdout.write(data)
}

// does sync IO
function readConfigDir (path) {
  return requireDir(path, { recurse: true })
}

// -- metric actions

function * listMetrics (maybeSink) {
  logger.verbose('listing metrics', { to: maybeSink })
  const metrics = yield libratoApi.getAllPaginated(libratoApi.getMetrics)
  const compact = _.map(_.get('name'), metrics)
  yield writeFileOrFd(maybeSink, jsonStringify(compact))
}

function * getMetrics (maybeSink) {
  logger.verbose('dumping metrics', { to: maybeSink })
  const metrics = yield libratoApi.getAllPaginated(libratoApi.getMetrics)
  yield writeFileOrFd(maybeSink, jsonStringify(metrics))
}

function * getMetric (name, maybeSink) {
  logger.verbose('retrieving metric %s', name, { name, to: maybeSink })
  const metric = yield libratoApi.getMetric(name)
  yield writeFileOrFd(maybeSink, jsonStringify(metric))
}

// -- space actions

function * listSpaces (maybeSink) {
  logger.verbose('listing spaces', { to: maybeSink })
  const spaces = yield libratoApi.getAllPaginated(libratoApi.getSpaces)
  const compact = _.reduce((acc, s) => _.set(s.id, s.name, acc), {}, spaces)
  yield writeFileOrFd(maybeSink, jsonStringify(compact))
}

function * dumpSpace (name, maybeSink) {
  logger.verbose('dumping space', { space: name, to: maybeSink })
  const space = yield libratoApi.dumpSpace(name)
  yield writeFileOrFd(maybeSink, jsonStringify(space))
}

function * createOrUpdateSpace (maybeSource) {
  const source = maybeSource || process.stdin.fd
  logger.verbose('updating space', { source })
  const buffer = yield fs.readFile(source)
  const space = JSON.parse(buffer.toString())
  logger.debug('space definition', { space })
  yield libratoApi.createOrUpdateSpace(space)
}

function * deleteSpace (name) {
  logger.verbose('deleting space', { space: name })
  const space = yield libratoApi.findSpaceByName(name)
  yield libratoApi.deleteSpace(space.id)
}

// -- config dir actions

function * showConfigDir (configDir, maybeSink) {
  const absConfigDir = path.join(process.cwd(), configDir)
  logger.verbose('reading config dir %s', absConfigDir)
  const config = libratoApi._processRawConfig(readConfigDir(absConfigDir))
  yield writeFileOrFd(maybeSink, jsonStringify(config))
}

function * showRawConfigDir (configDir, maybeSink) {
  const absConfigDir = path.join(process.cwd(), configDir)
  logger.verbose('reading config dir %s', absConfigDir)
  const config = readConfigDir(absConfigDir)
  yield writeFileOrFd(maybeSink, jsonStringify(config))
}

/**
 * @TODO Some updates fail silently, e.g. trying to change a metric's l2met_type or created_by_ua.
 *  We could check this, alert, and provid an option to delete-and-recreate.
 *  But we don't know how the mentioned undocumented attributes are used, maybe they are
 *  informational only and we can ignore this.
 * @TODO move the bulk of the logic here to LibratoAPI,
 *  collect errors like in createOrUpdateSpace, and provide tests.
 */
function * updateFromDir (configDir) {
  const absConfigDir = path.join(process.cwd(), configDir)
  logger.verbose('updating configuration from config dir %s', absConfigDir)
  const config = libratoApi._processRawConfig(readConfigDir(absConfigDir))

  var errorCount = 0
  const logOK = (what, id) => _result => {
    logger.verbose('%s %s', what, id)
  }
  const logAndCountError = (what, id) => err => {
    errorCount += 1
    logger.error('%s %s failed', what, id, {
      [what]: id,
      msg: err.toString(),
      errors: _.get('error.errors', err)
    })
  }
  const ignore404 = err => {
    if (err.statusCode !== 404) throw err
  }
  const withLogging = (what, id, action) =>
    action.then(logOK(what, id), logAndCountError(what, id))
  const withLoggingIgnore404 = (what, id, action) =>
    action.then(logOK(what, id)).catch(ignore404).catch(logAndCountError(what, id))

  const deleteMetric = name =>
    withLoggingIgnore404('delete metric', name, libratoApi.deleteMetric(name))
  const updateMetric = metric =>
    withLogging('update metric', metric.name, libratoApi.putMetric(metric.name, metric))
  const deleteSpace = name =>
    withLoggingIgnore404(
      'delete space', name,
      libratoApi.findSpaceByName(name).then(_.get('id')).then(libratoApi.deleteSpace)
    )
  const updateSpace = space =>
    withLogging('update space', space.name, libratoApi.createOrUpdateSpace(space))

  yield {
    outdated: {
      metrics: _.map(deleteMetric, config.outdated.metrics),
      spaces: _.map(deleteSpace, config.outdated.spaces)
    },
    metrics: _.map(updateMetric, config.metrics),
    spaces: _.map(updateSpace, config.spaces)
  }

  if (errorCount > 0) { throw new Error(`${errorCount} errors occured`) }
}

// -- main

function * help () {
  const getCmdList = _.flow(_.keys, _.reject(_.startsWith('_')), _.join(', '))
  yield writeFileOrFd(null, `Commands: ${getCmdList(actions)}\n`)
}

const actions = {
  'list-metrics': listMetrics,
  'get-metrics': getMetrics,
  'get-metric': getMetric,
  'list-spaces': listSpaces,
  'dump-space': dumpSpace,
  'update-space': createOrUpdateSpace,
  'delete-space': deleteSpace,
  'show-config-dir': showConfigDir,
  'show-raw-config-dir': showRawConfigDir,
  'update-from-dir': updateFromDir,
  'help': help
}

/**
 * CLI tool to manage Librato backend configuration.
 *
 * @author Jürgen Strobel <juergen.strobel@emarsys.com>
 */
function * main (argv) {
  const cmd = argv[2]
  const args = _.drop(3, argv)
  function * unknownCommand () { throw new Error(`unknown command ${cmd}, use "help"`) }
  try {
    if (process.env.LIBRATO_USER === undefined || process.env.LIBRATO_TOKEN === undefined) {
      throw new Error('LIBRATO_USER and LIBRATO_TOKEN must be set in the environment')
    }
    // let's look at proper argv parsing sometime
    // https://www.npmjs.com/package/command-line-args
    // or https://github.com/75lb/command-line-commands
    const action = _.getOr(unknownCommand, cmd, actions)
    logger.debug('dispatching', { cmd, action, args })
    yield action.apply(undefined, args)
    logger.debug('success')
  } catch (err) {
    process.exitCode = 1
    _.has('error', err)
      ? logger.error('%s: %s', err.name, err.message, err.error)
      : logger.error('%s: %s', err.name, err.message)
  }
}

module.exports = co.wrap(main)
module.exports.actions = actions

// execute main only if required at top level
if (require.main === module) { module.exports(process.argv) }
