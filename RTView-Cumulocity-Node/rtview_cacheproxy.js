// *********************************************************
// RTView - Cache Proxy Service

// This module provides a service that acts as an RTView DataServer
// provide a way to request data from RTView Cloud and translate
// those requests to another backend service.

// Users define specific data types (caches) as the 
// interface to the backend data service.
// RTView Cloud makes REST queries to the RTView Cache Proxy Service
// and these calls are translated to a callback in user code
// where the actual back end calls are made.

// EXPRESS APP REQUIRES

var express = require('express');
var session = require('express-session')
var bodyParser = require('body-parser');
var app = express();
var request = require('request');
var path = require('path');

// ==============================================
// CONFIGURATION SETTINGS

// RTView Cache Proxy Server port
var port = process.env.RTVIEW_SERVER_PORT || process.env.SERVER_PORT || 8081

var verbose = false

var userGetData = null

// ==============================================
// MAIN APPLICATION AND ROUTES
// Use the session middleware

app.use(bodyParser.urlencoded({ extended: false }));	// parse post body as JSON
app.use(bodyParser.json());

// create an instance of router
var router = express.Router();
router.use(express.json());       // to support JSON-encoded bodies
//router.use(express.urlencoded()); // to support URL-encoded bodies

// route middleware that will happen on every request
router.use(function(req, res, next) {

    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    // log each request to the console
    log = req.url;

    if (verbose) {
        console.log('------------------------------------');
        console.log(req.method, log);
    }

    //return isAuthenticated(req, res, next);
    // // continue doing what we were doing
    next();
});

// route middleware to validate :name
router.param('name', function(req, res, next, name) {

	// validate name here
	// just log something so we know it is working
	//console.log('doing name validations on: ' + name);
	
	// once validation is done, save the new item in the req
	req.name = name;
	
	// go to next thing
	next();
});

//-----------------------------------------------------------------------------
// Router endpoints

// process templates in 'html' dir
router.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

// ***********************************************************************
// RTView DataServer Proxy Methods

// Cache multi-query with query count
router.use('/rtvquery/cache/_rtvMulti', function(req, res) {
    if (verbose) console.log('... req <' + JSON.stringify(req.params) + ',' + JSON.stringify(req.query) + '>');
    queryCount = req.query['queryCount']
    if (verbose) console.log('... queryCount: ' + queryCount);
    // process the array of queries, one by one
    resultArray = []
    for (var i = 1; i <= queryCount; i++) {
        resultArray.push(null);
    }
    for (var i = 1; i <= queryCount; i++) {
        prefix = 'mq' + i + '_';
        newquery = {}
        newquery.resultArray = resultArray;   // store result info in query to be used in callback
        newquery.index = i - 1;
        for (var qprop in req.query) {
            if (qprop.startsWith(prefix)) {
                qprop2 = qprop.substring(prefix.length);
                newquery[qprop2] = req.query[qprop]
            }
            /// always use same format as multi-query
            if (qprop == 'fmt')
                newquery[qprop] = req.query[qprop]
            if (qprop == 'callback')
                newquery[qprop] = req.query[qprop]
        }
        // process this query
        if (verbose) console.log('**** new query: ' + i + ' ' + JSON.stringify(newquery))
        processCacheQuery(newquery['cache'], newquery['table'], newquery, res, function(res, result, thisQuery){
            if (verbose) console.log('... processing part of multi-request ... ' + thisQuery.index)
            let resultArray = thisQuery.resultArray;
            result = filterRows(result, thisQuery.fmap)
            result = adjustRowColumns(result, thisQuery.colArray)
            resultArray[thisQuery.index] = result;
            done = true; for (j in resultArray) { 
                if (resultArray[j] === null) done = false; 
            }
            if (done) {
        	if (verbose) console.log('**** query result: ' + JSON.stringify(resultArray))
                formatAndSend(res, thisQuery, resultArray);
            }
        })        
    }
});

