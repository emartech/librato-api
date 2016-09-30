# librato-api

[![npm version](http://img.shields.io/npm/v/librato-api.svg)](https://npmjs.org/package/librato-api)
[![Build Status](https://travis-ci.org/emartech/librato-api.svg?branch=master)](https://travis-ci.org/emartech/librato-api)
[![Coverage Status](https://coveralls.io/repos/github/emartech/librato-api/badge.svg?branch=master)](https://coveralls.io/github/emartech/librato-api?branch=master)
[![Dependencies Status](https://david-dm.org/emartech/librato-api.svg)](https://david-dm.org/emartech/librato-api)

A Librato backend API client library and a simple CLI tool.

This package allows you to manage your Librato backend configuration,
but not to submit stats. There are other packages doing that.

It can also be used to query metrics time series values by supplying
start\_time, end\_time, and other optional parameters to #getMetric.

For a full description of the Librato API see the official
[Librato API](https://www.librato.com/docs/api/) documentation.

## Examples

    // uses LIBRATO_USER and LIBRATO_TOKEN in the process'es environment
    const libratoApi = require('librato-api')

    libratoApi.getMetrics()
        .then(console.log)  // all methods return Promises

    libratoApi.getMetrics({ qs: { offset: 200, limit: 100 } })

    libratoApi.getAllPaginated(librato.getMetrics)

    libratoApi.getMetric('router.bytes')

    libratoApi.getMetric('router.bytes', { qs: { start_time: date1, end_time: date2 }})

    libratoApi.putMetric('customers', { 'period': 3600 })

    // assuming co()
    const myspace = yield libratoApi.findSpaceByName('myspace')

    libratoApi.putChart(myspace.id, mychartId, mychart)

    // not everything is explicitly supported yet, but you can do generic requests like this
    libratoApi.apiRequest(['alerts', 123], { name: 'myalert', ... }, { method: 'PUT' })

## CLI Tool

This package installs a CLI tool named "librato" into your global or package bin-dir.

You have to export LIBRATO_USER and LIBRATO_TOKEN for authentication to work.

    $ export LIBRATO_USER='...'
    $ export LIBRATO_TOKEN='...'
    $ librato help
    $ librato list-metrics
    $ ...

### Warning

This tool is quite new and still a bit rough regarding command line parsing,
integrated help, etc. To see what it's doing it may be helpful to set LOG_LEVEL to verbose or debug.

### Configuration Directory Support

Apart from functions which model single API calls, the tool can take a local directory
containing json or js files in a certain structure and apply the contained metrics and spaces to
a Librato account with the "update-from-dir" command. The repository contains an example directory
"example-config".

There's even some templating support to create serieses of similar metrics. The "show-config-dir"
command can be used to debug templating easily.
