'use strict'

const _ = require('lodash/fp')
const request = require('request-promise')
const sinonGlobal = require('sinon')
const chai = require('chai')
chai.use(require('sinon-chai'))
chai.use(require('chai-as-promised'))
const expect = chai.expect

const LibratoApi = require('./index')

describe('A default LibratoApi', () => {
  function createInstanceWithTestEnv () {
    const orig = _.pickBy(_.negate(_.isUndefined), _.pickAll(['LIBRATO_USER', 'LIBRATO_TOKEN'], process.env))
    process.env.LIBRATO_USER = 'testuser'
    process.env.LIBRATO_TOKEN = 'testtoken'
    const librato = new LibratoApi.LibratoApi()
    delete process.env.LIBRATO_USER
    delete process.env.LIBRATO_TOKEN
    _.assign(process.env, orig)
    return librato
  }

  const librato = createInstanceWithTestEnv()

  it('should use the public Librato REST URL', function * () {
    expect(librato.serviceUrl).to.equal('https://metrics-api.librato.com/v1')
  })

  it('should use auth credentials from environment', function * () {
    expect(librato.auth).to.deep.equal({ user: 'testuser', pass: 'testtoken' })
  })

  it('should use the default request-promise', function * () {
    expect(librato.request).to.equal(request)
  })
})

describe('The librato-client package itself', () => {
  it('should be a LibratoApi instance with default options', function * () {
    expect(LibratoApi).to.be.an.instanceof(LibratoApi.LibratoApi)
    expect(LibratoApi).to.have.a.property('auth')
    expect(LibratoApi).to.have.a.property('request', request)
    expect(LibratoApi).to.have.a.property('serviceUrl', 'https://metrics-api.librato.com/v1')
  })
})

