// *********************************************************
// RTView - Cumulocity IoT Connector Program

console.log('\n--- Cumulocity IoT / RTView Connector ---\n');

var request = require('request');
var rtvproxy = require('./rtview_cacheproxy.js');
var userinfo;
var username;
var password;
var baseURL;

/* if a userinfo file is present, use it! */
try {
   userinfo = require("./USERINFO.json");
   username = userinfo.username;
   password = userinfo.password;
   baseURL = userinfo.baseURL;
} catch(err) {}

/********************************************************/
/* following environment is passed to this node process 
 * when Cumulocity starts up the docker image as a microservice.
 */
username = process.env.C8Y_TENANT && process.env.C8Y_USER ? process.env.C8Y_TENANT + '/' + process.env.C8Y_USER : username;
password = process.env.C8Y_PASSWORD ? process.env.C8Y_PASSWORD : password;
baseURL  = process.env.C8Y_BASEURL ? process.env.C8Y_BASEURL : baseURL;


//var APPLICATION_NAME = process.env.APPLICATION_NAME;  //unused microservice environment

//console.log("Environment:\n"+JSON.stringify(process.env));
if(!username || !password || !baseURL) {
   console.log("***Cumulocity username, password or base URL are not configured!");
   //process.exit();
}
console.log("login: "+username+" "+password+"\t\nURL:"+baseURL);

// Cumulocity URL and authentication are used by 'request' module
// expected baseURL is something like 'https://' + C8Y_TENANT + '.cumulocity.com';
var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");


/********************************************************/
// Cache definitions for data requested from Cumulocity IoT Server
// and returned to RTView.

rtvproxy.create_datacache('CumMeasurement',
{   // cache properties
    'indexColumnNames': 'id;name;series',
    'historyColumnNames': 'value'
},[ // column metadata
    { 'time_stamp': 'date' },
    { 'id': 'string' },
    { 'name': 'string' },
    { 'series': 'string' },
    { 'value': 'double' },
    { 'units': 'string' }
]);

//-----------------------------------------

var cumAlarmMeta = [ // column metadata
    { 'time_stamp': 'date' },
    { 'id': 'string' },
    { 'type': 'string' },
    { 'count': 'integer' },
    { 'source_id': 'string' },
    { 'severity': 'string' },
    { 'status': 'string' },
    { 'text': 'string' },
    {'firstOccurrenceTime': 'date'}
];

rtvproxy.create_datacache('CumAlarm',
{   // cache properties
    'indexColumnNames': 'id',
    'historyColumnNames': ''
}, cumAlarmMeta);

var cumAlarmMap = [ // column mapping to JSON returned by query
    ['time_stamp', 'time'],
    ['id', 'id'],
    ['type', 'type'],
    ['count', 'count'],
    ['source_id', 'source.id'],
    ['severity', 'severity'],
    ['status', 'status'],
    ['text', 'text'],
    ['firstOccurrenceTime', 'firstOccurrenceTime']
];

//-----------------------------------------

var cumEventMeta= [ // column metadata
    { 'time_stamp': 'date' },
    { 'id': 'string' },
    { 'type': 'string' },
    { 'source_id': 'string' },
    { 'text': 'string' },
    { 'creationTime': 'date' }
];

rtvproxy.create_datacache('CumEvent',
{   // cache properties
    'indexColumnNames': 'id',
    'historyColumnNames': ''
}, cumEventMeta);

var cumEventMap = [ // column mapping to JSON returned by query
    ['time_stamp', 'time'],
    ['id', 'id'],
    ['type', 'type'],
    ['source_id', 'source.id'],
    ['text', 'text'],
    ['creationTime', 'creationTime']
];

//-----------------------------------------
var cumDeviceMeta = [ // column metadata
    { 'id': 'string' },
    { 'name': 'string' },
    { 'type': 'string' },
    { 'model': 'string' },
    { 'serialnumber': 'string' },
    { 'status': 'string' },
    { 'owner': 'string' }
];

rtvproxy.create_datacache('CumDevice',
{   // cache properties
    'indexColumnNames': 'id',
    'historyColumnNames': ''
}, cumDeviceMeta);

