var http = require('http')
  , Router = require('./router')
  , db = require('./db')
  , util = require('util')
  , Resource = require('./resource')
  , Keys = require('./keys')
  , SessionStore = require('./session').SessionStore
  , fs = require('fs')
  , io = require('socket.io')
  , setupReqRes = require('./util/http').setup
  , debug = require('debug')('server')
  , config = require('./config-loader')
  , Cluster = require('./cluster')
  , Context = require('./context')
  , respond = require('doh').createResponder();

function extend(origin, add) {
  // don't do anything if add isn't an object
  if (!add || typeof add !== 'object') return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    if(add[keys[i]]) origin[keys[i]] = add[keys[i]];
  }
  return origin;
}

/**
 * Create an http server with the given options and create a `Router` to handle its requests.
 *
 * Options:
 *
 *   - `db`           the database connection info
 *   - `host`         the server's hostname
 *   - `port`         the server's port
 *   - `dir`          the base directory
 *
 * Properties:
 *
 *  - `sessions`      the servers `SessionStore`
 *  - `sockets`       raw socket.io sockets
 *  - `db`            the servers `Db` instance
 *
 * Example:
 *
 *     var server = new Server({port: 3000, db: {host: 'localhost', port: 27015, name: 'my-db'}});
 *
 *     server.listen();
 *
 * @param {Object} options
 * @return {HttpServer}
 */

function Server(options) {
  var server = process.server = this;
  http.Server.call(this);

  // defaults
  this.options = options = extend({
    port: 2403,
    db: {port: 27017, host: '127.0.0.1', name: 'deployd'}
  }, options);

  debug('started with options %j', options);

  // an object to map a server to its stores
  this.stores = {};

  // back all memory stores with a db
  this.db = db.create(options.db);

  // use socket io for a session based realtime channel
  this.sockets = io.listen(this, {
    'log level': 0
  }).sockets;

  var cluster = this.cluster = new Cluster(this);

  // persist sessions in a store
  var sessionStore = this.sessions = new SessionStore('sessions', this.db, this.sockets, cluster);

  // persist keys in a store
  var keys = this.keys = new Keys();

  this.on('request', function (req, res) {
    // dont handle socket.io requests
    if(req.url.indexOf('/socket.io/') === 0) return;

    debug('%s %s', req.method, req.url);

    // add utilites to req and res
    setupReqRes(req, res, function(err, next) {
      if(err) return res.end(err.message);
      
      sessionStore.createSession(req.cookies.get('sid'), function(err, session) {
        
        if(err) {
          debug('session error', err, session);
          throw err;
        } else {
          // (re)set the session id
          req.cookies.set('sid', session.sid);
          req.session = session;
          
          var route = function() {
            server.loadConfig(function(err, results) {
              if (err) throw err;
              var ctx = new Context(null, req, res, server);
              server.executeMiddleware('request', [ctx], function(err, ctx) {
                server.router.route(req, res);
              }, {
                onTimeout: function(middleware) {
                  if (res.finished) return; // Timeout's ok if they returned something
                  var message = "The last middleware to run was";
                  if (middleware.name) {
                    message = "'" + middleware.name + "'" 
                  }
                  message += " from the '" + middleware.module + "' module."
                  message = "Request timed out. " + message + " Did you forget to call next() or end the response?";
                  respond(server.options.env === 'development' ? message : 'Request timed out', req, res);
                  console.error(message); 
                }
              });
            });
          };

          var root = req.headers['dpd-ssh-key'] || req.cookies.get('DpdSshKey');

          // XXX - need to require root
          if(req.url === '/__proxy') {
            
            cluster.handleProxy(req, res);
            
            return;
          }

          if (options.env === 'development') {
            if (root) { req.isRoot = true; }
            route();
          } else if (root) {
            // all root requests
            // must be authenticated
            debug('authenticating', root);
            keys.get(root, function(err, key) {
              if(err) throw err;
              if(key) req.isRoot = true;
              debug('is root?', session.isRoot);
              route();
            });
          } else {
            // normal route
            route();
          }
        }
      });
    });
  });
  
  server.on('request:error', function (err, req, res) {
    console.error();
    console.error(req.method, req.url, err.stack || err);
    process.exit(1);
  });
}
util.inherits(Server, http.Server);

/**
 * Start listening for incoming connections.
 *
 * @return {Server} for chaining
 */

Server.prototype.listen = function(port, host) {
  var server = this;
  
  server.loadConfig(function(err, results) {
    if (err) {
      console.error();
      console.error("Error loading config: ");
      console.error(err.stack || err);
      process.exit(1);
    } else {     
      http.Server.prototype.listen.call(server, port || server.options.port, host || server.options.host);
    }
  });
  return this;
};

Server.prototype.loadConfig = function(fn) {
  var server = this;
  config.loadConfig(this.options.dir, server, function(err, results) {
    if (err) return fn(err);
    Object.keys(results).forEach(function(k) {
      server[k] = results[k];
    });
    server.emit('loadConfig', results);
    var router = new Router(server.resources, server);
    server.router = router;
    fn();
  });
};

/**
 * Create a new `Store` for persisting data using the database info that was passed to the server when it was created.
 *
 * Example:
 *
 *     // Create a new server
 *     var server = new Server({port: 3000, db: {host: 'localhost', port: 27015, name: 'my-db'}});
 *
 *     // Attach a store to the server
 *     var todos = server.createStore('todos');
 *
 *     // Use the store to CRUD data
 *     todos.insert({name: 'go to the store', done: true}, ...); // see `Store` for more info
 *
 * @param {String} namespace
 * @return {Store}
 */

Server.prototype.createStore = function(namespace) {
	return (this.stores[namespace] = this.db.createStore(namespace));
};

Server.prototype.executeMiddleware = function(type, args, fn, options) {
  var server = this;
  var stack = server.middleware[type];

  options = options || {};
  options.timeout = options.timeout || 2000;  

  if (stack) {
    async.forEachSeries(stack, function(middleware, next) {
      if (options.onTimeout) {
        var completed = false;
        var timeout = setTimeout(function() {
          if (!completed) {
            options.onTimeout(middleware);
          }
        }, middleware.timeout || options.timeout);
      }

      middleware.execute.apply(null, _.union(args, function(err) {
        if (options.onTimeout) {
          clearTimeout(timeout);
          completed = true;
        }
        if (err) return next(err);
        next();
      }));

    }, function(err) {
      if (err) return fn(err);
      fn.apply(null, _.union(null, args));
    });
  } else {
    fn.apply(null, new Error("Could not find middleware stack '" + type + "'"));
  }
};


module.exports = Server;
