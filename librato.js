#!/usr/bin/env node
'use strict'

const _ = require('lodash/fp')
const assert = require('assert')
const co = require('co')
const fs = require('mz/fs')
const path = require('path')
const requireDir = require('require-dir')
const winston = require('winston')

const librato = require('./index')

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

const jsonStringify = json => JSON.stringify(json, undefined, 2) + '\n'

function writeFileOrFd (maybeSink) {
  const sink = maybeSink || process.stdout.fd
  const write = _.isString(sink) ? fs.writeFile : fs.write
  // return write(sink, ...arguments[1..])
  return write.apply(fs, _.chain(arguments).drop(1).unshift(sink).value())
}

// sync IO
function readConfigDir (path) {
  return requireDir(path, { recurse: true })
}

// Transforms config:
// 1. simplify structure read from dir (flattens subdirs and creates predictable arrays)
// 2. merge the __default__ metric with all other metrics and remove it
// 3. apply template_values to metric name/display_name/composite properties and
//    outdated metric names
function processRawConfig (config) {
  // support single objects or arrays in files in nested dirs, flatten to one level
  const allFlat = _.flow(_.defaultTo([]), _.toArray, _.flatten)

  // create all combinatorial permutations of values in config.template_values
  const allPermsRec = (acc, keys) =>
    _.isEmpty(keys)
      ? acc
      : _.flatMap(
        value => allPermsRec(_.merge(acc, { [keys[0]]: value }), _.drop(1, keys)),
        config.template_values[keys[0]]
      )
  const templateValuePermutations =
    _.isEmpty(config.template_values)
      ? [{}]
      : allPermsRec({}, _.keys(config.template_values))
  logger.debug({
    template_values: config.template_values,
    permutations: _.size(templateValuePermutations)
  })

  // template factories, simple and lifted to obj properties
  const createTemplate = source =>
    // lodash/fp is missing the arity-2 template function, so we need to un-fix it to pass options
    _.template.convert({fixed: false})(source, { interpolate: /{{([\s\S]+?)}}/g })
  const createPropsTemplate = obj => pathes => {
    const propValues = _.at(pathes, obj)
    const propTemplates = _.map(t => t ? createTemplate(t) : null, propValues)
    const evalPropTemplates = data => _.map(pt => pt ? pt(data) : null, propTemplates)
    const pathesZipEvaled =
      data => _.filter(x => x[1] !== null, _.zip(pathes, evalPropTemplates(data)))
    const setPathEvaled = (acc, pe) => _.set(pe[0], pe[1], acc)
    return data => _.reduce(setPathEvaled, obj, pathesZipEvaled(data))
  }

  // permutations in the sense of different template evaluations with templateValuePermutations
  const templatePermutations = template =>
    _.uniq(_.map(createTemplate(template), templateValuePermutations))
  const templatesPermutations = _.flatMap(templatePermutations)
  const permutationsOfObj = createObjTemplate => obj =>
    _.uniqWith(_.isEqual, _.map(createObjTemplate(obj), templateValuePermutations))
  const permutationsOfObjs = createObjTemplate => _.flatMap(permutationsOfObj(createObjTemplate))

  // custom metrics processing
  const applyDefaultMetric = metrics => {
    // want ES6: const [[defaultMetric={}], rest] = _.partition(...)
    const ps = _.partition(x => x.name === '__default__', metrics)
    assert(ps[0].length <= 1, 'more than 1 __default__ metric')
    const defaultMetric = ps[0][0] || {}
    const rest = ps[1]
    logger.debug({ defaultMetric })
    return _.map(m => _.merge(defaultMetric, m), rest)
  }
  const createMetricTemplate = metric =>
    createPropsTemplate(metric)(['name', 'display_name', 'composite'])
  const processRawMetrics =
    _.flow(allFlat, applyDefaultMetric, permutationsOfObjs(createMetricTemplate))

  return {
    metrics: processRawMetrics(config.metrics),
    spaces: allFlat(config.spaces),
    outdated: {
      metrics: templatesPermutations(config.outdated.metrics),
      spaces: config.outdated.spaces
    }
  }
}

