'use strict'

const _ = require('lodash/fp')  // note fp variant
const assert = require('assert')
const co = require('co')
const request = require('request-promise')
const StatusCodeError = require('request-promise/errors').StatusCodeError

const _build = method => body => ({ method, body })
const post = _build('POST')
const put = _build('PUT')
const del = _build('DELETE')()
const noSuch = _.curry((what, name) => {
  throw new StatusCodeError(404, `no ${what} named ${name}`)
})
const noSuchOrObj = _.curry((what, name, obj) => _.isUndefined(obj) ? noSuch(what, name) : obj)

/**
 * An API client for the Librato (management) API.
 *
 * Unless overridden by options this will pick up LIBRATO_USER and LIBRATO_TOKEN from
 * the process environment (works out of the box on Heroku).
 *
 * @param options {object} A plain object, which allows to override the following properties:
 *   - serviceUrl (String): the base of the service URL
 *   - auth (object): passed to the underlying request handler in each request
 *   - request: the underlying request-promise object, may be used to set defaults
 *
 * @see https://www.librato.com/docs/api/?shell#introduction
 *
 * @TODO The API is only partially covered, and there is no long running jobs support yet.
 *
 * @author Jürgen Strobel <juergen.strobel@emarsys.com>
 */
class LibratoApi {

  constructor (options) {
    const o = options || {}
    this.serviceUrl = o.serviceUrl || 'https://metrics-api.librato.com/v1'
    this.auth = o.auth || { user: process.env.LIBRATO_USER, pass: process.env.LIBRATO_TOKEN }
    this.request = o.request || request
  }

  /**
   * Do a single API request and return the result from the underlying request-promise.
   *
   * All items of the path array are appended to this.serviceUrl, this.auth is inserted
   * into the request object, and both opts and opts2 are merged into the request object.
   *
   * Returns a promise as created by request-promise. Most other methods call this one
   * eventually and return its result directly, so you should expect to get the errors,
   * result wrappers for pagination and job monitors as described in the API.
   *
   * The underlying request-promise and the given options may change several aspects of
   * this method, e.g. via resolveWithFullResponse: true or simple: false.
   */
  apiRequest (path, opts, opts2) {
    return this.request(
      _.merge(
        {
          url: [this.serviceUrl, ...path].join('/'),
          auth: this.auth,
          json: true
        },
        opts || {},
        opts2 || {}
      )
    )
  }

  /**
   * This convenience method steps through paginated results by repeatedly
   * calling this.paginatedGetter(opts) with increasing offsets and concatenates all
   * parts into an array (in a Promise).
   * The caller is responsible for passing valid parameters not messing with this process,
   * but notable may use all pagination options except "offset".
   */
  getAllPaginated (paginatedGetter, opts) {
    assert(paginatedGetter.resultPath, 'invalid paginatedGetter')
    const getPage = paginatedGetter.bind(this)
    const unwrapPage = _.get(paginatedGetter.resultPath)
    const optsWithOffset = offset => _.merge(opts, { qs: { offset } })
    const getNextPart = (acc, offset) =>
      getPage(optsWithOffset(offset)).then(resultOrContinue(acc))
    const resultOrContinue = acc => page => {
      const newAcc = _.concat(acc, unwrapPage(page))
      const nextOffset = page.query.offset + page.query.length
      const isLastPage = nextOffset >= page.query.found
      return isLastPage ? newAcc : getNextPart(newAcc, nextOffset)
    }
    return getNextPart([], 0)
  }

  /**
   * Get metrics.
   *
   * Note: The API does pagination with default and max length 100.
   * Use opts to pass a query string ({ qs: { offset: ... }}) to the underlying request,
   * or use getAllPaginated(getMetrics).
   */
  getMetrics (opts) {
    return this.apiRequest(['metrics'], opts)
  }

  /**
   * Get a single metric by name.
   */
  getMetric (name, opts) {
    return this.apiRequest(['metrics', name], opts)
  }

  /**
   * Put a single metric by name. This may be used to create or update a metric.
   * Check error.errors.params in case of problems.
   */
  putMetric (name, params, opts) {
    return this.apiRequest(['metrics', name], put(params), opts)
  }

  /**
   * Delete a single metric by name.
   */
  deleteMetric (name, opts) {
    return this.apiRequest(['metrics', name], del, opts)
  }

  /**
   * Get spaces (paginated).
   */
  getSpaces (opts) {
    return this.apiRequest(['spaces'], opts)
  }