describe('A test LibratoApi', () => {
  const librato = new LibratoApi.LibratoApi({
    serviceUrl: 'http://url/v1',
    auth: { user: 'testuser', pass: 'testtoken' },
    // reflect back request options in the result
    request: function () { return Promise.resolve(arguments) }
  })

  const stream1 = { name: 's1', id: 1011, type: 'gauge', source: '*' }
  const stream2 = { name: 's2', id: 1012, type: 'counter', source: '%' }
  const stream3 = { name: 's2', id: 1012, type: 'composite', source: '%', composite: 'sum(s (...)', metric: { somthing: 1 } }
  const chart1 = { name: 'chart1', id: 101, streams: [stream1, stream2] }
  const chart2 = { name: 'chart2', id: 102, streams: [stream2, stream3] }
  const space1 = {
    name: 'space1',
    charts: [
      { name: 'chart1', streams: [{ name: 's1', source: '*' }, { name: 's2', source: '%' }] },
      { name: 'chart2', streams: [{ name: 's2', source: '%' }] }
    ]
  }
  const space1a = {
    name: 'space1',
    charts: [
      { name: 'chart1', streams: [{ name: 's1', source: '*' }] },
      { name: 'chart3', streams: [{ name: 's3', source: '%' }] }
    ]
  }
  const space1b = {
    name: 'space1',
    charts: [
      { name: 'chart1', streams: [{ name: 's1', source: '*' }] },
      { name: '', streams: [{ name: 's3', source: '%' }] }
    ]
  }
  const space1c = {
    name: 'space1',
    charts: [
      { name: 'chart1', streams: [{ name: 's1', source: '*' }] },
      { name: 'chart3', streams: [{ name: 's3', source: '%' }] },
      { name: 'chart1', streams: [{ name: 's2', source: '%' }] }
    ]
  }

  let sinon
  beforeEach(function * () {
    sinon = sinonGlobal.sandbox.create()
  })
  afterEach(function * () {
    sinon.restore()
  })

  it('should do an arbitrary API request', function * () {
    const r = yield librato.apiRequest(['foo', 123, 'bar', 456], { qs: { x: 'y' } })
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      qs: { x: 'y' },
      url: 'http://url/v1/foo/123/bar/456'
    })
  })

  it('should iterate and aggregate over paginated results', function * () {
    const opts1 = { foo: 'bar' }
    const getXs = sinon.stub()
    getXs
      .withArgs({ foo: 'bar', qs: { offset: 0 } })
      .returns(Promise.resolve({ query: { offset: 0, length: 3, found: 8 }, xs: [1, 2, 3] }))
    getXs
      .withArgs({ foo: 'bar', qs: { offset: 3 } })
      .returns(Promise.resolve({ query: { offset: 3, length: 3, found: 8 }, xs: [4, 5, 6] }))
    getXs
      .withArgs({ foo: 'bar', qs: { offset: 6 } })
      .returns(Promise.resolve({ query: { offset: 6, length: 2, found: 8 }, xs: [7, 8] }))
    getXs.resultPath = 'xs'

    const result = yield librato.getAllPaginated(getXs, opts1)

    expect(result).to.eql([1, 2, 3, 4, 5, 6, 7, 8])
    expect(getXs)
      .to.have.been.calledThrice
      .and.to.have.always.been.calledOn(librato)
  })

  it('should assert valid paginated getter on call', function * () {
    const getXs = sinon.stub()
    // this really is asserted before a Promise is built, because it violates the call contract
    expect(() => librato.getAllPaginated(getXs)).to.throw('invalid paginatedGetter')
  })

  it('should get metrics', function * () {
    const r = yield librato.getMetrics()
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/metrics'
    })
  })

  it('should get metric definitions with pagination params', function * () {
    const r = yield librato.getMetrics({ qs: { offset: 200, length: 50 } })
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/metrics',
      qs: { offset: 200, length: 50 }
    })
  })

  it('should support getAllPaginated for getMetrics', function * () {
    expect(librato.getMetrics).to.have.property('resultPath', 'metrics')
  })

  it('should get a single metric definition', function * () {
    const r = yield librato.getMetric('test.metric')
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/metrics/test.metric'
    })
  })

  it('should put a metric definition', function * () {
    const r = yield librato.putMetric(
      'test.metric',
      { type: 'composite', composite: 'sum([A, B])' }
    )
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/metrics/test.metric',
      method: 'PUT',
      body: { type: 'composite', composite: 'sum([A, B])' }
    })
  })

  it('should delete a metric', function * () {
    const r = yield librato.deleteMetric('test.metric')
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/metrics/test.metric',
      method: 'DELETE'
    })
  })

  it('should get spaces', function * () {
    const r = yield librato.getSpaces()
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces'
    })
  })

  it('should support getAllPaginated for getSpaces', function * () {
    expect(librato.getSpaces).to.have.property('resultPath', 'spaces')
  })

  it('should get a single space definition', function * () {
    const r = yield librato.getSpace(12345)
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/12345'
    })
  })

  it('should post a new space definition', function * () {
    const r = yield librato.postSpace({ name: 'Test Space 1' })
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces',
      method: 'POST',
      body: { name: 'Test Space 1' }
    })
  })

  it('should post a new space with name only', function * () {
    const r = yield librato.postSpace('Test Space 1')
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces',
      method: 'POST',
      body: { name: 'Test Space 1' }
    })
  })

  it('should put a space definition', function * () {
    const r = yield librato.putSpace(12345, { name: 'Test Space 1a' })
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/12345',
      method: 'PUT',
      body: { name: 'Test Space 1a' }
    })
  })

  it('should delete a space', function * () {
    const r = yield librato.deleteSpace(12345)
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/12345',
      method: 'DELETE'
    })
  })

  it('should get charts of a space', function * () {
    const r = yield librato.getCharts(123)
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/123/charts'
    })
  })

  it('should not allow getAllPaginated for getCharts', function * () {
    expect(librato.getCharts).to.not.have.property('resultPath')
  })

  it('should get a single chart definition', function * () {
    const r = yield librato.getChart(123, 456)
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/123/charts/456'
    })
  })

  it('should post a new chart definition', function * () {
    const r = yield librato.postChart(123, { name: 'C1', x: 'y' })
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/123/charts',
      method: 'POST',
      body: { name: 'C1', x: 'y' }
    })
  })

  it('should put a chart definition', function * () {
    const r = yield librato.putChart(123, 456, { name: 'C2' })
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/123/charts/456',
      method: 'PUT',
      body: { name: 'C2' }
    })
  })

  it('should delete a chart', function * () {
    const r = yield librato.deleteChart(123, 456)
    expect(r).to.have.length(1)
    expect(r[0]).to.deep.equal({
      auth: { user: 'testuser', pass: 'testtoken' },
      json: true,
      url: 'http://url/v1/spaces/123/charts/456',
      method: 'DELETE'
    })
  })

  it('should find a space by exact name', function * () {
    sinon.stub(librato, 'getAllPaginated')
      .withArgs(librato.getSpaces, { qs: { name: 'Test' } })
      .returns(Promise.resolve([{ name: 'Test Space' }, { name: 'Test' }]))
    const r = yield librato.findSpaceByName('Test')
    expect(r).to.be.eql({ name: 'Test' })
  })

  it('should fail to find a space', function * () {
    sinon.stub(librato, 'getAllPaginated')
      .withArgs(librato.getSpaces, { qs: { name: 'Test Space 2' } })
      .returns(Promise.resolve([{ name: 'Test Space' }, { name: 'Test' }]))
    yield expect(librato.dumpSpace('Test Space 2'))
      .to.eventually.be.rejectedWith('no space named Test Space 2')
  })

  it('should dump a space with charts', function * () {
    sinon.stub(librato, 'findSpaceByName')
      .withArgs('space1')
      .returns(Promise.resolve({ name: 'space1', id: 333 }))
    sinon.stub(librato, 'getCharts')
      .withArgs(333)
      .returns(Promise.resolve([chart1, chart2]))

    const r = yield librato.dumpSpace('space1')

    expect(r).to.be.eql({
      name: 'space1',
      charts: [
        { name: 'chart1',
          streams: [
            { name: 's1', source: '*' },
            { name: 's2', source: '%' }
          ]
        },
        { name: 'chart2',
          streams: [
            { name: 's2', source: '%' },
            { name: 's2', source: '%', 'metric': { 'somthing': 1 } }
          ]
        }
      ]
    })
  })

  it('should fail to dump a space', function * () {
    sinon.stub(librato, 'findSpaceByName')
      .withArgs('space1')
      .returns(Promise.reject(new Error('no space named space1')))
    yield expect(librato.dumpSpace('space1'))
      .to.eventually.be.rejectedWith('no space named space1')
  })

  it('should create a space with charts', function * () {
    sinon.stub(librato, 'findSpaceByName')
      .withArgs('space1')
      .returns(Promise.resolve(undefined))
    sinon.stub(librato, 'postSpace')
      .withArgs({ name: 'space1' })
      .returns(Promise.resolve({ name: 'space1', id: 333 }))
    const postSpy = sinon.spy(librato, 'postChart')
    const putSpy = sinon.spy(librato, 'putChart')
    const deleteSpy = sinon.spy(librato, 'deleteChart')

    yield librato.createOrUpdateSpace(space1)

    expect(postSpy).to.have.been.calledTwice
      .and.calledWithExactly(333, space1.charts[0])
      .and.calledWithExactly(333, space1.charts[1])
    expect(putSpy).to.not.have.been.called
    expect(deleteSpy).to.not.have.been.called
  })

  it('should update a space with charts', function * () {
    sinon.stub(librato, 'findSpaceByName')
      .withArgs('space1')
      .returns(Promise.resolve({ name: 'space1', id: 333 }))
    sinon.stub(librato, 'getCharts')
      .withArgs(333)
      .returns(Promise.resolve([chart1, chart2]))
    const postSpy = sinon.spy(librato, 'postChart')
    const putSpy = sinon.spy(librato, 'putChart')
    const deleteSpy = sinon.spy(librato, 'deleteChart')

    yield librato.createOrUpdateSpace(space1a)

    expect(postSpy).to.have.been.calledOnce
      .and.calledWithExactly(333, space1a.charts[1])
    expect(putSpy).to.have.been.calledOnce
      .and.calledWithExactly(333, 101, space1a.charts[0])
    expect(deleteSpy).to.have.been.calledOnce
      .and.calledWithExactly(333, 102)
  })

  it('should fail to update space with empty chart names', function * () {
    sinon.stub(librato, 'findSpaceByName')
      .withArgs('space1')
      .returns(Promise.resolve({ name: 'space1', id: 333 }))
    sinon.stub(librato, 'getCharts')
      .withArgs(333)
      .returns(Promise.resolve([chart1, chart2]))
    const postSpy = sinon.spy(librato, 'postChart')
    const putSpy = sinon.spy(librato, 'putChart')
    const deleteSpy = sinon.spy(librato, 'deleteChart')

    yield expect(librato.createOrUpdateSpace(space1b))
      .to.eventually.be.rejectedWith('empty chart name in space space1')

    expect(postSpy).to.not.have.been.called
    expect(putSpy).to.not.have.been.called
    expect(deleteSpy).to.not.have.been.called
  })

  it('should fail to update a space with duplicate chart names', function * () {
    sinon.stub(librato, 'findSpaceByName')
      .withArgs('space1')
      .returns(Promise.resolve({ name: 'space1', id: 333 }))
    sinon.stub(librato, 'getCharts')
      .withArgs(333)
      .returns(Promise.resolve([chart1, chart2]))
    const postSpy = sinon.spy(librato, 'postChart')
    const putSpy = sinon.spy(librato, 'putChart')
    const deleteSpy = sinon.spy(librato, 'deleteChart')

    yield expect(librato.createOrUpdateSpace(space1c))
      .to.eventually.be.rejectedWith('duplicate chart names in space space1')

    expect(postSpy).to.not.have.been.called
    expect(putSpy).to.not.have.been.called
    expect(deleteSpy).to.not.have.been.called
  })

  it('should report chart op failures', function * () {
    const chartErr = errors => {
      const err = new Error('chart op failed')
      err.error = { errors }
      return err
    }
    sinon.stub(librato, 'findSpaceByName')
      .withArgs('space1')
      .returns(Promise.resolve({ name: 'space1', id: 333 }))
    sinon.stub(librato, 'getCharts')
      .withArgs(333)
      .returns(Promise.resolve([chart1, chart2]))
    sinon.stub(librato, 'postChart')
      .returns(Promise.reject(chartErr(['bad post params'])))
    sinon.stub(librato, 'putChart')
      .returns(Promise.reject(chartErr(['bad put params'])))
    sinon.stub(librato, 'deleteChart')
      .returns(Promise.reject(chartErr(['bad delete params'])))

    const p = librato.createOrUpdateSpace(space1a)
    yield expect(p).to.eventually.be.rejectedWith('some chart operations failed in space space1')
    yield p.catch(err => {
      expect(err).to.have.deep.property('error.errors').which.eql([
        { chart: 'chart2', op: 'delete', errors: ['bad delete params'] },
        { chart: 'chart1', op: 'update', errors: ['bad put params'] },
        { chart: 'chart3', op: 'create', errors: ['bad post params'] }
      ])
    })
  })
})