// Simple cache query   
router.use('/rtvquery/cache/:name/:table', function(req, res) {
    if (verbose) console.log('... req <' + JSON.stringify(req.params) + ',' + JSON.stringify(req.query) + '>');
    cache = req.params.name; table = req.params.table;
    processCacheQuery(cache, table, req.query, res, function(res, result, thisQuery){
        if (result !== undefined && result !== null) {
            result = filterRows(result, thisQuery.fmap)
            result = adjustRowColumns(result, thisQuery.colArray)
            formatAndSend(res, thisQuery, result);
        } else {       
            res.send('');   // if no result, send nothing
        }
    });
});

// Return diagnostic info for server environment - debug only, not for production use
//router.use('/env', function(req, res) {
    //res.send("Environment:\n"+JSON.stringify(process.env));
//});

// apply the routes to our application
app.use('/', router);

// START THE SERVER
// ==============================================

var run = function (getData) {
    userGetData = getData;
    console.log('... Running RTView Cache Proxy Server on port ' + port + '\n');
    app.listen(port);
}

// ******************************************************************************
// RTView Cache Proxy Implementation 

// Process cache query (asynch)
var processCacheQuery = function (cacheName, tableName, query, res, callback) {
    if (verbose) console.log('... GET cacheName: ' + cacheName + '/' + tableName + ' ' + JSON.stringify(query));
    
    // process some query params to make easier to use in user code
    processQueryParams(query)
    
    // process special RTViewDs query, which executes immediately
    if (cacheName == 'RTViewDs') {
        delete query['colArray']    // DEVNOTE: get rid of this, since data are in old format and adjustColumns won't work
        result = processRTViewDs(cacheName, tableName, query, res)
        return callback(res, result, query)
    }
    
    // process normal cache query, with asynchronous execution  
    properties = cacheMap[cacheName]
    metadata = metadataMap[cacheName]
	if (!properties || !metadata) {
		console.log('ERROR: cannot find cache definition: ' + cacheName);
        return callback(res, null, query);
	}
    indexColArray = properties.indexColumnNames.split(';')
    histColArray = properties.historyColumnNames.split(';')
    if (histColArray === undefined || histColArray === null) histColArray = []
            
    if (verbose) console.log('... normal cache: ' + cacheName + ' ' + JSON.stringify(metadata))
     
    // convert metadata to long format
    metadata2 = []; if (metadata !== null) {
        for (var i = 0; i < metadata.length; i++) {
            for (var colName in metadata[i]) {  
                if (tableName == 'current') {
                    metadata2.push( { "name": colName, "type": metadata[i][colName] } )
                } else {
                    if (colName == 'time_stamp' || indexColArray.includes(colName) || (histColArray.length == 0 || histColArray.includes(colName))) {
                        metadata2.push( { "name": colName, "type": metadata[i][colName] } )
                    }
                }
            }
        }
    }
    // adjust metadata to match requested columns
    metadataNew = metadata2
    colNameArray = query.colArray
    if (colNameArray) {
        metadataNew = []
        colIndexArray = getColIndexArrayFromMetadata(metadata2, colNameArray)
        for (ci in colIndexArray) {
            colIndex = colIndexArray[ci]
            if (colIndex >= 0)
                metadataNew.push(metadata2[colIndex])
            else
                metadataNew.push({ name:'<unknown>', type:'string' })
        }
    }
    
    // make call to user "getData" function, with asynchronous execution
    result = { metadata: metadataNew, metadataFull: metadata2, data: null }
    if (typeof userGetData === "function") {
        data = userGetData(cacheName, tableName, res, query, result, callback)
    } else {
        console.log('ERROR: getData not a function: ' + JSON.stringify(userGetData));
        callback(res, result, query);
    }  
}

