#!/usr/bin/env node
'use strict'

const _ = require('lodash/fp')
const co = require('co')
const fs = require('mz/fs')
const path = require('path')
const requireDir = require('require-dir')
const winston = require('winston')

const AppOpticsAPI = require('./index').AppOpticsAPI

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
const AppOpticsAPI = new AppOpticsAPI({ logger })

const getId = _.get('id')
const getNames = _.map('name')
const getIdAndNames = _.map(_.at(['id', 'name']))
const getNamesById = _.flow(getIdAndNames, _.fromPairs)
const getIdAndTitles = _.map(_.at(['id', 'title']))
const getTitlesById = _.flow(getIdAndTitles, _.fromPairs)

function * readJson (maybeSource) {
  const source = maybeSource || process.stdin.fd
  const buffer = yield fs.readFile(source)
  return JSON.parse(buffer.toString())
}

function * writeJson (maybeSink, data) {
  const jsonData = JSON.stringify(data, undefined, 2) + '\n'
  return (maybeSink === undefined)
    ? process.stdout.write(jsonData)
    : yield fs.writeFile(maybeSink, jsonData)
}

// does sync IO (requireDir)
function readConfigDir (configDir) {
  if (configDir === undefined) { throw new Error('missing config dir') }
  const absConfigDir = configDir.startsWith('/')
    ? configDir
    : path.join(process.cwd(), configDir)
  return requireDir(absConfigDir, { recurse: true })
}

// -- metric actions

function * listMetrics (maybeSink) {
  logger.verbose('listMetrics', { to: maybeSink })
  const metrics = yield AppOpticsAPI.getAllMetrics()
  yield writeJson(maybeSink, getNames(metrics))
}

function * getMetrics (maybeSink) {
  logger.verbose('getMetrics', { to: maybeSink })
  const metrics = yield AppOpticsAPI.getAllMetrics()
  yield writeJson(maybeSink, metrics)
}

function * getMetric (name, maybeSink) {
  logger.verbose('getMetric', { name, to: maybeSink })
  const metric = yield AppOpticsAPI.getMetric(name)
  yield writeJson(maybeSink, metric)
}

// -- space actions (with embedded charts)

function * listSpaces (maybeSink) {
  logger.verbose('listSpaces', { to: maybeSink })
  const spaces = yield AppOpticsAPI.getAllSpaces()
  yield writeJson(maybeSink, getNamesById(spaces))
}

function * dumpSpace (name, maybeSink) {
  logger.verbose('dumpSpace', { space: name, to: maybeSink })
  const space = yield AppOpticsAPI.dumpSpace(name)
  yield writeJson(maybeSink, space)
}

function * createOrUpdateSpace (maybeSource) {
  logger.verbose('createOrUpdateSpace', { from: maybeSource })
  const space = yield readJson(maybeSource)
  logger.debug('space definition', { space })
  yield AppOpticsAPI.createOrUpdateSpace(space)
}

function * deleteSpace (name) {
  logger.verbose('deleteSpace', { space: name })
  const space = yield AppOpticsAPI.findSpaceByName(name)
  yield AppOpticsAPI.deleteSpace(space.id)
}

// -- alert actions

function * listAlerts (maybeSink) {
  logger.verbose('listAlerts', { to: maybeSink })
  const alerts = yield AppOpticsAPI.getAllAlerts()
  yield writeJson(maybeSink, getNamesById(alerts))
}

function * getAlerts (maybeSink) {
  logger.verbose('getAlerts', { to: maybeSink })
  const alerts = yield AppOpticsAPI.getAllAlerts()
  yield writeJson(maybeSink, alerts)
}

function * getAlertsStatus (maybeSink) {
  logger.verbose('getAlertsStatus', { to: maybeSink })
  const status = yield AppOpticsAPI.getAlertsStatus()
  yield writeJson(maybeSink, status)
}

function * getAlert (idOrName, maybeSink) {
  logger.verbose('getAlert', { idOrName, to: maybeSink })
  const alert = yield AppOpticsAPI.getAlert(idOrName)
    .catch(_err => AppOpticsAPI.findAlertByName(idOrName))
  yield writeJson(maybeSink, alert)
}

// -- service actions

function * listServices (maybeSink) {
  logger.verbose('listServices', { to: maybeSink })
  const services = yield AppOpticsAPI.getAllServices()
  yield writeJson(maybeSink, getTitlesById(services))
}

function * getServices (maybeSink) {
  logger.verbose('getServices', { to: maybeSink })
  const services = yield AppOpticsAPI.getAllServices()
  yield writeJson(maybeSink, services)
}

function * getService (idOrTitle, maybeSink) {
  logger.verbose('getService', { idOrTitle, to: maybeSink })
  const service = yield AppOpticsAPI.getService(idOrTitle)
    .catch(_err => AppOpticsAPI.findServiceByTitle(idOrTitle))
  yield writeJson(maybeSink, service)
}

// -- source actions

function * listSources (maybeSink) {
  logger.verbose('listSources', { to: maybeSink })
  const sources = yield AppOpticsAPI.getAllSources()
  yield writeJson(maybeSink, getNames(sources))
}

function * getSources (maybeSink) {
  logger.verbose('getSources', { to: maybeSink })
  const sources = yield AppOpticsAPI.getAllSources()
  yield writeJson(maybeSink, sources)
}

function * getSource (name, maybeSink) {
  logger.verbose('getSource', { name, to: maybeSink })
  const source = yield AppOpticsAPI.getSource(name)
  yield writeJson(maybeSink, source)
}

