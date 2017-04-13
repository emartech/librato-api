'use strict'

const _ = require('lodash/fp')  // note fp variant
const assert = require('assert')
const co = require('co')
const combinatorics = require('js-combinatorics')
const request = require('request-promise')
const StatusCodeError = require('request-promise/errors').StatusCodeError
const uuid = require('uuid')
const winston = require('winston')

const post = body => ({ method: 'POST', body })
const put = body => ({ method: 'PUT', body })
const del = { method: 'DELETE' }
const noSuch = (what, name) => { throw new StatusCodeError(404, `no ${what} named ${name}`) }
const resultOrNoSuch = _.curry((what, name, obj) => _.isUndefined(obj) ? noSuch(what, name) : obj)

/**
 * An API client for the Librato (management) API.
 *
 * Unless overridden by options this will pick up LIBRATO_USER and LIBRATO_TOKEN from
 * the process environment (this works out of the box on Heroku).
 *
 * @param options {object} A plain object, which allows to override the following properties:
 *   - serviceUrl (String): the base of the service URL
 *   - auth (object): passed to the underlying request handler in each request
 *   - request: the underlying request-promise object, may be used to set defaults
 *   - logger: use a custom logger, else try winston.loggers.LibratoAPi or root winston
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
    this.logger = o.logger || winston.loggers.LibratoApi || winston
  }

  // *** straight API calls ***

  /**
   * Do a single API request and return the result from the underlying request-promise.
   *
   * All items of the path array are appended to this.serviceUrl, this.auth is inserted
   * into the request object, and both opts and opts2 are merged into the request object.
   *
   * Returns a promise as created by request-promise. Many other methods call this one
   * eventually and return its result directly, so you should expect to get the errors,
   * result wrappers for pagination and job monitors as described in the Librato API.
   *
   * The underlying request-promise and the given options may change several aspects of
   * this method, e.g. via resolveWithFullResponse: true or simple: false.
   *
   * The request is logged on debug, the result on silly (with a UUID).
   */
  apiRequest (path, opts, opts2) {
    const requestId = uuid.v4()
    const options = _.merge(
      {
        url: [this.serviceUrl, ...path].join('/'),
        auth: this.auth,
        json: true
      },
      opts || {},
      opts2 || {}
    )
    const logResult = result => {
      this.logger.silly('LibratoAPI#apiRequest result', { result, requestId })
      return result
    }
    const logErrorRethrow = error => {
      this.logger.silly('LibratoAPI#apiRequest error', { error, requestId })
      throw error
    }

    this.logger.debug('LibratoAPI#apiRequest', { path, opts, opts2, requestId })
    return this.request(options).then(logResult).catch(logErrorRethrow)
  }

  // single direct API calls

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
   * @param space request object.
   */
  postSpace (space, opts) {
    // too much magic, remove string handling next major version
    const body = _.isString(space) ? { name: space } : space
    return this.apiRequest(['spaces'], post(body), opts)
  }

  /**
   * Update a space (change its name).
   * @param space {{ name }} A space object with the new name.
   */
  putSpace (id, space, opts) {
    return this.apiRequest(['spaces', id], put(space), opts)
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

  /**
   * Get alerts (paginated).
   */
  getAlerts (opts) {
    return this.apiRequest(['alerts'], opts)
  }

  /**
   * Get status of alerts.
   */
  getAlertsStatus (opts) {
    return this.apiRequest(['alerts', 'status'], opts)
  }

  /**
   * Get details of a single alert by id.
   */
  getAlert (id, opts) {
    return this.apiRequest(['alerts', id], opts)
  }

  /**
   * Post a new alert.
   * @param alert request object.
   */
  postAlert (alert, opts) {
    return this.apiRequest(['alerts'], post(alert), opts)
  }

  /**
   * Update an alert.
   * @param alert request object.
   */
  putAlert (id, alert, opts) {
    return this.apiRequest(['alerts', id], put(alert), opts)
  }

  /**
   * Delete a single alert by id.
   */
  deleteAlert (id, opts) {
    return this.apiRequest(['alerts', id], del, opts)
  }

  /**
   * Get services (paginated).
   */
  getServices (opts) {
    return this.apiRequest(['services'], opts)
  }

  /**
   * Get details of a single service by id.
   */
  getService (id, opts) {
    return this.apiRequest(['services', id], opts)
  }

  /**
   * Post a new service.
   * @param service request object.
   */
  postService (service, opts) {
    return this.apiRequest(['services'], post(service), opts)
  }

  /**
   * Update a service.
   * @param service request object.
   */
  putService (id, service, opts) {
    return this.apiRequest(['services', id], put(service), opts)
  }

  /**
   * Delete a single service by id.
   */
  deleteService (id, opts) {
    return this.apiRequest(['services', id], del, opts)
  }

  /**
   * Get sources (paginated).
   */
  getSources (opts) {
    return this.apiRequest(['sources'], opts)
  }

  /**
   * Get details of a single source by name.
   */
  getSource (name, opts) {
    return this.apiRequest(['sources', name], opts)
  }

  /**
   * Create or update a source.
   * @param params request object.
   */
  putSource (name, params, opts) {
    return this.apiRequest(['sources', name], put(params), opts)
  }

  /**
   * Delete a single source by name.
   */
  deleteSource (name, opts) {
    return this.apiRequest(['sources', name], del, opts)
  }

  // *** pagination iteration helpers ***

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

  getAllMetrics (opts) {
    return this.getAllPaginated(this.getMetrics, opts)
  }

  getAllSpaces (opts) {
    return this.getAllPaginated(this.getSpaces, opts)
  }

  getAllAlerts (opts) {
    return this.getAllPaginated(this.getAlerts, opts)
  }

  getAllServices (opts) {
    return this.getAllPaginated(this.getServices, opts)
  }

  getAllSources (opts) {
    return this.getAllPaginated(this.getSources, opts)
  }

  // *** custom finders ***

  _findBy (getAll, what, property, value) {
    const qs = { [property]: value }
    // filter remote and locally, since server side qs does a contains-check only
    return getAll.bind(this)({ qs })
      .then(_.filter(qs))
      .then(_.head)
      .then(resultOrNoSuch(what, value))
  }

  /**
   * Returns (Promise of) first space with given name, compared by strict equality.
   * The Promise will be rejected if no matching space can be found.
   */
  findSpaceByName (name) {
    return this._findBy(this.getAllSpaces, 'space', 'name', name)
  }

  /**
   * Returns (Promise of) first alert with given name, compared by strict equality.
   * The Promise will be rejected if no matching alert can be found.
   */
  findAlertByName (name) {
    return this._findBy(this.getAllAlerts, 'alert', 'name', name)
  }

  /**
   * Returns (Promise of) first service with given title, compared by strict equality.
   * The Promise will be rejected if no matching service can be found.
   */
  findServiceByTitle (title) {
    return this._findBy(this.getAllServices, 'service', 'title', title)
  }

  // *** space and chart ops ***

  /**
   * For the named space return a json object (in a Promise) which can be used to re-create
   * this full space including charts with createOrUpdateSpace.
   * If there are multiple spaces with the same name it will dump the first one found
   * with findSpaceByName.
   *
   * @Note This includes the definition of all charts but not their visual layout on
   * the dashboard since the Librato API does not provide this information this at the moment.
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
   * postChart) embedded in an array under charts:
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
      ({ chart: chart.name, op, errors: err.error.errors })
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

  // *** alert & service ops ***

  // A dumpAlert a la dumpSpace would be nice to have, but it's less work to edit
  // the result from getAlert than doing the getSpace/getCharts walk.

  /**
   * Creates or updates an alert by its name.
   *
   * This supports specifying the alert's services by service id or title.
   */
  createOrUpdateAlert (newAlert) {
    const self = this
    return co(function * () {
      const services = yield self.getAllServices()
      const getServiceId = titleOrId =>
        resultOrNoSuch(
          'service', titleOrId,
          _.find(s => s.id === titleOrId || s.title === titleOrId, services)
        ).id
      const alert = _.merge(
        newAlert,
        { services: _.map(getServiceId, newAlert.services) }
      )

      const alertId = yield self.findAlertByName(alert.name)
        .then(_.get('id'))
        .catch(_.constant(undefined))
      return (alertId === undefined)
          ? self.postAlert(alert)
          : self.putAlert(alertId, alert)
    })
  }

  /**
   * Creates or updates a service by its title.
   */
  createOrUpdateService (newService) {
    return this.findServiceByTitle(newService.title).then(
      service => this.putService(service.id, newService),
      _err => this.postService(newService)
    )
  }

  // *** config management ***

  // Transforms config:
  // 1. simplify structure read from a config dir (flattens subdirs and creates predictable arrays)
  // 2. merge the __default__ metric with all other metrics and remove it
  // 3. apply template_values to metric name/display_name/composite properties and
  //    outdated metric names
  // Note: So far this is used only by the CLI tool, see the TODO in updateFromDir there.
  _processRawConfig (config) {
    // support single objects or arrays in files in nested dirs, flatten to one level
    const allFlat = _.flow(_.defaultTo([]), _.toArray, _.flatten)

    const metrics = allFlat(config.metrics)
    const spaces = allFlat(config.spaces)
    const alerts = allFlat(config.alerts)
    const services = allFlat(config.services)
    const sources = allFlat(config.sources)
    const outdated = _.merge(
      { metrics: [], spaces: [], alerts: [], services: [], sources: [] },
      config.outdated
    )
    const templateValues = config.template_values || []

    const createTemplateValuePermutations = templateValues => {
      const keys = _.reverse(_.keys(templateValues))
      const values = _.reverse(_.values(templateValues))
      const vs = _.spread(combinatorics.cartesianProduct)(values).toArray()
      const zipKeysToObj = _.flow(_.zip(keys), _.fromPairs)
      return _.map(zipKeysToObj, vs)
    }
    const templateValuePermutations =
      _.isEmpty(templateValues) ? [{}] : createTemplateValuePermutations(templateValues)
    this.logger.debug({
      template_values: config.template_values,
      permutations: _.size(templateValuePermutations)
    })
    this.logger.silly({ templateValuePermutations })

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
      this.logger.debug({ defaultMetric })
      return _.map(m => _.merge(defaultMetric, m), rest)
    }
    const createMetricTemplate = metric =>
      createPropsTemplate(metric)(['name', 'display_name', 'composite'])
    const processRawMetrics =
      _.flow(applyDefaultMetric, permutationsOfObjs(createMetricTemplate))

    return {
      metrics: processRawMetrics(metrics),
      spaces,
      alerts,
      services,
      sources,
      outdated: _.merge(
        outdated,
        { metrics: templatesPermutations(outdated.metrics) }
      )
    }
  }
}

// annotations required by getAllPaginated
LibratoApi.prototype.getMetrics.resultPath = 'metrics'
LibratoApi.prototype.getSpaces.resultPath = 'spaces'
LibratoApi.prototype.getAlerts.resultPath = 'alerts'
LibratoApi.prototype.getServices.resultPath = 'services'
LibratoApi.prototype.getSources.resultPath = 'sources'

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