// Process cache/RTViewDs query
var processRTViewDs = function(cacheName, tableName, query, res) {
    if (verbose) console.log('... in RTViewDs, cacheName: ' + cacheName + '/' + tableName);   

    if (tableName == 'Tables') {
        metadata = [ { name:'Table', type:'string' }, { name:'Rows', type:'int' } ]
        // if querying for Table;Rows assume it is to get list of caches
        // return current caches that have nrows > 1
        //if (query.cols == 'Table;Rows') {
        data = []; for (var cacheName in cacheMap) {
            // need to get length from dataset, use 1 for this purpose
            data.push( { Table: (cacheName + '.current'), Rows: 1 } );
            data.push( { Table: (cacheName + '.history'), Rows: 1000 } );
        }
        result = { metadata: metadata, metadataFull: metadata, data: data }
        res.queryStatus = 0; res.queryStatusText = 'OK';
        return result
    }

    if (tableName == 'CacheDefs') {
        cdMetadata = [{name:'Cache',type:'string'},{name:'Table',type:'string'},{name:'IndexColumns',type:'string'},{name:'AllColumns',type:'string'},{name:'AllColumnTypes',type:'string'}]
        data = []; for (var cacheName in cacheMap) {      
            properties = cacheMap[cacheName]
            metadata = metadataMap[cacheName]
            indexColArray = properties.indexColumnNames.split(';')
            histColArray = properties.historyColumnNames.split(';')
            if (histColArray === undefined || histColArray === null) histColArray = []
            
            // build row for current cache
            allColumnNames = ''; allColumnTypes = '';
            for (icol in metadata) {
                if (icol > 0) { allColumnNames += ';'; allColumnTypes += ';'; }
                colInfo = metadata[icol]
                colName = Object.keys(colInfo)[0]
                allColumnNames += colName;
                allColumnTypes += colInfo[colName]
            }
            data.push( { Cache:cacheName, Table:"current",
                IndexColumns:properties.indexColumnNames,
                AllColumns:allColumnNames,
                AllColumnTypes:allColumnTypes
            });
            
            // build row for history cache
            allColumnNames = ''; allColumnTypes = '';
            for (icol in metadata) {               
                colInfo = metadata[icol]
                colName = Object.keys(colInfo)[0]
                if (colName == 'time_stamp' || indexColArray.includes(colName) || (histColArray.length == 0 || histColArray.includes(colName))) {
                    if (icol > 0) { allColumnNames += ';'; allColumnTypes += ';'; }
                    allColumnNames += colName;
                    allColumnTypes += colInfo[colName]
                }
            }
            data.push( { Cache:cacheName, Table:"history",
                IndexColumns:properties.indexColumnNames,
                AllColumns:allColumnNames,
                AllColumnTypes:allColumnTypes
            });
        }
        result = { metadata: cdMetadata, metadataFull: cdMetadata, data: data }
		res.queryStatus = 0; res.queryStatusText = 'OK';
        return result
    }

    if (tableName == 'CacheObjectProperties') {
        cdMetadata = [{name:'cacheName',type:'string'},{name:'maxNumberOfHistoryRows',type:'int'},{name:'timestampColumnName',type:'string'},{name:'historyColumnNames',type:'string'}]
        data = [];
        for (var cacheName in cacheMap) {      
            properties = cacheMap[cacheName];
            //metadata = metadataMap[cacheName];
            //indexColArray = properties.indexColumnNames;
            histColArray = properties.historyColumnNames;
            data.push( { cacheName:cacheName,
                maxNumberOfHistoryRows:3000,
                timestampColumnName:"time_stamp",
                historyColumnNames:histColArray
            });
        }
        result = { metadata: cdMetadata, metadataFull: cdMetadata, data: data }
		res.queryStatus = 0; res.queryStatusText = 'OK';
        return result
    } 
	
	res.queryStatus = 0; res.queryStatusText = 'OK';
    return null;
}