// -- config dir actions

function * showConfigDir (configDir, maybeSink) {
  logger.verbose('showConfigDir', { configDir, to: maybeSink })
  const rawConfig = readConfigDir(configDir)
  const config = AppOpticsAPI._processRawConfig(rawConfig)
  yield writeJson(maybeSink, config)
}

function * showRawConfigDir (configDir, maybeSink) {
  logger.verbose('showRawConfigDir', { configDir, to: maybeSink })
  const rawConfig = readConfigDir(configDir)
  yield writeJson(maybeSink, rawConfig)
}

/**
 * @Note Some updates are silently ignored, e.g. trying to change a metric's
 * l2met_type or created_by_ua. This is just how the API works.
 *
 * @TODO move applying the config from here to AppOpticsAPI,
 *  collect errors like in createOrUpdateSpace, and provide tests.
 */
function * updateFromDir (configDir) {
  logger.verbose('updateFromDir', { configDir })
  const rawConfig = readConfigDir(configDir)
  const config = AppOpticsAPI._processRawConfig(rawConfig)

  let errorCount = 0
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
  const ignore404 = (what, id) => err => {
    if (err.statusCode === 404) {
      logger.verbose('%s %s (nothing there)', what, id)
    } else {
      throw err
    }
  }
  const withLogging = (what, id, action) =>
    action.then(logOK(what, id)).catch(logAndCountError(what, id))
  const withLoggingIgnore404 = (what, id, action) =>
    action.then(logOK(what, id), ignore404(what, id)).catch(logAndCountError(what, id))

  const deleteMetric = name =>
    withLoggingIgnore404('delete metric', name, AppOpticsAPI.deleteMetric(name))
  const deleteSpace = name =>
    withLoggingIgnore404(
      'delete space', name,
      AppOpticsAPI.findSpaceByName(name).then(getId).then(id => AppOpticsAPI.deleteSpace(id))
    )
  const deleteAlert = name =>
    withLoggingIgnore404(
      'delete alert', name,
      AppOpticsAPI.findAlertByName(name).then(getId).then(id => AppOpticsAPI.deleteAlert(id))
    )
  const deleteService = name =>
    withLoggingIgnore404(
      'delete service', name,
      AppOpticsAPI.findServiceByTitle(name).then(getId).then(id => AppOpticsAPI.deleteService(id))
    )
  const deleteSource = name =>
    withLoggingIgnore404('delete source', name, AppOpticsAPI.deleteSource(name))

  const updateMetric = metric =>
    withLogging('update metric', metric.name, AppOpticsAPI.putMetric(metric.name, metric))
  const updateSpace = space =>
    withLogging('update space', space.name, AppOpticsAPI.createOrUpdateSpace(space))
  const updateAlert = alert =>
    withLogging('update alert', alert.name, AppOpticsAPI.createOrUpdateAlert(alert))
  const updateService = service =>
    withLogging('update service', service.title, AppOpticsAPI.createOrUpdateService(service))
  const updateSource = source =>
    withLogging('update source', source.name, AppOpticsAPI.putSource(source.name, source))

  // deletes first
  yield {
    metrics: _.map(deleteMetric, config.outdated.metrics),
    spaces: _.map(deleteSpace, config.outdated.spaces),
    alerts: _.map(deleteAlert, config.outdated.alerts),
    services: _.map(deleteService, config.outdated.services),
    sources: _.map(deleteSource, config.outdated.sources)
  }
  // updates
  yield {
    metrics: _.map(updateMetric, config.metrics),
    services: _.map(updateService, config.services),
    sources: _.map(updateSource, config.sources)
  }
  // updates depending on metrics
  yield {
    spaces: _.map(updateSpace, config.spaces),
    alerts: _.map(updateAlert, config.alerts)
  }

  if (errorCount > 0) { throw new Error(`${errorCount} errors occured`) }
}

// -- main

function * help () {
  const getCmdList = _.flow(_.keys, _.reject(_.startsWith('_')), _.join(', '))
  process.stdout.write(`Commands: ${getCmdList(actions)}\n`)
}

const actions = {
  'list-metrics': listMetrics,
  'get-metrics': getMetrics,
  'get-metric': getMetric,
  'list-spaces': listSpaces,
  'dump-space': dumpSpace,
  'update-space': createOrUpdateSpace,
  'delete-space': deleteSpace,
  'list-alerts': listAlerts,
  'get-alerts': getAlerts,
  'get-alerts-status': getAlertsStatus,
  'get-alert': getAlert,
  'list-services': listServices,
  'get-services': getServices,
  'get-service': getService,
  'list-sources': listSources,
  'get-sources': getSources,
  'get-source': getSource,
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
    if (process.env.APPOPTICS_TOKEN === undefined) {
      throw new Error('APPOPTICS_TOKEN must be set in the environment')
    }
    // let's look at proper argv parsing and help sometime
    // https://www.npmjs.com/package/command-line-args
    // or https://github.com/75lb/command-line-commands
    const action = _.getOr(unknownCommand, cmd, actions)
    logger.debug('dispatching', { cmd, action, args })
    yield _.spread(action)(args)
    logger.debug('success')
  } catch (err) {
    process.exitCode = 1
    _.has('error', err)
      ? logger.error('%s: %s', err.name, err.message, err.error)
      : logger.error('%s: %s', err.name, err.message)
  }
}

module.exports = main
module.exports.actions = actions

// execute main only if required at top level
if (require.main === module) { co(main(process.argv)) }