  /**
   * Get details of a single space by id.
   */
  getSpace (id, opts) {
    return this.apiRequest(['spaces', id], opts)
  }

  /**
   * Post a new space.
   * If successful this returns an object with the id to be used with get and delete requests,
   * unlike metrics which are always referenced by name.
   * @param space request object, or as shortcut a String containing the new space's name.
   */
  postSpace (space, opts) {
    const body = _.isString(space) ? { name: space } : space
    return this.apiRequest(['spaces'], post(body), opts)
  }

  /**
   * Update a space (change its name).
   */
  putSpace (id, space, opts) {
    const body = _.isString(space) ? { name: space } : space
    return this.apiRequest(['spaces', id], put(body), opts)
  }

  /**
   * Delete a single space by id.
   */
  deleteSpace (id, opts) {
    return this.apiRequest(['spaces', id], del, opts)
  }

  /**
   * Get all charts of a space (not paginated).
   */
  getCharts (spaceId, opts) {
    return this.apiRequest(['spaces', spaceId, 'charts'], opts)
  }

  /**
   * Get a single chart by space and chart id.
   */
  getChart (spaceId, id, opts) {
    return this.apiRequest(['spaces', spaceId, 'charts', id], opts)
  }

  /**
   * Post a new chart.
   * If successful this returns an object with the id to be used with get and delete requests.
   */
  postChart (spaceId, chart, opts) {
    return this.apiRequest(['spaces', spaceId, 'charts'], post(chart), opts)
  }

  /**
   * Put a chart.
   */
  putChart (spaceId, id, chart, opts) {
    return this.apiRequest(['spaces', spaceId, 'charts', id], put(chart), opts)
  }

  /**
   * Delete a single chart by id.
   */
  deleteChart (spaceId, id, opts) {
    return this.apiRequest(['spaces', spaceId, 'charts', id], del, opts)
  }

  // "complex" operations doing more than a simple API call

  /**
   * Returns (Promise of) first space with given name, compared by strict equality.
   * The Promise will be rejected if no matching space can be found.
   */
  findSpaceByName (name) {
    return this
      // filter remote and locally, since server side qs does loose pattern matching
      .getAllPaginated(this.getSpaces, { qs: { name } })
      .then(_.filter({ name }))
      .then(_.head)
      .then(noSuchOrObj('space', name))
  }

  /**
   * For the named space return a json object (in a Promise) which can be used to re-create
   * this full space, including charts, with createOrUpdateSpace.
   * If there are multiple spaces with the same name it will dump the first one found
   * with findSpaceByName.
   *
   * @Note This includes the definition of all charts but not their visual layout on
   * the dashboard since the Librato API does not support this at the moment.
   */
  dumpSpace (name) {
    const self = this
    const omitRedundantComposite = stream =>
      _.has('metric', stream) ? _.omit('composite', stream) : stream
    const cleanStream = _.flow(_.omit(['id', 'type']), omitRedundantComposite)
    const cleanStreams = _.map(cleanStream)
    const cleanChart = _.flow(_.omit('id'), _.update('streams', cleanStreams))
    const cleanCharts = _.map(cleanChart)
    const cleanSpace = _.flow(_.omit('id'), _.update('charts', cleanCharts))

    return co(function * () {
      const space = yield self.findSpaceByName(name)
      const charts = yield self.getCharts(space.id)
      return cleanSpace(_.merge(space, { charts }))
    })
  }