// process some query parameters to make easier to use in user code
var processQueryParams = function (query) {
    for (var qprop in query) {
        qval = query[qprop]
        //console.log('... qprop, value: ' + qprop + ' ' + qval)
        
        if (qprop == 'cols' && qval != '' && qval != '*')
            query.colArray = qval.split(';')
            
        if (qprop == 'fcol' && qval != '' && qval != '*')
            query.fcolArray = qval.split(';')
        if (qprop == 'fval' && qval != '' && qval != '*')
            query.fvalArray = qval.split(';')
        
        if (qprop == 'jsort' && qval)   
            query.jsortArray = JSON.parse(qval)
    }
    // create filter map object for convenience
    if (query.fcolArray && query.fvalArray) {
        query.fmap = {};
        query.fcolArray.forEach((key, idx) => query.fmap[key] = query.fvalArray[idx]);
    }
        
    //console.log('... query2 = ' + JSON.stringify(query))
}

// Filter rows by specified columns in fmap (filter map)
// This is used if the user handler does not filter rows itself
// DEVNOTE: limited to just one non-server-side filter column for now
var filterRows = function(table, fmap) {
    if (!table) return table
    if (!fmap) return table
    if (Object.keys(fmap).length == 0) return table   // in case all filters were removed by user code
    //console.log('*** apply filter: ' + JSON.stringify(fmap))
    metadata = table.metadataFull; data = table.data;
    for (fcol in fmap) {  
        fval = fmap[fcol]
        fcolIndex = findIndexOfColumnInMetadata(metadata, fcol)
        break
    }
    // loop over each row and test for match on filter columns and values
    newdata = []
    for (r in data) { row = data[r];    
        testValue = row[fcolIndex]
        if (testValue != fval)
            continue;
        newdata.push(row)
    }
    table.data = newdata
    return table
} 
    
// Filter and order columns by colNameArray spec
// This is used if the user handler does not filter and order columns itself
var adjustRowColumns = function(table, colNameArray) {
    if (!table) return table
    if (!colNameArray) return table
    metadata = table.metadataFull; data = table.data;
    // construct array of indices for desired columns
    colIndexArray = getColIndexArrayFromMetadata(metadata, colNameArray)
    newdata = []
    for (r in data) {
        row = data[r]; newrow = []
        for (ci in colIndexArray) {
            colIndex = colIndexArray[ci]
            if (colIndex >= 0)
                newrow.push(row[colIndex])
            else
                newrow.push('')
        } 
        newdata.push(newrow)
    }
    table.data = newdata
    return table
}

// Return an array of column indexes from metadata given array of names
var getColIndexArrayFromMetadata = function(metadata, colNameArray) {
    if (!metadata) return metadata
    colIndexArray = []; for (c in colNameArray) {
        colName = colNameArray[c]
        colIndex = findIndexOfColumnInMetadata(metadata, colName)
        colIndexArray.push(colIndex)   
    }
    return colIndexArray
}

// Find the index of a named column in the metadata table
var findIndexOfColumnInMetadata = function(metadata, colName) {
    for (i in metadata)
        if (colName == metadata[i].name) return i
    return -1
}

// Send data with metadata in requested format
var formatAndSend = function (res, query, result) {
    if (result === undefined) return;
    
    // if JSONP format, construct string with callback name to send
    if (query.fmt == 'jsonp') {
        fmtData = 'try {' + query.callback + '('
        
        if (Array.isArray(result)) {
            //console.log('... formatting array ... ' + query.index)
            fmtData += '['
            for (r in result) {
                //console.log('     ----> row:; ' + r + ' = ' + result[r])
                if (result[r] !== undefined) {
                    if (r > 0) fmtData += ','
                    fmtData += formatTable(res, result[r])
                }
            }
            fmtData += ']'
        } else {
            //console.log('... formatting single ... ')
            fmtData += formatTable(res, result)
        }
        fmtData += ');} catch (ex) {if (window.console && console.log) console.log(ex);}';
        
        try {
            res.send(fmtData)
        } catch (ex) {
            console.log('ERROR: res.send failure (1): ' + ex.message)
            //console.log('  query: ' + JSON.stringify(query))
        }
        return;
    } 
    
    // other formats, simply use json
    fmtData = { metadata: result.metadata, data: result.data }
    //console.log('... sending:' + JSON.stringify(fmtData));
    try {
        //console.log('===> sending data with fmt: ' + query.fmt)
        res.send(fmtData)
    } catch (ex) {
        console.log('ERROR: res.send failure (2): ' + ex.message)
    }
}

