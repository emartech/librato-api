# librato-api

[![npm version](http://img.shields.io/npm/v/librato-api.svg)](https://npmjs.org/package/librato-api)
[![Build Status](https://travis-ci.org/emartech/librato-api.svg?branch=master)](https://travis-ci.org/emartech/librato-api)
[![Coverage Status](https://coveralls.io/repos/github/emartech/librato-api/badge.svg?branch=master)](https://coveralls.io/github/emartech/librato-api?branch=master)
[![Dependencies Status](https://david-dm.org/emartech/librato-api.svg)](https://david-dm.org/emartech/librato-api)

This package allows you to manage your Librato backend configuration and query time series data,
but it is not intended to submit metric data. There are other packages doing that
in a better way.

For a full description of the Librato API see the official
[Librato API](https://www.librato.com/docs/api/) documentation.

At the moment support for the following sections is implemented:
Authentication, Pagination, Metrics, Spaces, Charts, Alerts, Services, Sources.
Note the official API does not expose visual layout of spaces yet, only contents.

Explicit support for the following sections is missing:
Annotations, API Tokens, Jobs, Snapshots and Measurements Beta.
This is easy to fix, pull requests are welcome.

## Examples
```javascript
// the package is a ready to use client,
// using LIBRATO_USER and LIBRATO_TOKEN from the process environment
const libratoApi = require('librato-api')

// it's also possible to create a client with custom config (all properties are optional)
const LibratoApi = require('librato-api').LibratoAPI
const libratoApi = new LibratoAPI({
    serviceUrl: 'https://...',
    auth: { user: '...', pass: '...' },
    logger: ...,
    request: ...
})

// all methods return Promises
libratoApi.getMetrics().then(console.log)

// most methods support an options object which is passed to request-promise
libratoApi.getMetrics({ qs: { offset: 200, limit: 100 } })

// iterates over pagination
libratoApi.getAllMetrics()

// get a metric definition
libratoApi.getMetric('router.bytes')

// retrieve one page of time series data for metric and time frame
libratoApi.getMetric('router.bytes', { qs: { start_time: date1, end_time: date2 }})

// retrieve all pages of time series data for metric and time frame
libratoApi.getAllMeasurements('router.bytes', { qs: { start_time: date1, end_time: date2 }})

// update metric definition
libratoApi.putMetric('customers', { 'period': 3600 })

// use custom space finder (getSpace requires id)
libratoApi.findSpaceByName('myspace')

// update chart definition in a space
libratoApi.putChart(myspace.id, mychartId, mychart)

// not everything is explicitly supported yet, but generic api requests are easy to do
libratoApi.apiRequest(['annotation', 'backup'], { method: 'PUT', body: { ... } })
```

## CLI Tool

This package installs a CLI tool named "librato" into your global or package bin-dir.

You have to export LIBRATO_USER and LIBRATO_TOKEN for authentication to work.
```bash
export LIBRATO_USER='...'
export LIBRATO_TOKEN='...'
librato help
librato list-metrics
...
```

### Warning

This tool is quite new and still a bit rough regarding command line parsing,
integrated help, etc. To see what it's doing it may be helpful to set LOG_LEVEL to verbose or debug.

### Configuration Directory Support

Apart from functions which model single API calls, the tool can take a local directory
containing json or js files in a certain structure and apply the contained elements to
a Librato account with the "update-from-dir" command. The repository contains an example directory
"example-config" which demonstrates this feature.

Note that all elements are referenced by
their name (or title for alerts), even if the API usually handles them with a numeric id.
This way generic configuration can be applied to multiple Librato accounts, but uniquness
of names etc. is assumed.

There is a simple templating feature to create serieses of similar metrics. The "show-config-dir"
command can be used to debug templating easily.

In general this will leave alone (not delete) server side elements which are not defined
in the config dir, but it can remove elements which are explicitly enumerated in the
outdated.json file.