var cumDeviceMap = [ // column metadata
    [ 'id', 'id' ],
    [ 'name', 'name' ],
    [ 'type', 'type' ],
    [ 'model', 'c8y_Hardware.model' ],
    [ 'serialnumber', 'c8y_Hardware.serialNumber' ],
    [ 'status', 'c8y_Connection.status' ],
    [ 'owner', 'owner' ]
];

// **********************************************************************
// Return data for named cache and table using given query params
// Set result.data to the data to be returned and execute the callback
var metaArrayToObj = function(myArray) {
    return myArray.reduce( (obj,column) => {k=Object.keys(column)[0]; obj[k] = column[k]; return obj}, {} );
}
var cumAlarmColTypes = metaArrayToObj(cumAlarmMeta);
var cumEventColTypes = metaArrayToObj(cumEventMeta);
var cumDeviceColTypes = metaArrayToObj(cumDeviceMeta);

var addFilter = function(fmap,fcol,queryParm) {
    var url_clause = '';
    var fval= getValue(fmap,fcol,'');
    delete fmap[fcol];
    if (fval != '' && fval != '*') {
        url_clause = '&' + queryParm + '=' + fval;
    }
    return url_clause;
}

var cumDateRange = function(query) {
    var tr = Number(getValue(query,'tr',0))*1000;
    var dateTo = Number(getValue(query, 'te', (new Date()).getTime()));
    var dateFrom = Number(getValue(query, 'tb', dateTo - (tr > 0 ? tr : 10000)));
    var url = '';

    if( tr > 0) {
        url += ('&dateFrom=' + dateFrom.toISOString() + '&dateTo=' + dateTo.toISOString());
        var tr_interval = (dateTo - dateFrom) / 1000;
        // for larger time ranges, aggregate the data to manage number of points plotted.
        if( tr_interval/86400 > 30 )      url += '&aggregationType=DAILY';
        else if( tr_interval/3600 > 20 )  url += '&aggregationType=HOURLY';
        // Note big jumps from MINUTELY to HOURLY and HOURLY to DAILY!
        // TBD? for example, do our own 15 minute aggregation based on retrieved MINUTELY data...
        else if( tr_interval/60 > 200 )    url += '&aggregationType=MINUTELY';
    }
    return url;
}

var cumAlarmUrl = function(query) {
    var url = baseURL + '/alarm/alarms?pageSize=100';
    var fmap = getValue(query,'fmap',{});

    // get filters from query that can be processed by Cumulocity; 
    // remove them from fmap so they are ignored by downstream filter processing.
    url += addFilter(fmap,'type','type');
    url += addFilter(fmap,'status_id','status');
    url += cumDateRange(query);
    return url;
}

var cumEventUrl = function(query) {
    var url = baseURL + '/event/events?pageSize=100';
    var fmap = getValue(query,'fmap',{});

    // get filters from query that can be processed by Cumulocity; 
    // remove them from fmap so they are ignored by downstream filter processing.
    url += addFilter(fmap,'type','type');
    url += addFilter(fmap,'source_id','source');
    url += cumDateRange(query);
    return url;
}

var cumDeviceUrl = function(query) {
    //var url = baseURL + '/inventory/managedObjects?fragmentType=c8y_IsDevice&pageSize=200';
    var url = baseURL + '/inventory/managedObjects?fragmentType=c8y_IsDevice';
    var fmap = getValue(query,'fmap',{});
    
    // DEVNOTE: paging not working correctly, comment out for now
    // paging parameters are passed on to IoT server
    /*
    rp = query.rp; pn = query.pn;
    if (rp != undefined && rp > 0) {
        url += ('&pageSize=' + rp + '&Page=' + pn + '&withTotalPages=true')
        
        // example of sort parameters used with a different service; doesn't seem available in c8y
        /*
        if (query.jsortArray) {           
            dir = query.jsortArray[0].dir
            column = query.jsortArray[0].column
            if (column == 'time_stamp') column = 'last_activity'    // last_activity is mapped to time-stamp
            if (column == 'name' || column == 'last_activity' || column == 'created' || column == 'serial') {
                url += ('&dir=' + dir)
                url += ('&sort=' + column)
            }
        }
        ** //
        //console.log('**** page size: ' + rp);
    } else {
        url += ('&pageSize=' + 1000 + '&Page=' + 1)
        //console.log('**** page size x: ' + 1000);
    }
    */
    // instead, just use fixed page size of 1000
    url += ('&pageSize=' + 1000);

    // get filters from query that can be processed by Cumulocity; 
    // remove them from fmap so they are ignored by downstream filter processing.
    url += addFilter(fmap,'type','type');
    url += addFilter(fmap,'source','source');
    return url;
}