// Apply JSONP formatting to table
var formatTable = function (res, table) {
    metadata = table.metadata; data = table.data; paging = table.paging;
    //console.log('     +++++++++++ got result: ' + JSON.stringify(metadata))
    //console.log('  ... formatting table of n rows: ' + (table.data ? table.data.length : -1))
    fmtData = '{"metadata":' + JSON.stringify(metadata) + ',\n"data":[';
    for (row in data) {
        if (row > 0) fmtData += ','
        fmtData += ('\n' + safeStringify(data[row]))
    }      
    fmtData += '\n]'
    if (paging !== undefined) {
        fmtData += ',"paging":' + JSON.stringify(paging)
    }
    // capture the actual response code, instead of forcing OK, but only if not 200
    //fmtData += ',"queryStatus":0, "queryStatusText":"OK"\n}\n';
    if (res.queryStatus == 200) {
        res.queryStatus = 0;
    }
	fmtData += ',"queryStatus":' + res.queryStatus + ', "queryStatusText":"'+res.queryStatusText+'"\n}\n';
    return fmtData
}

// Safe stringify function; convert angle brackets to excape format
var safeStringify = function (data) {
    if (data === undefined) return data
    for (i = 0; i < data.length; i++) {
        obj = data[i]
        if (typeof obj === 'string') {
            data[i] = escapeHtml(obj)
        }
    }
    return JSON.stringify(data)
}

function escapeHtml(s) {
  var map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return s.replace(/[&<>"']/g, function(m) {return map[m];});
}
    
// *********************************************************
// RTView - Utility functions for Data Caching

// NOTE: users should not need to edit this file

// Provides these features:
//    - define RTView cache structure (index columns and column types)
//    - send data to RTView with proper metadata 
//    - batching of data for performance optimization
//    - retry on lost connection

// #########################################################
// RTView Utility Functions

var cacheMap = {};
var metadataMap = {};
var bufferMap = {};

var start = new Date().getTime();

// Create a named data cache with the specified properties.
function create_datacache (cacheName, properties, metadata) {
    if (properties === null) return;     
    cachedef_metadata = [ { "name":"propName", "type":"string" },{ "name":"propValue", "type":"string" } ];  
    cachedef_data = []
    for (var propName in properties) {
        cachedef_data.push( { 'propName': propName, 'propValue': properties[propName] } );
    }
    //send_to_rtview(targetCommandStr, 'replace/' + cacheName, cachedef_metadata, cachedef_data);    
    metadataMap[cacheName] = metadata;  
    bufferMap[cacheName] = [];
    cacheMap[cacheName] = properties;
    
    //console.log('... caches: ' + JSON.stringify(rtvproxy.cacheMap))
    //console.log('... metadata: ' + JSON.stringify(rtvproxy.metadataMap))
}

// Send a block of data to RTView cache
function send_datatable (cacheName, data) {
    if (data == null) data = [];
    buffer = bufferMap[cacheName];
    buffer.push(data);
    //if (buffer.length >= batchSize) {
        //flush_buffer(cacheName);
    //} 
}
// flush buffer associated with specific cache
function flush_buffer (cacheName) {
    buffer = bufferMap[cacheName];
    metadata = metadataMap[cacheName];
    if (metadata == null || metadata.length < 1) return;
    metadata2 = [];
    for (var i = 0; i < metadata.length; i++) {
        for (var colName in metadata[i]) {
            metadata2.push( { "name": colName, "type": metadata[i][colName] } )
        }
    }
    //send_to_rtview(targetPostStr, cacheName, metadata2, buffer);
    bufferMap[cacheName] = [];
}

module.exports.create_datacache = create_datacache;
module.exports.send_datatable = send_datatable;
//module.exports.cacheMap = cacheMap;
//module.exports.metadataMap = metadataMap;
module.exports.run = run;