describe('The LibratoApi.compositeDSL imported as $', () => {
  // eslint-disable-next-line no-unused-vars
  const $ = LibratoApi.compositeDSL
  const transformFunctions = [
    'abs', 'derive', 'divide', 'integrate', 'max', 'mean', 'min',
    'moving_average', 'multiply', 'rate', 'scale', 'subtract', 'sum', 'window'
  ]
  const complexTestCases = [
    [`$.series('test.metric.1')`, 's("test.metric.1", "%")'],
    [`$.s('test.metric.*', '*')`, 's("test.metric.*", "*")'],
    [`$.sum($.s('test.metric.*'))`, 'sum([\n  s("test.metric.*", "%")\n])'],
    [`$.sum([$.s('test.metric.*')])`, 'sum([\n  s("test.metric.*", "%")\n])'],
    [`$.divide([$.s('test.1'), $.s('test.2')])`,
      'divide([\n  s("test.1", "%"),\n  s("test.2", "%")\n])'],
    [`$.divide([$.sum($.s('test.metric.*')), $.s('test.2')])`,
      'divide([\n  sum([\n    s("test.metric.*", "%")\n  ]),\n  s("test.2", "%")\n])'],
    [`$.window($.s('test.metric.*'), { size: 10, "function": "median" })`,
      'window([\n  s("test.metric.*", "%")\n], { size:"10", function:"median" })'],
    [`$.abs($.abs($.abs('ARG1', { foo: 'bar' })))`,
      'abs([\n  abs([\n    abs([\n      ARG1\n    ], { foo:"bar" })\n  ])\n])'],
    [`$.renderCompositeFn('twinkle')(['A', 'B'], { x: 'y' })`,
      'twinkle([\n  A,\n  B\n], { x:"y" })']
  ]

  function itShouldRenderCorrectlyTransformFn (fnName) {
    itShouldRenderCorrectly([`$.${fnName}('A1')`, `${fnName}([\n  A1\n])`])
  }

  function itShouldRenderCorrectly (exprAndExpected) {
    const expr = exprAndExpected[0]
    const expected = exprAndExpected[1]
    it(`should render correctly ${expr}`, function * () {
      // eslint-disable-next-line no-eval
      expect(eval(expr)).to.equal(expected)
    })
  }

  _.forEach(itShouldRenderCorrectlyTransformFn, transformFunctions)
  _.forEach(itShouldRenderCorrectly, complexTestCases)
})