var getData = function (cacheName, tableName, res, query, result, callback) {

    console.log('... query Cumulocity data: ' + cacheName + ' ' + tableName + ' ' + JSON.stringify(query))
 
    // queries to ATT server process asynchronously, pass callback
    switch(cacheName) {
    case 'CumMeasurement':
        return getMeasurements(tableName, res, query, result, callback);
   
    case 'CumAlarm':
        return getCacheData('alarms', cumAlarmUrl(query), cumAlarmColTypes, cumAlarmMap, tableName, res, query, result, callback);
   
    case 'CumEvent':
        return getCacheData('events', cumEventUrl(query), cumEventColTypes, cumEventMap, tableName, res, query, result, callback);

    case 'CumDevice':
        return getCacheData('managedObjects', cumDeviceUrl(query), cumDeviceColTypes, cumDeviceMap, tableName, res, query, result, callback);

    default:
        result.data = [];
    }
    callback(res, result, query);
}

// Launch the RTView Cache Proxy Server
// Pass in handler for returning data

rtvproxy.run(getData);

// **********************************************************************
// Cumulocity variables and support

var hasProperty = function(obj,prop) {
    return Object.prototype.hasOwnProperty.call(obj,prop);
}

var getValue = function(obj,prop,default_value) {
    if(hasProperty(obj,prop))
        return obj[prop];
    else
        return default_value;
}

var isNumber = function(n) {
    return typeof n === 'number' && !isNaN(n);
}

// *************** Query Measurements *************************************

