# librato-api

A Librato backend API client library and a simple CLI tool.

# Example

    const libratoApi = require('librato-api')

    libratoApi.getMetrics()
        .then(console.log)  // all methods return Promises

    libratoApi.getMetrics({ qs: { offset: 200, limit: 100 } })

    libratoApi.getAllPaginated(librato.getMetrics)

    libratoApi.getMetric('router.bytes')

    libratoApi.putMetric({ name: 'customers', 'period': 3600 })

    // assuming co()
    const myspace = yield libratoApi.findSpaceByName('myspace')

    yield libratoApi.putChart(myspace.id, mychartId, mychart)