  /**
   * Create or update a full space including charts from a json object.
   * The format of the object is the one used by postSpace with charts (as per
   * postChart) embeded in an array under charts:
   *
   * { name: NAME, charts: [ CHARTS* ] }
   *
   * If there already exist multiple spaces with the same name it will update the
   * first one found. All charts must have a name, since for updates their ID is
   * looked up by it. Chart names are expected to be unique per space.
   *
   * The dumpSpace method returns an object in the format required by newSpace, so this can
   * be used to copy spaces between accounts.
   *
   * Assuming no other problems, if individual charts fail this does not stop this function.
   * All errors are collected in a single Error thrown in the end, with an error property
   * similar to other API calls.
   */
  createOrUpdateSpace (newSpace) {
    const self = this

    function validateNewChartNames (names) {
      if (_.some(_.eq(''), names)) {
        throw new Error(`empty chart name in space ${newSpace.name}`)
      }
      if (_.uniq(names).length < names.length) {
        throw new Error(`duplicate chart names in space ${newSpace.name}`)
      }
    }

    function validateChartResults (chartResults) {
      const chartErrors = _.compact(chartResults)
      if (chartErrors.length > 0) {
        const err = new Error(`some chart operations failed in space ${newSpace.name}`)
        err.error = { errors: chartErrors }
        throw err
      }
    }

    const succeed = _.constant(undefined)
    const getErrors = (op, chart) => err =>
      ({ chart: (chart.name || chart.id), op, errors: err.error.errors })
    const collectErrs = (op, chartFn) => chart =>
      chartFn(chart).then(succeed).catch(getErrors(op, chart))

    return co(function * () {
      const newCharts = newSpace.charts
      const newChartNames = _.map(_.getOr('', 'name'), newCharts)
      validateNewChartNames(newChartNames)

      const maybeSpace = yield self.findSpaceByName(newSpace.name).catch(_.constant(undefined))
      const space = _.isUndefined(maybeSpace)
        ? yield self.postSpace(_.omit('charts', newSpace))
        : maybeSpace

      const existingCharts = _.isUndefined(maybeSpace) ? [] : yield self.getCharts(space.id)
      const existingChartNames = _.map('name', existingCharts)
      const getIdByName = name => _.find({ name }, existingCharts).id

      const toDelete = _.filter(c => !_.includes(c.name, newChartNames), existingCharts)
      const oldAndNew = _.partition(c => _.includes(c.name, existingChartNames), newCharts)
      const toUpdate = oldAndNew[0]
      const toCreate = oldAndNew[1]

      const chartResults = yield [
        ..._.map(collectErrs('delete', chart => self.deleteChart(space.id, chart.id)), toDelete),
        ..._.map(collectErrs('update', chart => self.putChart(space.id, getIdByName(chart.name), chart)), toUpdate),
        ..._.map(collectErrs('create', chart => self.postChart(space.id, chart)), toCreate)
      ]
      validateChartResults(chartResults)
    })
  }
}

// annotations required by getAllPaginated
LibratoApi.prototype.getMetrics.resultPath = 'metrics'
LibratoApi.prototype.getSpaces.resultPath = 'spaces'

const renderCompositeOptions = options => {
  const optVals = _(options || {}).keys().map(k => `${k}:"${options[k]}"`).join(', ')
  return _.isEmpty(optVals) ? '' : `, { ${optVals} }`
}

/**
 * Render a named Librato composite expression function
 * with the common one-or-set-and-options argument pattern.
 * To ease partial application the first argument is separated.
 */
const renderCompositeFn = name => (argOrArgSet, options) => {
  const argSet = _.castArray(argOrArgSet)
  const indentLines = text => _(text).split('\n').map(l => '  ' + l).join('\n')
  const indentedArgs = _(argSet).map(indentLines).join(',\n')
  return `${name}([\n${indentedArgs}\n]${renderCompositeOptions(options)})`
}

const series = (name, source, options) =>
  `s("${name}", "${source || '%'}"${renderCompositeOptions(options)})`

/**
 * Librato composite metrics mini-DSL.
 *
 * The functions here output (nicely) formatted string representations of Librato composite metric
 * expressions of the same name. Librato set arguments are represented by javascript Arrays, and
 * the options dictionary is a plain object or missing/undefined.
 *
 * The source argument of series defaults to "%" (dynamic source).
 *
 * There is no validation in regard to set arity or allowed options.
 */
LibratoApi.prototype.compositeDSL = {
  series,
  s: series,
  renderCompositeFn,
  abs: renderCompositeFn('abs'),
  derive: renderCompositeFn('derive'),
  divide: renderCompositeFn('divide'),
  integrate: renderCompositeFn('integrate'),
  max: renderCompositeFn('max'),
  mean: renderCompositeFn('mean'),
  min: renderCompositeFn('min'),
  moving_average: renderCompositeFn('moving_average'),
  multiply: renderCompositeFn('multiply'),
  rate: renderCompositeFn('rate'),
  scale: renderCompositeFn('scale'),
  subtract: renderCompositeFn('subtract'),
  sum: renderCompositeFn('sum'),
  window: renderCompositeFn('window'),
  map: 'TODO',
  timeshift: 'TODO'
}

/**
 * At the root this package is a ready to use LibratoApi instance with default options.
 * For use cases requiring more flexibility the class constructor is exported as LibratoApi.
 */
module.exports = new LibratoApi()
module.exports.LibratoApi = LibratoApi