var getMeasurements = function(tableName, res, query, result, callback) {
    var url = baseURL + '/measurement/measurements';

    // get 'id' and 'name' filters from query; these can be passed to server 
    // remove them from fmap for downstream filter processing
    var fmap = getValue(query,'fmap',{});
    var id = getValue(fmap,'id','');
    var name = getValue(fmap,'name','');
    var series = getValue(fmap,'series','');
    delete fmap['id']; delete fmap['name']; delete fmap['series']; // tell cacheproxy we've handled these filters
    
    var tr = Number(getValue(query,'tr',10))*1000;
    var dateTo = Number(getValue(query, 'te', (new Date()).getTime()));
    var dateFrom = Number(getValue(query, 'tb', dateTo - tr));
    
    dateTo = new Date(dateTo);
    dateFrom = new Date(dateFrom);
    //console.log('... measurement interval ' + dateFrom + ' to '+ dateTo + " - tr " + tr);

    // if series name provided as filter, include in query
    if (series) {
        seriesPath = name + '.' + series;
        //console.log('***** seriesPath = ' + seriesPath);
        url += (tableName == 'current' ? '?pageSize=100' : ('/series?series='+seriesPath));
        
    // DEVNOTE: the below fails:    
    // if no series name provided, TRY to make a query that works ... but it doesn't !!
    } else {
        //console.log('***** fragment = ' + name);
        url += (tableName == 'current' ? '?pageSize=100' : ('/series?fragmentType='+name));
    }
    
    if (id != '' && id != '*') {
        url += ('&source=' + id);
    }
    if (tableName == "current" && name != '' && name != '*') {
        url += '&fragmentType=' + name;
    }
  
    //url += encodeURIComponent('&dateFrom=' + formatDate(dateFrom) + '&dateTo=' + formatDate(dateTo));
    if( tr > 0) {
        url += ('&dateFrom=' + dateFrom.toISOString() + '&dateTo=' + dateTo.toISOString());
        var tr_interval = (dateTo - dateFrom) / 1000;
        // for larger time ranges, aggregate the data to manage number of points plotted.
        if( tr_interval/86400 > 30 )      url += '&aggregationType=DAILY';
        else if( tr_interval/3600 > 20 )  url += '&aggregationType=HOURLY';
        // Note big jumps from MINUTELY to HOURLY and HOURLY to DAILY!
        // TBD? for example, do our own 15 minute aggregation based on retrieved MINUTELY data...
        else if( tr_interval/60 > 200 )    url += '&aggregationType=MINUTELY';
    }

    //console.log('... measurement query url <' + url + '>') 
    if(dateFrom >= dateTo) {
        console.log("Error: bad date/time range: "+url);
        console.log('... ' + JSON.stringify(query)+'\n');
    return;
    }
    // create object to hold info related to this request 
    urlInfo = { res:res, result:result, tableName:tableName, query:query, url:url, dateFrom:dateFrom, dateTo:dateTo, id:id, name:name, series:series }

    // make request with closure
    var dest = {
        url : url,
        headers : {
            "Authorization" : auth
        }
    };
    
    //console.log('^^^^^^^ meas url = ' + url);
    request(dest, getMeasurementsHandler(url, urlInfo));

    function getMeasurementsHandler(url, urlInfo) {
        return function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var b = JSON.parse(body);
            //urlInfo.res.queryStatus = response.statusCode;
		    urlInfo.res.queryStatus = 0;
		    urlInfo.res.queryStatusText = "OK";
            console.log('... measurement query ' + url);
            //console.log('    measurements: ' + JSON.stringify(b.measurements, 0, 2));
            var rtvdata = [];
            if(urlInfo.tableName == "current")
                for (var i=0; i < b.measurements.length; i++) {
                    measurementRow(b.measurements[i], rtvdata);
                }
            else {
                rtvdata = measurementRowHistory(urlInfo.id, urlInfo.name, '', b.values);
            }
            urlInfo.result.data = rtvdata;
            console.log('  ... getMeasurements exec_time: ' + (Date.now() - urlInfo.dateTo) + '  ' +
                urlInfo.name+'.'+urlInfo.tableName + ' ' + urlInfo.result.data.length + ' rows\n');// + JSON.stringify(urlInfo.result)+'\n');
        } else {
            urlInfo.res.queryStatus = response ? response.statusCode : 0;
            urlInfo.res.queryStatusText = error;
            console.log('ERROR: query for: ' + urlInfo.url + ' ' + error + ' resp code: ' + urlInfo.res.queryStatus );
        }
        //if (response == undefined) console.log('WARNING: no response from: ' + urlInfo.url);
        callback(urlInfo.res, urlInfo.result, urlInfo.query);
        };
    }
    
};

var measurementRow = function(row, rtvdata) {

    //console.log('... row type: ' + row.type);
    //console.log('... row: ' + JSON.stringify(row, 0 , 2));
    var fragkeys = Object.keys(row);
    // loop over all fragments in the row (skip common fields)
    for (var idxfkey in fragkeys) {
        var key = fragkeys[idxfkey]
        if (key === 'time') continue;
        if (key === 'id') continue;
        if (key === 'self') continue;
        if (key === 'source') continue;
        if (key === 'type') continue;
        //console.log('*****!! key: ' + idxfkey + ' ' + key);
        
        // we've determined this key is a 'fragment', loop over series
        var fragname = key;
        var fragment = row[fragname];
        
        var realfragname = fragname;
        //if (fragname.startsWith('c8y_'))          // tried to do this for user-friendly, but fails in history
            //realfragname = fragname.substring(4);
        
        var serieskeys = Object.keys(fragment);
        for (var idxskey in serieskeys) {
            var seriesname = serieskeys[idxskey]
            var series = fragment[seriesname];
            //console.log(' ***^^^^ series = ' + JSON.stringify(series));
            
            rtview_row = [];
            rtview_row.push(Date.parse(row.time));
            rtview_row.push(row.source.id);
            rtview_row.push(realfragname);        // 'fragname' is the key in the object (use 'name' in rtview)
            rtview_row.push(seriesname);         // 'seriesname' is an element within fragment
            //rtview_row.push(row.type);         // 'type' could possibly be use later as a cache name
            rtview_row.push(series.value);
            rtview_row.push(series.unit);
            //console.log(JSON.stringify(rtview_row));
            rtvdata.push(rtview_row);
        }
    }
}