// -- metric actions

function * listMetrics (maybeSink) {
  logger.verbose('listing metrics', { to: maybeSink })
  const metrics = yield librato.getAllPaginated(librato.getMetrics)
  const compact = _.map(_.get('name'), metrics)
  yield writeFileOrFd(maybeSink, jsonStringify(compact))
}

function * getMetrics (maybeSink) {
  logger.verbose('dumping metrics', { to: maybeSink })
  const metrics = yield librato.getAllPaginated(librato.getMetrics)
  yield writeFileOrFd(maybeSink, jsonStringify(metrics))
}

function * getMetric (name, maybeSink) {
  logger.verbose('retrieving metric %s', name, { name, to: maybeSink })
  const metric = yield librato.getMetric(name)
  yield writeFileOrFd(maybeSink, jsonStringify(metric))
}

// -- space actions

function * listSpaces (maybeSink) {
  logger.verbose('listing spaces', { to: maybeSink })
  const spaces = yield librato.getAllPaginated(librato.getSpaces)
  const compact = _.reduce((acc, s) => _.set(s.id, s.name, acc), {}, spaces)
  yield writeFileOrFd(maybeSink, jsonStringify(compact))
}

function * dumpSpace (name, maybeSink) {
  logger.verbose('dumping space', { space: name, to: maybeSink })
  const space = yield librato.dumpSpace(name)
  yield writeFileOrFd(maybeSink, jsonStringify(space))
}

function * createOrUpdateSpace (maybeSource) {
  const source = maybeSource || process.stdin.fd
  logger.verbose('updating space', { source })
  const buffer = yield fs.readFile(source)
  const space = JSON.parse(buffer.toString())
  logger.debug('space definition', { space })
  yield librato.createOrUpdateSpace(space)
}

function * deleteSpace (name) {
  logger.verbose('deleting space', { space: name })
  const space = yield librato.findSpaceByName(name)
  yield librato.deleteSpace(space.id)
}

// -- config dir actions

function * showConfigDir (configDir, maybeSink) {
  const absConfigDir = path.join(process.cwd(), configDir)
  logger.verbose('reading config dir %s', absConfigDir)
  const config = processRawConfig(readConfigDir(absConfigDir))
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
 */
function * updateFromDir (configDir) {
  const absConfigDir = path.join(process.cwd(), configDir)
  logger.verbose('updating configuration from config dir %s', absConfigDir)
  const config = processRawConfig(readConfigDir(absConfigDir))

  var errorCount = 0
  const logOK = (what, id) => _result => {
    logger.verbose('%s %s', what, id)
  }
  const logAndCountError = (what, id) => err => {
    errorCount += 1
    logger.error('%s %s failed', what, id, {
      [what]: id,
      errors: err.error.errors
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
    withLoggingIgnore404('delete metric', name, librato.deleteMetric(name))
  const updateMetric = metric =>
    withLogging('update metric', metric.name, librato.putMetric(metric.name, metric))
  const deleteSpace = name =>
    withLoggingIgnore404(
      'delete space', name,
      librato.findSpaceByName(name).then(_.get('id')).then(librato.deleteSpace)
    )
  const updateSpace = space =>
    withLogging('update space', space.name, librato.createOrUpdateSpace(space))

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

// -- hidden dev actions

function * _adhoc () {
  logger.verbose('adhoc')
  // foo
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
  'help': help,
  '_adhoc': _adhoc
}

/**
 * CLI tool to manage Librato backend configuration.
 *
 * @TODO extract this (with LibratoClient) to an npm package for @TamasTancos.
 *
 * @author Jürgen Strobel <juergen.strobel@emarsys.com>
 */
function * main (argv) {
  const cmd = argv[2]
  const args = _.drop(3, argv)
  function * unknownCommand () { throw new Error(`unknown command ${cmd}, use "help"`) }
  try {
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