var measurementRowHistory = function(id,name,seriesname,values) {
    var rtview_result = [];
    for(var ts in values) {
        var rtview_row = [];
        rtview_row.push(Date.parse(ts));
        rtview_row.push(id);
        rtview_row.push(name);
        rtview_row.push(seriesname);
        var v = values[ts][0];
        if (v) {
            rtview_row.push((v.min+v.max)/2.0);
        } else {
            rtview_row.push(0.0);
        }
        rtview_row.push('');
        rtview_result.push(rtview_row);
    }
    /*
    if(rtview_result.length > 0) {
        console.log(JSON.stringify(rtview_result[0]));
        console.log(JSON.stringify(rtview_result[rtview_result.length-1]));
        console.log(new Date(rtview_result[0][0])+' to '+ new Date(rtview_result[rtview_result.length-1][0]));
    }
    */
    return rtview_result;
}


// *************** generic Query for cache data: no enrichment *************************************

var getCacheData = function(arrayName, url, var_meta, var_map, tableName, res, query, result, callback){

    // create object to hold info related to this request 
    urlInfo = { res:res, result:result, start:new Date(), tableName:tableName, query:query, 
        url:url, var_meta:var_meta, var_map:var_map, arrayName:arrayName }

    // make request with closure
    var dest = {
        url : url,
        headers : {
            "Authorization" : auth
        }
    };
    request(dest, getCacheDataHandler(url, urlInfo));

    function getCacheDataHandler(url, urlInfo) {
        return function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var b = JSON.parse(body);
            //urlInfo.res.queryStatus = response.statusCode;
            urlInfo.res.queryStatus = 0;
            urlInfo.res.queryStatusText = "OK";
            console.log('... ' + urlInfo.arrayName + ' query: ' + url);
            //if(b.statistics)     // print paging stats
                //console.log('... b.statistics: ' + JSON.stringify(b.statistics, 0, 2));
            var rtvdata = [];
            if(urlInfo.tableName == "current") {
                var data = b[urlInfo.arrayName];
                for (var i=0; i < data.length; i++) {
                    rtvdata.push(dataRow(data[i],urlInfo.var_meta,urlInfo.var_map));
                }
            }
            urlInfo.result.data = rtvdata;
            // disable paging logic for now, not working properly
            /*
            if(b.statistics) {
                st = b.statistics;
                paging = { totalRowCount:(st.totalPages * st.pageSize), firstRow:0, lastRow:st.pageSize-1 }
                urlInfo.result.paging = paging;
                console.log('^^^^^ paging: ' + JSON.stringify(paging, 0, 2));
            }
            */   
            console.log('  ... getData exec_time: ' + (Date.now() - urlInfo.start) + '  ' +
                urlInfo.arrayName+'.'+urlInfo.tableName + ' ' + urlInfo.result.data.length + ' rows\n');// + JSON.stringify(urlInfo.result)+'\n');
        } else {
            urlInfo.res.queryStatus = response ? response.statusCode : 0;
            urlInfo.res.queryStatusText = error;
            console.log('ERROR: query for: ' + urlInfo.url + ' ' + error + ' resp code: ' + urlInfo.res.queryStatus);
        }
        //if (response == undefined) console.log('WARNING: no response from: ' + urlInfo.url);
        callback(urlInfo.res, urlInfo.result, urlInfo.query);
        };
    }
    
};

var dataRow = function(row, row_meta, row_map) {
    //console.log('... row: ' + JSON.stringify(row, 0, 2));
    //console.log('... row_meta: ' + JSON.stringify(row_meta, 0, 2));
    //console.log('... row_map: ' + JSON.stringify(row_map, 0, 2));
    function getRowVal(varpath) {
        var path = varpath[1].split('.');
        var type = row_meta[varpath[0]];
        var value, value0, value1, value2;
        switch(path.length) {
            case 1: 
                value = row[path[0]];
                break;
            case 2:
                value0 = row[path[0]];
                if (value0) value = value0[path[1]];
                break;
            case 3:  
                value0 = row[path[0]];
                if (value0) value1 = value0[path[1]];
                if (value1) value =  value1[path[2]];
                break;
            default:  
                value0 = row[path[0]];
                if (value0) value1 = value0[path[1]];
                if (value1) value2 =  value1[path[2]];
                if (value2) value = value2[path[3]];
                break;
        }

        switch(type) {
            case 'date': return Date.parse(value);
        }
        return value;
    }

    return row_map.map(getRowVal);
}

// *************** Query Devices *************************************

var getDevices = function(tableName, res, query, result, callback){
    //url = baseURL + '/inventory/managedObjects?pageSize=200';
    url = baseURL + '/inventory/managedObjects';
    
    // paging parameters are passed on to IoT server
    rp = query.rp; pn = query.pn;
    if (rp != undefined && rp > 0) {
        url += ('?pageSize=' + rp + '&Page=' + pn)
        
        // example of sort parameters used with a different service; doesn't seem available in c8y
        /*
        if (query.jsortArray) {           
            dir = query.jsortArray[0].dir
            column = query.jsortArray[0].column
            if (column == 'time_stamp') column = 'last_activity'    // last_activity is mapped to time-stamp
            if (column == 'name' || column == 'last_activity' || column == 'created' || column == 'serial') {
                url += ('&dir=' + dir)
                url += ('&sort=' + column)
            }
        }
        */
        console.log('**** page size: ' + rp);
    } else {
        url += ('?pageSize=' + 200 + '&Page=' + 1)
        console.log('**** page size x: ' + 200);
    }
    
    // append timestamp to query to make it unique
    __init_time = Date.now()
    url += ( ((url.indexOf('?') !== -1) ? '&_=' : '?_=') + __init_time)   
    console.log('... devices inventory query url <' + url + '>')
    
    // create object to hold info related to this request
    urlInfo = { res:res, query:query, url:url, __init_time:__init_time }
    
    // make request with closure
    request(url, getDevicesCatalogHandler(url, urlInfo));
    
    function getDevicesCatalogHandler(url, urlInfo) {
        return function(error, response, body) {
            console.log('  ... AttIotDevicesCatalog exec_time: ' + (Date.now() - urlInfo.__init_time))
            if (!error && response.statusCode == 200) {
                var b = JSON.parse(body);
                rtvdata = [];
                if (b.devices !== undefined) {
                    for (i in b.devices) {
                        rtvdata.push(mapDevicesCatalogRow(b.devices[i]));
                    }
                }
                result.data = rtvdata            
                paging = { totalRowCount:b.total, firstRow:0, lastRow:49 }
                result.paging = paging
            } else {  
                console.log('ERROR: query for: ' + urlInfo.url + ' ' + error + ' resp code: ' + (response ? response.statusCode : 'no response') )   
            }
            if (response === undefined) console.log('WARNING: no response from: ' + urlInfo.url);
            callback(urlInfo.res, result, urlInfo.query);
        };
    }
}


// Map one Devices Catalog row to flat row
var mapDevicesCatalogRow = function(row) {
    rtview_row = []
    rtview_row.push(Date.parse(row.last_activity))
    rtview_row.push(row.id)
    rtview_row.push(row.name)
    rtview_row.push(row.serial)
    rtview_row.push(row.status)
    rtview_row.push(row.visibility)
    rtview_row.push(row.description)
    rtview_row.push(Date.parse(row.created))
    rtview_row.push(row.url)
    return rtview_row
}

// Map one Device row to flat row
var mapDevicesRow = function(row) {
    rtview_row = []
    rtview_row.push(Date.parse(row.last_activity))
    rtview_row.push(row.id)
    rtview_row.push(row.name)
    rtview_row.push(row.serial)
    rtview_row.push(row.status)
    rtview_row.push(row.visibility)
    rtview_row.push(row.streams.count)
    rtview_row.push(row.location.latitude)
    rtview_row.push(row.location.longitude)
    rtview_row.push(row.location.elevation)
    rtview_row.push(row.description)
    rtview_row.push(Date.parse(row.created))
    rtview_row.push(row.url)
    return rtview_row
}

